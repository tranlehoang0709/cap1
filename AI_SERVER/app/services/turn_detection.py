"""Deterministic event-based turn detection; no decoder, VAD or provider calls.

Times are milliseconds on one caller-owned monotonic timeline. A VAD false
event starts silence; missing events alone never establish silence. Tick is
required while idle. One instance represents one utterance and is never reset.
"""

from dataclasses import dataclass
from enum import StrEnum
import math
import os
from typing import Mapping, Protocol
import unicodedata

from app.models.audio import TranscriptionResult, positive_int


class Decision(StrEnum):
    WAIT = "WAIT"
    END = "END"
    UNCERTAIN = "UNCERTAIN"


class LanguageEvidence(StrEnum):
    COMPLETE = "COMPLETE"
    INCOMPLETE = "INCOMPLETE"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class TurnDetectionConfig:
    min_silence_ms: int
    transcript_stability_ms: int
    max_turn_duration_ms: int

    def __post_init__(self) -> None:
        if not all(positive_int(value) for value in (
            self.min_silence_ms, self.transcript_stability_ms, self.max_turn_duration_ms
        )):
            raise ValueError("Turn thresholds must be positive integer milliseconds")
        if self.max_turn_duration_ms <= max(self.min_silence_ms, self.transcript_stability_ms):
            raise ValueError("Turn timeout must exceed silence and stability thresholds")

    @classmethod
    def from_env(cls, values: Mapping[str, str] | None = None) -> "TurnDetectionConfig":
        """Explicit opt-in loader; not added to app startup or echo Settings."""
        values = os.environ if values is None else values
        names = ("AI_SERVER_TURN_MIN_SILENCE_MS", "AI_SERVER_TURN_TRANSCRIPT_STABILITY_MS",
                 "AI_SERVER_TURN_MAX_DURATION_MS")
        if any(not isinstance(values.get(name), str) or not values[name].isascii()
               or not values[name].isdecimal() for name in names):
            raise ValueError("All three AI_SERVER_TURN_* thresholds are required as integer milliseconds")
        return cls(*(int(values[name]) for name in names))


def normalized(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).casefold().split())


class LanguageRule(Protocol):
    def classify(self, text: str) -> LanguageEvidence: ...


@dataclass(frozen=True)
class TextRules:
    """Conservative, caller-configured punctuation/tail heuristic, not grammar.

    Incomplete tails take priority over terminal punctuation. Without an
    explicit terminal mark there is no positive completion evidence.
    """
    terminal_marks: tuple[str, ...]
    incomplete_tails: tuple[str, ...]

    def __post_init__(self) -> None:
        for collection in (self.terminal_marks, self.incomplete_tails):
            if not isinstance(collection, tuple) or any(
                not isinstance(item, str) or not item.strip() for item in collection
            ):
                raise ValueError("Language rules require explicit nonempty string tuples")
        if any(not all(unicodedata.category(char).startswith("P") for char in mark)
               for mark in self.terminal_marks):
            raise ValueError("Terminal marks must be punctuation")

    def classify(self, text: str) -> LanguageEvidence:
        text = normalized(text)
        stem = text
        while stem and unicodedata.category(stem[-1]).startswith("P"):
            stem = stem[:-1].rstrip()
        for tail in self.incomplete_tails:
            tail = normalized(tail)
            if all(unicodedata.category(char).startswith("P") for char in tail):
                if text.endswith(tail):
                    return LanguageEvidence.INCOMPLETE
            elif stem == tail or stem.endswith(" " + tail):
                return LanguageEvidence.INCOMPLETE
        if stem and any(text.endswith(mark) for mark in self.terminal_marks):
            return LanguageEvidence.COMPLETE
        return LanguageEvidence.UNKNOWN


@dataclass(frozen=True)
class SpeechActivity:
    at_ms: float
    active: bool

    def __post_init__(self) -> None:
        valid_time(self.at_ms)
        if type(self.active) is not bool:
            raise ValueError("Speech activity must be boolean")


@dataclass(frozen=True)
class TranscriptEvent:
    at_ms: float
    result: TranscriptionResult

    def __post_init__(self) -> None:
        valid_time(self.at_ms)
        if not isinstance(self.result, TranscriptionResult):
            raise ValueError("Typed transcription result required")


def valid_time(value: float) -> None:
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError("Finite nonnegative monotonic milliseconds required")


class TurnDetector:
    def __init__(self, config: TurnDetectionConfig, rules: LanguageRule, *, started_at_ms: float):
        valid_time(started_at_ms)
        self.config, self.rules = config, rules
        self.started_at_ms = self._last_at = started_at_ms
        self._active = False
        self._heard_speech = False
        self._silence_since: float | None = None
        self._stable_since: float | None = None
        self._text = ""
        self._fresh_transcript = False
        self.transcript: TranscriptionResult | None = None
        self.ended = self.timed_out = self.cancelled = False

    def _advance(self, at_ms: float) -> None:
        valid_time(at_ms)
        if at_ms < self._last_at:
            raise ValueError("Out-of-order turn event")
        self._last_at = at_ms
        if not self.ended and at_ms - self.started_at_ms >= self.config.max_turn_duration_ms:
            self.timed_out = True

    def speech(self, event: SpeechActivity) -> Decision:
        self._advance(event.at_ms)
        if self.ended or self.cancelled or self.timed_out:
            return self._decision(event.at_ms)
        if event.active:
            if not self._active:
                # Do not end a resumed utterance using a stale prior transcript.
                self._fresh_transcript = False
                self._stable_since = None
            self._heard_speech = True
            self._silence_since = None
        elif self._active:
            self._silence_since = event.at_ms
        self._active = event.active
        return self._decision(event.at_ms)

    def transcription(self, event: TranscriptEvent) -> Decision:
        self._advance(event.at_ms)
        if self.ended or self.cancelled or self.timed_out:
            return self._decision(event.at_ms)
        text = normalized(event.result.text)
        if text != self._text or self._stable_since is None:
            self._stable_since = event.at_ms
        self._text = text
        self.transcript = event.result
        self._fresh_transcript = self._heard_speech
        return self._decision(event.at_ms)

    def tick(self, at_ms: float) -> Decision:
        self._advance(at_ms)
        return self._decision(at_ms)

    def check_timeout(self, at_ms: float) -> bool:
        """Validate ingress time without ending on stale VAD before new speech."""
        self._advance(at_ms)
        return self.timed_out

    def cancel(self) -> Decision:
        self.cancelled = True
        self.transcript = None
        self._text = ""
        return Decision.UNCERTAIN

    def _decision(self, at_ms: float) -> Decision:
        if self.cancelled or self.timed_out:
            return Decision.UNCERTAIN
        if self.ended:
            return Decision.END
        if self._active or self._silence_since is None:
            return Decision.WAIT
        if at_ms - self._silence_since < self.config.min_silence_ms:
            return Decision.WAIT
        if not self._fresh_transcript or not self._text:
            return Decision.UNCERTAIN
        if self._stable_since is None or at_ms - self._stable_since < self.config.transcript_stability_ms:
            return Decision.WAIT
        if self.rules.classify(self._text) != LanguageEvidence.COMPLETE:
            return Decision.UNCERTAIN
        self.ended = True
        return Decision.END
