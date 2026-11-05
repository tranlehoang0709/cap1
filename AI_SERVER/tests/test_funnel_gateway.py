"""Offline contract tests; Backend is a fake, never the working database."""
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.robot_gateway import RobotGateway, PUBLIC_ORIGIN, PUBLIC_HOST, create_gateway
from app.core.lan_config import LanSettings
from app.clients.backend import BackendError, BackendCode
from tests.test_lan_bootstrap import configured, PROOF, hello


def client_for(app, **kwargs):
    app.state.lan_settings = LanSettings(public_origin=PUBLIC_ORIGIN)
    return TestClient(RobotGateway(app), base_url=PUBLIC_ORIGIN,
                      client=("127.0.0.1", 1234), **kwargs)


@pytest.mark.parametrize("path", ["/", "/docs", "/openapi.json", "/health",
    "/internal/web-chat", "/admin", "/debug", "/ws/dev-robot", "/ws/dev-echo",
    "/device-profiles", "/xiaozhi/ota", "/xiaozhi/ota//", "/xiaozhi/ota/?x=1",
    "/xiaozhi/%6fta/", "/ws/robot", "/heartbeat", "/auth"])
def test_only_exact_ota_post(configured, path):
    app, backend = configured
    with client_for(app) as c:
        assert c.post(path, headers=PROOF).status_code == 404
    assert backend.calls == []


def test_ota_contract_and_proof(configured):
    app, backend = configured
    with client_for(app) as c:
        assert c.get('/xiaozhi/ota/').status_code == 404
        assert c.post('/xiaozhi/ota/').status_code == 401
        r = c.post('/xiaozhi/ota/', headers=PROOF, json={"board": "sd2"})
        assert r.status_code == 200
        assert r.json()['websocket'] == {"url": "wss://" + PUBLIC_HOST + "/ws/robot", "version": 1}
        assert r.headers['cache-control'] == 'no-store'
        assert c.post('/xiaozhi/ota/', headers=PROOF | {'Host': 'evil.invalid'}).status_code == 404
        assert c.post('/xiaozhi/ota/', headers=PROOF, content=b'x'*16385).status_code == 413


def test_auth_denied_and_unavailable(configured):
    app, backend = configured
    with client_for(app) as c:
        for error in (BackendError(BackendCode.HTTP, status=401),
                      BackendError(BackendCode.NETWORK, status=503)):
            backend.fail = error
            assert c.post('/xiaozhi/ota/', headers=PROOF).status_code in (403, 503)
            with pytest.raises(WebSocketDisconnect):
                with c.websocket_connect('wss://' + PUBLIC_HOST + '/ws/robot', headers=PROOF):
                    pytest.fail('Unauthorized upgrade')


def test_ws_handshake_and_heartbeat(configured):
    app, backend = configured
    with client_for(app) as c:
        for path in ('/ws/dev-robot', '/internal/web-chat', '/ws/robot?token=x'):
            with pytest.raises(WebSocketDisconnect):
                with c.websocket_connect(path, headers=PROOF):
                    pytest.fail('Forbidden upgrade')
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect('wss://' + PUBLIC_HOST + '/ws/robot'):
                pytest.fail('Missing proof accepted')
        with c.websocket_connect('wss://' + PUBLIC_HOST + '/ws/robot', headers=PROOF) as ws:
            session = hello(ws)
            ws.send_json({'type': 'heartbeat', 'session_id': session})
            assert ws.receive_json()['accepted'] is True
            ws.send_bytes(b'audio-before-admission')
            assert ws.receive()['code'] == 1008
    assert ('authorize', 'provisioned-sd2') in backend.calls


def test_factory_refuses_mock_mode():
    with TestClient(create_gateway(), base_url=PUBLIC_ORIGIN,
                    client=('127.0.0.1', 1234)) as c:
        assert c.post('/xiaozhi/ota/', headers=PROOF).status_code == 503
        assert c.post('/xiaozhi/ota/').status_code == 503
        assert c.get('/internal/web-chat').status_code == 404
        with pytest.raises(WebSocketDisconnect):
            with c.websocket_connect('wss://' + PUBLIC_HOST + '/ws/robot', headers=PROOF):
                pytest.fail('Mock mode exposed')


def test_nonloopback_is_denied(configured):
    app, backend = configured
    with TestClient(RobotGateway(app), base_url=PUBLIC_ORIGIN, client=('192.0.2.1', 1)) as c:
        assert c.post('/xiaozhi/ota/', headers=PROOF).status_code == 404
    assert not backend.calls


def test_real_tcp_upgrade_and_binary_both_directions():
    """Transport-only fixture: no device/provider acceptance is claimed."""
    import socket
    import threading
    import time
    import uvicorn
    from websockets.sync.client import connect
    from websockets.exceptions import InvalidStatus

    async def echo(scope, receive, send):
        assert scope['scheme'] == 'wss'
        await receive()
        await send({'type': 'websocket.accept'})
        await send({'type': 'websocket.send', 'bytes': b'\x00\xffserver-opus'})
        event = await receive()
        await send({'type': 'websocket.send', 'bytes': event['bytes']})
        await send({'type': 'websocket.close', 'code': 1000})

    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(RobotGateway(echo), lifespan='off',
                            proxy_headers=False, log_level='error', ws_max_size=4096))
    worker = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
    worker.start()
    try:
        deadline = time.monotonic() + 5
        while not server.started and worker.is_alive() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert server.started
        with connect('ws://' + PUBLIC_HOST + '/ws/robot',
                     sock=socket.create_connection(('127.0.0.1', port)), proxy=None) as ws:
            assert ws.recv() == b'\x00\xffserver-opus'
            ws.send(b'\xff\x00client-opus')
            assert ws.recv() == b'\xff\x00client-opus'
        with pytest.raises(InvalidStatus) as denied:
            with connect('ws://' + PUBLIC_HOST + '/ws/dev-robot',
                         sock=socket.create_connection(('127.0.0.1', port)), proxy=None):
                pytest.fail('Forbidden TCP upgrade')
        assert denied.value.response.status_code == 403
    finally:
        server.should_exit = True
        worker.join(5)
        listener.close()
    assert not worker.is_alive()
