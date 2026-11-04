"""Contract simulations only: no Cloud, hardware or database writes."""
import pytest
from types import SimpleNamespace
from unittest.mock import Mock, AsyncMock
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect
from app.clients.backend import BackendCode, BackendError
from app.core.backend_config import BackendSettings
from app.core.lan_config import LanSettings
from app.main import create_app
from app.models.backend import Authorization, HeartbeatResult
from app.services.orchestrator import SessionState
from tests.test_live_gemini_integration import config
from app.api.lan_robot import AUDIO_PARAMS

PROOF = {"Device-Uid": "provisioned-sd2", "Device-Credential": "D" * 43, "Protocol-Version": "1"}


class Backend:
    def __init__(self):
        self.calls = []
        self.fail = None

    async def aclose(self):
        pass

    async def authorize(self, proof, context):
        self.calls.append(("authorize", proof.deviceUid))
        if self.fail:
            raise self.fail
        return Authorization(allowed=True, deviceId="42", ownerUserId="7")

    async def heartbeat(self, request, context):
        self.calls.append(("heartbeat", request.deviceUid))
        if self.fail:
            raise self.fail
        return HeartbeatResult(accepted=True, deviceId="42", lastSeenAt=request.observedAt)

    async def resolve_config(self, request, context):
        self.calls.append(("resolve", request.deviceId))
        if self.fail:
            raise self.fail
        return config()


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "integrated")
    monkeypatch.setenv("AI_SERVER_LAN_PUBLIC_ORIGIN", "https://192.168.10.9:8123")
    for name, char in (("DEVICE", "A"), ("CONFIG", "B"), ("QUOTA", "C")):
        monkeypatch.setenv("AI_SERVER_BACKEND_" + name + "_TOKEN", char * 43)
    backend = Backend()
    monkeypatch.setattr(BackendSettings, "create_client", lambda self: backend)
    from app.api import lan_robot
    def pipeline(state,ws,session,session_id,version):
        orch=SimpleNamespace(state=SessionState.LISTENING,turn=None,task=None)
        return orch,SimpleNamespace(close=Mock()),SimpleNamespace(prepare=AsyncMock()),SimpleNamespace()
    monkeypatch.setattr(lan_robot,'create_live_robot',pipeline)
    return create_app(), backend


def secure_client(app):
    return TestClient(app, base_url="https://testserver")


def hello(ws):
    ws.send_json({"type": "hello", "version": 1, "transport": "websocket",
                  "audio_params": AUDIO_PARAMS,
                  "features": {"aiva_half_duplex_v1": True, "aiva_lan_v1": True}})
    return ws.receive_json()["session_id"]


def test_bootstrap_preserves_nvs_secrets_and_uses_explicit_origin(configured):
    app, backend = configured
    with TestClient(app, base_url="https://testserver", client=("127.0.0.1", 1234)) as client:
        response = client.post('/xiaozhi/ota/', headers=PROOF | {'Host': 'attacker.invalid'}, json={'board': 'sd2'})
        assert response.status_code == 200
        body = response.json()
        assert body['websocket'] == {'url': 'wss://192.168.10.9:8123/ws/robot', 'version': 1}
        assert response.headers['cache-control'] == 'no-store'
        assert not {'activation', 'firmware'} & body.keys()
        assert 'token' not in body['websocket']
        assert PROOF['Device-Credential'] not in response.text
        assert backend.calls == [('authorize', 'provisioned-sd2')]


def test_ota_rejects_missing_proof_and_oversized_body(configured):
    app, backend = configured
    with secure_client(app) as client:
        assert client.post('/xiaozhi/ota/').status_code == 401
        assert not backend.calls
        assert client.post('/xiaozhi/ota/', headers=PROOF, content=b'x' * 16385).status_code == 413


def test_plaintext_gateway_is_rejected_before_backend_auth(configured):
    app, backend = configured
    with TestClient(app) as client:
        assert client.post('/xiaozhi/ota/', headers=PROOF).status_code == 426
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/ws/robot', headers=PROOF):
                pytest.fail('Plaintext WebSocket accepted')
    assert backend.calls == []


def test_https_bootstrap_fails_before_auth_if_advertised_origin_is_plaintext(configured):
    app, backend = configured
    app.state.lan_settings.public_origin = "http://192.168.10.9:8123"
    with secure_client(app) as client:
        response = client.post('/xiaozhi/ota/', headers=PROOF)
        assert response.status_code == 503
        assert response.json()['detail'] == 'HTTPS_LAN_ORIGIN_NOT_CONFIGURED'
    assert backend.calls == []


def test_ota_be_unavailable_and_denied(configured):
    app, backend = configured
    with secure_client(app) as client:
        backend.fail = BackendError(BackendCode.NETWORK)
        assert client.post('/xiaozhi/ota/', headers=PROOF).status_code == 503
        backend.fail = BackendError(BackendCode.HTTP, status=403)
        assert client.post('/xiaozhi/ota/', headers=PROOF).status_code == 403


def test_heartbeat_isolation_disconnect_reconnect_and_revocation(configured):
    app, backend = configured
    with secure_client(app) as client:
        with client.websocket_connect('wss://testserver/ws/robot', headers=PROOF) as first:
            a = hello(first)
            with client.websocket_connect('wss://testserver/ws/robot', headers=PROOF) as second:
                b = hello(second)
                assert a != b
                first.send_json({'type': 'heartbeat', 'session_id': a})
                assert first.receive_json()['accepted'] is True
                second.send_json({'type': 'heartbeat', 'session_id': a})
                assert second.receive()['code'] == 1008
        with client.websocket_connect('wss://testserver/ws/robot', headers=PROOF) as reconnected:
            c = hello(reconnected)
            assert c not in (a, b)
            backend.fail = BackendError(BackendCode.HTTP, status=403)
            reconnected.send_json({'type': 'heartbeat', 'session_id': c})
            assert reconnected.receive()['code'] == 1008


def test_audio_never_reaches_provider_before_live_admission(configured):
    app, backend = configured
    with secure_client(app) as client:
        with client.websocket_connect('wss://testserver/ws/robot',
                headers=PROOF | {'Device-Id': 'fixture-device', 'Client-Id': 'fixture-client'}) as ws:
            hello(ws)
            ws.send_bytes(b'unsolicited-opus')
            assert ws.receive()['code'] == 1008
        assert backend.calls[:2] == [('authorize','provisioned-sd2'),('resolve','42')]


def test_mock_mode_cannot_bootstrap_or_open_integrated_route():
    with secure_client(create_app()) as client:
        # The explicit standalone branch denies access without per-device local
        # credential configuration; it must never bootstrap mock/unauthenticated devices.
        assert client.post('/xiaozhi/ota/', headers=PROOF).status_code == 403
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('wss://testserver/ws/robot', headers=PROOF):
                pytest.fail('Mock bypass')


def test_standalone_device_heartbeat_is_answered_without_closing_session(monkeypatch):
    from app.api import robot_websocket

    monkeypatch.setenv('AI_SERVER_BACKEND_MODE', 'development-mock')
    monkeypatch.setenv('AI_SERVER_ROBOT_ENABLED', 'true')
    monkeypatch.setenv('AI_SERVER_ROBOT_AI_MODE', 'gemini')
    monkeypatch.setenv('AI_SERVER_ROBOT_ENERGY_THRESHOLD', '100')
    monkeypatch.setenv('AI_SERVER_ROBOT_ALLOWED_NETWORKS', '["127.0.0.0/8"]')
    monkeypatch.setenv('AI_SERVER_ROBOT_LOCAL_DEVICE_CREDENTIALS', '{"heartbeat-fixture":"' + 'H' * 43 + '"}')
    monkeypatch.setenv('AI_SERVER_LLM_PROVIDER', 'gemini')
    monkeypatch.setenv('GEMINI_API_KEY', 'fixture-key')
    monkeypatch.setenv('GEMINI_MODEL', 'fixture-model')

    class Codec:
        def __init__(self, *_args): pass
        def close(self): pass

    monkeypatch.setattr(robot_websocket, 'OpusCodec', Codec)
    from app.clients import provider_factory, stt_factory, tts_factory
    from types import SimpleNamespace
    monkeypatch.setattr(provider_factory, 'create_llm_adapter', lambda *_args, **_kwargs: (object(), 'fixture-model'))
    monkeypatch.setattr(stt_factory, 'create_gemini_stt_adapter', lambda *_args, **_kwargs: object())
    monkeypatch.setattr(tts_factory, 'create_gemini_tts_adapter',
                        lambda *_args, **_kwargs: SimpleNamespace(model='fixture-tts', voice='fixture-voice'))
    headers = {
        'Device-Uid': 'heartbeat-fixture', 'Device-Credential': 'H' * 43,
        'Protocol-Version': '1', 'Device-Id': 'fixture-device', 'Client-Id': 'fixture-client',
    }
    with TestClient(create_app(), base_url='https://testserver', client=('127.0.0.1', 1234)) as client:
        with client.websocket_connect('wss://testserver/ws/robot', headers=headers) as ws:
            ws.send_json({'type': 'hello', 'version': 1, 'transport': 'websocket',
                'audio_params': AUDIO_PARAMS,
                'features': {'aiva_half_duplex_v1': True, 'aiva_lan_v1': True}})
            session_id = ws.receive_json()['session_id']
            ws.send_json({'type': 'heartbeat', 'session_id': session_id})
            assert ws.receive_json() == {
                'type': 'heartbeat', 'session_id': session_id, 'accepted': True,
            }


def test_standalone_bootstrap_requires_per_device_local_credential():
    from app.services.device_auth import validate_local_device_credential
    from app.core.robot_config import RobotSettings
    local = RobotSettings(_env_file=None, enabled=True, ai_mode="gemini", energy_threshold=100,
        allowed_networks=["127.0.0.0/8"], local_device_credentials={"provisioned-sd2": "D" * 43})
    assert validate_local_device_credential(local.local_device_credentials, "provisioned-sd2", "D" * 43)
    assert not validate_local_device_credential(local.local_device_credentials, "provisioned-sd2", "X" * 43)
    assert not validate_local_device_credential(local.local_device_credentials, "unknown", "D" * 43)
    with pytest.raises(ValidationError):
        RobotSettings(_env_file=None, enabled=True, energy_threshold=100,
                      local_device_credentials={'sd2': 'short'})


def test_standalone_https_bootstrap_uses_local_credential_without_backend(monkeypatch):
    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "development-mock")
    monkeypatch.setenv("AI_SERVER_LAN_PUBLIC_ORIGIN", "https://192.168.10.9:8123")
    monkeypatch.setenv("AI_SERVER_ROBOT_ENABLED", "true")
    monkeypatch.setenv("AI_SERVER_ROBOT_AI_MODE", "gemini")
    monkeypatch.setenv("AI_SERVER_ROBOT_ENERGY_THRESHOLD", "100")
    monkeypatch.setenv("AI_SERVER_ROBOT_ALLOWED_NETWORKS", '["127.0.0.0/8"]')
    monkeypatch.setenv("AI_SERVER_ROBOT_LOCAL_DEVICE_CREDENTIALS", '{"provisioned-sd2":"' + "D" * 43 + '"}')
    app = create_app()
    with TestClient(app, base_url="https://testserver", client=("127.0.0.1", 1234)) as client:
        accepted = client.post('/xiaozhi/ota/', headers=PROOF)
        assert accepted.status_code == 200
        assert accepted.json()['websocket']['url'] == 'wss://192.168.10.9:8123/ws/robot'
        assert PROOF['Device-Credential'] not in accepted.text
        denied = client.post('/xiaozhi/ota/', headers=PROOF | {'Device-Credential': 'X' * 43})
        assert denied.status_code == 403
    assert app.state.backend_client is None


def test_standalone_wss_requires_local_device_credential_before_hello(monkeypatch):
    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "development-mock")
    monkeypatch.setenv("AI_SERVER_ROBOT_ENABLED", "true")
    monkeypatch.setenv("AI_SERVER_ROBOT_AI_MODE", "gemini")
    monkeypatch.setenv("AI_SERVER_ROBOT_ENERGY_THRESHOLD", "100")
    monkeypatch.setenv("AI_SERVER_ROBOT_ALLOWED_NETWORKS", '["127.0.0.0/8"]')
    monkeypatch.setenv("AI_SERVER_ROBOT_LOCAL_DEVICE_CREDENTIALS", '{"provisioned-sd2":"' + "D" * 43 + '"}')
    monkeypatch.setenv("AI_SERVER_LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "fixture-provider-key-not-used")
    app = create_app()
    with TestClient(app, base_url="https://testserver", client=("127.0.0.1", 1234)) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('wss://testserver/ws/robot',
                    headers=PROOF | {'Device-Credential': 'X' * 43}):
                pytest.fail('Invalid standalone credential accepted')
        with client.websocket_connect('wss://testserver/ws/robot',
                headers=PROOF | {'Device-Id': 'fixture-device', 'Client-Id': 'fixture-client'}) as ws:
            ws.send_json({"type": "hello", "version": 1, "transport": "websocket",
                "audio_params": AUDIO_PARAMS,
                "features": {"aiva_half_duplex_v1": True, "aiva_lan_v1": True}})
            session = ws.receive_json()['session_id']
            assert len(session) == 32
    assert app.state.backend_client is None


def test_missing_proof_and_unavailable_backend_reject_before_hello(configured):
    app, backend = configured
    with secure_client(app) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('wss://testserver/ws/robot'):
                pytest.fail('Missing proof accepted')
        assert backend.calls == []
        backend.fail = BackendError(BackendCode.NETWORK)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('wss://testserver/ws/robot', headers=PROOF):
                pytest.fail('Unavailable Backend accepted')


def test_config_failure_cannot_start_media(configured):
    app, backend = configured
    with secure_client(app) as client:
        with client.websocket_connect('wss://testserver/ws/robot', headers=PROOF) as ws:
            session = hello(ws)
            backend.fail=BackendError(BackendCode.BLOCKED)
            ws.send_json({'type': 'listen', 'state': 'start', 'mode':'manual', 'session_id': session})
            assert ws.receive()['code'] == 1013
        assert backend.calls[-1] == ('resolve', '42')


def test_silent_peer_times_out_and_releases_capacity(configured, monkeypatch):
    from app.api import lan_robot
    monkeypatch.setattr(lan_robot, 'IDLE_TIMEOUT_SECONDS', .02)
    app, _ = configured
    with secure_client(app) as client:
        for _ in range(3):
            with client.websocket_connect('wss://testserver/ws/robot', headers=PROOF) as ws:
                hello(ws)
                assert ws.receive()['code'] == 1008


def test_invalid_hello_does_not_create_session(configured):
    app, _ = configured
    with secure_client(app) as client:
        with client.websocket_connect('wss://testserver/ws/robot', headers=PROOF) as ws:
            ws.send_json({'type': 'hello', 'version': 1, 'transport': 'websocket',
                'audio_params': AUDIO_PARAMS | {'channels': True},
                'features': {'aiva_half_duplex_v1': True, 'aiva_lan_v1': True}})
            assert ws.receive()['code'] == 1008


@pytest.mark.parametrize('origin', ['https://0.0.0.0:8000', 'https://127.0.0.1', 'https://u:p@host', 'https://host/path', 'wss://host'])
def test_invalid_public_origins(origin):
    with pytest.raises(ValidationError):
        LanSettings(_env_file=None, public_origin=origin)


def test_plaintext_origin_cannot_advertise_websocket():
    with pytest.raises(ValueError, match="HTTPS LAN origin"):
        LanSettings(_env_file=None, public_origin="http://192.168.0.2:8000").websocket_url()


def test_lan_entrypoint_fails_closed_without_tls(monkeypatch):
    from scripts import run_lan
    from app.core.config import get_settings
    from types import SimpleNamespace
    monkeypatch.setenv("AI_SERVER_HOST", "0.0.0.0")
    monkeypatch.setenv("AI_SERVER_PORT", "8123")
    monkeypatch.setenv("AI_SERVER_RELOAD", "false")
    monkeypatch.setenv("AI_SERVER_LAN_PUBLIC_ORIGIN", "https://lan.example:8123")
    monkeypatch.delenv("AI_SERVER_TLS_CERTFILE", raising=False)
    monkeypatch.delenv("AI_SERVER_TLS_KEYFILE", raising=False)
    monkeypatch.setattr(run_lan, "BackendSettings", lambda: SimpleNamespace(mode="integrated"))
    get_settings.cache_clear()
    with pytest.raises(SystemExit, match="plaintext LAN gateway is disabled"):
        run_lan.main()


def test_lan_entrypoint_rejects_unloadable_tls_pair(monkeypatch):
    from scripts import run_lan
    from app.core.config import get_settings
    from types import SimpleNamespace
    cert = str(__file__)
    monkeypatch.setenv("AI_SERVER_HOST", "0.0.0.0")
    monkeypatch.setenv("AI_SERVER_PORT", "8123")
    monkeypatch.setenv("AI_SERVER_RELOAD", "false")
    monkeypatch.setenv("AI_SERVER_LAN_PUBLIC_ORIGIN", "https://lan.example:8123")
    monkeypatch.setenv("AI_SERVER_TLS_CERTFILE", cert)
    monkeypatch.setenv("AI_SERVER_TLS_KEYFILE", cert)
    monkeypatch.setattr(run_lan, "BackendSettings", lambda: SimpleNamespace(mode="integrated"))
    get_settings.cache_clear()
    with pytest.raises(SystemExit, match="could not be loaded"):
        run_lan.main()
