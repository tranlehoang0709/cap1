"""Interactive CLI pipeline tests use in-memory adapter fixtures, never live PASS."""

import asyncio
import gc
from datetime import datetime, timezone
import io
import struct
import sys
import wave

import pytest

from app.clients.gemini_tts import PCM_FORMAT, WAV_FORMAT
from app.core.llm_config import LLMSettings
from app.core.tts_config import GeminiTTSSettings
from app.models.llm import LLMError, LLMErrorCode, ProviderDelta, ProviderDone, Usage
from app.models.tts import TTSAudioChunk, TTSError, TTSErrorCode
from app.services.llm import LLMRunner
from app.services.voice_file_pipeline import VoicePipelineError
from scripts.interactive_voice_demo import (
    current_time_instruction, new_session, play_audio, process_question, should_exit,
)


def wav_fixture():
    sink = io.BytesIO()
    samples = [int(1000 * ((i % 40) - 20)) for i in range(240)]
    with wave.open(sink, "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000)
        output.writeframes(struct.pack("<" + "h" * len(samples), *samples))
    return sink.getvalue()


class LLM:
    def __init__(self, error=None):
        self.error, self.requests = error, []
    async def stream(self, request, context):
        self.requests.append(request)
        if self.error:
            raise self.error
        yield ProviderDelta("AIVA trả lời ngắn gọn.")
        yield ProviderDone(True, "completed", Usage(20, 7, 27))


class TTS:
    def __init__(self, error=None): self.error, self.calls = error, []
    async def synthesize(self, request, context):
        self.calls.append(request)
        if self.error: raise self.error
        yield TTSAudioChunk(0, wav_fixture(), WAV_FORMAT)


def test_interactive_text_llm_tts_multiturn_and_new_session_isolation(tmp_path):
    async def scenario():
        llm, tts = LLM(), TTS()
        runner = LLMRunner(LLMSettings(model="gemini-test"))
        settings = GeminiTTSSettings(_env_file=None, GEMINI_API_KEY="test-only", GEMINI_TTS_MODEL="tts-test")
        key, conversation = new_session()
        first = await process_question("Xin chào", llm=llm, tts=tts, runner=runner,
            conversation=conversation, key=key, llm_model="gemini-test", tts_settings=settings,
            llm_timeout_seconds=1, output_dir=tmp_path)
        second = await process_question("Bạn nhớ tôi hỏi gì?", llm=llm, tts=tts, runner=runner,
            conversation=conversation, key=key, llm_model="gemini-test", tts_settings=settings,
            llm_timeout_seconds=1, output_dir=tmp_path)
        next_key, next_conversation = new_session()
        await process_question("Câu hỏi mới", llm=llm, tts=tts, runner=runner,
            conversation=next_conversation, key=next_key, llm_model="gemini-test", tts_settings=settings,
            llm_timeout_seconds=1, output_dir=tmp_path)
        assert first.wav_path is None and first.audio.startswith(b"RIFF") and first.wav_duration_seconds > 0
        assert first.wav_sample_rate_hz == 24000 and first.usage.total_tokens == 27
        assert second.wav_path is None
        assert llm.requests[0].history == ()
        assert len(llm.requests[1].history) == 2
        assert llm.requests[2].history == ()
        assert "Asia/Ho_Chi_Minh" in llm.requests[0].system_prompt
        assert tts.calls[0].text == first.answer
        assert list(tmp_path.iterdir()) == []  # default path stays in memory only
    asyncio.run(scenario())


def test_streaming_pcm_starts_before_llm_completion_and_reports_ttfa(tmp_path):
    class StreamingLLM(LLM):
        def __init__(self):
            super().__init__()
            self.finished = False
        async def stream(self, request, context):
            self.requests.append(request)
            yield ProviderDelta("Câu đầu tiên.")
            await asyncio.sleep(.03)
            yield ProviderDelta(" Câu thứ hai.")
            self.finished = True
            yield ProviderDone(True, "completed", Usage(22, 8, 30))
    class StreamingTTS:
        def __init__(self, llm): self.llm, self.calls = llm, []
        async def stream_pcm(self, request, context):
            self.calls.append(request)
            # The first TTS call must happen while the LLM is still generating.
            if len(self.calls) == 1:
                assert not self.llm.finished
            await asyncio.sleep(.01)
            marker = 1 if request.scope.generation.endswith("-0") else 2
            yield TTSAudioChunk(0, bytes((marker, 0)) * 240, PCM_FORMAT)
    async def scenario():
        llm = StreamingLLM()
        tts = StreamingTTS(llm)
        key, conversation = new_session()
        result = await process_question("Câu hỏi", llm=llm, tts=tts,
            runner=LLMRunner(LLMSettings()), conversation=conversation, key=key,
            llm_model="gemini-test",
            tts_settings=GeminiTTSSettings(_env_file=None, GEMINI_API_KEY="fixture", GEMINI_TTS_MODEL="tts-test"),
            llm_timeout_seconds=1, output_dir=tmp_path)
        assert result.answer == "Câu đầu tiên. Câu thứ hai."
        assert result.audio.startswith(b"RIFF") and result.tts_first_audio_ms >= 0
        assert result.time_to_first_audio_ms >= result.first_sentence_ms
        assert len(tts.calls) == 2
        assert tts.calls[0].text == "Câu đầu tiên."
        assert tts.calls[1].text == "Câu thứ hai."
        with wave.open(io.BytesIO(result.audio), "rb") as generated:
            frames = generated.readframes(generated.getnframes())
        assert frames[:480] == b"\x01\x00" * 240
        assert frames[480:] == b"\x02\x00" * 240
        assert list(tmp_path.iterdir()) == []
    asyncio.run(scenario())


@pytest.mark.parametrize("session_count", [1, 5, 20])
def test_concurrent_sessions_are_isolated_and_bounded(tmp_path, session_count):
    import tracemalloc
    class DelayedLLM(LLM):
        async def stream(self, request, context):
            self.requests.append(request)
            await asyncio.sleep(.01)
            yield ProviderDelta("Đã nhận câu hỏi.")
            yield ProviderDone(True, "completed", Usage(18, 5, 23))
    class StreamingTTS:
        async def stream_pcm(self, request, context):
            await asyncio.sleep(.005)
            yield TTSAudioChunk(0, b"\x02\x00" * 480, PCM_FORMAT)
    async def scenario():
        llm = DelayedLLM()
        runner = LLMRunner(LLMSettings(max_concurrent_requests=5))
        settings = GeminiTTSSettings(_env_file=None, GEMINI_API_KEY="fixture", GEMINI_TTS_MODEL="tts-test")
        pairs = [new_session(user_id=f"u{i}", device_id=f"d{i}") for i in range(session_count)]
        tracemalloc.start()
        results = await asyncio.gather(*(
            process_question(f"question {i}", llm=llm, tts=StreamingTTS(), runner=runner,
                conversation=conversation, key=key, llm_model="gemini-test", tts_settings=settings,
                llm_timeout_seconds=2, output_dir=tmp_path)
            for i, (key, conversation) in enumerate(pairs)), return_exceptions=True)
        successes = [result for result in results if not isinstance(result, Exception)]
        errors = [result for result in results if isinstance(result, VoicePipelineError)]
        assert len(successes) == min(session_count, 5)
        if session_count == 20:
            assert errors and all(error.code == "overloaded" for error in errors)
        assert all(request.history == () for request in llm.requests)
        assert all(len(conversation.history) == 2 for _, conversation in pairs if conversation.history)
        _, peak = tracemalloc.get_traced_memory()
        assert peak > 0
        print(f"fixture_concurrency={session_count} peak_traced_bytes={peak}")
        del results, successes, errors
        gc.collect()
        assert list(tmp_path.iterdir()) == []
        tracemalloc.stop()
    asyncio.run(scenario())


def test_interactive_pipeline_exports_only_when_explicit(tmp_path):
    async def scenario():
        key, conversation = new_session()
        result = await process_question("Xuất WAV", llm=LLM(), tts=TTS(), runner=LLMRunner(LLMSettings()),
            conversation=conversation, key=key, llm_model="gemini",
            tts_settings=GeminiTTSSettings(_env_file=None, GEMINI_API_KEY="test", GEMINI_TTS_MODEL="tts"),
            llm_timeout_seconds=1, output_dir=tmp_path, export_wav=True)
        assert result.wav_path is not None and result.wav_path.is_file()
    asyncio.run(scenario())


def test_empty_question_is_rejected_before_live_adapters(tmp_path):
    async def scenario():
        key, conversation = new_session()
        with pytest.raises(ValueError, match="empty_question"):
            await process_question("  ", llm=LLM(), tts=TTS(), runner=LLMRunner(LLMSettings()),
                conversation=conversation, key=key, llm_model="gemini", 
                tts_settings=GeminiTTSSettings(_env_file=None, GEMINI_API_KEY="test", GEMINI_TTS_MODEL="tts"),
                llm_timeout_seconds=1, output_dir=tmp_path)
    asyncio.run(scenario())


@pytest.mark.parametrize("error,stage_code", [
    (LLMError(LLMErrorCode.RATE_LIMIT), "LLM:rate_limit"),
    (LLMError(LLMErrorCode.SERVICE_UNAVAILABLE), "LLM:service_unavailable"),
    (TTSError(TTSErrorCode.TIMEOUT), "TTS:timeout:segment_0"),
    (TTSError(TTSErrorCode.RATE_LIMIT), "TTS:rate_limited:segment_0"),
])
def test_provider_errors_are_reported_and_do_not_fallback(error, stage_code, tmp_path):
    async def scenario():
        key, conversation = new_session()
        llm = LLM(error if isinstance(error, LLMError) else None)
        tts = TTS(error if isinstance(error, TTSError) else None)
        with pytest.raises(VoicePipelineError) as caught:
            await process_question("Thử lỗi", llm=llm, tts=tts, runner=LLMRunner(LLMSettings()),
                conversation=conversation, key=key, llm_model="gemini", 
                tts_settings=GeminiTTSSettings(_env_file=None, GEMINI_API_KEY="test", GEMINI_TTS_MODEL="tts"),
                llm_timeout_seconds=1, output_dir=tmp_path)
        assert f"{caught.value.stage}:{caught.value.code}" == stage_code
        if isinstance(error, LLMError): assert not tts.calls
    asyncio.run(scenario())


def test_llm_timeout_is_reported_without_tts_or_fallback(tmp_path):
    class Hang:
        async def stream(self, request, context):
            await asyncio.Event().wait()
            yield  # pragma: no cover
    async def scenario():
        key, conversation = new_session()
        tts = TTS()
        with pytest.raises(VoicePipelineError, match="LLM:timeout"):
            await process_question("Chờ quá lâu", llm=Hang(), tts=tts, runner=LLMRunner(LLMSettings()),
                conversation=conversation, key=key, llm_model="gemini",
                tts_settings=GeminiTTSSettings(_env_file=None, GEMINI_API_KEY="test", GEMINI_TTS_MODEL="tts"),
                llm_timeout_seconds=.02, output_dir=tmp_path)
        assert not tts.calls
    asyncio.run(scenario())


def test_time_instruction_is_current_and_exit_is_case_insensitive():
    now = datetime(2026, 1, 2, 3, 4, tzinfo=timezone.utc)
    assert "2026-01-02T10:04:00+07:00" in current_time_instruction(now)
    assert should_exit(" Exit ") and not should_exit("xin chào")


def test_ram_playback_and_explicit_export_fallback(monkeypatch, tmp_path):
    import scripts.interactive_voice_demo as demo
    monkeypatch.setattr(demo.os, "name", "nt")
    class Winsound:
        SND_MEMORY = 1
        def PlaySound(self, audio, mode):
            assert audio == b"RIFF in memory" and mode == self.SND_MEMORY
    monkeypatch.setitem(sys.modules, "winsound", Winsound())
    assert play_audio(b"RIFF in memory") == "memory"
    class BrokenWinsound:
        SND_MEMORY = 1
        def PlaySound(self, *_args): raise OSError("no audio device")
    monkeypatch.setitem(sys.modules, "winsound", BrokenWinsound())
    monkeypatch.setattr(demo.os, "startfile", lambda _path: (_ for _ in ()).throw(OSError()), raising=False)
    assert play_audio(b"RIFF in memory", tmp_path / "voice.wav") is None


def test_integrated_mode_is_rejected_before_provider_factory(monkeypatch):
    import scripts.interactive_voice_demo as demo
    monkeypatch.setattr(demo, "BackendSettings", lambda: type("Settings", (), {"mode": "integrated"})())
    monkeypatch.setattr(demo, "create_llm_adapter", lambda *_: pytest.fail("must not call provider"))
    with pytest.raises(RuntimeError, match="integrated_mode_fail_closed"):
        demo.load_live_adapters()


def test_winmm_pcm_format_matches_waveformatex_layout():
    import ctypes
    from scripts.interactive_voice_demo import StreamingWindowsPCMPlayer
    fmt = StreamingWindowsPCMPlayer._WaveFormat
    offsets = {name: getattr(fmt, name).offset for name, *_ in fmt._fields_}
    assert ctypes.sizeof(fmt) >= 18
    assert offsets["format_tag"] == 0 and offsets["channels"] == 2
    assert offsets["sample_rate"] == 4 and offsets["extra"] == 16


def test_cli_requires_explicit_opt_in_before_configuration(monkeypatch, capsys):
    import scripts.interactive_voice_demo as demo
    monkeypatch.delenv("AI_SERVER_INTERACTIVE_VOICE_DEMO_ENABLE", raising=False)
    monkeypatch.setattr(demo, "load_live_adapters", lambda: pytest.fail("must not load credentials"))
    args = type("Args", (), {"enable": False, "output_dir": "unused"})()
    assert asyncio.run(demo.interactive(args)) == 2
    assert "BLOCKED" in capsys.readouterr().out


def test_audio_export_cli_flag_is_explicit_and_default_is_off():
    from scripts.interactive_voice_demo import build_parser
    assert build_parser().parse_args([]).export_audio is False
    assert build_parser().parse_args(["--export-audio"]).export_audio is True
