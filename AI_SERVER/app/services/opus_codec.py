"""Bounded libopus raw-packet codec and fixed-frame PCM conversion (no Cloud)."""

import ctypes as c
import ctypes.util
import importlib.util
from pathlib import Path
import struct

from app.core.config import get_settings


class CodecError(ValueError):
    pass


def _load_opus_library():
    # An explicit local DLL path avoids relying on a global Windows PATH.
    path = get_settings().opus_library or ctypes.util.find_library("opus")
    if not path:
        bundled = importlib.util.find_spec("opuslib_next")
        if bundled and bundled.origin:
            candidate = Path(bundled.origin).parent / "_native" / "opus.dll"
            if candidate.is_file():
                path = candidate
    if not path:
        raise CodecError("libopus unavailable")
    try:
        return c.CDLL(str(path))
    except OSError:
        raise CodecError("libopus unavailable") from None


def resample_pcm16(pcm: bytes, source_rate: int, target_rate: int) -> bytes:
    """Linear fixed-frame conversion, mono s16le; not a quality claim for speech."""
    if (type(source_rate) is not int or type(target_rate) is not int
        or source_rate not in (8000, 12000, 16000, 24000, 48000)
        or target_rate not in (8000, 12000, 16000, 24000, 48000)):
        raise CodecError("Unsupported sample rate")
    if not isinstance(pcm, bytes) or not pcm or len(pcm) % 2 or len(pcm) > source_rate * 120 // 1000 * 2:
        raise CodecError("Whole PCM16 samples required")
    if source_rate == target_rate:
        return pcm
    samples = struct.unpack("<" + "h" * (len(pcm) // 2), pcm)
    count = len(samples) * target_rate // source_rate
    if count < 1:
        raise CodecError("PCM frame too short")
    converted = []
    for i in range(count):
        numerator = i * source_rate
        left, fraction = divmod(numerator, target_rate)
        right = min(left + 1, len(samples) - 1)
        converted.append(round((samples[left] * (target_rate - fraction) + samples[right] * fraction) / target_rate))
    return struct.pack("<" + "h" * count, *converted)


class OpusCodec:
    def __init__(self, rate: int, frame_ms: int):
        if type(rate) is not int or rate not in (8000, 12000, 16000, 24000, 48000) or type(frame_ms) is not int or frame_ms not in (10, 20, 40, 60):
            raise CodecError("Unsupported Opus profile")
        self.lib = _load_opus_library()
        self.rate, self.frame_ms, self.samples = rate, frame_ms, rate * frame_ms // 1000
        self.decoder = self.encoder = None
        self.lib.opus_decoder_create.argtypes = [c.c_int, c.c_int, c.POINTER(c.c_int)]
        self.lib.opus_decoder_create.restype = c.c_void_p
        self.lib.opus_encoder_create.argtypes = [c.c_int, c.c_int, c.c_int, c.POINTER(c.c_int)]
        self.lib.opus_encoder_create.restype = c.c_void_p
        self.lib.opus_decode.argtypes = [c.c_void_p, c.c_void_p, c.c_int, c.c_void_p, c.c_int, c.c_int]
        self.lib.opus_encode.argtypes = [c.c_void_p, c.c_void_p, c.c_int, c.c_void_p, c.c_int]
        self.lib.opus_decoder_destroy.argtypes = [c.c_void_p]
        self.lib.opus_encoder_destroy.argtypes = [c.c_void_p]
        error = c.c_int()
        self.decoder = self.lib.opus_decoder_create(rate, 1, c.byref(error))
        if error.value or not self.decoder:
            self.close()
            raise CodecError("Cannot initialize Opus decoder")
        self.encoder = self.lib.opus_encoder_create(rate, 1, 2049, c.byref(error))  # OPUS_APPLICATION_AUDIO
        if error.value or not self.encoder:
            self.close()
            raise CodecError("Cannot initialize Opus encoder")

    def decode(self, packet: bytes) -> bytes:
        if not self.decoder or not isinstance(packet, bytes) or not 0 < len(packet) <= 4096:
            raise CodecError("Invalid Opus packet")
        out = (c.c_int16 * (self.rate * 120 // 1000))()
        decoded = self.lib.opus_decode(self.decoder, packet, len(packet), out, len(out), 0)
        if decoded != self.samples:
            raise CodecError("Invalid packet or frame duration")
        return struct.pack("<" + "h" * decoded, *out[:decoded])

    def encode(self, pcm: bytes) -> bytes:
        if not self.encoder or not isinstance(pcm, bytes) or len(pcm) != self.samples * 2:
            raise CodecError("Exact PCM frame required")
        samples = (c.c_int16 * self.samples)(*struct.unpack("<" + "h" * self.samples, pcm))
        out = (c.c_ubyte * 1275)()
        size = self.lib.opus_encode(self.encoder, samples, self.samples, out, len(out))
        if size <= 0:
            raise CodecError("Opus encode failed")
        return bytes(out[:size])

    def close(self):
        if self.decoder:
            self.lib.opus_decoder_destroy(self.decoder)
            self.decoder = None
        if self.encoder:
            self.lib.opus_encoder_destroy(self.encoder)
            self.encoder = None


class PCMOpusFrames:
    """Streaming rebuffer at 60ms source frames, bounded feed, zero-pad last frame."""
    def __init__(self, source_rate: int, target_rate: int, *, max_chunk_bytes: int):
        if type(source_rate) is not int or source_rate not in (8000, 12000, 16000, 24000, 48000):
            raise CodecError("Unsupported source rate")
        if type(max_chunk_bytes) is not int or not 0 < max_chunk_bytes <= 65536:
            raise CodecError("Bounded PCM chunk size required")
        self.codec = OpusCodec(target_rate, 60)
        self.source_rate, self.max_chunk_bytes = source_rate, max_chunk_bytes
        self.frame_bytes = source_rate * 60 // 1000 * 2
        self.pending = bytearray()

    def feed(self, pcm: bytes):
        if not isinstance(pcm, bytes) or not pcm or len(pcm) % 2 or len(pcm) > self.max_chunk_bytes:
            raise CodecError("Invalid PCM chunk")
        self.pending.extend(pcm)
        packets = []
        while len(self.pending) >= self.frame_bytes:
            frame = bytes(self.pending[:self.frame_bytes])
            del self.pending[:self.frame_bytes]
            packets.append(self.codec.encode(resample_pcm16(frame, self.source_rate, self.codec.rate)))
        return packets

    def finish(self):
        if not self.pending:
            return []
        padded = bytes(self.pending) + b"\x00" * (self.frame_bytes - len(self.pending))
        self.pending.clear()
        return [self.codec.encode(resample_pcm16(padded, self.source_rate, self.codec.rate))]

    def close(self):
        self.pending.clear()
        self.codec.close()
