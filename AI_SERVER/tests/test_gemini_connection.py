import asyncio
from types import SimpleNamespace

import httpx
from pydantic import SecretStr, ValidationError
import pytest
from google import genai

from app.clients.gemini_llm import GeminiLLMAdapter
from app.core.gemini_config import GeminiSettings
from app.core.llm_config import LLMSettings
from app.models.llm import ConversationKey, LLMError, LLMRequest, Message, ProviderDelta, ProviderDone
from app.services.audio_context import AudioContext
from scripts.test_gemini_connection import ProbeFailure, classify_error, run_probe


def settings(*, key="fixture-secret-do-not-print", model="gemini-3.8-flash", **kwargs):
    values = {"_env_file": None, "GEMINI_API_KEY": None if key is None else SecretStr(key),
              "GEMINI_MODEL": model, **kwargs}
    if "timeout_seconds" in values:
        values["GEMINI_TIMEOUT_SECONDS"] = values.pop("timeout_seconds")
    return GeminiSettings(**values)


def test_config_reads_environment_over_dotenv_and_hides_key(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("GEMINI_API_KEY=dotenv-secret-value\nGEMINI_MODEL=gemini-3.8-flash\n", encoding="utf-8")
    monkeypatch.setenv("GEMINI_API_KEY", "environment-secret-value")
    config = GeminiSettings(_env_file=env_file)
    assert config.api_key.get_secret_value() == "environment-secret-value"
    assert config.model == "gemini-3.8-flash"
    assert "environment-secret-value" not in repr(config)
    assert "dotenv-secret-value" not in repr(config)


def test_invalid_model_and_timeout_rejected():
    with pytest.raises(ValidationError):
        settings(model="invalid model name")
    with pytest.raises(ValidationError):
        settings(timeout_seconds=0)


def test_official_client_factory_uses_bounded_timeout_and_one_attempt():
    from app.clients.gemini_llm import _google_client

    client = _google_client("fixture-secret", 7)
    try:
        assert isinstance(client, genai.Client)
        assert "fixture-secret" not in repr(client)
    finally:
        asyncio.run(client.aio.aclose())
        client.close()


@pytest.mark.parametrize("code,expected", [
    (401, "FAIL_HTTP_401_AUTHENTICATION"),
    (403, "FAIL_HTTP_403_PERMISSION"),
    (404, "FAIL_HTTP_404_MODEL_OR_ENDPOINT"),
    (429, "FAIL_HTTP_429_RATE_OR_QUOTA"),
    (503, "FAIL_HTTP_503"),
    ("RESOURCE_EXHAUSTED", "FAIL_HTTP_429_RATE_OR_QUOTA"),
])
def test_api_error_status_classification(code, expected):
    error = RuntimeError("secret response body must never be surfaced")
    error.code = code
    assert classify_error(error) == expected


def test_timeout_and_network_classification():
    assert classify_error(TimeoutError()) == "FAIL_TIMEOUT"
    assert classify_error(httpx.ConnectError("network detail")) == "FAIL_NETWORK"


def test_missing_key_or_model_block_before_sdk_call():
    async def scenario():
        with pytest.raises(ProbeFailure, match="BLOCKED_GEMINI_API_KEY_MISSING"):
            await run_probe(settings(key=None))
        with pytest.raises(ProbeFailure, match="BLOCKED_GEMINI_MODEL_MISSING"):
            await run_probe(settings(model=None))
    asyncio.run(scenario())


def test_live_probe_uses_one_gemini_request_and_real_usage_shape():
    class Client:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.calls = []
            self.closed = False
            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self.generate), aclose=self.aclose)
        async def generate(self, **kwargs):
            self.calls.append(kwargs)
            return SimpleNamespace(text="Xin chào AIVA.", usage_metadata=SimpleNamespace(
                prompt_token_count=5, candidates_token_count=7, total_token_count=13))
        async def aclose(self):
            self.closed = True
        def close(self):
            self.closed = True

    clients = []
    def factory(**kwargs):
        client = Client(**kwargs)
        clients.append(client)
        return client

    async def scenario():
        result = await run_probe(settings(), client_factory=factory)
        assert result.response_text == "Xin chào AIVA."
        assert (result.input_tokens, result.output_tokens, result.total_tokens) == (5, 7, 13)
        assert clients[0].closed and len(clients[0].calls) == 1
        call = clients[0].calls[0]
        assert call["model"] == "gemini-3.8-flash" and call["contents"] == "Xin chào AIVA"
        assert call["config"]["max_output_tokens"] == LLMSettings().max_output_tokens
        assert call["config"]["automatic_function_calling"]["disable"] is True
    asyncio.run(scenario())


def make_request(model="gemini-3.8-flash"):
    return LLMRequest(
        ConversationKey("u1", "s1", "d1"), "turn1", "Xin chào AIVA", "Be helpful.",
        (Message("user", "chào"), Message("assistant", "xin chào")),
        LLMSettings(model=model),
    )


def test_gemini_adapter_streams_and_reports_provider_usage_without_openai_fallback():
    class FakeStream:
        def __init__(self):
            self.items = iter([
                SimpleNamespace(text="Chào bạn. ", candidates=[SimpleNamespace(finish_reason=None)], usage_metadata=None),
                SimpleNamespace(text=None, candidates=[SimpleNamespace(finish_reason="STOP")], usage_metadata=SimpleNamespace(
                    prompt_token_count=12, candidates_token_count=7, thoughts_token_count=3, total_token_count=22)),
            ])
            self.closed = False
        def __aiter__(self):
            return self
        async def __anext__(self):
            try:
                return next(self.items)
            except StopIteration:
                raise StopAsyncIteration
        async def aclose(self):
            self.closed = True

    class Client:
        def __init__(self):
            self.stream = FakeStream()
            self.calls = []
            self.closed = False
            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content_stream=self.generate), aclose=self.aclose)
        async def generate(self, **kwargs):
            self.calls.append(kwargs)
            return self.stream
        async def aclose(self):
            self.closed = True
        def close(self):
            self.closed = True

    client = Client()
    adapter = GeminiLLMAdapter(api_key="fixture-api-key", client_factory=lambda *_: client)

    async def scenario():
        events = [event async for event in adapter.stream(make_request(), AudioContext(deadline=asyncio.get_running_loop().time() + 5))]
        assert events[0] == ProviderDelta("Chào bạn. ")
        assert events[-1] == ProviderDone(True, "completed", __import__("app.models.llm", fromlist=["Usage"]).Usage(12, 10, 22))
        assert len(client.calls) == 1 and client.stream.closed and client.closed
        call = client.calls[0]
        assert call["model"] == "gemini-3.8-flash"
        assert call["contents"][1]["role"] == "model"
        assert "fixture-api-key" not in repr(adapter)
    asyncio.run(scenario())


def test_gemini_adapter_provider_error_is_typed_and_never_retries():
    class Client:
        def __init__(self):
            self.calls = 0
            self.aio = SimpleNamespace(models=SimpleNamespace(generate_content_stream=self.generate), aclose=self.aclose)
        async def generate(self, **kwargs):
            self.calls += 1
            raise RuntimeError("sensitive Google response detail")
        async def aclose(self):
            pass
        def close(self):
            pass

    client = Client()
    adapter = GeminiLLMAdapter(api_key="fixture-api-key", client_factory=lambda *_: client)
    async def scenario():
        with pytest.raises(LLMError, match="provider_error"):
            async for _ in adapter.stream(make_request(), AudioContext(deadline=asyncio.get_running_loop().time() + 5)):
                pass
        assert client.calls == 1
    asyncio.run(scenario())
