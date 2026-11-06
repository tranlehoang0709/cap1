"""Mock-only contract and isolation; no cloud or production runtime is called."""
import pytest
from fastapi.testclient import TestClient
from scripts.mock_chat import create_mock_app, MOCK_REPLY

TOKEN = "m" * 43

def app():
    return create_mock_app(enabled=True, environment="test", service_token=TOKEN)

@pytest.mark.parametrize("enabled,environment", [(False,"test"),(True,"production"),(True,"")])
def test_mock_runtime_fails_closed(enabled, environment):
    with pytest.raises(ValueError):
        create_mock_app(enabled=enabled, environment=environment, service_token=TOKEN)

def test_authentication_owner_shape_and_no_store():
    with TestClient(app()) as client:
        assert client.post("/internal/web-chat", json={"userId":"7","content":"fixture"}).status_code == 401
        headers={"Authorization":"Bearer " + TOKEN}
        assert client.post("/internal/web-chat", headers=headers, json={"userId":"8","content":"fixture"}).status_code == 403
        response=client.post("/internal/web-chat", headers=headers, json={"userId":"7","content":"synthetic question"})
        assert response.status_code == 200
        assert response.json() == {"content":MOCK_REPLY,"conversation_id":"11","usage":{"input_tokens":0,"output_tokens":0}}
        assert response.headers["cache-control"] == "no-store"
        assert "synthetic question" not in response.text
        assert client.get("/health").json()["requests"] == 1

@pytest.mark.parametrize("payload", [{"userId":"7","content":""},{"userId":"7","content":" "},
    {"userId":"7","content":"fixture","providerId":"1"}, {"userId":"7"}])
def test_rejects_invalid_and_override_requests(payload):
    with TestClient(app()) as client:
        assert client.post("/internal/web-chat", headers={"Authorization":"Bearer "+TOKEN}, json=payload).status_code == 400
        assert client.get("/health").json()["requests"] == 0

def test_body_limit_and_bad_json():
    with TestClient(app()) as client:
        headers={"Authorization":"Bearer "+TOKEN}
        assert client.post("/internal/web-chat",headers=headers,content=b"x"*70001).status_code==413
        assert client.post("/internal/web-chat",headers=headers,content=b"{").status_code==400
