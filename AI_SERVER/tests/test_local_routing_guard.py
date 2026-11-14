from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.lan_robot import resolved_execution_runtime
from app.core.backend_config import BackendSettings
from app.main import create_app
from tests.test_lan_bootstrap import Backend, PROOF


def config(code):
    return SimpleNamespace(provider=SimpleNamespace(code=code))


def test_backend_selected_local_never_enters_cloud_pipeline():
    assert resolved_execution_runtime(config("LOCAL")) == "local"


def test_existing_gemini_route_is_unchanged():
    assert resolved_execution_runtime(config("GEMINI")) == "cloud"


def test_other_provider_is_rejected_for_robot_voice():
    with pytest.raises(ValueError, match="Unsupported robot AI provider"):
        resolved_execution_runtime(config("OPENAI"))


def test_backend_selected_local_fails_closed_before_cloud_pipeline(monkeypatch):
    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "integrated")
    for name, char in (("DEVICE", "A"), ("CONFIG", "B"), ("QUOTA", "C")):
        monkeypatch.setenv("AI_SERVER_BACKEND_" + name + "_TOKEN", char * 43)
    backend = Backend()
    backend.resolved = backend.resolved.model_copy(update={
        "provider": backend.resolved.provider.model_copy(update={"code": "LOCAL"}),
        "credentialScope": "NONE", "credentialSource": "NONE",
        "credentialReference": None, "credential": None,
    })
    monkeypatch.setattr(BackendSettings, "create_client", lambda self: backend)
    from app.api import lan_robot
    cloud_pipeline = SimpleNamespace(called=False)
    def forbidden(*args, **kwargs):
        cloud_pipeline.called = True
        raise AssertionError("LOCAL device entered Cloud pipeline")
    monkeypatch.setattr(lan_robot, "create_live_robot", forbidden)
    app = create_app()
    with TestClient(app, base_url="https://testserver") as client:
        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect("wss://testserver/ws/robot", headers=PROOF) as ws:
                assert ws.receive_json() == {"type": "error",
                    "code": "LOCAL_RUNTIME_NOT_READY", "retryable": True}
                ws.receive_json()
        assert closed.value.code == 1013
    assert cloud_pipeline.called is False
    assert backend.calls == [("authorize", "provisioned-sd2"), ("resolve", "42")]
