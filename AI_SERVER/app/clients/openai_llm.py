"""Official AsyncOpenAI Responses adapter. No implicit key lookup or retries."""

from collections.abc import AsyncIterator, Callable
import time

from openai import AsyncOpenAI, APIError, APITimeoutError, RateLimitError

from app.models.audio import AudioError, ErrorCode
from app.models.llm import LLMError, LLMErrorCode, LLMRequest, ProviderDelta, ProviderDone, Usage
from app.services.audio_context import AudioContext


class OpenAILLMAdapter:
    def __init__(self, *, api_key: str, client_factory: Callable[..., AsyncOpenAI] = AsyncOpenAI):
        if not isinstance(api_key, str) or not api_key.strip():
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        self._api_key = api_key
        self._client_factory = client_factory

    def __repr__(self):
        return "OpenAILLMAdapter(api_key=<redacted>)"

    async def stream(self, request: LLMRequest, context: AudioContext) -> AsyncIterator[ProviderDelta | ProviderDone]:
        client = stream = None
        try:
            context.check()
            client = self._client_factory(api_key=self._api_key, max_retries=0,
                                          base_url="https://api.openai.com/v1",
                                          timeout=max(.001, context.deadline - time.monotonic()))
            messages = [{"role": item.role, "content": item.text} for item in request.history]
            messages.append({"role": "user", "content": request.transcript})
            stream = await context.run(lambda: client.responses.create(
                model=request.config.model,
                reasoning={"effort": request.config.reasoning_effort},
                instructions=request.system_prompt + "\nTrả lời bằng tiếng Việt.",
                input=messages, max_output_tokens=request.config.max_output_tokens,
                stream=True, store=False,
            ))
            last_sequence = -1
            async for event in self._events(stream, context):
                sequence = getattr(event, "sequence_number", None)
                if sequence is not None:
                    if type(sequence) is not int or sequence <= last_sequence:
                        raise LLMError(LLMErrorCode.INVALID_STREAM)
                    last_sequence = sequence
                if event.type == "response.output_text.delta":
                    if not isinstance(event.delta, str):
                        raise LLMError(LLMErrorCode.INVALID_STREAM)
                    yield ProviderDelta(event.delta)
                elif event.type in ("response.completed", "response.incomplete"):
                    response = event.response
                    usage = None if response.usage is None else Usage(
                        response.usage.input_tokens, response.usage.output_tokens, response.usage.total_tokens)
                    complete = event.type == "response.completed" and response.status == "completed"
                    reason = "completed" if complete else "incomplete"
                    if not complete and response.incomplete_details is not None:
                        reason = "token_limit" if response.incomplete_details.reason == "max_output_tokens" else "incomplete"
                    yield ProviderDone(complete, reason, usage)
                    return
                elif event.type in ("response.failed", "error", "response.refusal.delta", "response.refusal.done"):
                    raise LLMError(LLMErrorCode.PROVIDER_ERROR)
            raise LLMError(LLMErrorCode.INVALID_STREAM)
        except LLMError:
            raise
        except AudioError as error:
            code = LLMErrorCode.CANCELLED if error.code == ErrorCode.CANCELLED else LLMErrorCode.TIMEOUT
            raise LLMError(code) from None
        except RateLimitError:
            raise LLMError(LLMErrorCode.RATE_LIMIT) from None
        except APITimeoutError:
            raise LLMError(LLMErrorCode.TIMEOUT) from None
        except APIError:
            raise LLMError(LLMErrorCode.PROVIDER_ERROR) from None
        except Exception:
            raise LLMError(LLMErrorCode.PROVIDER_ERROR) from None
        finally:
            try:
                try:
                    if stream is not None:
                        await stream.close()
                finally:
                    if client is not None:
                        await client.close()
            except Exception:
                raise LLMError(LLMErrorCode.PROVIDER_ERROR) from None

    @staticmethod
    async def _events(stream, context):
        iterator = aiter(stream)
        while True:
            try:
                yield await context.run(lambda: anext(iterator))
            except StopAsyncIteration:
                return
