import asyncio
from types import SimpleNamespace
import time

import pytest

from app.clients.gemini_llm import GeminiLLMAdapter
from app.clients.provider_factory import create_llm_adapter
from app.core.provider_config import LLMProviderSettings
from app.models.llm import LLMError, LLMErrorCode


def test_gemini_factory_does_not_fallback_to_openai():
    config = LLMProviderSettings(_env_file=None, AI_SERVER_LLM_PROVIDER="gemini",
        GEMINI_API_KEY="fixture-key", GEMINI_MODEL="gemini-3.5-flash-lite")
    adapter, model = create_llm_adapter(config)
    assert isinstance(adapter, GeminiLLMAdapter)
    assert model == "gemini-3.5-flash-lite"
    with pytest.raises(LLMError):
        create_llm_adapter(LLMProviderSettings(_env_file=None, AI_SERVER_LLM_PROVIDER="gemini",
            OPENAI_API_KEY="openai-key", GEMINI_MODEL="gemini-3.5-flash-lite"))


@pytest.mark.parametrize("status,expected", [(429, LLMErrorCode.RATE_LIMIT), (503, LLMErrorCode.SERVICE_UNAVAILABLE)])
def test_gemini_429_503_are_distinct_and_never_retried(status, expected):
    class ProviderFailure(Exception):
        def __init__(self):
            self.code = status

    class Client:
        def __init__(self):
            self.calls = 0
            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content_stream=self.generate), aclose=self.aclose)
        async def generate(self, **kwargs):
            self.calls += 1
            raise ProviderFailure()
        async def aclose(self):
            pass
        def close(self):
            pass

    client = Client()
    adapter = GeminiLLMAdapter(api_key="fixture-key", client_factory=lambda *_: client)
    from tests.test_gemini_connection import make_request
    from app.services.audio_context import AudioContext
    async def scenario():
        with pytest.raises(LLMError) as error:
            async for _ in adapter.stream(make_request(), AudioContext(deadline=time.monotonic() + 5)):
                pass
        assert error.value.code == expected
        assert client.calls == 1
    asyncio.run(scenario())


@pytest.mark.parametrize("error,expected", [
    (ConnectionError("private network detail"), LLMErrorCode.NETWORK_FAILURE),
    (TimeoutError("private timeout detail"), LLMErrorCode.TIMEOUT),
    (type("Failure", (Exception,), {"code": 401})(), LLMErrorCode.AUTHENTICATION),
    (type("Failure", (Exception,), {"code": 403})(), LLMErrorCode.PERMISSION),
    (type("Failure", (Exception,), {"code": 404})(), LLMErrorCode.NOT_FOUND),
])
def test_gemini_network_and_auth_errors_are_typed_and_safe(error, expected):
    assert GeminiLLMAdapter._classify_error(error) == expected


def test_reused_gemini_llm_client_is_closed_at_explicit_shutdown():
    from tests.test_gemini_connection import make_request
    from app.services.audio_context import AudioContext
    class Client:
        def __init__(self):
            self.calls = 0
            self.closed = False
            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content_stream=self.generate), aclose=self.aclose)
        async def generate(self, **kwargs):
            self.calls += 1
            async def chunks():
                yield SimpleNamespace(text="Xin chào.", candidates=[SimpleNamespace(finish_reason="STOP")],
                                      usage_metadata=SimpleNamespace(prompt_token_count=2,
                                          candidates_token_count=3, total_token_count=5, thoughts_token_count=0))
            return chunks()
        async def aclose(self): self.closed = True
        def close(self): pass
    client = Client()
    factories = []
    adapter = GeminiLLMAdapter(api_key="fixture", reuse_client=True,
        client_factory=lambda *args: factories.append(args) or client)
    async def scenario():
        for _ in range(2):
            context = AudioContext(deadline=time.monotonic()+3)
            events = [event async for event in adapter.stream(make_request(), context)]
            assert events[-1].complete
        assert len(factories) == 1 and client.calls == 2 and not client.closed
        await adapter.aclose()
        assert client.closed
    asyncio.run(scenario())
