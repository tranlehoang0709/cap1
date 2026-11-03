"""Gemini 3.8 real speech generation adapter (unary WAV output)."""

import asyncio
from collections.abc import AsyncIterator, Callable
import base64
import binascii
import socket

from app.models.audio import AudioError, ErrorCode, AudioMetadata
from app.models.tts import AudioFormat, TTSAudioChunk, TTSRequest, TTSError, TTSErrorCode
from app.services.audio_context import AudioContext


WAV_FORMAT = AudioFormat(AudioMetadata("wav", 24000, 1, 20, "s16le"), "wav")
PCM_FORMAT = AudioFormat(AudioMetadata("pcm", 24000, 1, 20, "s16le"), "s16le")


class GeminiTTSAdapter:
    def __init__(self, *, api_key: str, model: str = "gemini-3.8-flash-tts", voice: str = "Kore",
                 timeout_seconds: float = 30, max_text_chars: int = 2000,
                 client_factory: Callable[..., object] | None = None,
                 reuse_client: bool = False, diagnostic_hook: Callable[..., None] | None = None):
        if not isinstance(api_key, str) or not api_key.strip() or not isinstance(model, str) or not model.strip():
            raise ValueError("Explicit Gemini TTS credentials and model required")
        if not isinstance(voice, str) or not voice.strip() or type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 120:
            raise ValueError("Invalid Gemini TTS settings")
        if type(max_text_chars) is not int or not 0 < max_text_chars <= 10000:
            raise ValueError("Invalid Gemini TTS text limit")
        self._api_key, self.model, self.voice = api_key, model, voice
        self.timeout_seconds, self.max_text_chars = float(timeout_seconds), max_text_chars
        self._client_factory = client_factory or self._google_client
        self._reuse_client = bool(reuse_client)
        self._diagnostic_hook = diagnostic_hook
        self._client = None
        self._client_lock = asyncio.Lock()

    def _diagnostic(self, event: str, request: TTSRequest) -> None:
        hook = self._diagnostic_hook
        if hook is not None:
            try:
                hook(event, request)
            except Exception:
                # Diagnostics must never change provider behavior.
                pass

    async def _new_or_reused_client(self):
        if not self._reuse_client:
            return self._client_factory(self._api_key, self.timeout_seconds), True
        async with self._client_lock:
            if self._client is None:
                self._client = self._client_factory(self._api_key, self.timeout_seconds)
            return self._client, False

    async def aclose(self):
        async with self._client_lock:
            client, self._client = self._client, None
        if client is not None:
            await self._close_client(client)

    @staticmethod
    async def _close_client(client):
        aio = getattr(client, "aio", None)
        close_async = getattr(aio, "aclose", None)
        if close_async:
            await close_async()
        close_sync = getattr(client, "close", None)
        if close_sync:
            close_sync()

    def __repr__(self):
        return f"GeminiTTSAdapter(model={self.model!r}, voice={self.voice!r}, api_key=<redacted>)"

    @staticmethod
    def _google_client(api_key: str, timeout_seconds: float):
        from google import genai
        from google.genai import types
        return genai.Client(api_key=api_key, http_options=types.HttpOptions(
            timeout=round(timeout_seconds * 1000), retry_options=types.HttpRetryOptions(attempts=1)))

    async def synthesize(self, request: TTSRequest, context: AudioContext) -> AsyncIterator[TTSAudioChunk]:
        if (not isinstance(request, TTSRequest) or not isinstance(context, AudioContext)
                or request.config.model != self.model or request.config.voice != self.voice
                or request.config.language.lower() not in ("vi", "vi-vn", "vietnamese")
                or request.config.audio_format != WAV_FORMAT or not request.text.strip()
                or len(request.text) > self.max_text_chars):
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        client = None
        owns_client = False
        try:
            context.check()
            client, owns_client = await self._new_or_reused_client()
            from google.genai import types
            config = types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=self.voice))),
                candidate_count=1,
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            )
            response = await context.run(lambda: client.aio.models.generate_content(
                model=self.model, contents=request.text, config=config))
            audio = None
            for candidate in (getattr(response, "candidates", None) or ()):
                content = getattr(candidate, "content", None)
                for part in (getattr(content, "parts", None) or ()):
                    inline = getattr(part, "inline_data", None)
                    data = getattr(inline, "data", None) if inline else None
                    mime = getattr(inline, "mime_type", None) if inline else None
                    if isinstance(data, bytes) and mime and mime.lower().startswith("audio/wav"):
                        audio = data
                        break
                if audio:
                    break
            if not isinstance(audio, bytes) or not audio:
                raise TTSError(TTSErrorCode.INVALID_AUDIO)
            if len(audio) > 5_000_000:
                raise TTSError(TTSErrorCode.LIMIT)
            if not audio.startswith(b"RIFF") or audio[8:12] != b"WAVE":
                raise TTSError(TTSErrorCode.INVALID_AUDIO)
            context.check()
            yield TTSAudioChunk(0, audio, WAV_FORMAT)
        except (TTSError, GeneratorExit):
            raise
        except AudioError as error:
            code = TTSErrorCode.CANCELLED if error.code == ErrorCode.CANCELLED else TTSErrorCode.TIMEOUT
            self._diagnostic("sdk_cancelled" if code == TTSErrorCode.CANCELLED else "sdk_deadline", request)
            raise TTSError(code) from None
        except (TimeoutError, asyncio.TimeoutError):
            raise TTSError(TTSErrorCode.TIMEOUT) from None
        except Exception as error:
            raise TTSError(classify_provider_error(error)) from None
        finally:
            if client is not None and owns_client:
                try:
                    await self._close_client(client)
                except Exception:
                    pass

    async def stream_pcm(self, request: TTSRequest, context: AudioContext) -> AsyncIterator[TTSAudioChunk]:
        """Stream signed 16-bit mono 24 kHz PCM deltas through Gemini Interactions.

        Audio remains in memory. The SDK stream is single shot (no retries) to
        avoid duplicate generation/usage, and is always closed on cancellation.
        """
        if (not isinstance(request, TTSRequest) or not isinstance(context, AudioContext)
                or request.config.model != self.model or request.config.voice != self.voice
                or request.config.language.lower() not in ("vi", "vi-vn", "vietnamese")
                or request.config.audio_format != WAV_FORMAT or not request.text.strip()
                or len(request.text) > self.max_text_chars):
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        client = stream = None
        owns_client = False
        total_bytes = 0
        sequence = 0
        try:
            context.check()
            client, owns_client = await self._new_or_reused_client()
            self._diagnostic("tts_request_started", request)
            stream = await context.run(lambda: client.aio.interactions.create(
                model=self.model,
                input=[{"type": "user_input", "content": [{"type": "text", "text": request.text}]}],
                response_format={"type": "audio", "mime_type": "audio/l16", "sample_rate": 24000},
                generation_config={"speech_config": [{"voice": self.voice}]},
                stream=True,
            ))
            while True:
                try:
                    event = await context.run(lambda: anext(stream))
                except StopAsyncIteration:
                    break
                if getattr(event, "event_type", None) != "step.delta":
                    continue
                delta = getattr(event, "delta", None)
                if getattr(delta, "type", None) != "audio":
                    continue
                mime = getattr(delta, "mime_type", None)
                rate = getattr(delta, "sample_rate", None)
                channels = getattr(delta, "channels", None)
                encoded = getattr(delta, "data", None)
                # Gemini may omit mime_type on AudioDelta when response_format
                # was explicit; its sample_rate/channels still validate PCM.
                if (mime not in (None, "audio/l16") or rate != 24000 or channels not in (None, 1)
                        or not isinstance(encoded, str)):
                    raise TTSError(TTSErrorCode.INVALID_AUDIO)
                try:
                    pcm = base64.b64decode(encoded, validate=True)
                except (binascii.Error, ValueError):
                    raise TTSError(TTSErrorCode.INVALID_AUDIO) from None
                if not pcm or len(pcm) % 2:
                    raise TTSError(TTSErrorCode.INVALID_AUDIO)
                total_bytes += len(pcm)
                if total_bytes > 5_000_000:
                    raise TTSError(TTSErrorCode.LIMIT)
                context.check()
                if sequence == 0:
                    self._diagnostic("first_pcm_chunk", request)
                yield TTSAudioChunk(sequence, pcm, PCM_FORMAT)
                sequence += 1
            if sequence == 0:
                raise TTSError(TTSErrorCode.INVALID_AUDIO)
        except (TTSError, GeneratorExit):
            raise
        except AudioError as error:
            code = TTSErrorCode.CANCELLED if error.code == ErrorCode.CANCELLED else TTSErrorCode.TIMEOUT
            self._diagnostic("sdk_cancelled" if code == TTSErrorCode.CANCELLED else "sdk_deadline", request)
            raise TTSError(code) from None
        except (TimeoutError, asyncio.TimeoutError):
            self._diagnostic("sdk_timeout", request)
            raise TTSError(TTSErrorCode.TIMEOUT) from None
        except Exception as error:
            raise TTSError(classify_provider_error(error)) from None
        finally:
            if stream is not None:
                try:
                    close_stream = getattr(stream, "aclose", None)
                    if close_stream:
                        await close_stream()
                except Exception:
                    pass
            if client is not None and owns_client:
                try:
                    await self._close_client(client)
                except Exception:
                    pass


def classify_provider_error(error: BaseException) -> TTSErrorCode:
    """Return a safe category without exposing SDK/network exception text."""
    current = error
    seen: set[int] = set()
    chain = []
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        chain.append(current)
        current = current.__cause__ or current.__context__

    # HTTP status is authoritative even if the SDK also wraps a transport error.
    for current in chain:
        status = getattr(current, "status_code", None) or getattr(current, "code", None)
        name = str(getattr(status, "name", status)).upper()
        if name in ("401", "UNAUTHENTICATED"):
            return TTSErrorCode.AUTHENTICATION
        if name in ("403", "PERMISSION_DENIED"):
            return TTSErrorCode.PERMISSION
        if name in ("404", "NOT_FOUND"):
            return TTSErrorCode.NOT_FOUND
        if name in ("429", "RESOURCE_EXHAUSTED"):
            return TTSErrorCode.RATE_LIMIT
        if name in ("503", "UNAVAILABLE", "SERVICE_UNAVAILABLE"):
            return TTSErrorCode.SERVICE_UNAVAILABLE

    # Inspect root causes before generic wrapper exception names.
    for current in reversed(chain):
        if isinstance(current, (TimeoutError, asyncio.TimeoutError)) or "timeout" in type(current).__name__.lower():
            return TTSErrorCode.TIMEOUT
        if isinstance(current, (socket.gaierror,)) or "gaierror" in type(current).__name__.lower():
            return TTSErrorCode.DNS_FAILURE
        if "ssl" in type(current).__name__.lower() or "certificate" in type(current).__name__.lower():
            return TTSErrorCode.TLS_FAILURE
        if isinstance(current, (ConnectionError, OSError)) or any(
                marker in type(current).__name__.lower()
                for marker in ("connecterror", "networkerror", "protocolerror", "proxyerror")):
            return TTSErrorCode.NETWORK_FAILURE
    return TTSErrorCode.PROVIDER_ERROR
