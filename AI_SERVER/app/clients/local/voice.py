"""Offline Piper Vietnamese PCM synthesis and bounded Opus conversion."""
import asyncio
import re
import threading
import unicodedata
from collections.abc import Callable

from app.core.local_tts_config import LocalTTSSettings
from app.models.audio import AudioError, AudioMetadata, ErrorCode
from app.models.tts import AudioFormat, TTSAudioChunk, TTSRequest, TTSError, TTSErrorCode
from app.services.opus_codec import CodecError, PCMOpusFrames


OPUS_FORMAT = AudioFormat(AudioMetadata("opus", 16000, 1, 60), "raw")
_voices: dict[tuple[str, str], object] = {}
_voice_lock = threading.Lock()
_END = object()

_EMOTICON = re.compile(r"(?<!\w)(?::-|;-|:|;)(?:\)|\(|D|P)(?!\w)", re.IGNORECASE)
_EMOJI = re.compile(
    "[\U0001F1E6-\U0001F1FF\U0001F300-\U0001FAFF\U00002600-\U000027BF\u2B50\u2B55]"
    "[\U0000FE0E\U0000FE0F\U0001F3FB-\U0001F3FF]*"
    "(?:\u200d[\U0001F300-\U0001FAFF][\U0000FE0E\U0000FE0F\U0001F3FB-\U0001F3FF]*)*"
)


def normalize_text_for_speech(value: str) -> str:
    """Remove visual-only markup from a TTS copy without changing stored text."""
    text = unicodedata.normalize("NFC", value)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s+", "", text)
    text = re.sub(r"(?m)^\s*\*+\s+", "", text)
    # Complete emphasis spans only; arithmetic such as ``2 * 3`` is preserved.
    text = re.sub(r"(?<!\w)\*{1,3}([^*\n]+?)\*{1,3}(?!\w)", r"\1", text)
    text = re.sub(r"(?<!\S)#+(?!\S)", " ", text)
    text = _EMOTICON.sub(" ", text)
    text = _EMOJI.sub(" ", text)
    text = text.replace("\ufe0f", "").replace("\ufe0e", "").replace("\u200d", "")
    return re.sub(r"\s+", " ", text).strip()


def _next(iterator):
    try:
        return next(iterator)
    except StopIteration:
        return _END


class LocalTTSAdapter:
    def __init__(self, settings: LocalTTSSettings | None = None, *,
                 voice_factory: Callable[..., object] | None = None,
                 encoder_factory: Callable[..., object] = PCMOpusFrames):
        self.settings = settings or LocalTTSSettings()
        self._voice_factory = voice_factory
        self._encoder_factory = encoder_factory

    async def load(self, context=None) -> None:
        operation = lambda: asyncio.to_thread(self._load_sync)
        if context is None:
            await asyncio.wait_for(operation(), self.settings.timeout_seconds)
        else:
            await context.run(operation)

    def _load_sync(self):
        settings = self.settings
        key = (str(settings.model_path), str(settings.config_path))
        with _voice_lock:
            if key not in _voices:
                if not settings.model_path.is_file() or not settings.config_path.is_file():
                    raise FileNotFoundError("local_tts_model_missing")
                factory = self._voice_factory
                if factory is None:
                    from piper import PiperVoice
                    factory = PiperVoice.load
                _voices[key] = factory(settings.model_path, config_path=settings.config_path,
                                       use_cuda=False)
        return _voices[key]

    def _text(self, request: TTSRequest) -> str:
        if not isinstance(request, TTSRequest) or request.config.audio_format != OPUS_FORMAT:
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        text = normalize_text_for_speech(request.text)
        if (not text or len(text) > self.settings.max_text_chars
                or any(unicodedata.category(char) == "Cc" and char not in "\n\r\t" for char in text)):
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        return text

    async def synthesize(self, request: TTSRequest, context):
        text = self._text(request)
        encoder = iterator = None
        sequence = total_pcm = source_chunks = 0
        try:
            voice = await context.run(lambda: asyncio.wait_for(
                asyncio.to_thread(self._load_sync), self.settings.timeout_seconds))
            iterator = iter(voice.synthesize(text))
            encoder = self._encoder_factory(
                self.settings.source_sample_rate_hz, self.settings.target_sample_rate_hz,
                max_chunk_bytes=65536)
            while True:
                chunk = await context.run(lambda: asyncio.wait_for(
                    asyncio.to_thread(_next, iterator), self.settings.timeout_seconds))
                if chunk is _END:
                    break
                context.check()
                if (getattr(chunk, "sample_rate", None) != self.settings.source_sample_rate_hz
                        or getattr(chunk, "sample_width", None) != 2
                        or getattr(chunk, "sample_channels", None) != 1):
                    raise TTSError(TTSErrorCode.INVALID_AUDIO)
                pcm = chunk.audio_int16_bytes
                if not isinstance(pcm, bytes) or not pcm or len(pcm) % 2:
                    raise TTSError(TTSErrorCode.INVALID_AUDIO)
                source_chunks += 1
                total_pcm += len(pcm)
                if total_pcm > self.settings.max_audio_seconds * self.settings.source_sample_rate_hz * 2:
                    raise TTSError(TTSErrorCode.LIMIT)
                for offset in range(0, len(pcm), 65536):
                    part = pcm[offset:offset + 65536]
                    if len(part) % 2:
                        raise TTSError(TTSErrorCode.INVALID_AUDIO)
                    for packet in encoder.feed(part):
                        yield TTSAudioChunk(sequence, packet, OPUS_FORMAT)
                        sequence += 1
            if source_chunks == 0:
                raise TTSError(TTSErrorCode.INVALID_AUDIO)
            for packet in encoder.finish():
                yield TTSAudioChunk(sequence, packet, OPUS_FORMAT)
                sequence += 1
            if sequence == 0:
                raise TTSError(TTSErrorCode.INVALID_AUDIO)
        except TTSError:
            raise
        except AudioError as error:
            raise TTSError(TTSErrorCode.CANCELLED if error.code == ErrorCode.CANCELLED
                           else TTSErrorCode.TIMEOUT) from None
        except (TimeoutError, asyncio.TimeoutError):
            raise TTSError(TTSErrorCode.TIMEOUT) from None
        except CodecError as error:
            raise TTSError(TTSErrorCode.CODEC_UNAVAILABLE if "libopus unavailable" in str(error)
                           else TTSErrorCode.INVALID_AUDIO) from None
        except (FileNotFoundError, ImportError):
            raise TTSError(TTSErrorCode.NOT_FOUND) from None
        except Exception:
            raise TTSError(TTSErrorCode.PROVIDER_ERROR) from None
        finally:
            if encoder is not None:
                encoder.close()
