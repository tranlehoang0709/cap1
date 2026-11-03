"""Single-turn half-duplex bridge for decoded PCM audio and explicit boundaries."""

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum

from app.models.audio import AudioError, AudioFrame, AudioMetadata
from app.services.audio_input import BoundedAudioInput
from app.services.turn_detection import Decision, SpeechActivity, TranscriptEvent, TurnDetector


class TurnPhase(StrEnum):
    LISTENING = "LISTENING"
    PROCESSING = "PROCESSING"
    SPEAKING = "SPEAKING"
    CLOSED = "CLOSED"


@dataclass(frozen=True)
class TurnEnded:
    turn_id: str
    at_ms: float
    text: str
    transcript_is_final: bool


@dataclass(frozen=True)
class TurnTimedOut:
    turn_id: str
    at_ms: float


class HalfDuplexTurn:
    def __init__(self, turn_id: str, detector: TurnDetector, audio: BoundedAudioInput, *,
                 speech_activity: Callable[[AudioFrame], bool],
                 emit: Callable[[TurnEnded | TurnTimedOut], None]):
        if not isinstance(turn_id, str) or not turn_id.strip():
            raise ValueError("Explicit turn ID required")
        if detector.ended or detector.cancelled or detector.timed_out:
            raise ValueError("Fresh detector required")
        self.turn_id, self.detector, self.audio = turn_id, detector, audio
        self._speech_activity, self._emit = speech_activity, emit
        self._phase = TurnPhase.LISTENING
        self._emitted = False
        self._unsubscribe = audio.context.on_cancel(self._on_cancel)

    @property
    def phase(self) -> TurnPhase:
        return self._phase

    def _on_cancel(self) -> None:
        self._phase = TurnPhase.CLOSED
        self.detector.cancel()

    def _check(self) -> None:
        try:
            self.audio.context.check()
        except AudioError:
            self.cancel()
            raise

    def microphone(self, frame: AudioFrame, *, metadata: AudioMetadata, at_ms: float) -> bool:
        # Gate BEFORE VAD, STT input feed, or any holding queue. No replay queue.
        if self.phase != TurnPhase.LISTENING:
            return False
        self._check()
        if self.detector.check_timeout(at_ms):
            self._apply(Decision.UNCERTAIN, at_ms)
            return False
        self.audio.feed(frame, metadata=metadata)
        try:
            active = self._speech_activity(frame)
            self._apply(self.detector.speech(SpeechActivity(at_ms, active)), at_ms)
        except Exception:
            self.cancel()
            raise
        return True

    def transcription(self, event: TranscriptEvent) -> Decision:
        if self.phase != TurnPhase.LISTENING:
            return self._terminal_decision()
        self._check()
        return self._apply(self.detector.transcription(event), event.at_ms)

    def tick(self, at_ms: float) -> Decision:
        if self.phase != TurnPhase.LISTENING:
            return self._terminal_decision()
        self._check()
        return self._apply(self.detector.tick(at_ms), at_ms)

    def end_input(self, at_ms: float) -> bool:
        """Close a complete client-framed utterance without requiring a transcript."""
        if self.phase != TurnPhase.LISTENING:
            return False
        self._check()
        self.audio.finish()
        self._phase = TurnPhase.PROCESSING
        self._emitted = True
        self._emit(TurnEnded(self.turn_id, at_ms, "", False))
        return True

    def _apply(self, decision: Decision, at_ms: float) -> Decision:
        if self.detector.timed_out:
            # Policy: abort this input and notify; NEVER turn a deadline into END.
            self.cancel()
            if not self._emitted:
                self._emitted = True
                self._emit(TurnTimedOut(self.turn_id, at_ms))
        elif decision == Decision.END and not self._emitted:
            self.audio.finish()  # Drain current turn only; STT may still finalize.
            self._phase = TurnPhase.PROCESSING
            self._emitted = True  # Mark before callback to prevent reentrant duplicates.
            transcript = self.detector.transcript
            self._emit(TurnEnded(self.turn_id, at_ms, transcript.text, transcript.is_final))
        return decision

    def _terminal_decision(self) -> Decision:
        return Decision.END if self.phase != TurnPhase.CLOSED and self.detector.ended else Decision.UNCERTAIN

    def speaking(self) -> None:
        if self.phase != TurnPhase.PROCESSING:
            raise ValueError("Speaking requires a completed input turn")
        self._phase = TurnPhase.SPEAKING

    def cancel(self) -> Decision:
        self._on_cancel()
        self._unsubscribe()
        self.audio.context.cancel()  # Existing Task 02 hook discards input immediately.
        return Decision.UNCERTAIN

    async def aclose(self) -> None:
        self.cancel()
        await self.audio.aclose()
