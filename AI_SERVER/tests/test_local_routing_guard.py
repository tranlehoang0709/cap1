from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.lan_robot import resolved_execution_runtime
from app.core.backend_config import BackendSettings
from app.main import create_app
from app.core.gateway_routing_config import GatewayRoutingSettings
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


def test_only_selected_device_gets_local_override():
    routing = GatewayRoutingSettings(_env_file=None, local_device_uids="robot-local",
        local_provider_id="1", local_model_id="2")
    assert routing.target_for("robot-local") == ("1", "2")
    assert routing.target_for("robot-cloud") == (None, None)


def test_backend_selected_local_is_rejected_by_cloud_process(monkeypatch):
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
    app = create_app()
    with TestClient(app, base_url="https://testserver") as client:
        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect("wss://testserver/ws/robot", headers=PROOF):
                pytest.fail("Cloud process accepted a Local device")
        assert closed.value.code == 1008
    assert backend.calls == [("authorize", "provisioned-sd2"), ("resolve", "42")]
