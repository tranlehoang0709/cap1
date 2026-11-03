"""Internal TTS/playback types; no new firmware messages or production defaults."""

from dataclasses import dataclass, field
from enum import StrEnum

from app.models.audio import AudioMetadata, positive_int
from app.models.llm import ConversationKey


class TTSErrorCode(StrEnum):
    INVALID_INPUT = "invalid_input"
    INVALID_AUDIO = "invalid_audio"
    UNSAFE_TEXT = "unsafe_text"
    INCOMPLETE_INPUT = "incomplete_input"
    LIMIT = "limit"
    PROVIDER_ERROR = "provider_error"
    AUTHENTICATION = "authentication_failed"
    PERMISSION = "permission_denied"
    RATE_LIMIT = "rate_limited"
    SERVICE_UNAVAILABLE = "service_unavailable"
    NOT_FOUND = "not_found"
    DNS_FAILURE = "dns_failure"
    TLS_FAILURE = "tls_failure"
    NETWORK_FAILURE = "network_failure"
    CODEC_UNAVAILABLE = "codec_unavailable"
    OUTPUT_ERROR = "output_error"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    SESSION_BUSY = "session_busy"
    INVALID_PROOF = "invalid_playback_proof"


class TTSError(Exception):
    def __init__(self, code: TTSErrorCode):
        self.code = code
        super().__init__(code.value)


@dataclass(frozen=True)
class AudioFormat:
    metadata: AudioMetadata
    data_format: str

    def __post_init__(self):
        if not isinstance(self.metadata, AudioMetadata) or not isinstance(self.data_format, str) or not self.data_format.strip():
            raise TTSError(TTSErrorCode.INVALID_AUDIO)


@dataclass(frozen=True)
class TTSConfig:
    model: str
    voice: str
    language: str
    audio_format: AudioFormat

    def __post_init__(self):
        if (any(not isinstance(value, str) or not value.strip() for value in (self.model, self.voice, self.language))
            or not isinstance(self.audio_format, AudioFormat)):
            raise TTSError(TTSErrorCode.INVALID_INPUT)


@dataclass(frozen=True)
class PlaybackLimits:
    max_queue_chunks: int
    max_queue_bytes: int
    max_chunk_bytes: int
    max_segments: int
    max_text_chars: int
    max_turns: int

    def __post_init__(self):
        if not all(positive_int(value) for value in (
            self.max_queue_chunks, self.max_queue_bytes, self.max_chunk_bytes,
            self.max_segments, self.max_text_chars, self.max_turns
        )) or self.max_chunk_bytes > self.max_queue_bytes:
            raise ValueError("Explicit positive playback limits required; chunk must fit queue")


@dataclass(frozen=True)
class PlaybackScope:
    key: ConversationKey
    turn_id: str
    generation: str  # Opaque correlation; dev extension maps this to playback_id.


@dataclass(frozen=True)
class TTSRequest:
    scope: PlaybackScope
    segment_index: int
    text: str = field(repr=False)
    config: TTSConfig


@dataclass(frozen=True)
class TTSAudioChunk:
    sequence: int
    payload: bytes = field(repr=False)
    audio_format: AudioFormat

    def __post_init__(self):
        if (type(self.sequence) is not int or self.sequence < 0
            or not isinstance(self.payload, bytes) or not self.payload
            or not isinstance(self.audio_format, AudioFormat)):
            raise TTSError(TTSErrorCode.INVALID_AUDIO)


@dataclass(frozen=True)
class ScheduledAudio:
    scope: PlaybackScope
    segment_index: int
    chunk: TTSAudioChunk


@dataclass(frozen=True)
class PlaybackEvidence:
    scope: PlaybackScope
    completed: bool
    source: str  # Mock sink or negotiated development firmware evidence.

    def __post_init__(self):
        # Only scoped adapters may construct evidence. A sent tts.stop or
        # socket send success alone cannot become completion proof.
        if (not isinstance(self.scope, PlaybackScope) or type(self.completed) is not bool
            or self.source not in ("mock-only", "development-firmware-drained-v1")):
            raise TTSError(TTSErrorCode.INVALID_PROOF)


@dataclass(frozen=True)
class PlaybackReceipt:
    scope: PlaybackScope
    evidence: PlaybackEvidence
    ready_for_next_turn: bool
