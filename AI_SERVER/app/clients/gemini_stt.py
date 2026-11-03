"""Gemini audio transcription adapter for bounded audio inputs.

Raw firmware Opus packets are decoded to PCM16 and wrapped as WAV. Complete
Ogg Opus files stay Ogg containers; raw packets are never mislabeled as Ogg.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
import array
import io
import struct
import sys
import wave

from app.models.audio import AudioError, ErrorCode, TranscriptionResult
from app.services.audio_context import AudioContext
from app.services.audio_input import AudioInput
from app.services.opus_codec import CodecError, OpusCodec


class GeminiSTTAdapter:
    def __init__(self, *, api_key: str, model: str, timeout_seconds: float = 30,
                 max_audio_bytes: int = 5_000_000, max_duration_seconds: float = 120,
                 client_factory: Callable[..., object] | None = None,
                 opus_factory: Callable[[int, int], object] = OpusCodec):
        if not isinstance(api_key, str) or not api_key.strip() or not isinstance(model, str) or not model.strip():
            raise ValueError("Explicit Gemini STT key and model required")
        if type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 120:
            raise ValueError("Invalid Gemini STT timeout")
        if type(max_audio_bytes) is not int or not 0 < max_audio_bytes <= 19_000_000:
            raise ValueError("Invalid audio byte ceiling")
        if type(max_duration_seconds) not in (int, float) or not 0 < max_duration_seconds <= 600:
            raise ValueError("Invalid audio duration ceiling")
        self._api_key, self.model = api_key, model
        self.timeout_seconds = float(timeout_seconds)
        self.max_audio_bytes, self.max_duration_seconds = max_audio_bytes, float(max_duration_seconds)
        self._client_factory = client_factory or self._google_client
        self._opus_factory = opus_factory

    def __repr__(self):
        return f"GeminiSTTAdapter(model={self.model!r}, api_key=<redacted>)"

    @staticmethod
    def _google_client(api_key: str, timeout_seconds: float):
        from google import genai
        from google.genai import types
        return genai.Client(api_key=api_key, http_options=types.HttpOptions(
            timeout=round(timeout_seconds * 1000), retry_options=types.HttpRetryOptions(attempts=1)))

    async def transcribe(self, audio: AudioInput, context: AudioContext) -> AsyncIterator[TranscriptionResult]:
        codec = (audio.metadata.codec or "").lower()
        sample_rate = audio.metadata.sample_rate_hz
        channels = audio.metadata.channels
        frame_ms = audio.metadata.frame_duration_ms
        if type(sample_rate) is not int or channels != 1:
            raise AudioError(ErrorCode.INVALID_METADATA)
        if codec not in ("opus", "ogg_opus", "ogg", "wav", "pcm_s16le", "pcm"):
            raise AudioError(ErrorCode.INVALID_METADATA)
        if codec in ("opus", "pcm_s16le", "pcm") and (sample_rate not in (8000, 12000, 16000, 24000, 48000)):
            raise AudioError(ErrorCode.INVALID_METADATA)
        if codec == "opus" and (type(frame_ms) not in (int, float) or frame_ms not in (10, 20, 40, 60)):
            raise AudioError(ErrorCode.INVALID_METADATA)
        if codec in ("pcm_s16le", "pcm") and audio.metadata.sample_format != "s16le":
            raise AudioError(ErrorCode.INVALID_METADATA)

        raw = bytearray()
        pcm = bytearray()
        input_size = 0
        needs_raw_container = codec in ("ogg", "ogg_opus", "wav")
        opus = None
        client = None
        try:
            while True:
                context.check()
                frame = await context.run(audio.read)
                if frame is None:
                    break
                payload = frame.payload
                if not payload or input_size + len(payload) > self.max_audio_bytes:
                    raise AudioError(ErrorCode.AUDIO_TOO_LARGE if payload else ErrorCode.INVALID_AUDIO)
                input_size += len(payload)
                if needs_raw_container:
                    raw.extend(payload)
                if codec == "opus":
                    if opus is None:
                        try:
                            opus = self._opus_factory(sample_rate, int(frame_ms))
                        except CodecError as error:
                            if "libopus unavailable" in str(error):
                                raise AudioError(ErrorCode.CODEC_UNAVAILABLE) from None
                            raise AudioError(ErrorCode.INVALID_AUDIO) from None
                    try:
                        decoded = opus.decode(payload)
                    except Exception:
                        raise AudioError(ErrorCode.INVALID_AUDIO) from None
                    pcm.extend(decoded)
                    duration = len(pcm) / (2 * sample_rate)
                    if duration > self.max_duration_seconds:
                        raise AudioError(ErrorCode.AUDIO_TOO_LARGE)
                elif codec in ("pcm_s16le", "pcm"):
                    if len(payload) % 2:
                        raise AudioError(ErrorCode.INVALID_AUDIO)
                    pcm.extend(payload)
                    if len(pcm) / (2 * sample_rate) > self.max_duration_seconds:
                        raise AudioError(ErrorCode.AUDIO_TOO_LARGE)

            if input_size == 0:
                raise AudioError(ErrorCode.EMPTY_AUDIO)
            raw_payload = bytes(raw) if raw else b""
            pcm_payload = bytes(pcm) if pcm else b""
            mime_type, provider_audio = self._provider_audio(codec, raw_payload, pcm_payload, sample_rate)
            raw.clear()
            pcm.clear()
            del raw_payload, pcm_payload
            if len(provider_audio) > self.max_audio_bytes:
                raise AudioError(ErrorCode.AUDIO_TOO_LARGE)
            context.check()
            client = self._client_factory(self._api_key, self.timeout_seconds)
            from google.genai import types
            content = types.Part.from_bytes(data=provider_audio, mime_type=mime_type)
            config = types.GenerateContentConfig(candidate_count=1,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
            prompt = "Transcribe speech in this audio verbatim. The spoken language is Vietnamese. Return only the transcript, preserving the original language; do not translate, summarize, or add commentary."
            response = await context.run(lambda: client.aio.models.generate_content(
                model=self.model, contents=[prompt, content], config=config))
            text = getattr(response, "text", None)
            if not isinstance(text, str) or not text.strip():
                raise AudioError(ErrorCode.INVALID_TRANSCRIPT)
            yield TranscriptionResult(text.strip(), True, "vi")
        except AudioError:
            raise
        except (TimeoutError, asyncio.TimeoutError):
            raise AudioError(ErrorCode.DEADLINE_EXCEEDED) from None
        except Exception as error:
            status = getattr(error, "status_code", None) or getattr(error, "code", None)
            name = str(getattr(status, "name", status)).upper()
            if name in ("429", "RESOURCE_EXHAUSTED"):
                raise AudioError(ErrorCode.RATE_LIMIT) from None
            if name in ("503", "UNAVAILABLE", "SERVICE_UNAVAILABLE"):
                raise AudioError(ErrorCode.SERVICE_UNAVAILABLE) from None
            raise AudioError(ErrorCode.PROVIDER_FAILED) from None
        finally:
            raw.clear()
            pcm.clear()
            if opus is not None:
                try:
                    opus.close()
                except Exception:
                    pass
            if client is not None:
                try:
                    async_client = getattr(client, "aio", None)
                    close_async = getattr(async_client, "aclose", None)
                    if close_async:
                        await close_async()
                    close_sync = getattr(client, "close", None)
                    if close_sync:
                        close_sync()
                except Exception:
                    pass

    def _provider_audio(self, codec: str, raw: bytes, pcm: bytes, sample_rate: int) -> tuple[str, bytes]:
        if codec in ("ogg", "ogg_opus"):
            seconds = _ogg_opus_duration(raw)
            if seconds <= 0 or seconds > self.max_duration_seconds:
                raise AudioError(ErrorCode.AUDIO_TOO_LARGE if seconds > self.max_duration_seconds else ErrorCode.INVALID_AUDIO)
            return "audio/ogg", raw
        if codec == "wav":
            try:
                with wave.open(io.BytesIO(raw), "rb") as source:
                    if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getcomptype() != "NONE":
                        raise AudioError(ErrorCode.INVALID_AUDIO)
                    rate = source.getframerate()
                    frames = source.getnframes()
                    if frames / rate > self.max_duration_seconds:
                        raise AudioError(ErrorCode.AUDIO_TOO_LARGE)
                    pcm = source.readframes(frames)
                    if len(pcm) != frames * 2:
                        raise AudioError(ErrorCode.INVALID_AUDIO)
                    sample_rate = rate
            except AudioError:
                raise
            except Exception:
                raise AudioError(ErrorCode.INVALID_AUDIO) from None
        if not pcm or len(pcm) % 2:
            raise AudioError(ErrorCode.INVALID_AUDIO)
        try:
            normalized = _resample_pcm16(pcm, sample_rate, 16000)
            output = io.BytesIO()
            with wave.open(output, "wb") as target:
                target.setnchannels(1)
                target.setsampwidth(2)
                target.setframerate(16000)
                target.writeframes(normalized)
            wav_data = output.getvalue()
        except Exception:
            raise AudioError(ErrorCode.INVALID_AUDIO) from None
        return "audio/wav", wav_data


def _ogg_opus_duration(data: bytes) -> float:
    if not data or not data.startswith(b"OggS"):
        raise AudioError(ErrorCode.INVALID_AUDIO)
    offset, last_granule, first_packet = 0, None, bytearray()
    while offset < len(data):
        if len(data) - offset < 27 or data[offset:offset + 4] != b"OggS":
            raise AudioError(ErrorCode.INVALID_AUDIO)
        segment_count = data[offset + 26]
        header_end = offset + 27 + segment_count
        if header_end > len(data):
            raise AudioError(ErrorCode.INVALID_AUDIO)
        lacing = data[offset + 27:header_end]
        page_size = sum(lacing)
        page_end = header_end + page_size
        if page_end > len(data):
            raise AudioError(ErrorCode.INVALID_AUDIO)
        granule = struct.unpack_from("<Q", data, offset + 6)[0]
        if granule != 0xFFFFFFFFFFFFFFFF:
            last_granule = granule
        body_offset = header_end
        for length in lacing:
            first_packet.extend(data[body_offset:body_offset + length])
            body_offset += length
            if length < 255:
                break
        offset = page_end
    if b"OpusHead" not in first_packet or last_granule is None or len(first_packet) < 12:
        raise AudioError(ErrorCode.INVALID_AUDIO)
    pre_skip = struct.unpack_from("<H", first_packet, 10)[0]
    return max(0, last_granule - pre_skip) / 48000


def _resample_pcm16(pcm: bytes, source_rate: int, target_rate: int) -> bytes:
    """Bounded mono s16le linear resampling for the complete capped utterance."""
    supported = (8000, 12000, 16000, 24000, 48000)
    if (not pcm or len(pcm) % 2 or source_rate not in supported or target_rate not in supported):
        raise AudioError(ErrorCode.INVALID_AUDIO)
    if source_rate == target_rate:
        return pcm
    samples = array.array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    output_count = len(samples) * target_rate // source_rate
    if output_count < 1:
        raise AudioError(ErrorCode.INVALID_AUDIO)
    output = array.array("h")
    for index in range(output_count):
        numerator = index * source_rate
        left, fraction = divmod(numerator, target_rate)
        right = min(left + 1, len(samples) - 1)
        value = round((samples[left] * (target_rate - fraction) + samples[right] * fraction) / target_rate)
        output.append(max(-32768, min(32767, value)))
    if sys.byteorder != "little":
        output.byteswap()
    return output.tobytes()
