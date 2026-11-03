"""Transcribe one explicit audio file through STTAdapter (never a mock)."""

from __future__ import annotations
import asyncio
from pathlib import Path
import sys
import time
import wave
import io

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.clients.stt_factory import create_gemini_stt_adapter  # noqa: E402
from app.core.stt_config import GeminiSTTSettings  # noqa: E402
from app.models.audio import AudioError, AudioMetadata, AudioFrame, ErrorCode  # noqa: E402
from app.services.audio_context import AudioContext  # noqa: E402
from app.services.stt import transcribe  # noqa: E402


class FileAudioInput:
    def __init__(self, path: Path, settings: GeminiSTTSettings):
        self.path, self.settings = path, settings
        self.data = path.read_bytes()
        if len(self.data) > settings.max_audio_bytes:
            raise AudioError(ErrorCode.AUDIO_TOO_LARGE)
        ext = path.suffix.lower()
        if ext == ".ogg":
            self.metadata = AudioMetadata("ogg_opus", 24000, 1, 20)
        elif ext == ".wav":
            try:
                with wave.open(io.BytesIO(self.data), "rb") as file:
                    if file.getnchannels() != 1 or file.getsampwidth() != 2 or file.getcomptype() != "NONE":
                        raise ValueError
                    seconds = file.getnframes() / file.getframerate()
                    if seconds > settings.max_duration_seconds:
                        raise ValueError
                    self.metadata = AudioMetadata("wav", file.getframerate(), 1, 20, "s16le")
            except Exception:
                raise AudioError(ErrorCode.INVALID_AUDIO) from None
        else:
            raise AudioError(ErrorCode.INVALID_METADATA)
        self.sent = False

    async def read(self):
        if self.sent:
            return None
        self.sent = True
        return AudioFrame(self.data)

    async def aclose(self):
        self.data = b""


async def main() -> int:
    if len(sys.argv) != 2:
        print("usage: python scripts/gemini_stt_demo.py <Vietnamese-recording.wav|opus.ogg>")
        return 2
    path = Path(sys.argv[1]).resolve()
    if not path.is_file():
        print("BLOCKED: audio file not found")
        return 2
    settings = GeminiSTTSettings()
    try:
        adapter = create_gemini_stt_adapter(settings)
        audio = FileAudioInput(path, settings)
    except AudioError as error:
        print(f"BLOCKED: {error.code.value}")
        return 2
    except Exception:
        print("BLOCKED: invalid STT configuration or audio file")
        return 2
    context = AudioContext(deadline=time.monotonic() + settings.timeout_seconds)
    start = time.perf_counter()
    try:
        result = await transcribe(adapter, audio, context)
    except AudioError as error:
        status = "FAIL"
        print(f"{status}: {error.code.value}")
        return 1
    print("PASS: LIVE GEMINI STT")
    print(f"provider: Gemini API\nmodel: {settings.model}")
    print(f"latency_ms: {round((time.perf_counter() - start) * 1000)}")
    print(f"audio_bytes: {path.stat().st_size}")
    print(f"language: {result.language or 'auto'}")
    print(f"transcript: {result.text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
