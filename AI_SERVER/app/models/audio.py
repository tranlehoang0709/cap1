"""Provider-neutral internal types. None of these are robot JSON schemas."""

from dataclasses import dataclass
from enum import StrEnum
import math


class ErrorCode(StrEnum):
    INVALID_METADATA = "invalid_metadata"
    INVALID_FRAME = "invalid_frame"
    FRAME_TOO_LARGE = "frame_too_large"
    BUFFER_FULL = "buffer_full"
    INPUT_CLOSED = "input_closed"
    CANCELLED = "cancelled"
    DEADLINE_EXCEEDED = "deadline_exceeded"
    PROVIDER_FAILED = "provider_failed"
    INVALID_TRANSCRIPT = "invalid_transcript"
    EMPTY_AUDIO = "empty_audio"
    INVALID_AUDIO = "invalid_audio"
    AUDIO_TOO_LARGE = "audio_too_large"
    CODEC_UNAVAILABLE = "codec_unavailable"
    RATE_LIMIT = "rate_limit"
    SERVICE_UNAVAILABLE = "service_unavailable"


class AudioError(Exception):
    """Safe, typed error: never embed payload, transcript or provider exception."""

    def __init__(self, code: ErrorCode):
        self.code = code
        super().__init__(code.value)


def positive_int(value: object) -> bool:
    return type(value) is int and value > 0


@dataclass(frozen=True)
class AudioMetadata:
    # Explicit caller-supplied format; no provider/robot defaults or conversion.
    codec: str
    sample_rate_hz: int
    channels: int
    frame_duration_ms: float
    sample_format: str | None = None

    def __post_init__(self) -> None:
        if (
            not isinstance(self.codec, str) or not self.codec.strip()
            or not positive_int(self.sample_rate_hz) or not positive_int(self.channels)
            or type(self.frame_duration_ms) not in (int, float)
            or not math.isfinite(self.frame_duration_ms) or self.frame_duration_ms <= 0
            or (self.sample_format is not None and (
                not isinstance(self.sample_format, str) or not self.sample_format.strip()
            ))
        ):
            raise AudioError(ErrorCode.INVALID_METADATA)


@dataclass(frozen=True)
class AudioFrame:
    payload: bytes
    timestamp_ms: int | None = None

    def __post_init__(self) -> None:
        if (not isinstance(self.payload, bytes) or not self.payload
            or (self.timestamp_ms is not None and (
                type(self.timestamp_ms) is not int or not 0 <= self.timestamp_ms <= 0xFFFFFFFF
            ))):
            raise AudioError(ErrorCode.INVALID_FRAME)


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    is_final: bool
    language: str | None = None

    def __post_init__(self) -> None:
        # Empty final text is allowed: a provider can detect no speech.
        if (not isinstance(self.text, str) or type(self.is_final) is not bool
            or (self.language is not None and (
                not isinstance(self.language, str) or not self.language.strip()
            ))):
            raise AudioError(ErrorCode.INVALID_TRANSCRIPT)
