"""Mode safety and local ceiling tests; no live Backend evidence."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.clients.backend import BackendError
from app.core.backend_config import BackendSettings
from app.main import create_app
from app.services.user_rate_limit import UserRateLimit
from app.models.backend import Authorization, ResolvedConfig
from starlette.websockets import WebSocketDisconnect


def test_integrated_requires_credentials():
    with pytest.raises(ValidationError):
        BackendSettings(_env_file=None, mode="integrated")


def test_integrated_never_accepts_mock_robot(monkeypatch):
    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "integrated")
    for name, value in (("DEVICE", "A"), ("CONFIG", "B"), ("QUOTA", "C")):
        monkeypatch.setenv("AI_SERVER_BACKEND_" + name + "_TOKEN", value * 43)
    app = create_app()
    assert app.state.backend_integration_blocker == "cloud_media_pipeline_unavailable"
    with TestClient(app) as client:
        from starlette.websockets import WebSocketDisconnect
        with pytest.raises(WebSocketDisconnect) as error:
            with client.websocket_connect("/ws/dev-robot"):
                pytest.fail("Missing Backend contract must reject before accepting audio")
        assert error.value.code == 1008


def test_integrated_authorizes_and_resolves_before_rejecting_audio(monkeypatch):
    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "integrated")
    for name, value in (("DEVICE", "A"), ("CONFIG", "B"), ("QUOTA", "C")):
        monkeypatch.setenv("AI_SERVER_BACKEND_" + name + "_TOKEN", value * 43)
    class Backend:
        calls = []
        async def aclose(self):
            pass
        async def authorize(self, proof, context):
            self.calls.append(("authorize", proof.deviceUid))
            return Authorization(allowed=True, deviceId="42", ownerUserId="7")
        async def resolve_config(self, request, context):
            self.calls.append(("resolve", request.userId, request.deviceId))
            return ResolvedConfig.model_validate({
                "userId": "7", "provider": {"id": "2", "code": "OPENAI", "name": "OpenAI"},
                "model": {"id": "21", "modelCode": "gpt-6-luna", "capability": "llm"},
                "profile": {"assistantName": "AIVA", "systemPrompt": "fixture", "preferredProviderId": "2",
                            "preferredLlmModelId": "21", "languageCode": "vi", "voiceCode": "voice"},
                "credentialScope": "USER", "credentialReference": {"id": "9", "providerId": "2"}})

    backend = Backend()
    monkeypatch.setattr(BackendSettings, "create_client", lambda self: backend)
    app = create_app()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/dev-robot", headers={"device-uid": "robot-42", "device-credential": "D" * 43}) as ws:
            assert ws.receive_json() == {"type": "error", "code": "AI_PIPELINE_UNAVAILABLE"}
            with pytest.raises(WebSocketDisconnect) as error:
                ws.receive_json()
            assert error.value.code == 1013
    assert backend.calls == [("authorize", "robot-42"), ("resolve", "7", "42")]


def test_sliding_window_per_user_and_shared_devices():
    now = [0.0]
    limiter = UserRateLimit(clock=lambda: now[0])
    for _ in range(6):
        limiter.claim("user-a")  # Robot A
    now[0] = 30
    for _ in range(6):
        limiter.claim("user-a")  # Robot B, same owner
    with pytest.raises(BackendError) as error:
        limiter.claim("user-a")
    assert error.value.status == 429
    for _ in range(12):
        limiter.claim("user-b")
    now[0] = 59.999
    with pytest.raises(BackendError):
        limiter.claim("user-a")
    now[0] = 60
    for _ in range(6):
        limiter.claim("user-a")
    with pytest.raises(BackendError):
        limiter.claim("user-a")


def test_rate_limiter_capacity_fails_closed_and_expires():
    now = [0]
    limiter = UserRateLimit(clock=lambda: now[0], max_users=1)
    limiter.claim("a")
    with pytest.raises(BackendError):
        limiter.claim("b")
    now[0] = 60
    limiter.claim("b")
