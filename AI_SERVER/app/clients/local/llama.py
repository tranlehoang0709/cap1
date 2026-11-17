"""llama.cpp OpenAI-compatible adapter; never imports or contacts cloud SDKs."""
import asyncio
import json
import re
import httpx

from app.core.runtime_config import LocalLLMSettings
from app.models.audio import AudioError, ErrorCode
from app.models.llm import LLMError, LLMErrorCode, ProviderDelta, ProviderDone, Usage


class LocalLLMError(RuntimeError):
    """Safe local failure code; never includes credentials or response bodies."""


class LlamaServerAdapter:
    def __init__(self, settings: LocalLLMSettings):
        self.settings = settings
        self._client: httpx.AsyncClient | None = None
        self._model_id: str | None = None
        self._model_lock = asyncio.Lock()

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            timeout = httpx.Timeout(self.settings.timeout_seconds,
                                    connect=self.settings.connect_timeout_seconds)
            self._client = httpx.AsyncClient(timeout=timeout, trust_env=False,
                                             follow_redirects=False)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def discover_model(self) -> str:
        if self._model_id is not None:
            return self._model_id
        key = self.settings.api_key
        if key is None or not key.get_secret_value().strip():
            raise LocalLLMError("missing_api_key")
        async with self._model_lock:
            if self._model_id is not None:
                return self._model_id
            try:
                client = self._http()
                for attempt in range(self.settings.max_retries + 1):
                    try:
                        response = await client.get(self.settings.base_url + "/models",
                            headers=self._headers())
                        break
                    except (httpx.ConnectError, httpx.ConnectTimeout):
                        if attempt >= self.settings.max_retries:
                            raise
                        await asyncio.sleep(.1 * (attempt + 1))
                response.raise_for_status()
                data = response.json()["data"]
                ids = [item["id"] for item in data if isinstance(item, dict)
                       and isinstance(item.get("id"), str) and item["id"].strip()]
                if len(ids) != 1:
                    raise LocalLLMError("model_missing_or_ambiguous")
                self._model_id = ids[0]
                return self._model_id
            except LocalLLMError:
                raise
            except httpx.TimeoutException:
                raise LocalLLMError("timeout") from None
            except httpx.HTTPStatusError:
                raise LocalLLMError("http_error") from None
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                raise LocalLLMError("unavailable_or_invalid_models") from None

    @staticmethod
    def matches_model(expected: str, discovered: str) -> bool:
        """Match an exact alias or its Hugging Face cache GGUF path."""
        if discovered == expected:
            return True
        match = re.fullmatch(r"([^/\s]+)/([^:\s]+):([A-Za-z0-9_.-]+)", expected)
        if match is None:
            return False
        owner, repository, variant = (part.lower() for part in match.groups())
        path = discovered.replace("\\", "/").lower()
        filename = path.rsplit("/", 1)[-1]
        return (f"/models--{owner}--{repository}/" in path
                and filename.endswith(".gguf") and variant in filename[:-5])

    async def stream(self, request, context, *, response_schema=None, enable_thinking=None):
        response = None
        try:
            context.check()
            model = await context.run(self.discover_model)
            messages = [{"role": "system", "content": request.system_prompt +
                         "\nLuôn trả lời bằng tiếng Việt."}]
            messages.extend({"role": item.role, "content": item.text} for item in request.history)
            messages.append({"role": "user", "content": request.transcript})
            approximate_tokens = sum(len(item["content"]) for item in messages) // 4 + request.config.max_output_tokens
            if approximate_tokens > self.settings.max_context_tokens:
                raise LLMError(LLMErrorCode.CONTEXT_LIMIT)
            client = self._http()
            payload = {"model": model, "messages": messages, "stream": True,
                       "stream_options": {"include_usage": True},
                       "max_tokens": min(request.config.max_output_tokens,
                                         self.settings.max_output_tokens)}
            if enable_thinking is not None:
                payload['chat_template_kwargs'] = {'enable_thinking': enable_thinking}
            if response_schema is not None:
                payload['chat_template_kwargs'] = {'enable_thinking': False}
                payload['temperature'] = 0
                payload["response_format"] = {"type": "json_schema", "json_schema": {
                    "name": "pa_interpretation", "schema": response_schema}}
                payload["max_tokens"] = min(request.config.max_output_tokens, 4096)
            outgoing = client.build_request("POST", self.settings.base_url + "/chat/completions",
                                            headers=self._headers(), json=payload)
            if response_schema is not None:
                outgoing.extensions['timeout']['read'] = 300
            for attempt in range(self.settings.max_retries + 1):
                try:
                    response = await context.run(lambda: client.send(outgoing, stream=True))
                    break
                except (httpx.ConnectError, httpx.ConnectTimeout):
                    if attempt >= self.settings.max_retries:
                        raise
                    await asyncio.sleep(.1 * (attempt + 1))
            response.raise_for_status()
            done = False
            usage = None
            async for line in self._lines(response, context):
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    break
                try:
                    event = json.loads(raw)
                    if event.get("usage") is not None:
                        item = event["usage"]
                        usage = Usage(int(item["prompt_tokens"]), int(item["completion_tokens"]),
                                      int(item["total_tokens"]))
                    choices = event.get("choices", [])
                    if choices:
                        choice = choices[0]
                        text = choice.get("delta", {}).get("content")
                        if isinstance(text, str) and text:
                            yield ProviderDelta(text)
                        finish = choice.get("finish_reason")
                        if finish is not None:
                            done = finish == "stop"
                            reason = "completed" if done else ("token_limit" if finish == "length" else "incomplete")
                except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                    raise LLMError(LLMErrorCode.INVALID_STREAM) from None
            if 'reason' not in locals():
                raise LLMError(LLMErrorCode.INVALID_STREAM)
            yield ProviderDone(done, reason, usage)
        except LLMError:
            raise
        except AudioError as error:
            raise LLMError(LLMErrorCode.CANCELLED if error.code == ErrorCode.CANCELLED
                           else LLMErrorCode.TIMEOUT) from None
        except httpx.TimeoutException:
            raise LLMError(LLMErrorCode.TIMEOUT) from None
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            code = (LLMErrorCode.AUTHENTICATION if status == 401 else
                    LLMErrorCode.NOT_FOUND if status == 404 else
                    LLMErrorCode.RATE_LIMIT if status == 429 else
                    LLMErrorCode.SERVICE_UNAVAILABLE if status >= 500 else
                    LLMErrorCode.PROVIDER_ERROR)
            raise LLMError(code) from None
        except httpx.HTTPError:
            raise LLMError(LLMErrorCode.NETWORK_FAILURE) from None
        finally:
            if response is not None:
                await response.aclose()

    def _headers(self):
        key = self.settings.api_key
        if key is None or not key.get_secret_value().strip():
            raise LocalLLMError("missing_api_key")
        return {"Authorization": "Bearer " + key.get_secret_value(),
                "Content-Type": "application/json"}

    @staticmethod
    async def _lines(response, context):
        iterator = response.aiter_lines()
        while True:
            try:
                yield await context.run(lambda: anext(iterator))
            except StopAsyncIteration:
                return
