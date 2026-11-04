"""Synthetic audio + mock completion proof only, never robot playback tests."""

import asyncio
from dataclasses import replace
import time

import pytest

from app.core.llm_config import LLMSettings
from app.models.audio import AudioMetadata, AudioFrame, TranscriptionResult
from app.models.llm import ConversationKey, LLMError, LLMResult, ProviderDelta, ProviderDone, TextChunk
from app.models.tts import (
    AudioFormat, PlaybackEvidence, PlaybackLimits, PlaybackScope, ScheduledAudio,
    TTSAudioChunk, TTSConfig, TTSError,
)
from app.services.audio_context import AudioContext
from app.services.audio_input import BoundedAudioInput
from app.services.llm import Conversation, LLMRunner
from app.services.mock_llm import MockLLMAdapter
from app.services.mock_tts import MockAudioOutput, MockTTS
from app.services.playback import AudioQueue, PlaybackScheduler
from app.services.turn_detection import SpeechActivity, TextRules, TranscriptEvent, TurnDetectionConfig, TurnDetector
from app.services.turn_input import HalfDuplexTurn, TurnPhase


KEY = ConversationKey("user-test", "session-test", "robot-test")
# Synthetic PCM fixture format ONLY, not firmware wire or production choice.
FORMAT = AudioFormat(AudioMetadata("pcm", 8000, 1, 10, "s16le"), "raw")
CONFIG = TTSConfig("mock-model", "mock-voice", "vi", FORMAT)
LIMITS = PlaybackLimits(2, 8, 4, 4, 500, 5)  # All test-only budgets.
FIXTURES = ((b"\x00\x00", b"\x01\x00"), (b"\x02\x00",))


def make_turn(name="t1", seconds=2):
    audio = BoundedAudioInput(AudioMetadata("opus", 16000, 1, 60),
        AudioContext(deadline=time.monotonic() + seconds), max_frames=2, max_bytes=20)
    d = TurnDetector(TurnDetectionConfig(700, 300, 15000), TextRules((".",), ()), started_at_ms=0)
    turn = HalfDuplexTurn(name, d, audio, speech_activity=lambda frame: True, emit=lambda event: None)
    d.speech(SpeechActivity(0, True))
    turn.transcription(TranscriptEvent(100, TranscriptionResult("Chào.", True)))
    d.speech(SpeechActivity(200, False))
    turn.tick(900)
    return turn


async def texts(events=None):
    if events is None:
        events = (TextChunk(0, "Chào.", True), TextChunk(1, " Nghe nhạc nhé?", True),
                  LLMResult("Chào. Nghe nhạc nhé?", True, "completed", None))
    for event in events:
        yield event


async def confirm_when_sent(output):
    await output.finished.wait()
    output.confirm_complete(output.scope)


async def play(scheduler, provider, output, turn, source=None, *, key=KEY):
    return await scheduler.play(provider, output, texts() if source is None else source,
                                key=key, turn=turn, config=CONFIG)


def test_stream_order_metadata_half_duplex_and_explicit_proof():
    async def scenario():
        turn, scheduler = make_turn(), PlaybackScheduler(KEY, LIMITS)
        provider, output = MockTTS(FIXTURES), MockAudioOutput()
        task = asyncio.create_task(play(scheduler, provider, output, turn))
        await output.finished.wait()
        assert not task.done() and turn.phase == TurnPhase.SPEAKING
        assert not turn.microphone(AudioFrame(b"mic"), metadata=turn.audio.metadata, at_ms=1000)
        assert turn.audio.buffered_bytes == 0
        assert [(item.segment_index, item.chunk.sequence) for item in output.delivered] == [(0, 0), (0, 1), (1, 0)]
        assert [item.chunk.payload for item in output.delivered] == [b"\x00\x00", b"\x01\x00", b"\x02\x00"]
        assert all(item.chunk.audio_format == FORMAT for item in output.delivered)
        output.confirm_complete(output.scope)
        receipt = await task
        assert receipt.ready_for_next_turn and receipt.evidence.source == "mock-only"
        assert turn.phase == TurnPhase.CLOSED and provider.released == 2
        assert scheduler.queue.bytes == scheduler.queue.chunks == 0
        duplicate = make_turn()
        with pytest.raises(TTSError, match="session_busy"):
            await play(scheduler, provider, output, duplicate)
        await duplicate.aclose()
    asyncio.run(scenario())


def test_queue_bounds_and_backpressure():
    async def scenario():
        queue = AudioQueue(PlaybackLimits(1, 4, 4, 2, 100, 2))
        scope = PlaybackScope(KEY, "t", "g")
        packet = ScheduledAudio(scope, 0, TTSAudioChunk(0, b"1234", FORMAT))
        await queue.put(packet)
        pending = asyncio.create_task(queue.put(packet))
        await asyncio.sleep(0)
        assert not pending.done() and queue.bytes == 4 and queue.chunks == 1
        assert queue.blocked_puts == 1
        assert await queue.get() == packet
        await pending
        assert (queue.peak_chunks, queue.peak_bytes) == (1, 4)
        queue.abort()
        assert queue.bytes == queue.chunks == 0
        with pytest.raises(TTSError, match="cancelled"):
            await queue.get()
    asyncio.run(scenario())


def test_byte_bound_independent_of_count_and_oversized_frame():
    async def scenario():
        queue = AudioQueue(PlaybackLimits(10, 4, 4, 2, 100, 2))
        scope = PlaybackScope(KEY, "t", "g")
        await queue.put(ScheduledAudio(scope, 0, TTSAudioChunk(0, b"123", FORMAT)))
        waiting = asyncio.create_task(queue.put(ScheduledAudio(scope, 0, TTSAudioChunk(1, b"ab", FORMAT))))
        await asyncio.sleep(0)
        assert not waiting.done() and queue.bytes == 3
        with pytest.raises(TTSError, match="limit"):
            await queue.put(ScheduledAudio(scope, 0, TTSAudioChunk(2, b"12345", FORMAT)))
        queue.abort()
        with pytest.raises(TTSError, match="cancelled"):
            await waiting
    asyncio.run(scenario())


@pytest.mark.parametrize("source,code", [
    ((TextChunk(1, "Chào.", True),), "invalid_input"),
    ((TextChunk(0, "Chào.", True), TextChunk(0, "Chào.", True)), "invalid_input"),
    ((TextChunk(0, "câu dở", False),), "unsafe_text"),
    ((TextChunk(0, " ", True),), "invalid_input"),
    ((TextChunk(0, "Chào.", True),), "incomplete_input"),
    ((TextChunk(0, "Chào.", True), LLMResult("Khác.", True, "completed", None)), "invalid_input"),
    ((TextChunk(0, "Chào.", True), LLMResult("Chào.", False, "token_limit", None)), "incomplete_input"),
    ((LLMResult("", True, "completed", None),), "invalid_input"),
])
def test_invalid_or_incomplete_text_aborts_without_replay(source, code):
    async def scenario():
        scheduler, turn, output = PlaybackScheduler(KEY, LIMITS), make_turn(), MockAudioOutput()
        with pytest.raises(TTSError, match=code):
            await play(scheduler, MockTTS(FIXTURES), output, turn, texts(source))
        assert output.aborted and turn.phase == TurnPhase.CLOSED
        assert scheduler.queue.bytes == scheduler.queue.chunks == 0
    asyncio.run(scenario())


@pytest.mark.parametrize("mode,code", [("metadata", "invalid_audio"), ("order", "invalid_audio"),
    ("empty", "invalid_audio"), ("oversized", "limit"), ("failure", "provider_error")])
def test_provider_errors_and_audio_validation(mode, code):
    class BadTTS:
        closed = False
        async def synthesize(self, request, context):
            try:
                if mode == "failure":
                    raise RuntimeError("secret-and-raw-audio")
                if mode == "empty":
                    return
                fmt = replace(FORMAT, data_format="wrong") if mode == "metadata" else FORMAT
                yield TTSAudioChunk(1 if mode == "order" else 0, b"12345" if mode == "oversized" else b"ab", fmt)
            finally:
                self.closed = True
    async def scenario():
        scheduler, turn, output, provider = PlaybackScheduler(KEY, LIMITS), make_turn(), MockAudioOutput(), BadTTS()
        with pytest.raises(TTSError, match=code) as error:
            await play(scheduler, provider, output, turn)
        assert "secret" not in str(error.value) and provider.closed and output.aborted
        assert scheduler.queue.bytes == 0
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["timeout", "cancel", "disconnect", "task"])
def test_ack_wait_timeout_cancel_disconnect_cleanup(mode):
    async def scenario():
        scheduler = PlaybackScheduler(KEY, LIMITS)
        turn = make_turn(seconds=.04 if mode == "timeout" else 2)
        output = MockAudioOutput()
        task = asyncio.create_task(play(scheduler, MockTTS(FIXTURES), output, turn))
        await output.finished.wait()
        if mode == "cancel":
            turn.cancel()
        elif mode == "disconnect":
            await turn.aclose()
        elif mode == "task":
            task.cancel()
        if mode == "task":
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(TTSError, match="timeout" if mode == "timeout" else "cancelled"):
                await task
        assert scheduler.queue.bytes == 0 and output.aborted
        assert turn.phase == TurnPhase.CLOSED
        with pytest.raises(TTSError, match="invalid_playback_proof"):
            output.confirm_complete(output.scope)
        next_turn = make_turn("next")
        with pytest.raises(TTSError, match="session_busy"):
            await play(scheduler, MockTTS(FIXTURES), MockAudioOutput(), next_turn)
        await next_turn.aclose()
        assert not [task for task in asyncio.all_tasks() if task is not asyncio.current_task() and not task.done()]
    asyncio.run(scenario())


def test_cancel_drops_late_provider_chunks():
    class LateTTS:
        started = None
        closed = False
        async def synthesize(self, request, context):
            self.started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                yield TTSAudioChunk(0, b"late", FORMAT)
            finally:
                self.closed = True
    async def scenario():
        scheduler, turn, output, provider = PlaybackScheduler(KEY, LIMITS), make_turn(), MockAudioOutput(), LateTTS()
        provider.started = asyncio.Event()
        task = asyncio.create_task(play(scheduler, provider, output, turn))
        await provider.started.wait()
        turn.cancel()
        with pytest.raises(TTSError, match="cancelled"):
            await task
        assert provider.closed and not output.delivered and scheduler.queue.bytes == 0
    asyncio.run(scenario())


def test_two_sessions_have_independent_queues_and_proof():
    async def scenario():
        key2 = ConversationKey("user-2", "session-2", "robot-2")
        sa, sb = PlaybackScheduler(KEY, LIMITS), PlaybackScheduler(key2, LIMITS)
        ta, tb, oa, ob = make_turn("a"), make_turn("b"), MockAudioOutput(), MockAudioOutput()
        a = asyncio.create_task(play(sa, MockTTS(FIXTURES), oa, ta))
        b = asyncio.create_task(play(sb, MockTTS(FIXTURES), ob, tb, key=key2))
        await asyncio.gather(oa.finished.wait(), ob.finished.wait())
        with pytest.raises(TTSError, match="invalid_playback_proof"):
            ob.confirm_complete(oa.scope)
        ta.cancel()
        with pytest.raises(TTSError, match="cancelled"):
            await a
        ob.confirm_complete(ob.scope)
        assert (await b).ready_for_next_turn
        assert all(item.scope.key == key2 for item in ob.delivered)
    asyncio.run(scenario())


def test_wrong_proof_never_reopens_listening():
    class WrongProof(MockAudioOutput):
        async def wait_playback_complete(self, scope, context):
            return PlaybackEvidence(replace(scope, generation="old"), True, "mock-only")
    async def scenario():
        turn, output = make_turn(), WrongProof()
        with pytest.raises(TTSError, match="invalid_playback_proof"):
            await play(PlaybackScheduler(KEY, LIMITS), MockTTS(FIXTURES), output, turn)
        assert turn.phase == TurnPhase.CLOSED and output.aborted
    asyncio.run(scenario())


def test_existing_llm_stream_continues_same_turn_while_speaking():
    async def scenario():
        turn = make_turn(seconds=10)
        conversation = Conversation(KEY, max_turns=3, max_history_chars=2000)
        llm = MockLLMAdapter((ProviderDelta("Chào. "), ProviderDelta("Nghe nhạc nhé?"),
                              ProviderDone(True, "completed")), delay_seconds=.01)
        source = LLMRunner(LLMSettings()).stream(llm, conversation, KEY, turn,
            TranscriptionResult("Chào.", True), "Bạn là AIVA.", turn.audio.context)
        output, scheduler = MockAudioOutput(), PlaybackScheduler(KEY, LIMITS)
        task = asyncio.create_task(play(scheduler, MockTTS(FIXTURES), output, turn, source))
        await output.finished.wait()
        assert turn.phase == TurnPhase.SPEAKING and not conversation.history
        other = make_turn("other")
        with pytest.raises(LLMError, match="session_busy"):
            await anext(LLMRunner(LLMSettings()).stream(llm, conversation, KEY, other,
                TranscriptionResult("Mới.", True), "AIVA", other.audio.context))
        await other.aclose()
        output.confirm_complete(output.scope)
        assert (await task).ready_for_next_turn
        assert len(llm.requests) == 1 and len(output.delivered) == 3
        await turn.aclose()
        conversation.release(turn)
        assert conversation.history
    asyncio.run(scenario())


@pytest.mark.parametrize("values", [(0, 8, 4, 4, 500, 5), (2, 2, 4, 4, 500, 5),
    (2, 8, True, 4, 500, 5), (2, 8, 4, -1, 500, 5)])
def test_limits_need_explicit_valid_budgets(values):
    with pytest.raises(ValueError):
        PlaybackLimits(*values)


def test_audio_repr_does_not_include_raw_bytes():
    chunk = TTSAudioChunk(0, b"PRIVATE_AUDIO", FORMAT)
    assert "PRIVATE_AUDIO" not in repr(chunk)


def test_scheduler_backpressure_and_cancel_clears_pending_audio():
    class SlowOutput(MockAudioOutput):
        def __init__(self):
            super().__init__()
            self.writing = asyncio.Event()
        async def write(self, audio, context):
            self.writing.set()
            await asyncio.Event().wait()
    async def scenario():
        scheduler = PlaybackScheduler(KEY, replace(LIMITS, max_queue_bytes=4))
        turn, output, provider = make_turn(), SlowOutput(), MockTTS((tuple(b"ab" for _ in range(10)),))
        source = texts((TextChunk(0, "Chào.", True), LLMResult("Chào.", True, "completed", None)))
        task = asyncio.create_task(play(scheduler, provider, output, turn, source))
        await output.writing.wait()
        for _ in range(10):
            if scheduler.queue.blocked_puts:
                break
            await asyncio.sleep(0)
        assert scheduler.queue.peak_chunks == 2 and scheduler.queue.peak_bytes == 4
        assert scheduler.queue.blocked_puts >= 1
        turn.cancel()
        with pytest.raises(TTSError, match="cancelled"):
            await task
        assert provider.released == 1 and output.aborted and not output.delivered
        assert scheduler.queue.bytes == scheduler.queue.chunks == 0
    asyncio.run(scenario())


def test_output_failure_aborts_and_is_safe():
    class FailedOutput(MockAudioOutput):
        async def write(self, audio, context):
            raise RuntimeError("PRIVATE_AUDIO_SECRET")
    async def scenario():
        output, turn, scheduler = FailedOutput(), make_turn(), PlaybackScheduler(KEY, LIMITS)
        with pytest.raises(TTSError, match="output_error") as error:
            await play(scheduler, MockTTS(FIXTURES), output, turn)
        assert "PRIVATE" not in str(error.value) and output.aborted
        assert scheduler.queue.bytes == 0 and turn.phase == TurnPhase.CLOSED
    asyncio.run(scenario())


@pytest.mark.parametrize("source", ["tts.stop", "queue-drained", "send-success", "device-ack-unapproved"])
def test_no_unapproved_playback_proof(source):
    with pytest.raises(TTSError, match="invalid_playback_proof"):
        PlaybackEvidence(PlaybackScope(KEY, "t", "g"), True, source)


@pytest.mark.parametrize("changes", [{"max_segments": 1}, {"max_text_chars": 4}])
def test_segment_and_text_budgets(changes):
    async def scenario():
        turn, output = make_turn(), MockAudioOutput()
        with pytest.raises(TTSError, match="limit"):
            await play(PlaybackScheduler(KEY, replace(LIMITS, **changes)), MockTTS(FIXTURES), output, turn)
        assert output.aborted
    asyncio.run(scenario())


@pytest.mark.parametrize("field,value", [("model", ""), ("voice", ""), ("language", ""), ("audio_format", None)])
def test_tts_config_is_explicit(field, value):
    with pytest.raises(TTSError, match="invalid_input"):
        replace(CONFIG, **{field: value})


def test_next_turn_after_proof_cannot_accept_old_generation_proof():
    async def scenario():
        scheduler = PlaybackScheduler(KEY, LIMITS)
        a, oa = make_turn("a"), MockAudioOutput()
        first = asyncio.create_task(play(scheduler, MockTTS(FIXTURES), oa, a))
        await oa.finished.wait()
        oa.confirm_complete(oa.scope)
        old_scope = (await first).scope
        b, ob = make_turn("b"), MockAudioOutput()
        second = asyncio.create_task(play(scheduler, MockTTS(FIXTURES), ob, b))
        await ob.finished.wait()
        assert ob.scope.generation != old_scope.generation
        with pytest.raises(TTSError, match="invalid_playback_proof"):
            ob.confirm_complete(old_scope)
        assert not second.done() and b.phase == TurnPhase.SPEAKING
        ob.confirm_complete(ob.scope)
        assert (await second).ready_for_next_turn
    asyncio.run(scenario())


def test_wrong_identity_rejected_without_starting_provider():
    async def scenario():
        turn, provider, output = make_turn(), MockTTS(FIXTURES), MockAudioOutput()
        wrong = ConversationKey("other-user", "session-test", "robot-test")
        with pytest.raises(TTSError, match="invalid_input"):
            await play(PlaybackScheduler(KEY, LIMITS), provider, output, turn, key=wrong)
        assert not provider.requests and not output.delivered
        await turn.aclose()
    asyncio.run(scenario())
