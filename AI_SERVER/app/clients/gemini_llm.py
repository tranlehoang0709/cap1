"""Google GenAI streaming adapter implementing the existing provider contract."""

import asyncio
from collections.abc import AsyncIterator, Callable
from datetime import datetime
import socket
import ssl

from app.models.audio import AudioError, ErrorCode
from app.models.llm import LLMError, LLMErrorCode, LLMRequest, ProviderDelta, ProviderDone, Usage
from app.services.audio_context import AudioContext


def _google_client(api_key: str, timeout_seconds: float):
    from google import genai
    from google.genai import types

    options = types.HttpOptions(
        timeout=round(timeout_seconds * 1000),
        retry_options=types.HttpRetryOptions(attempts=1),
    )
    return genai.Client(api_key=api_key, http_options=options)


def _system_instruction(base_prompt: str, now: datetime | None = None) -> str:
    """Add a bounded server clock while preserving the BE-owned base prompt."""
    local_now = datetime.now().astimezone() if now is None else now.astimezone()
    clock = local_now.strftime('%Y-%m-%d %H:%M:%S %Z%z')
    return (f"{base_prompt.rstrip()}\n\n" if base_prompt.strip() else '') + (
        f"Current server local date and time: {clock}. "
        "For questions about today's date or current local time, answer using this value. "
        "Do not claim to have live access to other current events or facts."
    )


class GeminiLLMAdapter:
    """Gemini-only adapter. It never switches providers or retries requests."""

    def __init__(self, *, api_key: str, timeout_seconds: float = 30,
                 client_factory: Callable[..., object] = _google_client,
                 reuse_client: bool = False):
        if not isinstance(api_key, str) or not api_key.strip():
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        if type(timeout_seconds) not in (int, float) or not 0 < timeout_seconds <= 120:
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        self._api_key = api_key
        self._timeout_seconds = float(timeout_seconds)
        self._client_factory = client_factory
        self._reuse_client = bool(reuse_client)
        self._client = None
        self._client_lock = asyncio.Lock()

    def __repr__(self):
        return "GeminiLLMAdapter(api_key=<redacted>)"

    async def count_input_tokens(self, request, context):
        client = None
        try:
            client = self._client_factory(self._api_key, self._timeout_seconds)
            contents = [{'role': 'model' if item.role == 'assistant' else 'user',
                         'parts': [{'text': item.text}]} for item in request.history]
            contents.append({'role':'user','parts':[{'text':request.transcript}]})
            result = await context.run(lambda: client.aio.models.count_tokens(model=request.config.model,
                contents=contents, config={'system_instruction':_system_instruction(request.system_prompt)}))
            count = getattr(result, 'total_tokens', None)
            if type(count) is not int or count < 0:
                raise LLMError(LLMErrorCode.INVALID_STREAM)
            return count
        except (LLMError, AudioError):
            raise
        except Exception as error:
            raise LLMError(self._classify_error(error)) from None
        finally:
            if client is not None:
                try:
                    await client.aio.aclose()
                    client.close()
                except Exception:
                    raise LLMError(LLMErrorCode.PROVIDER_ERROR) from None

    async def stream(self, request: LLMRequest, context: AudioContext) -> AsyncIterator[ProviderDelta | ProviderDone]:
        client = stream = None
        owns_client = False
        try:
            context.check()
            if self._reuse_client:
                async with self._client_lock:
                    if self._client is None:
                        self._client = self._client_factory(self._api_key, self._timeout_seconds)
                    client = self._client
            else:
                client = self._client_factory(self._api_key, self._timeout_seconds)
                owns_client = True
            contents = [
                {"role": "model" if item.role == "assistant" else "user", "parts": [{"text": item.text}]}
                for item in request.history
            ]
            contents.append({"role": "user", "parts": [{"text": request.transcript}]})
            config = {
                "system_instruction": _system_instruction(request.system_prompt),
                "max_output_tokens": request.config.max_output_tokens,
                "candidate_count": 1,
                "automatic_function_calling": {"disable": True},
            }
            stream = await context.run(lambda: client.aio.models.generate_content_stream(
                model=request.config.model, contents=contents, config=config,
            ))
            finish_reason = None
            usage_metadata = None
            while True:
                try:
                    chunk = await context.run(lambda: anext(stream))
                except StopAsyncIteration:
                    break
                candidates = getattr(chunk, "candidates", None) or ()
                if candidates:
                    reason = getattr(candidates[0], "finish_reason", None)
                    if reason is not None:
                        finish_reason = getattr(reason, "name", str(reason)).rsplit(".", 1)[-1].upper()
                metadata = getattr(chunk, "usage_metadata", None)
                if metadata is not None:
                    usage_metadata = metadata
                text = getattr(chunk, "text", None)
                if text:
                    if not isinstance(text, str):
                        raise LLMError(LLMErrorCode.INVALID_STREAM)
                    yield ProviderDelta(text)

            if finish_reason is None:
                raise LLMError(LLMErrorCode.INVALID_STREAM)
            usage = self._usage(usage_metadata)
            if finish_reason == "STOP":
                yield ProviderDone(True, "completed", usage)
            else:
                reason = "token_limit" if finish_reason in ("MAX_TOKENS", "MAX_OUTPUT_TOKENS") else "incomplete"
                yield ProviderDone(False, reason, usage)
        except LLMError:
            raise
        except AudioError as error:
            code = LLMErrorCode.CANCELLED if error.code == ErrorCode.CANCELLED else LLMErrorCode.TIMEOUT
            raise LLMError(code) from None
        except (TimeoutError, asyncio.TimeoutError):
            raise LLMError(LLMErrorCode.TIMEOUT) from None
        except Exception as error:
            raise LLMError(self._classify_error(error)) from None
        finally:
            try:
                if stream is not None:
                    close_stream = getattr(stream, "aclose", None)
                    if close_stream is not None:
                        await close_stream()
                if client is not None and owns_client:
                    async_client = getattr(client, "aio", None)
                    async_close = getattr(async_client, "aclose", None)
                    if async_close is not None:
                        await async_close()
                    close_client = getattr(client, "close", None)
                    if close_client is not None:
                        close_client()
            except Exception:
                raise LLMError(LLMErrorCode.PROVIDER_ERROR) from None

    async def aclose(self) -> None:
        """Close a deliberately reused HTTP client after its owning session."""
        async with self._client_lock:
            client, self._client = self._client, None
        if client is None:
            return
        try:
            aio = getattr(client, "aio", None)
            close_async = getattr(aio, "aclose", None)
            if close_async:
                await close_async()
            close_sync = getattr(client, "close", None)
            if close_sync:
                close_sync()
        except Exception:
            raise LLMError(LLMErrorCode.PROVIDER_ERROR) from None

    @staticmethod
    def _classify_error(error: BaseException) -> LLMErrorCode:
        current = error
        seen: set[int] = set()
        chain = []
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            chain.append(current)
            current = current.__cause__ or current.__context__
        statuses = {"401": LLMErrorCode.AUTHENTICATION, "UNAUTHENTICATED": LLMErrorCode.AUTHENTICATION,
                    "403": LLMErrorCode.PERMISSION, "PERMISSION_DENIED": LLMErrorCode.PERMISSION,
                    "404": LLMErrorCode.NOT_FOUND, "NOT_FOUND": LLMErrorCode.NOT_FOUND,
                    "429": LLMErrorCode.RATE_LIMIT, "RESOURCE_EXHAUSTED": LLMErrorCode.RATE_LIMIT,
                    "503": LLMErrorCode.SERVICE_UNAVAILABLE, "UNAVAILABLE": LLMErrorCode.SERVICE_UNAVAILABLE,
                    "SERVICE_UNAVAILABLE": LLMErrorCode.SERVICE_UNAVAILABLE}
        for item in chain:
            status = getattr(item, "status_code", None) or getattr(item, "code", None)
            code = statuses.get(str(getattr(status, "name", status)).upper())
            if code:
                return code
        for item in reversed(chain):
            name = type(item).__name__.lower()
            if isinstance(item, (TimeoutError, asyncio.TimeoutError)) or "timeout" in name:
                return LLMErrorCode.TIMEOUT
            if isinstance(item, socket.gaierror) or "gaierror" in name:
                return LLMErrorCode.NETWORK_FAILURE
            if isinstance(item, ssl.SSLError) or "ssl" in name or "certificate" in name:
                return LLMErrorCode.NETWORK_FAILURE
            if isinstance(item, ConnectionError) or any(marker in name for marker in
                    ("connecterror", "networkerror", "protocolerror", "proxyerror")):
                return LLMErrorCode.NETWORK_FAILURE
        return LLMErrorCode.PROVIDER_ERROR

    @staticmethod
    def _usage(metadata) -> Usage | None:
        if metadata is None:
            return None
        input_tokens = getattr(metadata, "prompt_token_count", None)
        total_tokens = getattr(metadata, "total_token_count", None)
        candidate_tokens = getattr(metadata, "candidates_token_count", None)
        thought_tokens = getattr(metadata, "thoughts_token_count", 0) or 0
        if type(input_tokens) is not int or input_tokens < 0:
            return None
        if type(total_tokens) is int and total_tokens >= input_tokens:
            output_tokens = total_tokens - input_tokens
        elif type(candidate_tokens) is int and candidate_tokens >= 0 and type(thought_tokens) is int and thought_tokens >= 0:
            output_tokens = candidate_tokens + thought_tokens
        else:
            return None
        return Usage(input_tokens, output_tokens, input_tokens + output_tokens)
