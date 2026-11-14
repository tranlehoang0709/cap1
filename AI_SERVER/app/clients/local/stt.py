"""In-memory Vietnamese STT using one faster-whisper CUDA model per process."""
import asyncio
import math
import struct
import threading
from collections.abc import AsyncIterator, Callable

from app.core.local_stt_config import LocalSTTSettings
from app.models.audio import AudioError, ErrorCode, TranscriptionResult
from app.services.audio_context import AudioContext
from app.services.opus_codec import CodecError, OpusCodec, resample_pcm16

_models: dict[tuple[str, str, str, str], object] = {}
_model_lock = threading.Lock()


def _model_key(settings: LocalSTTSettings) -> tuple[str, str, str, str]:
    return (settings.model, str(settings.cache_dir), settings.device, settings.compute_type)


class LocalSTTAdapter:
    def __init__(self, settings: LocalSTTSettings | None = None, *,
                 model_factory: Callable[..., object] | None = None,
                 opus_factory: Callable[[int, int], object] = OpusCodec):
        self.settings = settings or LocalSTTSettings()
        self._model_factory = model_factory
        self._opus_factory = opus_factory

    def __repr__(self):
        return (f"LocalSTTAdapter(model={self.settings.model!r}, "
                f"device={self.settings.device!r}, compute_type={self.settings.compute_type!r})")

    async def load(self, context: AudioContext | None = None) -> None:
        operation = asyncio.to_thread(self._load_sync)
        if context is None:
            await asyncio.wait_for(operation, self.settings.timeout_seconds)
        else:
            await context.run(lambda: operation)

    def _load_sync(self):
        key = _model_key(self.settings)
        with _model_lock:
            if key not in _models:
                factory = self._model_factory
                if factory is None:
                    from faster_whisper import WhisperModel
                    factory = WhisperModel
                _models[key] = factory(
                    self.settings.model, device=self.settings.device,
                    compute_type=self.settings.compute_type,
                    download_root=str(self.settings.cache_dir), local_files_only=True)
        return _models[key]

    async def transcribe(self, audio, context: AudioContext) -> AsyncIterator[TranscriptionResult]:
        metadata = audio.metadata
        codec = metadata.codec.lower()
        if (metadata.channels != 1 or codec not in ("opus", "pcm", "pcm_s16le")
                or metadata.sample_rate_hz not in (8000, 12000, 16000, 24000, 48000)
                or (codec == "opus" and metadata.frame_duration_ms not in (10, 20, 40, 60))
                or (codec in ("pcm", "pcm_s16le") and metadata.sample_format != "s16le")):
            raise AudioError(ErrorCode.INVALID_METADATA)
        pcm = bytearray()
        input_bytes = 0
        opus = None
        try:
            while True:
                frame = await context.run(audio.read)
                if frame is None:
                    break
                payload = frame.payload
                input_bytes += len(payload)
                if input_bytes > self.settings.max_audio_bytes:
                    raise AudioError(ErrorCode.AUDIO_TOO_LARGE)
                if codec == "opus":
                    if opus is None:
                        try:
                            opus = self._opus_factory(metadata.sample_rate_hz,
                                                      int(metadata.frame_duration_ms))
                        except CodecError:
                            raise AudioError(ErrorCode.CODEC_UNAVAILABLE) from None
                    try:
                        decoded = opus.decode(payload)
                    except Exception:
                        raise AudioError(ErrorCode.INVALID_AUDIO) from None
                else:
                    if len(payload) % 2:
                        raise AudioError(ErrorCode.INVALID_AUDIO)
                    decoded = payload
                if metadata.sample_rate_hz != 16000:
                    try:
                        decoded = resample_pcm16(decoded, metadata.sample_rate_hz, 16000)
                    except CodecError:
                        raise AudioError(ErrorCode.INVALID_AUDIO) from None
                pcm.extend(decoded)
                if len(pcm) > self.settings.max_duration_seconds * 16000 * 2:
                    raise AudioError(ErrorCode.AUDIO_TOO_LARGE)
            if input_bytes == 0:
                raise AudioError(ErrorCode.EMPTY_AUDIO)
            if not pcm or len(pcm) % 2:
                raise AudioError(ErrorCode.INVALID_AUDIO)
            samples = struct.unpack("<" + "h" * (len(pcm) // 2), pcm)
            rms = math.sqrt(sum(value * value for value in samples) / len(samples))
            if rms < self.settings.silence_rms_threshold:
                yield TranscriptionResult("", True, self.settings.language)
                return
            pcm_bytes = bytes(pcm)
            pcm.clear()
            text = await context.run(lambda: asyncio.to_thread(self._transcribe_sync, pcm_bytes))
            context.check()
            yield TranscriptionResult(text, True, self.settings.language)
        except AudioError:
            raise
        except (TimeoutError, asyncio.TimeoutError):
            raise AudioError(ErrorCode.DEADLINE_EXCEEDED) from None
        except Exception:
            raise AudioError(ErrorCode.PROVIDER_FAILED) from None
        finally:
            pcm.clear()
            if opus is not None:
                try:
                    opus.close()
                except Exception:
                    pass

    def _transcribe_sync(self, pcm: bytes) -> str:
        import numpy as np
        model = self._load_sync()
        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        segments, _ = model.transcribe(
            samples, language=self.settings.language, task="transcribe",
            beam_size=self.settings.beam_size, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": self.settings.vad_min_silence_ms},
            condition_on_previous_text=False)
        return " ".join(segment.text.strip() for segment in segments
                        if isinstance(segment.text, str) and segment.text.strip()).strip()
