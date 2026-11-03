"""Explicit standalone live diagnostic through LLMRunner and Gemini adapter.

This is not a robot or Backend-integrated execution path. Run only with the
explicit development opt-in; integrated WebSocket execution remains fail-closed.
"""

from __future__ import annotations

import asyncio
from contextlib import aclosing
import os
from pathlib import Path
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.clients.provider_factory import create_llm_adapter  # noqa: E402
from app.core.backend_config import BackendSettings  # noqa: E402
from app.core.llm_config import LLMSettings  # noqa: E402
from app.core.provider_config import LLMProviderSettings  # noqa: E402
from app.models.audio import AudioMetadata, TranscriptionResult  # noqa: E402
from app.models.llm import ConversationKey, LLMError, TextChunk  # noqa: E402
from app.services.audio_context import AudioContext  # noqa: E402
from app.services.audio_input import BoundedAudioInput  # noqa: E402
from app.services.llm import Conversation, LLMRunner  # noqa: E402
from app.services.turn_detection import SpeechActivity, TextRules, TranscriptEvent, TurnDetectionConfig, TurnDetector  # noqa: E402
from app.services.turn_input import HalfDuplexTurn  # noqa: E402


async def run() -> int:
    if os.getenv("AI_SERVER_LLM_DEMO_ENABLE", "").lower() != "true":
        print("BLOCKED: set AI_SERVER_LLM_DEMO_ENABLE=true for explicit standalone diagnostic")
        return 2
    try:
        backend_mode = BackendSettings().mode
    except Exception:
        print("BLOCKED: Backend integration configuration is invalid")
        return 2
    if backend_mode != "development-mock":
        print("BLOCKED: standalone diagnostic requires AI_SERVER_BACKEND_MODE=development-mock; integrated mode remains fail-closed")
        return 2
    provider_settings = LLMProviderSettings()
    if provider_settings.provider != "gemini":
        print("BLOCKED: AI_SERVER_LLM_PROVIDER must be gemini; no provider fallback is performed")
        return 2
    try:
        adapter, model = create_llm_adapter(provider_settings)
        llm_settings = LLMSettings(model=model)
    except Exception as error:
        print(f"BLOCKED: provider configuration invalid ({getattr(error, 'code', 'configuration')})")
        return 2

    context = AudioContext(deadline=time.monotonic() + provider_settings.gemini_timeout_seconds + 5)
    audio = BoundedAudioInput(AudioMetadata("opus", 16000, 1, 60), context, max_frames=1, max_bytes=64)
    detector = TurnDetector(TurnDetectionConfig(700, 300, 15000), TextRules((".", "?", "!"), ()), started_at_ms=0)
    turn = HalfDuplexTurn("gemini-diagnostic-turn", detector, audio,
                          speech_activity=lambda _frame: True, emit=lambda _event: None)
    detector.speech(SpeechActivity(0, True))
    detector.speech(SpeechActivity(100, False))
    transcript = TranscriptionResult("Hello AIVA.", True)
    turn.transcription(TranscriptEvent(200, transcript))
    turn.tick(900)
    conversation = Conversation(ConversationKey("diagnostic-user", "diagnostic-session", "diagnostic-device"),
                                max_turns=1, max_history_chars=5000)
    runner = LLMRunner(llm_settings)
    started = time.perf_counter()
    first_token_ms = None
    try:
        async with aclosing(runner.stream(adapter, conversation, conversation.key, turn,
                transcript, "B?n l? AIVA. H?y tr? l?i ng?n g?n b?ng ti?ng Vi?t.", context)) as events:
            async for event in events:
                if isinstance(event, TextChunk):
                    if first_token_ms is None:
                        first_token_ms = round((time.perf_counter() - started) * 1000)
                    print(event.text, end="", flush=True)
                else:
                    total_ms = round((time.perf_counter() - started) * 1000)
                    print("\nPASS: REAL GEMINI RESPONSE" if event.complete else "\nFAIL: incomplete provider response")
                    print(f"provider: gemini\nmodel: {model}")
                    print(f"time_to_first_token_ms: {first_token_ms if first_token_ms is not None else 'unavailable'}")
                    print(f"total_latency_ms: {total_ms}")
                    usage = event.usage
                    print(f"input_tokens: {usage.input_tokens if usage else 'unavailable'}")
                    print(f"output_tokens: {usage.output_tokens if usage else 'unavailable'}")
                    print(f"total_tokens: {usage.total_tokens if usage else 'unavailable'}")
                    print("scope: standalone development diagnostic; no Backend auth/quota/usage")
                    return 0 if event.complete and usage is not None else 1
    except LLMError as error:
        print(f"\nFAIL: {error.code.value}")
        if error.code.value == "service_unavailable":
            print("provider_status: 503")
        elif error.code.value == "rate_limit":
            print("provider_status: 429")
        return 1
    finally:
        await turn.aclose()
    print("FAIL: missing final response")
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
