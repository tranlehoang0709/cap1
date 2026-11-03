"""Offline streaming demo. No OpenAI client, API credential or network access."""

import asyncio
from contextlib import aclosing
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.llm_config import LLMSettings  # noqa: E402
from app.models.audio import AudioMetadata, TranscriptionResult  # noqa: E402
from app.models.llm import ConversationKey, ProviderDelta, ProviderDone, TextChunk, Usage  # noqa: E402
from app.services.audio_context import AudioContext  # noqa: E402
from app.services.audio_input import BoundedAudioInput  # noqa: E402
from app.services.llm import Conversation, LLMRunner  # noqa: E402
from app.services.mock_llm import MockLLMAdapter  # noqa: E402
from app.services.turn_detection import SpeechActivity, TextRules, TranscriptEvent, TurnDetectionConfig, TurnDetector  # noqa: E402
from app.services.turn_input import HalfDuplexTurn  # noqa: E402


async def main():
    config = LLMSettings()
    context = AudioContext(deadline=time.monotonic() + 10)
    audio = BoundedAudioInput(AudioMetadata("opus", 16000, 1, 60), context, max_frames=2, max_bytes=100)
    detector = TurnDetector(TurnDetectionConfig(700, 300, 15000), TextRules((".",), ()), started_at_ms=0)
    turn = HalfDuplexTurn("demo-turn", detector, audio, speech_activity=lambda frame: False, emit=lambda event: None)
    detector.speech(SpeechActivity(0, True))
    detector.speech(SpeechActivity(100, False))
    turn.transcription(TranscriptEvent(200, TranscriptionResult("Chào AIVA.", True)))
    turn.tick(800)
    conversation = Conversation(ConversationKey("demo-user", "demo-session", "demo-robot"),
                                max_turns=3, max_history_chars=3000)  # DEMO budgets only.
    mock = MockLLMAdapter((ProviderDelta("Xin "), ProviderDelta("chào. "),
                           ProviderDelta("Mình có thể giúp gì cho bạn?"),
                           ProviderDone(True, "completed", Usage(12, 15, 27))), delay_seconds=.15)
    print("MOCK ONLY; STT input: Chào AIVA.", flush=True)
    start = time.monotonic()
    try:
        async with aclosing(LLMRunner(config).stream(mock, conversation, conversation.key, turn,
            TranscriptionResult("Chào AIVA.", True), "Bạn là AIVA.", context)) as stream:
            async for event in stream:
                elapsed = time.monotonic() - start
                if isinstance(event, TextChunk):
                    print(f"{elapsed:.2f}s chunk[{event.index}] tts_safe={event.tts_safe}: {event.text!r}", flush=True)
                else:
                    print(f"{elapsed:.2f}s final complete={event.complete}: {event.text!r}; usage=MOCK {event.usage}", flush=True)
    finally:
        await turn.aclose()


if __name__ == "__main__":
    asyncio.run(main())
