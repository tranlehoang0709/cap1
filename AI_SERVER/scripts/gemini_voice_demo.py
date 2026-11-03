"""Text -> Gemini LLMRunner -> Gemini TTS adapter -> playable WAV.

Standalone live diagnostic only. It does not authenticate/quota through BE and
does not claim ESP32 playback completion.
"""

from __future__ import annotations

import asyncio
import argparse
from contextlib import aclosing
import os
from pathlib import Path
import sys
import time
import wave
import io

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.clients.provider_factory import create_llm_adapter  # noqa: E402
from app.clients.tts_factory import create_gemini_tts_adapter  # noqa: E402
from app.core.backend_config import BackendSettings  # noqa: E402
from app.core.llm_config import LLMSettings  # noqa: E402
from app.core.provider_config import LLMProviderSettings  # noqa: E402
from app.core.tts_config import GeminiTTSSettings  # noqa: E402
from app.clients.gemini_tts import WAV_FORMAT  # noqa: E402
from app.models.audio import AudioMetadata, TranscriptionResult  # noqa: E402
from app.models.llm import ConversationKey, LLMError, TextChunk  # noqa: E402
from app.models.tts import PlaybackScope, TTSConfig, TTSRequest  # noqa: E402
from app.services.audio_context import AudioContext  # noqa: E402
from app.services.audio_input import BoundedAudioInput  # noqa: E402
from app.services.llm import Conversation, LLMRunner  # noqa: E402
from app.services.turn_detection import SpeechActivity, TextRules, TranscriptEvent, TurnDetectionConfig, TurnDetector  # noqa: E402
from app.services.turn_input import HalfDuplexTurn  # noqa: E402
from app.services.voice_response_policy import voice_system_prompt  # noqa: E402


async def run(export_wav: bool = False) -> int:
    if os.getenv("AI_SERVER_VOICE_DEMO_ENABLE", "").lower() != "true":
        print("BLOCKED: set AI_SERVER_VOICE_DEMO_ENABLE=true to opt into a standalone live request")
        return 2
    try:
        if BackendSettings().mode != "development-mock":
            print("BLOCKED: standalone demo requires development-mock; integrated mode remains fail-closed")
            return 2
        provider = LLMProviderSettings()
        tts_settings = GeminiTTSSettings()
        if provider.provider != "gemini":
            print("BLOCKED: AI_SERVER_LLM_PROVIDER must be gemini; no fallback")
            return 2
        llm, llm_model = create_llm_adapter(provider)
        tts = create_gemini_tts_adapter(tts_settings)
        if provider.gemini_model is None:
            print("BLOCKED: GEMINI_MODEL is not configured")
            return 2
    except Exception as error:
        print(f"BLOCKED: configuration invalid ({getattr(error, 'code', 'configuration')})")
        return 2

    key = ConversationKey("voice-demo-user", "voice-demo-session", "voice-demo-device")
    conversation = Conversation(key, max_turns=10, max_history_chars=5000)
    context = AudioContext(deadline=time.monotonic() + provider.gemini_timeout_seconds + tts_settings.timeout_seconds + 10)
    audio = BoundedAudioInput(AudioMetadata("pcm", 16000, 1, 20, "s16le"), context, max_frames=1, max_bytes=2)
    detector = TurnDetector(TurnDetectionConfig(700, 300, 15000), TextRules((".", "?", "!"), ()), started_at_ms=0)
    turn = HalfDuplexTurn("voice-demo-turn", detector, audio, speech_activity=lambda _frame: True, emit=lambda _event: None)
    detector.speech(SpeechActivity(0, True)); detector.speech(SpeechActivity(100, False))
    turn.transcription(TranscriptEvent(200, TranscriptionResult("Xin chào AIVA, bạn có thể giúp gì cho tôi?", True)))
    turn.tick(900)

    answer = ""
    llm_start = time.perf_counter()
    try:
        async with aclosing(LLMRunner(LLMSettings(model=llm_model)).stream(
                llm, conversation, key, turn,
                TranscriptionResult("Xin chào AIVA, bạn có thể giúp gì cho tôi?", True),
                voice_system_prompt("Bạn là trợ lý AIVA."), context)) as events:
            async for event in events:
                if isinstance(event, TextChunk):
                    answer += event.text
                else:
                    if not event.complete or event.usage is None:
                        print("FAIL: Gemini LLM returned incomplete/unreported usage")
                        return 1
                    llm_ms = round((time.perf_counter() - llm_start) * 1000)
                    usage = event.usage
    except LLMError as error:
        print(f"FAIL: LLM {error.code.value}")
        return 1
    finally:
        await turn.aclose()
    if not answer.strip():
        print("FAIL: empty LLM answer")
        return 1

    tts_turn = AudioContext(deadline=time.monotonic() + tts_settings.timeout_seconds + 5)
    tts_config = TTSConfig(tts.model, tts.voice, "vi-VN", WAV_FORMAT)
    request = TTSRequest(PlaybackScope(key, "voice-demo-turn", "voice-demo-generation"), 0, answer, tts_config)
    started = time.perf_counter()
    chunks = []
    try:
        async for chunk in tts.synthesize(request, tts_turn):
            chunks.append(chunk.payload)
    except Exception as error:
        print(f"FAIL: TTS {getattr(getattr(error, 'code', None), 'value', 'provider_error')}")
        return 1
    finally:
        tts_turn.cancel()
    data = b"".join(chunks)
    if not data:
        print("FAIL: empty TTS audio")
        return 1
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels, rate, frames, width = wav.getnchannels(), wav.getframerate(), wav.getnframes(), wav.getsampwidth()
            duration = frames / rate
            if channels != 1 or rate != 24000 or width != 2 or duration <= 0:
                raise ValueError("unexpected WAV metadata")
    except Exception:
        print("FAIL: invalid WAV output")
        return 1
    output = None
    if export_wav:
        output = Path(os.getenv("AI_SERVER_VOICE_DEMO_OUTPUT", str(ROOT / "artifacts" / "gemini_voice_demo.wav")))
        allowed = (ROOT / "artifacts").resolve()
        output = output.resolve()
        if output.parent != allowed and allowed not in output.parents:
            print("FAIL: WAV export path must remain under AI_SERVER/artifacts")
            return 1
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
    print("PASS: REAL GEMINI LLM + REAL GEMINI TTS")
    print(f"llm_model: {llm_model}\nllm_latency_ms: {llm_ms}")
    print(f"llm_input_tokens: {usage.input_tokens}\nllm_output_tokens: {usage.output_tokens}")
    print(f"answer: {answer.strip()}")
    print(f"tts_model: {tts.model}\ntts_voice: {tts.voice}\ntts_latency_ms: {round((time.perf_counter()-started)*1000)}")
    print(f"wav_export: {output if output else 'disabled (audio stayed in RAM)'}")
    print(f"wav_sample_rate_hz: {rate}\nwav_channels: {channels}\nwav_duration_seconds: {duration:.2f}")
    print("scope: standalone diagnostic; no Backend auth/quota/usage or ESP32 playback evidence")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-audio", "--export-wav", dest="export_audio", action="store_true",
                        help="Explicitly write WAV under AI_SERVER/artifacts")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.export_audio)))
