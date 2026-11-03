"""Adapter-contract tests for file voice orchestration (fixtures are not live evidence)."""

import asyncio
import io
import time
import wave
from types import SimpleNamespace

import pytest

from app.clients.gemini_tts import WAV_FORMAT
from app.core.llm_config import LLMSettings
from app.models.audio import AudioFrame, AudioMetadata, TranscriptionResult, AudioError, ErrorCode
from app.models.llm import ConversationKey, LLMError, LLMErrorCode, ProviderDelta, ProviderDone, Usage
from app.models.tts import AudioFormat, TTSAudioChunk, TTSConfig, TTSError, TTSErrorCode
from app.services.audio_context import AudioContext
from app.services.llm import Conversation, LLMRunner
from app.services.voice_file_pipeline import VoiceFilePipeline, VoicePipelineError


def wav_fixture():
    stream = io.BytesIO()
    with wave.open(stream, "wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(24000); out.writeframes(b"\x02\x00" * 240)
    return stream.getvalue()


class Audio:
    metadata = AudioMetadata("wav", 16000, 1, 20, "s16le")
    def __init__(self): self.sent = False; self.closed = False
    async def read(self):
        if self.sent: return None
        self.sent = True
        return AudioFrame(b"real-file-fixture")
    async def aclose(self): self.closed = True


class STT:
    model = "stt-test"
    def __init__(self, transcripts=None, error=None, hang=False):
        self.transcripts = list(transcripts or ["Xin chào, bạn khỏe không?"])
        self.error, self.hang, self.calls = error, hang, 0
        self.started = asyncio.Event()
    async def transcribe(self, audio, context):
        self.calls += 1
        frame = await audio.read()
        assert frame is not None
        self.started.set()
        if self.hang:
            await asyncio.Event().wait()
        if self.error: raise self.error
        yield TranscriptionResult(self.transcripts.pop(0), True, "vi")


class LLM:
    async def stream(self, request, context):
        self.requests.append(request)
        if self.error: raise self.error
        yield ProviderDelta(self.answer)
        yield ProviderDone(True, "completed", Usage(12, 8, 20))
    def __init__(self, answer="Xin chào, mình luôn khỏe. Cảm ơn bạn!", error=None):
        self.answer, self.error, self.requests = answer, error, []


class TTS:
    def __init__(self, error=None): self.error, self.calls = error, []
    async def synthesize(self, request, context):
        self.calls.append(request)
        if self.error: raise self.error
        yield TTSAudioChunk(0, wav_fixture(), WAV_FORMAT)


def setup_pipeline(stt=None, llm=None, tts=None, *, stt_timeout=1):
    stt, llm, tts = stt or STT(), llm or LLM(), tts or TTS()
    settings = LLMSettings(model="gemini-3.5-flash-lite", max_output_chars=500)
    pipeline = VoiceFilePipeline(stt=stt, llm=llm, tts=tts, llm_runner=LLMRunner(settings),
        llm_settings=settings, stt_model=stt.model, llm_model=settings.model,
        tts_config=TTSConfig("tts-test", "Kore", "vi-VN", WAV_FORMAT),
        stt_timeout_seconds=stt_timeout, llm_timeout_seconds=1, tts_timeout_seconds=1)
    return pipeline, stt, llm, tts


def run_turn(pipeline, key, conversation, audio=None, index=1):
    return asyncio.run(pipeline.process(audio or Audio(), key=key, conversation=conversation, turn_id=f"t{index}"))


def test_adapter_contract_mock_flow_and_multiturn_history_stay_isolated_per_identity():
    pipeline, stt, llm, tts = setup_pipeline(stt=STT(["Xin chào, bạn khỏe không?", "Xin chào, bạn khỏe không?", "Hôm qua tôi hỏi gì?"]))
    key1 = ConversationKey("u1", "s1", "d1")
    key2 = ConversationKey("u2", "s2", "d2")
    c1, c2 = Conversation(key1, max_turns=4, max_history_chars=5000), Conversation(key2, max_turns=4, max_history_chars=5000)
    first = run_turn(pipeline, key1, c1, index=1)
    isolated = run_turn(pipeline, key2, c2, index=1)
    followup = run_turn(pipeline, key1, c1, index=2)
    assert first.transcript == "Xin chào, bạn khỏe không?"
    assert first.answer == "Xin chào, mình luôn khỏe. Cảm ơn bạn!"
    assert first.usage == Usage(12, 8, 20) and first.wav_sample_rate_hz == 24000
    assert first.wav_duration_seconds == pytest.approx(0.01)
    assert llm.requests[0].history == () and llm.requests[1].history == ()
    assert len(llm.requests[2].history) == 2
    assert "15–35" in llm.requests[0].system_prompt
    assert tts.calls[0].text == llm.answer
    assert stt.calls == 3


def test_stt_failure_stops_llm_tts_and_closes_audio():
    class BrokenSTT(STT):
        async def transcribe(self, audio, context):
            await audio.read(); self.started.set(); raise AudioError(ErrorCode.PROVIDER_FAILED)
            yield  # pragma: no cover
    pipeline, stt, llm, tts = setup_pipeline(stt=BrokenSTT())
    audio = Audio(); key = ConversationKey("u", "s", "d")
    with pytest.raises(VoicePipelineError, match="STT:provider_failed"):
        run_turn(pipeline, key, Conversation(key, max_turns=2, max_history_chars=1000), audio)
    assert audio.closed and not llm.requests and not tts.calls


def test_llm_provider_error_does_not_call_tts():
    pipeline, _, _, tts = setup_pipeline(llm=LLM(error=LLMError(LLMErrorCode.PROVIDER_ERROR)))
    key = ConversationKey("u", "s", "d")
    with pytest.raises(VoicePipelineError, match="LLM:provider_error"):
        run_turn(pipeline, key, Conversation(key, max_turns=2, max_history_chars=1000))
    assert not tts.calls


def test_tts_error_is_reported_after_real_stt_llm_stages():
    pipeline, _, llm, _ = setup_pipeline(tts=TTS(error=TTSError(TTSErrorCode.RATE_LIMIT)))
    key = ConversationKey("u", "s", "d")
    with pytest.raises(VoicePipelineError, match="TTS:rate_limited"):
        run_turn(pipeline, key, Conversation(key, max_turns=2, max_history_chars=1000))
    assert llm.requests


def test_stt_timeout_and_external_cancel_release_audio():
    async def run_timeout():
        pipeline, stt, _, _ = setup_pipeline(stt=STT(hang=True), stt_timeout=0.03)
        audio = Audio(); key = ConversationKey("u", "s", "d")
        with pytest.raises(VoicePipelineError, match="STT:deadline_exceeded"):
            await pipeline.process(audio, key=key, conversation=Conversation(key, max_turns=1, max_history_chars=1000), turn_id="timeout")
        assert audio.closed
    async def run_cancel():
        pipeline, stt, _, _ = setup_pipeline(stt=STT(hang=True))
        audio = Audio(); key = ConversationKey("u", "s", "d")
        task = asyncio.create_task(pipeline.process(audio, key=key,
            conversation=Conversation(key, max_turns=1, max_history_chars=1000), turn_id="cancel"))
        await stt.started.wait(); task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        assert audio.closed
    asyncio.run(run_timeout()); asyncio.run(run_cancel())
