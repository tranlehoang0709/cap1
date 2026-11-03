"""Generate a synthetic tone WAV and test mock playback ordering/proof offline."""

import asyncio
from pathlib import Path
import math
import struct
import sys
import time
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models.audio import AudioFrame, AudioMetadata, TranscriptionResult  # noqa: E402
from app.models.llm import ConversationKey, LLMResult, TextChunk  # noqa: E402
from app.models.tts import AudioFormat, PlaybackLimits, TTSConfig  # noqa: E402
from app.services.audio_context import AudioContext  # noqa: E402
from app.services.audio_input import BoundedAudioInput  # noqa: E402
from app.services.mock_tts import MockAudioOutput, MockTTS  # noqa: E402
from app.services.playback import PlaybackScheduler  # noqa: E402
from app.services.turn_detection import SpeechActivity, TextRules, TranscriptEvent, TurnDetectionConfig, TurnDetector  # noqa: E402
from app.services.turn_input import HalfDuplexTurn  # noqa: E402


async def source():
    yield TextChunk(0, "Xin chào.", True)
    yield TextChunk(1, " Đây là audio giả.", True)
    yield LLMResult("Xin chào. Đây là audio giả.", True, "completed", None)


async def main():
    # Demo fixture only. These are NOT production TTS or firmware wire choices.
    sample_rate = 8000
    frame = struct.pack("<80h", *(int(3000 * math.sin(2 * math.pi * 440 * i / sample_rate)) for i in range(80)))
    fixtures = ((frame,) * 10, (frame,) * 10)
    target = Path(__file__).resolve().parents[1] / ".test-artifacts" / "tts-mock-demo.wav"
    target.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(target), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(b"".join(chunk for segment in fixtures for chunk in segment))
    fmt = AudioFormat(AudioMetadata("pcm", sample_rate, 1, 10, "s16le"), "raw")
    config = TTSConfig("mock-model", "mock-voice", "vi", fmt)
    audio = BoundedAudioInput(AudioMetadata("opus", 16000, 1, 60),
        AudioContext(deadline=time.monotonic() + 10), max_frames=2, max_bytes=100)
    d = TurnDetector(TurnDetectionConfig(700, 300, 15000), TextRules((".",), ()), started_at_ms=0)
    turn = HalfDuplexTurn("demo", d, audio, speech_activity=lambda frame: True, emit=lambda event: None)
    d.speech(SpeechActivity(0, True))
    turn.transcription(TranscriptEvent(100, TranscriptionResult("Chào.", True)))
    d.speech(SpeechActivity(200, False))
    turn.tick(900)
    key = ConversationKey("mock-user", "mock-session", "mock-robot")
    scheduler = PlaybackScheduler(key, PlaybackLimits(2, 320, 160, 2, 500, 2))
    output = MockAudioOutput()
    task = asyncio.create_task(scheduler.play(MockTTS(fixtures), output, source(), key=key, turn=turn, config=config))
    try:
        await output.finished.wait()
        print(f"MOCK ONLY; WAV fixture: {target}")
        print(f"Metadata: {fmt}")
        print(f"Order: {[(item.segment_index, item.chunk.sequence) for item in output.delivered]}")
        print(f"Sent all: phase={turn.phase}, playback_complete={task.done()}")
        accepted = turn.microphone(AudioFrame(b"mic-dropped"), metadata=audio.metadata, at_ms=1000)
        print(f"Mic accepted during SPEAKING: {accepted}; mic buffer bytes={audio.buffered_bytes}")
        output.confirm_complete(output.scope)
        receipt = await task
        print(f"Explicit MOCK proof: source={receipt.evidence.source}; ready_for_next_turn={receipt.ready_for_next_turn}; old_turn={turn.phase}")
        print(f"Queue peak: chunks={scheduler.queue.peak_chunks}, bytes={scheduler.queue.peak_bytes}; remaining={scheduler.queue.bytes}")
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await turn.aclose()


if __name__ == "__main__":
    asyncio.run(main())
