"""Two isolated mock sessions; explicit mock playback proof, no Cloud/robot I/O."""

import asyncio
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.llm_config import LLMSettings  # noqa: E402
from app.models.audio import AudioFrame, AudioMetadata  # noqa: E402
from app.models.llm import ConversationKey, ProviderDelta, ProviderDone  # noqa: E402
from app.models.tts import AudioFormat, PlaybackLimits, TTSConfig  # noqa: E402
from app.services.llm import LLMRunner  # noqa: E402
from app.services.mock_llm import MockLLMAdapter  # noqa: E402
from app.services.mock_stt import MockStreamingSTT  # noqa: E402
from app.services.mock_tts import MockAudioOutput, MockTTS  # noqa: E402
from app.services.orchestrator import AIOrchestrator, OrchestrationLimits  # noqa: E402
from app.services.turn_detection import TextRules, TurnDetectionConfig  # noqa: E402


async def session(label, runner):
    now = [0]
    stt, output = MockStreamingSTT("Xin chào."), MockAudioOutput()
    llm = MockLLMAdapter((ProviderDelta(f"Chào {label}. "), ProviderDelta("Tôi là AIVA."), ProviderDone(True, "completed")), delay_seconds=.02)
    tts = MockTTS(((b"a0", b"a1"), (b"b0",)), delay_seconds=.01)
    orch = AIOrchestrator(ConversationKey(label, "demo-session", "robot-" + label), stt=stt, llm=llm, tts=tts,
        output=output, llm_runner=runner, input_metadata=AudioMetadata("opus", 16000, 1, 60),
        turn_config=TurnDetectionConfig(700, 300, 15000), language_rules=TextRules((".",), ("...",)),
        speech_activity=lambda frame: frame.payload == b"speech",
        tts_config=TTSConfig("mock-model", "mock-voice", "vi", AudioFormat(AudioMetadata("pcm", 8000, 1, 10, "s16le"), "raw")),
        playback_limits=PlaybackLimits(2, 8, 4, 4, 500, 5),
        limits=OrchestrationLimits(3, .005, 4, 20, 5, 10000), system_prompt="Bạn là AIVA.", clock_ms=lambda: now[0])
    task = orch.start_turn("demo-turn")
    orch.microphone("demo-turn", AudioFrame(b"speech"))
    await stt.partial_ready.wait()
    now[0] = 100
    orch.microphone("demo-turn", AudioFrame(b"quiet"))
    now[0] = 800
    orch.tick()
    print(f"MOCK {label}: after END={orch.state.value}")
    await output.finished.wait()
    print(f"MOCK {label}: sent={[(p.segment_index,p.chunk.sequence) for p in output.delivered]}, state={orch.state.value}, done={task.done()}")
    print(f"MOCK {label}: mic accepted={orch.microphone('demo-turn', AudioFrame(b'blocked'))}")
    output.confirm_complete(output.scope)
    result = await task
    print(f"MOCK {label}: after mock proof={result.state.value}, llm_requests={len(llm.requests)}, metrics_ms={vars(result.metrics)}")


async def main():
    runner = LLMRunner(LLMSettings())
    await asyncio.gather(session("A", runner), session("B", runner))


if __name__ == "__main__":
    asyncio.run(main())
