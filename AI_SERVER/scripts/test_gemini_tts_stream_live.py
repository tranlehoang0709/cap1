"""One real Gemini PCM-stream request; audio stays in RAM and is never retried."""

import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.clients.tts_factory import create_gemini_tts_adapter  # noqa: E402
from app.clients.gemini_tts import WAV_FORMAT  # noqa: E402
from app.core.tts_config import GeminiTTSSettings  # noqa: E402
from app.models.llm import ConversationKey  # noqa: E402
from app.models.tts import PlaybackScope, TTSConfig, TTSRequest, TTSError  # noqa: E402
from app.services.audio_context import AudioContext  # noqa: E402


async def run() -> int:
    try:
        settings = GeminiTTSSettings()
        adapter = create_gemini_tts_adapter(settings)
    except Exception:
        print("BLOCKED: configuration_unavailable")
        return 2
    key = ConversationKey("tts-stream-live", "one-shot", "keyboard")
    request = TTSRequest(PlaybackScope(key, "turn", "tts-live"), 0, "Xin chào, tôi là AIVA.",
        TTSConfig(adapter.model, adapter.voice, "vi-VN", WAV_FORMAT))
    started = time.perf_counter()
    deadline = time.monotonic() + settings.timeout_seconds + 2
    context = AudioContext(deadline=deadline)
    def diag(event: str, **fields):
        values = " ".join(f"{key}={value}" for key, value in fields.items())
        print(f"TTS_DIAG event={event} elapsed_ms={round((time.perf_counter()-started)*1000)} {values}".rstrip(), flush=True)
    adapter._diagnostic_hook = lambda event, _request: diag(event, segment=0)
    diag("segment_created", segment=0, text_chars=len(request.text), nonempty=bool(request.text.strip()))
    diag("segment_queued", segment=0)
    diag("segment_dequeued", segment=0, queue_wait_ms=0)
    diag("deadline_set", segment=0, timeout_ms=round((deadline-time.monotonic())*1000))
    chunks, count, first_ms = bytearray(), 0, None
    try:
        async for chunk in adapter.stream_pcm(request, context):
            if first_ms is None:
                first_ms = round((time.perf_counter() - started) * 1000)
            chunks.extend(chunk.payload)
            count += 1
        if not chunks or not any(chunks):
            print("LIVE FAIL: invalid_or_silent_pcm")
            return 1
        duration = len(chunks) / (24000 * 2)
        print("TTS STREAM LIVE PASS")
        print(f"model: {adapter.model}; voice: {adapter.voice}")
        print(f"time_to_first_audio_ms: {first_ms}; total_ms: {round((time.perf_counter()-started)*1000)}")
        print(f"chunks: {count}; bytes: {len(chunks)}; duration_seconds: {duration:.2f}; format: PCM16 mono 24000 Hz")
        return 0
    except TTSError as error:
        print(f"TTS STREAM LIVE FAIL: {error.code.value}")
        return 1
    finally:
        context.cancel()
        diag("context_cancelled_for_cleanup", segment=0)
        await adapter.aclose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enable", action="store_true", help="Explicitly permit a live TTS request")
    args = parser.parse_args()
    if not args.enable or os.getenv("AI_SERVER_GEMINI_TTS_STREAM_TEST_ENABLE", "").lower() != "true":
        print("BLOCKED: requires --enable and AI_SERVER_GEMINI_TTS_STREAM_TEST_ENABLE=true")
        return 2
    return asyncio.run(run())


if __name__ == "__main__":
    raise SystemExit(main())
