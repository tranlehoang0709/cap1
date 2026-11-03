"""One bounded, real Gemini prompt comparison through LLMRunner.

Makes at most two generation requests, no retries, and requires explicit opt-in.
This diagnostic is not Backend-integrated and is unavailable in integrated mode.
"""

from __future__ import annotations

import asyncio
from contextlib import aclosing
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import time
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.clients.provider_factory import create_llm_adapter  # noqa: E402
from app.core.backend_config import BackendSettings  # noqa: E402
from app.core.llm_config import LLMSettings  # noqa: E402
from app.core.provider_config import LLMProviderSettings  # noqa: E402
from app.models.audio import AudioMetadata, TranscriptionResult  # noqa: E402
from app.models.llm import ConversationKey, LLMError, ProviderDelta, TextChunk  # noqa: E402
from app.services.audio_context import AudioContext  # noqa: E402
from app.services.audio_input import BoundedAudioInput  # noqa: E402
from app.services.llm import Conversation, LLMRunner  # noqa: E402
from app.services.turn_detection import TextRules, TurnDetectionConfig, TurnDetector  # noqa: E402
from app.services.turn_input import HalfDuplexTurn  # noqa: E402
from app.services.voice_response_policy import voice_system_prompt  # noqa: E402


def time_context() -> str:
    try:
        zone = ZoneInfo("Asia/Ho_Chi_Minh")
    except ZoneInfoNotFoundError:
        zone = timezone(timedelta(hours=7), "Asia/Ho_Chi_Minh")
    return f"Current local time in Vietnam: {datetime.now(zone).isoformat(timespec='seconds')}."


def make_turn(turn_id: str, deadline: float):
    context = AudioContext(deadline=deadline)
    audio = BoundedAudioInput(AudioMetadata("pcm", 16000, 1, 20, "s16le"), context,
                              max_frames=1, max_bytes=2)
    detector = TurnDetector(TurnDetectionConfig(700, 300, 15000),
                            TextRules((".", "?", "!"), ()), started_at_ms=0)
    turn = HalfDuplexTurn(turn_id, detector, audio,
                          speech_activity=lambda _frame: True, emit=lambda _event: None)
    if not turn.end_input(0):
        raise RuntimeError("turn_boundary_failed")
    return context, turn


async def main() -> int:
    if os.getenv("AI_SERVER_GEMINI_PROMPT_COMPARE_ENABLE", "").lower() != "true":
        print("BLOCKED: explicit prompt comparison opt-in is required")
        return 2
    try:
        if BackendSettings().mode != "development-mock":
            print("BLOCKED: diagnostic requires development-mock; integrated mode stays fail-closed")
            return 2
        provider = LLMProviderSettings()
        if provider.provider != "gemini":
            print("BLOCKED: configured provider is not Gemini; no fallback")
            return 2
        adapter, model = create_llm_adapter(provider, reuse_client=True)
        runner = LLMRunner(LLMSettings(model=model))
    except Exception as exc:
        print(f"BLOCKED: Gemini configuration unavailable ({getattr(exc, 'code', 'configuration')})")
        return 2

    now = time_context()
    policy = voice_system_prompt("Bạn là trợ lý AIVA.")
    variants = (("minimal_policy", policy), ("current_policy", policy + "\n\n" + now))
    question = TranscriptionResult("Thủ đô Việt Nam là gì? Trả lời ngắn gọn.", True, "vi")
    try:
        for label, prompt in variants:
            key = ConversationKey("prompt-compare-user", uuid4().hex, "diagnostic")
            conversation = Conversation(key, max_turns=1, max_history_chars=8000)
            turn_id = uuid4().hex
            context, turn = make_turn(turn_id, time.monotonic() + provider.gemini_timeout_seconds)
            started = time.perf_counter()
            first_delta_ms = None
            answer = []

            class MeasureFirstDelta:
                async def stream(self, request, audio_context):
                    nonlocal first_delta_ms
                    async for event in adapter.stream(request, audio_context):
                        if isinstance(event, ProviderDelta) and first_delta_ms is None:
                            first_delta_ms = round((time.perf_counter() - started) * 1000)
                        yield event

            try:
                async with aclosing(runner.stream(
                    MeasureFirstDelta(), conversation, key, turn, question, prompt, context
                )) as events:
                    async for event in events:
                        if isinstance(event, TextChunk):
                            answer.append(event.text)
                        else:
                            elapsed = round((time.perf_counter() - started) * 1000)
                            usage = event.usage
                            print(f"{label}=PASS model={model} prompt_chars={len(prompt)} "
                                  f"history_messages=0 ttft_ms={first_delta_ms} total_ms={elapsed} "
                                  f"input_tokens={usage.input_tokens if usage else 'unavailable'} "
                                  f"output_tokens={usage.output_tokens if usage else 'unavailable'}")
                            print("response=" + "".join(answer).strip())
                            if not event.complete:
                                return 1
            except LLMError as exc:
                print(f"{label}=FAIL error={exc.code.value}; stopping without retry")
                return 1
            finally:
                await turn.aclose()
        return 0
    finally:
        close = getattr(adapter, "aclose", None)
        if close:
            try:
                await close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
