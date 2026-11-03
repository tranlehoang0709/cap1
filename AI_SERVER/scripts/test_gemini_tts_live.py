"""One-shot TTS-only live smoke test: fixed Vietnamese text -> real WAV.

No LLM call, mock provider, automatic retry, or billing change is performed.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import os
from pathlib import Path
import sys
import time
import wave

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.clients.gemini_tts import WAV_FORMAT  # noqa: E402
from app.clients.tts_factory import create_gemini_tts_adapter  # noqa: E402
from app.core.tts_config import GeminiTTSSettings  # noqa: E402
from app.models.llm import ConversationKey  # noqa: E402
from app.models.tts import PlaybackScope, TTSConfig, TTSRequest, TTSError  # noqa: E402
from app.services.audio_context import AudioContext  # noqa: E402


TEXT = "Xin chào, tôi là AIVA."


async def run(play_audio: bool = False, export_wav: bool = False) -> int:
    try:
        settings = GeminiTTSSettings()
        adapter = create_gemini_tts_adapter(settings)
    except Exception as error:
        print(f"BLOCKED: configuration unavailable ({getattr(error, 'code', 'configuration')})")
        return 2
    print(f"model: {adapter.model}\nvoice: {adapter.voice}")
    print("pricing_mode: API price table lists a Free Tier; project entitlement is confirmed only by a successful request")

    key = ConversationKey("tts-live-test-user", "tts-live-test-session", "tts-live-test-device")
    request = TTSRequest(PlaybackScope(key, "tts-live-test-turn", "tts-live-test-generation"), 0, TEXT,
        TTSConfig(adapter.model, adapter.voice, "vi-VN", WAV_FORMAT))
    context = AudioContext(deadline=time.monotonic() + settings.timeout_seconds + 2)
    started = time.perf_counter()
    chunks = []
    try:
        async for chunk in adapter.synthesize(request, context):
            chunks.append(chunk.payload)
    except TTSError as error:
        print(f"LIVE FAIL: {error.code.value}")
        return 1
    finally:
        context.cancel()

    wav_bytes = b"".join(chunks)
    if not wav_bytes:
        print("LIVE FAIL: empty_audio")
        return 1
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
            channels, rate, frames, width = wav.getnchannels(), wav.getframerate(), wav.getnframes(), wav.getsampwidth()
            pcm = wav.readframes(frames)
            duration = frames / rate
            # Reject silence: a real TTS result should contain nonzero speech energy.
            has_signal = any(pcm)
            if (channels != 1 or rate != 24000 or width != 2 or duration <= 0 or not has_signal
                    or wav.getcomptype() != "NONE"):
                raise ValueError
    except Exception:
        print("LIVE FAIL: invalid_wav_or_silent_audio")
        return 1

    output = None
    if export_wav:
        output = Path(os.getenv("AI_SERVER_TTS_LIVE_OUTPUT", str(ROOT / "artifacts" / "gemini_tts_live.wav"))).resolve()
        allowed = (ROOT / "artifacts").resolve()
        if output.parent != allowed and allowed not in output.parents:
            print("LIVE FAIL: WAV export path must remain under AI_SERVER/artifacts")
            return 1
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(wav_bytes)
    print("TTS-ONLY LIVE PASS")
    print(f"text: {TEXT}")
    print(f"latency_ms: {round((time.perf_counter()-started)*1000)}")
    print(f"wav_export: {output if output else 'disabled (audio stayed in RAM)'}")
    print(f"size_bytes: {len(wav_bytes)}\nduration_seconds: {duration:.2f}")
    print(f"channels: {channels}\nsample_rate_hz: {rate}\nsample_width_bits: {width*8}\nnon_silent_pcm: {has_signal}")
    if play_audio:
        try:
            import winsound
            winsound.PlaySound(wav_bytes, winsound.SND_MEMORY)
            print("windows_playback: returned normally")
        except Exception as error:
            print(f"windows_playback: FAIL ({type(error).__name__})")
            return 1
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--play", action="store_true", help="Play the verified WAV through Windows winsound")
    parser.add_argument("--export-audio", "--export-wav", dest="export_audio", action="store_true",
                        help="Explicitly save WAV under AI_SERVER/artifacts")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.play, args.export_audio)))
