"""Per authenticated scope orchestration. No wire protocol/authentication inference."""

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
import hashlib
import logging
import math
import time

from app.core.logging import get_logger, log_event
from app.models.audio import AudioError, AudioFrame, AudioMetadata, TranscriptionResult, positive_int
from app.models.llm import ConversationKey, LLMError, ProviderDelta
from app.models.tts import PlaybackLimits, PlaybackReceipt, TTSConfig, TTSError
from app.services.audio_context import AudioContext
from app.services.audio_input import BoundedAudioInput
from app.services.llm import Conversation, LLMRunner
from app.services.playback import PlaybackScheduler
from app.services.stt import stream_transcription
from app.services.turn_detection import SpeechActivity, TranscriptEvent, TurnDetectionConfig, TurnDetector
from app.services.turn_input import HalfDuplexTurn, TurnEnded, TurnTimedOut


class SessionState(StrEnum):
    LISTENING = "LISTENING"
    PROCESSING = "PROCESSING"
    SPEAKING = "SPEAKING"
    ERROR = "ERROR"
    CLOSED = "CLOSED"


class Control(StrEnum):
    ABORT = "ABORT"
    DISCONNECT = "DISCONNECT"
    REVOKE = "REVOKE"


@dataclass(frozen=True)
class OrchestrationLimits:
    turn_deadline_seconds: float
    tick_seconds: float
    input_frames: int
    input_bytes: int
    history_turns: int
    history_chars: int

    def __post_init__(self):
        if (any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0
                for v in (self.turn_deadline_seconds, self.tick_seconds))
            or self.tick_seconds >= self.turn_deadline_seconds
            or not all(positive_int(v) for v in (self.input_frames, self.input_bytes, self.history_turns, self.history_chars))):
            raise ValueError("Explicit positive orchestration budgets required")


@dataclass
class TurnMetrics:
    stt_ms: float | None = None
    llm_first_token_ms: float | None = None
    tts_first_audio_ms: float | None = None
    total_ms: float | None = None


@dataclass(frozen=True)
class TurnOutcome:
    turn_id: str
    state: SessionState
    error: str | None
    receipt: PlaybackReceipt | None
    metrics: TurnMetrics


class _InputLease:
    """STT can close its stream, but only the turn owner closes the shared input."""
    def __init__(self, audio):
        self.audio = audio

    @property
    def metadata(self):
        return self.audio.metadata

    async def read(self):
        return await self.audio.read()

    async def aclose(self):
        pass


class _Failure(Exception):
    pass


class AIOrchestrator:
    def __init__(self, key: ConversationKey, *, stt, llm, tts, output, llm_runner: LLMRunner,
                 input_metadata: AudioMetadata, turn_config: TurnDetectionConfig, language_rules,
                 speech_activity: Callable[[AudioFrame], bool], tts_config: TTSConfig,
                 playback_limits: PlaybackLimits, limits: OrchestrationLimits, system_prompt: str,
                 clock_ms: Callable[[], float] = lambda: time.monotonic() * 1000):
        self.key = key  # Must come from trusted auth, never wire session_id.
        self.stt, self.llm, self.tts, self.output = stt, llm, tts, output
        self.runner, self.metadata = llm_runner, input_metadata
        self.turn_config, self.rules, self.vad = turn_config, language_rules, speech_activity
        self.tts_config, self.limits, self.prompt = tts_config, limits, system_prompt
        self.clock = clock_ms
        self.conversation = Conversation(key, max_turns=limits.history_turns, max_history_chars=limits.history_chars)
        self.playback = PlaybackScheduler(key, playback_limits)
        self.state = SessionState.LISTENING
        self.turn = None
        self.task = None
        self._attempted: set[str] = set()
        self._error = None
        self._metrics = TurnMetrics()

    def _state(self, state):
        self.state = state
        log_event(get_logger("orchestrator"), logging.INFO, "orchestrator.state", "Session state changed",
                  turn_ref=self._ref(), state=state.value)

    def _ref(self):
        identity = (self.key.user_id, self.key.session_id, self.key.device_id, self.turn.turn_id if self.turn else "")
        return hashlib.sha256(repr(identity).encode()).hexdigest()[:16]

    def start_turn(self, turn_id: str):
        if self.state != SessionState.LISTENING or (self.task is not None and not self.task.done()):
            raise ValueError("Session is not ready for another turn")
        if not isinstance(turn_id, str) or not turn_id.strip():
            raise ValueError("Explicit turn ID required")
        if turn_id in self._attempted or len(self._attempted) >= self.limits.history_turns:
            raise ValueError("Duplicate turn or session budget exhausted")
        self._attempted.add(turn_id)
        self._error, self._metrics = None, TurnMetrics()
        self._started = time.monotonic()
        self._boundary = asyncio.Event()
        self._input_stopped = False
        audio = BoundedAudioInput(self.metadata, AudioContext(deadline=self._started + self.limits.turn_deadline_seconds),
                                 max_frames=self.limits.input_frames, max_bytes=self.limits.input_bytes)
        turn = HalfDuplexTurn(turn_id, TurnDetector(self.turn_config, self.rules, started_at_ms=self.clock()),
                              audio, speech_activity=self.vad, emit=self._event)
        self.turn = turn
        self._state(SessionState.LISTENING)
        self.task = asyncio.create_task(self._run(turn))
        def cancelled_before_start(task):
            if task.cancelled() and self.turn is turn:
                turn.cancel()
                self._error = self._error or "cancelled"
                if self.state != SessionState.CLOSED:
                    self._state(SessionState.ERROR)
        self.task.add_done_callback(cancelled_before_start)
        return self.task

    def _event(self, event):
        if self.turn is None or event.turn_id != self.turn.turn_id or self.state != SessionState.LISTENING:
            return
        if isinstance(event, TurnTimedOut):
            self._error = "turn_timeout"
            self._state(SessionState.ERROR)
        elif isinstance(event, TurnEnded) and not self._boundary.is_set():
            self._state(SessionState.PROCESSING)
            self._boundary.set()

    def microphone(self, turn_id, frame: AudioFrame):
        if self.state != SessionState.LISTENING or self.turn is None or turn_id != self.turn.turn_id or self._input_stopped:
            return False  # BEFORE VAD, framing/conversion, STT input or holding buffer.
        try:
            return self.turn.microphone(frame, metadata=self.metadata, at_ms=self.clock())
        except Exception:
            self._error = "input_error"
            self._state(SessionState.ERROR)
            self.turn.cancel()
            return False

    @property
    def accepting_input(self):
        return (self.state == SessionState.LISTENING and self.turn is not None
                and self.task is not None and not self.task.done() and not self._input_stopped)

    def stop_input(self, turn_id):
        """Explicit manual listen.stop: stop ingress, observe silence, still require END."""
        if self.state != SessionState.LISTENING or self.turn is None or turn_id != self.turn.turn_id:
            return False
        self._input_stopped = True
        self.turn.detector.speech(SpeechActivity(self.clock(), False))
        self.tick()
        return True

    def tick(self):
        if self.state == SessionState.LISTENING and self.turn is not None:
            return self.turn.tick(self.clock())

    async def control(self, command: Control, *, key: ConversationKey, turn_id: str):
        """Trusted internal command, NOT a parser for any invented firmware message."""
        if not isinstance(command, Control) or key != self.key or self.turn is None or turn_id != self.turn.turn_id:
            return False
        if self.task is None or self.task.done():
            if command in (Control.REVOKE, Control.DISCONNECT):
                self._state(SessionState.CLOSED)
            return True
        self._error = command.value.lower()
        self._state(SessionState.ERROR if command == Control.ABORT else SessionState.CLOSED)
        self.turn.cancel()
        await asyncio.gather(self.task, return_exceptions=True)
        return True

    async def _monitor(self, turn):
        while self.turn is turn:
            try:
                turn.audio.context.check()
            except AudioError:
                return
            if self.state == SessionState.LISTENING:
                self.tick()
            await asyncio.sleep(self.limits.tick_seconds)

    async def _transcribe(self, turn):
        final = None
        async for result in stream_transcription(self.stt, _InputLease(turn.audio), turn.audio.context):
            turn.audio.context.check()
            if self.turn is not turn:
                raise _Failure("stale_turn")
            if self.state == SessionState.LISTENING:
                turn.transcription(TranscriptEvent(self.clock(), result))
            if result.is_final:
                final = result
                self._metrics.stt_ms = (time.monotonic() - self._started) * 1000
        if final is None or not final.text.strip():
            raise _Failure("empty_transcript")
        return final

    async def _run(self, turn):
        stt = asyncio.create_task(self._transcribe(turn))
        monitor = asyncio.create_task(self._monitor(turn))
        boundary = asyncio.create_task(self._boundary.wait())
        receipt = None
        try:
            done, _ = await turn.audio.context.run(lambda: asyncio.wait((stt, boundary, monitor), return_when=asyncio.FIRST_COMPLETED))
            if monitor in done:
                await monitor
                raise _Failure("turn_timeout")
            if stt in done:
                stt.result()  # Surface Provider/empty errors immediately, not after timeout.
            await turn.audio.context.run(lambda: asyncio.shield(boundary))
            final = await turn.audio.context.run(lambda: asyncio.shield(stt))
            if self.state != SessionState.PROCESSING:
                raise _Failure("invalid_state")
            llm_started = time.monotonic()
            owner = self

            class ObservedLLM:
                async def stream(_, request, context):
                    stream = owner.llm.stream(request, context)
                    try:
                        async for event in stream:
                            context.check()
                            if isinstance(event, ProviderDelta) and event.text and owner._metrics.llm_first_token_ms is None:
                                owner._metrics.llm_first_token_ms = (time.monotonic() - llm_started) * 1000
                            yield event
                    finally:
                        await stream.aclose()

            class ObservedTTS:
                async def synthesize(_, request, context):
                    started = time.monotonic()
                    stream = owner.tts.synthesize(request, context)
                    try:
                        async for event in stream:
                            context.check()
                            if owner._metrics.tts_first_audio_ms is None:
                                owner._metrics.tts_first_audio_ms = (time.monotonic() - started) * 1000
                            yield event
                    finally:
                        await stream.aclose()

            class ObservedOutput:
                async def start(_, scope, audio_format, context):
                    owner._state(SessionState.SPEAKING)
                    await owner.output.start(scope, audio_format, context)
                async def write(_, audio, context):
                    await owner.output.write(audio, context)
                async def finish(_, scope, context):
                    await owner.output.finish(scope, context)
                async def wait_playback_complete(_, scope, context):
                    return await owner.output.wait_playback_complete(scope, context)
                async def abort(_, scope):
                    await owner.output.abort(scope)

            texts = self.runner.stream(ObservedLLM(), self.conversation, self.key, turn, final, self.prompt, turn.audio.context)
            receipt = await self.playback.play(ObservedTTS(), ObservedOutput(), texts, key=self.key, turn=turn, config=self.tts_config)
            self.conversation.release(turn)
            self._state(SessionState.LISTENING)  # Only scheduler proof can reach here.
        except asyncio.CancelledError:
            self._error = self._error or "cancelled"
            if self.state != SessionState.CLOSED:
                self._state(SessionState.ERROR)
        except (AudioError, LLMError, TTSError) as error:
            self._error = self._error or error.code.value
            if self.state != SessionState.CLOSED:
                self._state(SessionState.ERROR)
        except _Failure as error:
            self._error = self._error or str(error)
            if self.state != SessionState.CLOSED:
                self._state(SessionState.ERROR)
        except Exception:
            self._error = self._error or "pipeline_error"
            if self.state != SessionState.CLOSED:
                self._state(SessionState.ERROR)
        finally:
            for child in (stt, monitor, boundary):
                if not child.done():
                    child.cancel()
            await asyncio.gather(stt, monitor, boundary, return_exceptions=True)
            await turn.aclose()
            self._metrics.total_ms = (time.monotonic() - self._started) * 1000
            for stage, latency in vars(self._metrics).items():
                log_event(get_logger("orchestrator"), logging.INFO, "orchestrator.latency", "Pipeline latency",
                          turn_ref=self._ref(), stage=stage, latency_ms=latency, state=self.state.value)
            if self._error:
                log_event(get_logger("orchestrator"), logging.WARNING, "orchestrator.error", "Pipeline failed",
                          turn_ref=self._ref(), reason=self._error, state=self.state.value)
        return TurnOutcome(turn.turn_id, self.state, self._error, receipt, self._metrics)
