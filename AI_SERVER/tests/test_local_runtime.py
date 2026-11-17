from pathlib import Path
import asyncio
import os
import subprocess
import sys

import httpx
import pytest
from pydantic import SecretStr


def test_local_import_never_loads_cloud():
    script = '''
import sys
from app.main import app
assert app.state.runtime == "local"
assert app.state.settings.port == 8002
assert hasattr(app.state, "backend_client")
assert not any(name.startswith(("app.clients.gemini", "app.clients.openai", "google.genai", "openai")) for name in sys.modules)
assert "app.services.live_robot" not in sys.modules
'''
    env = dict(os.environ, AI_RUNTIME="local")
    subprocess.run([sys.executable, "-c", script], env=env, cwd=Path(__file__).resolve().parents[1], check=True, timeout=20)


def test_local_health_and_blocked_routes(monkeypatch):
    monkeypatch.setenv("AI_RUNTIME", "local")
    monkeypatch.delenv("LOCAL_LLM_API_KEY", raising=False)
    from app.main import create_app
    async def run():
        app = create_app()
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                body = (await client.get("/health")).json()
                assert body["status"] == "ok"
                assert body["runtime"] == "local"
                assert body["readiness"]["voice"] == "NOT_READY"
                assert body["readiness"]["llama_server"]["reason"] == "missing_api_key"
                assert (await client.get("/ready")).status_code == 503
                assert (await client.post("/internal/web-chat", json={})).status_code == 503
    asyncio.run(run())


@pytest.mark.parametrize("factory", ["provider_factory.create_llm_adapter",
    "stt_factory.create_gemini_stt_adapter", "tts_factory.create_gemini_tts_adapter"])
def test_cloud_factories_rejected_in_local(monkeypatch, factory):
    import importlib
    monkeypatch.setenv("AI_RUNTIME", "local")
    module, function = factory.split(".")
    with pytest.raises(RuntimeError, match="Cloud providers are disabled"):
        getattr(importlib.import_module("app.clients." + module), function)()


@pytest.mark.parametrize("case, expected", [("ok", "real-model-id"), ("timeout", "timeout"),
    ("unauthorized", "http_error"), ("invalid", "unavailable_or_invalid_models"),
    ("ambiguous", "model_missing_or_ambiguous")])
def test_llama_metadata(monkeypatch, case, expected):
    from app.clients.local.llama import LlamaServerAdapter, LocalLLMError
    from app.core.runtime_config import LocalLLMSettings
    original = httpx.AsyncClient
    def respond(request):
        assert request.url == "http://127.0.0.1:8001/v1/models"
        assert request.headers["authorization"] == "Bearer test-secret"
        if case == "timeout":
            raise httpx.ReadTimeout("private error")
        if case == "unauthorized":
            return httpx.Response(401)
        if case == "invalid":
            return httpx.Response(200, json={})
        return httpx.Response(200, json={"data": [{"id": "real-model-id"}] * (2 if case == "ambiguous" else 1)})
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(respond)))
    adapter = LlamaServerAdapter(LocalLLMSettings(api_key=SecretStr("test-secret")))
    if case == "ok":
        assert asyncio.run(adapter.discover_model()) == expected
    else:
        with pytest.raises(LocalLLMError, match=expected):
            asyncio.run(adapter.discover_model())


def test_local_model_binding_accepts_only_matching_huggingface_cache_path():
    from app.clients.local.llama import LlamaServerAdapter
    expected = "ggml-org/gemma-4-e4b-it-GGUF:Q4_0"
    actual = ("C:/cache/models--ggml-org--gemma-4-e4b-it-GGUF/snapshots/abc/"
              "gemma-4-E4B-it-Q4_0.gguf")
    assert LlamaServerAdapter.matches_model(expected, expected)
    assert LlamaServerAdapter.matches_model(expected, actual)
    assert not LlamaServerAdapter.matches_model(expected, actual.replace("Q4_0", "Q8_0"))
    assert not LlamaServerAdapter.matches_model(
        expected, actual.replace("models--ggml-org", "models--other-org"))
