import asyncio
import json
import time

import httpx

from app.models.llm import ProviderDelta, ProviderDone, Usage

TOKEN = "L" * 43


class RecordingLocalLLM:
    def __init__(self):
        self.requests = []

    async def discover_model(self):
        return "ggml-org/gemma-4-e4b-it-GGUF:Q4_0"

    async def stream(self, request, context, *, enable_thinking=None):
        assert enable_thinking is False
        self.requests.append(request)
        yield ProviderDelta(f"Lượt {len(request.history) // 2 + 1}: {request.transcript}")
        yield ProviderDone(True, "completed", Usage(10, 4, 14))


def local_app(monkeypatch):
    monkeypatch.setenv("AI_RUNTIME", "local")
    monkeypatch.setenv("LOCAL_LLM_API_KEY", "llama-key")
    monkeypatch.setenv("LOCAL_LLM_CHAT_TOKEN", TOKEN)
    from app.main import create_app
    app = create_app()
    fake = RecordingLocalLLM()
    app.state.local_llm = fake
    return app, fake


def test_local_chat_three_turns_isolated_by_user_and_session(monkeypatch):
    app, fake = local_app(monkeypatch)

    async def run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            assert (await client.post("/local/chat", json={"user_id": "u", "session_id": "s",
                "content": "xin chào", "stream": False})).status_code == 401
            headers = {"Authorization": "Bearer " + TOKEN}
            for content in ("Tôi tên An", "Tôi tên gì?", "Hãy nhắc lại"):
                response = await client.post("/local/chat", headers=headers,
                    json={"user_id": "u", "session_id": "s", "content": content, "stream": False})
                assert response.status_code == 200
                assert response.json()["model"].endswith(":Q4_0")
                assert response.json()["usage"]["total_tokens"] == 14
            other = await client.post("/local/chat", headers=headers,
                json={"user_id": "u", "session_id": "other", "content": "Tôi là ai?", "stream": False})
            assert other.status_code == 200
    asyncio.run(run())
    assert [len(item.history) for item in fake.requests] == [0, 2, 4, 0]
    assert fake.requests[2].history[0].text == "Tôi tên An"


def test_local_chat_sse_stream(monkeypatch):
    app, _ = local_app(monkeypatch)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.post("/local/chat", headers={"Authorization": "Bearer " + TOKEN},
                json={"user_id": "u", "session_id": "s", "content": "Chào", "stream": True})
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            assert "event: delta" in response.text and "event: done" in response.text
    asyncio.run(run())


def test_incomplete_generation_logs_reason_without_private_content(monkeypatch, caplog):
    app, fake = local_app(monkeypatch)

    async def incomplete(request, context, *, enable_thinking=None):
        assert enable_thinking is False
        yield ProviderDone(False, 'token_limit', Usage(56, 256, 312))

    fake.stream = incomplete

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.post('/local/chat', headers={'Authorization': 'Bearer ' + TOKEN},
                json={'user_id': 'u', 'session_id': 's', 'content': 'private-content'})
            assert response.status_code == 503
            assert response.json() == {'detail': 'provider_error'}

    asyncio.run(run())
    records = [r for r in caplog.records if getattr(r, 'event', None) == 'local_chat_incomplete']
    assert len(records) == 1 and records[0].reason == 'token_limit'
    assert records[0].status == 'empty'
    assert 'private-content' not in caplog.text and TOKEN not in caplog.text


def test_llama_openai_compatible_sse_contract(monkeypatch):
    from pydantic import SecretStr
    from app.clients.local.llama import LlamaServerAdapter
    from app.core.llm_config import LLMSettings
    from app.core.runtime_config import LocalLLMSettings
    from app.models.llm import ConversationKey, LLMRequest, Message
    from app.services.audio_context import AudioContext

    bodies = []
    def respond(request):
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "actual-gemma-id"}]})
        bodies.append(json.loads(request.content))
        stream = ('data: {"choices":[{"delta":{"content":"Xin "},"finish_reason":null}]}\n\n'
                  'data: {"choices":[{"delta":{"content":"chào"},"finish_reason":"stop"}]}\n\n'
                  'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n'
                  'data: [DONE]\n\n').encode()
        return httpx.Response(200, content=stream, headers={"content-type": "text/event-stream"})

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(respond)))
    settings = LocalLLMSettings(api_key=SecretStr("key"), max_retries=0)
    adapter = LlamaServerAdapter(settings)
    request = LLMRequest(ConversationKey("u", "s", "d"), "turn", "Chào",
        "Trả lời hữu ích", (Message("user", "Tên tôi là An"), Message("assistant", "Đã nhớ")),
        LLMSettings(_env_file=None, model="actual-gemma-id"))

    async def run():
        return [event async for event in adapter.stream(request,
            AudioContext(deadline=time.monotonic() + 5))]
    events = asyncio.run(run())
    assert "".join(event.text for event in events if isinstance(event, ProviderDelta)) == "Xin chào"
    assert events[-1] == ProviderDone(True, "completed", Usage(8, 2, 10))
    assert bodies[0]["model"] == "actual-gemma-id"
    assert bodies[0]["messages"][0]["role"] == "system"
    assert bodies[0]["messages"][1]["content"] == "Tên tôi là An"


def test_llama_reuses_client_and_model_discovery(monkeypatch):
    from pydantic import SecretStr
    from app.clients.local.llama import LlamaServerAdapter
    from app.core.runtime_config import LocalLLMSettings

    calls = []
    clients = []
    original = httpx.AsyncClient

    def respond(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={"data": [{"id": "actual-gemma-id"}]})

    def factory(**kwargs):
        client = original(**kwargs, transport=httpx.MockTransport(respond))
        clients.append(client)
        return client

    monkeypatch.setattr(httpx, "AsyncClient", factory)
    adapter = LlamaServerAdapter(LocalLLMSettings(api_key=SecretStr("key"), max_retries=0))

    async def run():
        assert await adapter.discover_model() == "actual-gemma-id"
        assert await adapter.discover_model() == "actual-gemma-id"
        await adapter.aclose()

    asyncio.run(run())
    assert len(clients) == 1
    assert calls == ["/v1/models"]
    assert clients[0].is_closed
