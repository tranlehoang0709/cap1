"""RAM-only OpenAI STT/TTS adapters for the local Xiaozhi development gateway."""

from collections.abc import AsyncIterator, Callable
import asyncio
import io
import time
import wave

from openai import AsyncOpenAI, APIConnectionError, APIStatusError, APITimeoutError, RateLimitError

from app.models.audio import AudioError, AudioMetadata, ErrorCode, TranscriptionResult
from app.models.tts import AudioFormat, TTSAudioChunk, TTSError, TTSErrorCode
from app.services.audio_context import AudioContext
from app.services.audio_input import AudioInput


WAV_FORMAT = AudioFormat(AudioMetadata("wav", 24000, 1, 60, "s16le"), "wav")


def _remaining(context: AudioContext, configured: float) -> float:
    return max(0.001, min(configured, context.deadline - time.monotonic()))


def _provider_error(error: Exception):
    if isinstance(error, RateLimitError):
        return "rate"
    if isinstance(error, (APITimeoutError, TimeoutError, asyncio.TimeoutError)):
        return "timeout"
    if isinstance(error, APIConnectionError):
        return "network"
    if isinstance(error, APIStatusError):
        if error.status_code == 401:
            return "auth"
        if error.status_code == 429:
            return "rate"
        if error.status_code >= 500:
            return "service"
    return "provider"


class OpenAISTTAdapter:
    def __init__(self, *, api_key: str, model: str, max_audio_bytes: int = 5_000_000,
                 max_duration_seconds: float = 15, timeout_seconds: float = 30,
                 client_factory: Callable[..., AsyncOpenAI] = AsyncOpenAI):
        if not api_key.strip() or not model.strip():
            raise ValueError("OpenAI STT key and model are required")
        if type(max_audio_bytes) is not int or not 0 < max_audio_bytes <= 19_000_000:
            raise ValueError("Invalid OpenAI STT byte limit")
        if type(max_duration_seconds) not in (int, float) or not 0 < max_duration_seconds <= 120:
            raise ValueError("Invalid OpenAI STT duration limit")
        if type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 120:
            raise ValueError("Invalid OpenAI STT timeout")
        self._api_key, self.model = api_key, model
        self.max_audio_bytes, self.max_duration_seconds = max_audio_bytes, float(max_duration_seconds)
        self.timeout_seconds = float(timeout_seconds)
        self._client_factory = client_factory

    def __repr__(self):
        return f"OpenAISTTAdapter(model={self.model!r}, api_key=<redacted>)"

    async def transcribe(self, audio: AudioInput, context: AudioContext) -> AsyncIterator[TranscriptionResult]:
        metadata = audio.metadata
        if (metadata.codec not in ("pcm", "pcm_s16le") or metadata.sample_rate_hz != 16000
            or metadata.channels != 1 or metadata.sample_format != "s16le"):
            raise AudioError(ErrorCode.INVALID_METADATA)
        pcm = bytearray()
        client = None
        try:
            while True:
                context.check()
                frame = await context.run(audio.read)
                if frame is None:
                    break
                if not frame.payload or len(frame.payload) % 2:
                    raise AudioError(ErrorCode.INVALID_AUDIO)
                if len(pcm) + len(frame.payload) > self.max_audio_bytes:
                    raise AudioError(ErrorCode.AUDIO_TOO_LARGE)
                pcm.extend(frame.payload)
                if len(pcm) / 32000 > self.max_duration_seconds:
                    raise AudioError(ErrorCode.AUDIO_TOO_LARGE)
            if not pcm:
                raise AudioError(ErrorCode.EMPTY_AUDIO)

            wav_buffer = io.BytesIO()
            with wave.open(wav_buffer, "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(16000)
                output.writeframes(pcm)
            pcm.clear()
            client = self._client_factory(api_key=self._api_key, max_retries=0,
                base_url="https://api.openai.com/v1", timeout=_remaining(context, self.timeout_seconds))
            response = await context.run(lambda: client.audio.transcriptions.create(
                model=self.model, file=("speech.wav", wav_buffer.getvalue(), "audio/wav"),
                languages=["vi"], prompt="Vietnamese speech. Preserve the original language and wording.",
                timeout=_remaining(context, self.timeout_seconds)))
            text = response if isinstance(response, str) else getattr(response, "text", None)
            if not isinstance(text, str) or not text.strip():
                raise AudioError(ErrorCode.INVALID_TRANSCRIPT)
            context.check()
            yield TranscriptionResult(text.strip(), True, "vi")
        except AudioError:
            raise
        except Exception as error:
            code = _provider_error(error)
            mapped = {"rate": ErrorCode.RATE_LIMIT, "timeout": ErrorCode.DEADLINE_EXCEEDED,
                      "service": ErrorCode.SERVICE_UNAVAILABLE}.get(code, ErrorCode.PROVIDER_FAILED)
            raise AudioError(mapped) from None
        finally:
            pcm.clear()
            if client is not None:
                try:
                    await client.close()
                except Exception:
                    pass
            try:
                await audio.aclose()
            except Exception:
                pass


class OpenAITTSAdapter:
    def __init__(self, *, api_key: str, model: str, voice: str, max_audio_bytes: int = 5_000_000,
                 timeout_seconds: float = 30,
                 client_factory: Callable[..., AsyncOpenAI] = AsyncOpenAI):
        if not api_key.strip() or not model.strip() or not voice.strip():
            raise ValueError("OpenAI TTS key, model and voice are required")
        if type(max_audio_bytes) is not int or not 0 < max_audio_bytes <= 5_000_000:
            raise ValueError("Invalid OpenAI TTS byte limit")
        if type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 120:
            raise ValueError("Invalid OpenAI TTS timeout")
        self._api_key, self.model, self.voice = api_key, model, voice
        self.max_audio_bytes, self._client_factory = max_audio_bytes, client_factory
        self.timeout_seconds = float(timeout_seconds)

    def __repr__(self):
        return f"OpenAITTSAdapter(model={self.model!r}, voice={self.voice!r}, api_key=<redacted>)"

    async def synthesize(self, request, context: AudioContext) -> AsyncIterator[TTSAudioChunk]:
        if request.config.model != self.model or request.config.voice != self.voice:
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        client = None
        audio = bytearray()
        try:
            context.check()
            client = self._client_factory(api_key=self._api_key, max_retries=0,
                base_url="https://api.openai.com/v1", timeout=_remaining(context, self.timeout_seconds))
            response = await context.run(lambda: client.audio.speech.create(
                model=self.model, voice=self.voice, input=request.text, response_format="wav",
                instructions="Speak clearly and naturally in Vietnamese.",
                timeout=_remaining(context, self.timeout_seconds)))
            payload = getattr(response, "content", None)
            if not isinstance(payload, bytes) or not payload or len(payload) > self.max_audio_bytes:
                raise TTSError(TTSErrorCode.LIMIT if isinstance(payload, bytes) and len(payload) > self.max_audio_bytes
                               else TTSErrorCode.INVALID_AUDIO)
            audio.extend(payload)
            try:
                with wave.open(io.BytesIO(audio), "rb") as source:
                    if (source.getnchannels() != 1 or source.getsampwidth() != 2
                        or source.getframerate() != 24000 or source.getcomptype() != "NONE"):
                        raise ValueError
                    pcm = source.readframes(source.getnframes())
                    if not pcm or len(pcm) % 2:
                        raise ValueError
            except Exception:
                raise TTSError(TTSErrorCode.INVALID_AUDIO) from None
            context.check()
            yield TTSAudioChunk(0, bytes(audio), WAV_FORMAT)
        except (TTSError, GeneratorExit):
            raise
        except Exception as error:
            code = _provider_error(error)
            mapped = {"auth": TTSErrorCode.AUTHENTICATION, "rate": TTSErrorCode.RATE_LIMIT,
                      "timeout": TTSErrorCode.TIMEOUT, "service": TTSErrorCode.SERVICE_UNAVAILABLE,
                      "network": TTSErrorCode.NETWORK_FAILURE}.get(code, TTSErrorCode.PROVIDER_ERROR)
            raise TTSError(mapped) from None
        finally:
            audio.clear()
            if client is not None:
                try:
                    await client.close()
                except Exception:
                    pass
