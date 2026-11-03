"""Standalone firmware SendAudio envelope checks; no endpoint or negotiation.

Source: main/protocols/protocol.h and websocket_protocol.cc. Payload bytes are
opaque here: framing validity does NOT establish Opus bitstream validity.
"""

from dataclasses import dataclass
import struct

from app.models.audio import AudioError, AudioFrame, ErrorCode, positive_int


@dataclass(frozen=True)
class FramingConfig:
    version: int
    max_payload_bytes: int

    def __post_init__(self) -> None:
        if type(self.version) is not int or self.version not in (1, 2, 3):
            raise ValueError("Explicit firmware framing version 1, 2 or 3 required")
        if not positive_int(self.max_payload_bytes):
            raise ValueError("Positive payload limit required")

    @property
    def header_bytes(self) -> int:
        return {1: 0, 2: 16, 3: 4}[self.version]


def validate_audio_frame(data: bytes, config: FramingConfig) -> AudioFrame:
    if not isinstance(data, bytes):
        raise AudioError(ErrorCode.INVALID_FRAME)
    if len(data) > config.header_bytes + config.max_payload_bytes:
        raise AudioError(ErrorCode.FRAME_TOO_LARGE)
    if len(data) <= config.header_bytes:
        raise AudioError(ErrorCode.INVALID_FRAME)
    timestamp = None
    if config.version == 2:
        version, kind, reserved, timestamp, size = struct.unpack_from("!HHIII", data)
        if version != 2 or kind != 0 or reserved != 0:
            raise AudioError(ErrorCode.INVALID_FRAME)
    elif config.version == 3:
        kind, reserved, size = struct.unpack_from("!BBH", data)
        if kind != 0 or reserved != 0:
            raise AudioError(ErrorCode.INVALID_FRAME)
    else:
        size = len(data)
    if size > config.max_payload_bytes:
        raise AudioError(ErrorCode.FRAME_TOO_LARGE)
    if size != len(data) - config.header_bytes:
        raise AudioError(ErrorCode.INVALID_FRAME)
    return AudioFrame(data[config.header_bytes:], timestamp)


def encode_audio_frame(frame: AudioFrame, config: FramingConfig) -> bytes:
    if len(frame.payload) > config.max_payload_bytes:
        raise AudioError(ErrorCode.FRAME_TOO_LARGE)
    if config.version == 2:
        return struct.pack("!HHIII", 2, 0, 0, frame.timestamp_ms or 0, len(frame.payload)) + frame.payload
    if config.version == 3:
        if len(frame.payload) > 65535:
            raise AudioError(ErrorCode.FRAME_TOO_LARGE)
        return struct.pack("!BBH", 0, 0, len(frame.payload)) + frame.payload
    return frame.payload
