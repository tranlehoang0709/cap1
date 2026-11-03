"""In-memory mock E2E only, no live speech/Cloud/robot validation."""

import asyncio
import io
import logging

import pytest

from app.core.llm_config import LLMSettings
from app.core.logging import configure_logging, get_logger, _JsonFormatter
from app.models.audio import AudioFrame, AudioMetadata, TranscriptionResult
from app.models.llm import ConversationKey, ProviderDelta, ProviderDone
from app.models.tts import AudioFormat, PlaybackLimits, TTSConfig, TTSAudioChunk
from app.services.llm import LLMRunner
from app.services.mock_llm import MockLLMAdapter
from app.services.mock_tts import MockAudioOutput, MockTTS
from app.services.orchestrator import AIOrchestrator, Control, OrchestrationLimits, SessionState
from app.services.turn_detection import TextRules, TurnDetectionConfig


class Clock:
    value = 0
    def __call__(self):
        return self.value


class MockSTT:
    def __init__(self, value="Chào.", *, early=False):
        self.value, self.early = value, early
        self.partial = asyncio.Event()
        self.frames = []
        self.released = 0
    async def transcribe(self, audio, context):
        try:
            frame = await audio.read()
            if frame is not None:
                self.frames.append(frame.payload)
            yield TranscriptionResult(self.value, False)
            self.partial.set()
            if not self.early:
                while (frame := await audio.read()) is not None:
                    self.frames.append(frame.payload)
            yield TranscriptionResult(self.value, True)
        finally:
            self.released += 1


def setup(*, user="u", device="d", stt=None, llm=None, tts=None, seconds=2, input_bytes=20, output=None, runner=None):
    clock = Clock()
    stt = stt or MockSTT()
    llm = llm or MockLLMAdapter((ProviderDelta("Xin chào. "), ProviderDelta("Tôi là AIVA."), ProviderDone(True, "completed")), delay_seconds=.01)
    tts = tts or MockTTS(((b"a0", b"a1"), (b"b0",)), delay_seconds=.005)
    output = output or MockAudioOutput()
    vad = []
    def activity(frame):
        vad.append(frame.payload)
        return frame.payload == b"speech"
    orch = AIOrchestrator(ConversationKey(user, "session", device), stt=stt, llm=llm, tts=tts, output=output,
        llm_runner=runner or LLMRunner(LLMSettings()), input_metadata=AudioMetadata("opus", 16000, 1, 60),
        turn_config=TurnDetectionConfig(700, 300, 15000), language_rules=TextRules((".",), ("...", "và")),
        speech_activity=activity, tts_config=TTSConfig("mock-model", "mock-voice", "vi",
            AudioFormat(AudioMetadata("pcm", 8000, 1, 10, "s16le"), "raw")),
        playback_limits=PlaybackLimits(2, 8, 4, 4, 500, 5),
        limits=OrchestrationLimits(seconds, .005, 4, input_bytes, 5, 10000), system_prompt="PRIVATE_PROMPT",
        clock_ms=clock)
    return orch, clock, stt, llm, tts, output, vad


async def end_input(items):
    orch, clock, stt, *_ = items
    assert orch.microphone(orch.turn.turn_id, AudioFrame(b"speech"))
    await asyncio.wait_for(stt.partial.wait(), 1)
    await asyncio.sleep(0)
    clock.value = 100
    assert orch.microphone(orch.turn.turn_id, AudioFrame(b"quiet"))
    clock.value = 800
    orch.tick()


def test_mock_e2e_streaming_half_duplex_and_metrics():
    async def scenario():
        items = setup()
        orch, clock, stt, llm, tts, output, vad = items
        task = orch.start_turn("t1")
        await end_input(items)
        assert orch.state == SessionState.PROCESSING
        assert not orch.microphone("t1", AudioFrame(b"processing"))
        with pytest.raises(ValueError):
            orch.start_turn("duplicate")
        await asyncio.wait_for(output.finished.wait(), 1)
        assert orch.state == SessionState.SPEAKING and not task.done()
        assert not orch.microphone("t1", AudioFrame(b"speaking"))
        assert stt.frames == [b"speech", b"quiet"] and vad == stt.frames
        assert [(a.segment_index, a.chunk.sequence) for a in output.delivered] == [(0, 0), (0, 1), (1, 0)]
        output.confirm_complete(output.scope)
        result = await task
        assert result.state == SessionState.LISTENING and not result.error and result.receipt
        assert len(llm.requests) == 1 and stt.released == 1 and tts.released == 2
        assert all(value is not None and value >= 0 for value in vars(result.metrics).values())
        with pytest.raises(ValueError, match="Duplicate"):
            orch.start_turn("t1")
        assert not [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()]
        print("MOCK metrics:", vars(result.metrics))
    asyncio.run(scenario())


def test_final_alone_waits_for_vad_boundary():
    async def scenario():
        items = setup(stt=MockSTT(early=True))
        orch, clock, stt, llm, _, output, _ = items
        task = orch.start_turn("t")
        orch.microphone("t", AudioFrame(b"speech"))
        await stt.partial.wait()
        for _ in range(10):
            await asyncio.sleep(0)
        assert orch.state == SessionState.LISTENING and not llm.requests
        clock.value = 100
        orch.microphone("t", AudioFrame(b"quiet"))
        clock.value = 800
        orch.tick()
        await asyncio.wait_for(output.finished.wait(), 1)
        output.confirm_complete(output.scope)
        assert (await task).receipt and len(llm.requests) == 1
    asyncio.run(scenario())


@pytest.mark.parametrize("command", list(Control))
def test_controls_during_speaking_close_and_no_late_audio(command):
    async def scenario():
        items = setup()
        orch, _, _, _, _, output, _ = items
        task = orch.start_turn("t")
        await end_input(items)
        await output.finished.wait()
        before = len(output.delivered)
        assert not await orch.control(command, key=ConversationKey("wrong", "session", "d"), turn_id="t")
        assert await orch.control(command, key=orch.key, turn_id="t")
        result = await task
        assert result.state == (SessionState.ERROR if command == Control.ABORT else SessionState.CLOSED)
        assert output.aborted and len(output.delivered) == before and orch.playback.queue.bytes == 0
        assert not orch.microphone("t", AudioFrame(b"late"))
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["deadline", "turn_timeout", "empty", "provider", "overflow"])
def test_error_policies_never_call_llm(mode):
    class BrokenSTT(MockSTT):
        async def transcribe(self, audio, context):
            raise RuntimeError("PRIVATE_PROVIDER_SECRET")
            yield
    async def scenario():
        stt = BrokenSTT() if mode == "provider" else MockSTT("" if mode == "empty" else "Chào.", early=mode == "empty")
        items = setup(stt=stt, seconds=.03 if mode == "deadline" else 2, input_bytes=2 if mode == "overflow" else 20)
        orch, clock, _, llm, *_ = items
        task = orch.start_turn("t")
        if mode in ("empty", "provider", "overflow"):
            orch.microphone("t", AudioFrame(b"speech"))
        if mode == "turn_timeout":
            clock.value = 15000
            orch.tick()
        result = await asyncio.wait_for(task, 1)
        assert result.state == SessionState.ERROR and result.error and not llm.requests
        assert orch.turn.audio.buffered_bytes == 0
        assert "PRIVATE" not in result.error
    asyncio.run(scenario())


def test_two_sessions_and_second_turn_isolation():
    async def scenario():
        runner = LLMRunner(LLMSettings())
        a, b = setup(user="A", device="dA", runner=runner), setup(user="B", device="dB", runner=runner)
        ta, tb = a[0].start_turn("one"), b[0].start_turn("one")
        await asyncio.gather(end_input(a), end_input(b))
        await asyncio.gather(a[5].finished.wait(), b[5].finished.wait())
        a[5].confirm_complete(a[5].scope)
        b[5].confirm_complete(b[5].scope)
        assert (await ta).receipt and (await tb).receipt
        assert a[3].requests[0].key != b[3].requests[0].key
        assert a[0].conversation.history is not b[0].conversation.history
        a[1].value = 1000
        next_task = a[0].start_turn("two")
        assert not a[0].microphone("one", AudioFrame(b"late"))
        await a[0].control(Control.DISCONNECT, key=a[0].key, turn_id="two")
        assert (await next_task).state == SessionState.CLOSED
        assert b[0].state == SessionState.LISTENING
    asyncio.run(scenario())


def test_safe_structured_logs():
    configure_logging("info")
    sink = io.StringIO()
    handler = logging.StreamHandler(sink)
    handler.setFormatter(_JsonFormatter())
    get_logger().addHandler(handler)
    async def scenario():
        items = setup()
        orch = items[0]
        task = orch.start_turn("PRIVATE_TURN_ID")
        await end_input(items)
        await items[5].finished.wait()
        items[5].confirm_complete(items[5].scope)
        await task
    try:
        asyncio.run(scenario())
    finally:
        get_logger().removeHandler(handler)
    logs = sink.getvalue()
    assert "orchestrator.latency" in logs and "turn_ref" in logs and "latency_ms" in logs
    assert "PRIVATE_PROMPT" not in logs and "PRIVATE_TURN_ID" not in logs and "speech" not in logs


@pytest.mark.parametrize("stage", ["listening", "llm", "tts"])
def test_abort_at_each_stage_discards_late_provider_results(stage):
    class LateProvider:
        def __init__(self):
            self.started = asyncio.Event()
            self.released = False
        async def stream(self, request, context):
            self.started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                yield ProviderDelta("LATE_PRIVATE_TEXT.")
            finally:
                self.released = True
        async def synthesize(self, request, context):
            self.started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                yield TTSAudioChunk(0, b"xx", request.config.audio_format)
            finally:
                self.released = True
    async def scenario():
        provider = LateProvider()
        items = setup(llm=provider if stage == "llm" else None, tts=provider if stage == "tts" else None)
        orch, _, _, llm, tts, output, _ = items
        task = orch.start_turn("t")
        if stage != "listening":
            await end_input(items)
            await provider.started.wait()
        await orch.control(Control.ABORT, key=orch.key, turn_id="t")
        result = await task
        assert result.state == SessionState.ERROR and not output.delivered
        if stage != "listening":
            assert provider.released
        assert orch.turn.audio.buffered_bytes == 0
        assert not [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()]
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["llm_failure", "llm_incomplete", "tts_oversized", "playback_timeout"])
def test_pipeline_errors_abort_without_reopening(mode):
    class FailureLLM:
        async def stream(self, request, context):
            raise RuntimeError("PRIVATE_SECRET")
            yield
    async def scenario():
        llm = FailureLLM() if mode == "llm_failure" else None
        if mode == "llm_incomplete":
            llm = MockLLMAdapter((ProviderDelta("Câu đủ. dở"), ProviderDone(False, "token_limit")))
        tts = MockTTS(((b"oversized",),)) if mode == "tts_oversized" else None
        items = setup(llm=llm, tts=tts, seconds=.12 if mode == "playback_timeout" else 2)
        task = items[0].start_turn("t")
        await end_input(items)
        result = await asyncio.wait_for(task, 1)
        assert result.state == SessionState.ERROR and result.error and not result.receipt
        assert items[0].playback.queue.bytes == 0
        assert items[5].aborted
        assert "PRIVATE" not in result.error
        with pytest.raises(ValueError):
            items[0].start_turn("new")
    asyncio.run(scenario())


def test_first_audio_before_llm_generation_finishes():
    class StreamingLLM:
        def __init__(self):
            self.proceed = asyncio.Event()
            self.finished = False
        async def stream(self, request, context):
            yield ProviderDelta("Câu một. ")
            await self.proceed.wait()
            yield ProviderDelta("Câu hai.")
            yield ProviderDone(True, "completed")
            self.finished = True
    class ObservedSink(MockAudioOutput):
        def __init__(self):
            super().__init__()
            self.first = asyncio.Event()
        async def write(self, audio, context):
            await super().write(audio, context)
            self.first.set()
    async def scenario():
        llm, output = StreamingLLM(), ObservedSink()
        items = setup(llm=llm, output=output)
        task = items[0].start_turn("t")
        await end_input(items)
        await asyncio.wait_for(output.first.wait(), 1)
        assert not llm.finished and items[0].state == SessionState.SPEAKING
        llm.proceed.set()
        await output.finished.wait()
        output.confirm_complete(output.scope)
        assert (await task).receipt and llm.finished
    asyncio.run(scenario())


def test_direct_task_cancel_before_start_clears_input():
    async def scenario():
        items = setup()
        orch = items[0]
        task = orch.start_turn("t")
        orch.microphone("t", AudioFrame(b"speech"))
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await asyncio.sleep(0)
        assert orch.turn.audio.buffered_bytes == 0 and orch.state == SessionState.ERROR
        assert not items[3].requests
    asyncio.run(scenario())

def test_manual_stop_preserves_silence_threshold_and_drops_mic():
    async def scenario():
        items=setup()
        orch,clock,stt,llm,tts,output,vad=items
        task=orch.start_turn('manual')
        assert orch.accepting_input
        orch.microphone('manual',AudioFrame(b'speech'))
        await stt.partial.wait()
        clock.value=100
        assert orch.stop_input('manual')
        assert not orch.accepting_input
        assert not orch.microphone('manual',AudioFrame(b'late'))
        clock.value=799; orch.tick()
        assert not llm.requests and orch.state==SessionState.LISTENING
        clock.value=800; orch.tick()
        await asyncio.wait_for(output.finished.wait(),1)
        output.confirm_complete(output.scope)
        result=await task
        assert result.state==SessionState.LISTENING and len(llm.requests)==1
        assert vad==[b'speech']
    asyncio.run(scenario())
