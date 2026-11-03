import asyncio

import httpx
from openai import APIConnectionError, APITimeoutError, AuthenticationError, NotFoundError, PermissionDeniedError, RateLimitError
from pydantic import SecretStr, ValidationError
import pytest

from scripts.test_openai_connection import (
    OpenAIProbeSettings,
    ProbeFailure,
    classify_error,
    run_probe,
)


def settings(*, key="test-key-not-a-secret", model="gpt-6-luna", **kwargs):
    values = {"_env_file": None, "OPENAI_API_KEY": None if key is None else SecretStr(key),
              "OPENAI_MODEL": model, **kwargs}
    if "timeout_seconds" in values:
        values["OPENAI_TIMEOUT_SECONDS"] = values.pop("timeout_seconds")
    return OpenAIProbeSettings(**values)


def test_probe_settings_validate_model_and_timeout():
    with pytest.raises(ValidationError):
        settings(model="not a valid model")
    with pytest.raises(ValidationError):
        settings(timeout_seconds=0)


def test_dotenv_and_environment_precedence_without_secret_repr(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("OPENAI_API_KEY=dotenv-secret-value\nOPENAI_MODEL=gpt-6-luna\n", encoding="utf-8")
    monkeypatch.setenv("OPENAI_API_KEY", "environment-secret-value")
    config = OpenAIProbeSettings(_env_file=env_file)
    assert config.api_key.get_secret_value() == "environment-secret-value"
    assert config.model == "gpt-6-luna"
    assert "environment-secret-value" not in repr(config)
    assert "dotenv-secret-value" not in repr(config)


@pytest.mark.parametrize("status,expected", [
    (401, "HTTP_401_AUTHENTICATION"),
    (403, "HTTP_403_PERMISSION"),
    (404, "HTTP_404_MODEL_OR_ENDPOINT"),
    (429, "HTTP_429_RATE_LIMIT_OR_BILLING"),
    (500, "HTTP_500"),
])
def test_status_error_categories(status, expected):
    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    response = httpx.Response(status, request=request)
    classes = {401: AuthenticationError, 403: PermissionDeniedError, 404: NotFoundError, 429: RateLimitError}
    cls = classes.get(status)
    if cls is not None:
        error = cls("safe test error", response=response, body={})
    else:
        from openai import APIStatusError
        error = APIStatusError("safe test error", response=response, body={})
    assert classify_error(error) == expected


def test_timeout_and_network_categories():
    request = httpx.Request("POST", "https://api.openai.com/v1/responses")
    assert classify_error(APITimeoutError(request=request)) == "TIMEOUT"
    assert classify_error(APIConnectionError(request=request)) == "NETWORK"


def test_missing_credentials_fail_before_network():
    async def scenario():
        with pytest.raises(ProbeFailure, match="BLOCKED_OPENAI_API_KEY_MISSING"):
            await run_probe(settings(key=None))
        with pytest.raises(ProbeFailure, match="BLOCKED_OPENAI_MODEL_MISSING"):
            await run_probe(settings(model=None))
    asyncio.run(scenario())


def test_probe_makes_one_responses_request_and_closes_client():
    class Response:
        _request_id = "req_fixture_only"
        output_text = "Xin chào AIVA."
        usage = type("Usage", (), {"input_tokens": 4, "output_tokens": 6})()

    class Responses:
        def __init__(self):
            self.calls = []
        async def create(self, **kwargs):
            self.calls.append(kwargs)
            return Response()

    class Client:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.responses = Responses()
            self.closed = False
        async def close(self):
            self.closed = True

    clients = []
    def factory(**kwargs):
        client = Client(**kwargs)
        clients.append(client)
        return client

    async def scenario():
        result = await run_probe(settings(), client_factory=factory)
        assert result.response_text == "Xin chào AIVA."
        assert result.request_id == "req_fixture_only"
        assert (result.input_tokens, result.output_tokens) == (4, 6)
        assert clients[0].closed and len(clients[0].responses.calls) == 1
        call = clients[0].responses.calls[0]
        assert call["model"] == "gpt-6-luna" and call["input"] == "Xin chào AIVA"
        assert call["store"] is False and call["max_output_tokens"] == 256
    asyncio.run(scenario())
