"""ASGI endpoint checks and real TCP tests (no TestClient transport substitution)."""

import asyncio
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

import httpx
import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.frames import Frame, Opcode

from app.core.config import Settings


async def drive_endpoint(messages, *, host="127.0.0.1", send_error=None, receive_error=None):
    from app.main import create_app

    sent = []
    incoming = iter([{"type": "websocket.connect"}, *messages])

    async def receive():
        event = next(incoming)
        if event["type"] == "websocket.receive" and receive_error is not None:
            raise receive_error
        return event

    async def send(event):
        sent.append(event)
        if event["type"] == "websocket.send" and send_error is not None:
            raise send_error

    scope = {
        "type": "websocket", "asgi": {"version": "3.0", "spec_version": "2.4"},
        "scheme": "ws", "path": "/ws/dev-echo", "raw_path": b"/ws/dev-echo",
        "root_path": "", "query_string": b"", "headers": [], "subprotocols": [],
        "client": (host, 12345), "server": ("127.0.0.1", 8000), "state": {},
    }
    await create_app(Settings(_env_file=None))(scope, receive, send)
    return sent


def test_endpoint_echo_and_client_close():
    messages = [
        {"type": "websocket.receive", "text": "Xin chào 🤖"},
        {"type": "websocket.receive", "text": "  text unchanged  "},
        {"type": "websocket.disconnect", "code": 1000},
    ]
    sent = asyncio.run(drive_endpoint(messages))
    assert [event["type"] for event in sent] == ["websocket.accept", "websocket.send", "websocket.send"]
    assert sent[0]["subprotocol"] is None
    assert [event["text"] for event in sent[1:]] == ["Xin chào 🤖", "  text unchanged  "]


@pytest.mark.parametrize("message,code", [
    ({"type": "websocket.receive", "bytes": b"binary"}, 1003),
    ({"type": "websocket.receive", "text": ""}, 1008),
    ({"type": "websocket.receive", "text": "a" * 4097}, 1009),
    ({"type": "websocket.receive", "text": "🤖" * 1025}, 1009),
])
def test_endpoint_rejects_message(message, code):
    sent = asyncio.run(drive_endpoint([message]))
    assert [event["type"] for event in sent] == ["websocket.accept", "websocket.close"]
    assert sent[-1]["code"] == code


def test_nonlocal_peer_denied_before_accept():
    sent = asyncio.run(drive_endpoint([], host="192.0.2.1"))
    assert len(sent) == 1
    assert sent[0]["type"] == "websocket.close"
    assert sent[0]["code"] == 1008


@pytest.mark.parametrize("direction", ["send", "receive"])
def test_internal_error_closed_without_logging_input(direction, capsys):
    failure = RuntimeError("private-payload-do-not-log")
    options = {f"{direction}_error": failure}
    sent = asyncio.run(drive_endpoint([{"type": "websocket.receive", "text": "hello"}], **options))
    assert sent[-1]["type"] == "websocket.close"
    assert sent[-1]["code"] == 1011
    assert "private-payload-do-not-log" not in capsys.readouterr().err


def test_failed_send_after_disconnect_does_not_send_again():
    sent = asyncio.run(drive_endpoint(
        [{"type": "websocket.receive", "text": "hello"}], send_error=BrokenPipeError(),
    ))
    assert [event["type"] for event in sent] == ["websocket.accept", "websocket.send"]


def test_unexpected_disconnect_does_not_send_again():
    sent = asyncio.run(drive_endpoint([{"type": "websocket.disconnect", "code": 1006}]))
    assert [event["type"] for event in sent] == ["websocket.accept"]


@pytest.fixture
def live_server(tmp_path):
    """Actual run_dev.py process, ephemeral loopback port and finite cleanup."""
    root = Path(__file__).resolve().parents[1]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    environment = {key: value for key, value in os.environ.items() if not key.upper().startswith("AI_SERVER_")}
    environment.update({
        "AI_SERVER_HOST": "127.0.0.1", "AI_SERVER_PORT": str(port),
        "AI_SERVER_RELOAD": "false", "AI_SERVER_LOG_LEVEL": "warning",
        "AI_SERVER_WS_MAX_MESSAGE_BYTES": "4096", "PYTHONDONTWRITEBYTECODE": "1",
    })
    log_path = tmp_path / "server.log"
    with log_path.open("w+", encoding="utf-8") as output:
        process = subprocess.Popen(
            [sys.executable, str(root / "scripts/run_dev.py")], cwd=root,
            env=environment, stdout=output, stderr=output,
        )
        try:
            deadline = time.monotonic() + 10
            with httpx.Client(trust_env=False, timeout=0.3) as client:
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        pytest.fail(f"Server exited before ready: {log_path.read_text()}")
                    try:
                        response = client.get(f"http://127.0.0.1:{port}/health")
                        if response.status_code == 200:
                            assert response.json() == {"status": "ok"}
                            break
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.05)
                else:
                    pytest.fail("Server did not become healthy within 10 seconds")
            yield f"ws://127.0.0.1:{port}/ws/dev-echo", process, environment
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
            contents = log_path.read_text()
            assert process.returncode == 0
            assert "Exception in ASGI application" not in contents
            if "Traceback" in contents:
                # Uvicorn 0.54 logs its handled decoder error before closing 1007.
                assert "Invalid UTF-8 sequence received from client." in contents
                assert "UnicodeDecodeError" in contents
                assert contents.count("Traceback") == 1
            assert "AI Server startup" in contents
            assert "AI Server shutdown" in contents


def connection(url):
    return connect(
        url, open_timeout=2, close_timeout=2, ping_interval=None,
        max_size=65536, compression=None, proxy=None,
    )


async def expect_close(websocket, code):
    with pytest.raises(ConnectionClosed) as caught:
        await asyncio.wait_for(websocket.recv(), 2)
    assert caught.value.rcvd is not None
    assert caught.value.rcvd.code == code


def test_real_transport_handshake_echo_close_and_health(live_server):
    url, process, _ = live_server

    async def exercise():
        async with connection(url) as websocket:
            assert websocket.response.status_code == 101
            assert websocket.subprotocol is None
            for message in ["hello", "Xin chào 🤖", "a" * 4096, "🤖" * 1024]:
                await websocket.send(message)
                assert await asyncio.wait_for(websocket.recv(), 2) == message
            await websocket.send(["fragment-", "one-", "two"])
            assert await asyncio.wait_for(websocket.recv(), 2) == "fragment-one-two"
        assert websocket.close_code == 1000
    asyncio.run(exercise())
    assert process.poll() is None
    with httpx.Client(trust_env=False) as client:
        response = client.get(url.replace("ws://", "http://").replace("/ws/dev-echo", "/health"))
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("payload,code", [
    ("", 1008), (b"binary", 1003), ("x" * 4097, 1009), ("🤖" * 1025, 1009),
    (["x" * 2048, "x" * 2049], 1009),
], ids=["empty-text", "binary", "ascii-4097-bytes", "unicode-4100-bytes", "fragmented-4097-bytes"])
def test_real_invalid_messages_and_healthy_peer(live_server, payload, code):
    url, process, _ = live_server

    async def exercise():
        async with connection(url) as healthy, connection(url) as invalid:
            await invalid.send(payload)
            await expect_close(invalid, code)
            await healthy.send("still alive")
            assert await asyncio.wait_for(healthy.recv(), 2) == "still alive"
    asyncio.run(exercise())
    assert process.poll() is None


def test_real_invalid_utf8_is_1007(live_server):
    url, _, _ = live_server

    async def exercise():
        async with connection(url) as websocket:
            # Deliberately bypass client text encoding to exercise server validation.
            websocket.transport.write(Frame(Opcode.TEXT, b"\xff").serialize(mask=True))
            await expect_close(websocket, 1007)
    asyncio.run(exercise())


def test_real_abrupt_disconnect_and_two_independent_clients(live_server):
    url, process, _ = live_server

    async def exercise():
        async with connection(url) as first, connection(url) as second:
            await asyncio.gather(first.send("first"), second.send("second"))
            assert await asyncio.gather(first.recv(), second.recv()) == ["first", "second"]
            first.transport.abort()
            await asyncio.wait_for(first.wait_closed(), 2)
            await second.send("survives peer abort")
            assert await asyncio.wait_for(second.recv(), 2) == "survives peer abort"
        async with connection(url) as replacement:
            await replacement.send("reconnect")
            assert await asyncio.wait_for(replacement.recv(), 2) == "reconnect"
    async def bounded():
        await asyncio.wait_for(exercise(), 8)

    asyncio.run(bounded())
    assert process.poll() is None


def test_real_wrong_endpoint_denied(live_server):
    url, _, _ = live_server

    async def exercise():
        with pytest.raises(InvalidStatus) as caught:
            async with connection(url.replace("/ws/dev-echo", "/ws/unknown")):
                pass
        assert caught.value.response.status_code == 403
    asyncio.run(exercise())


def test_cli_real_exchange_and_server_rejection(live_server):
    url, _, environment = live_server
    root = Path(__file__).resolve().parents[1]
    command = [sys.executable, str(root / "scripts/ws_client.py"), "--url", url, "--timeout", "2"]
    result = subprocess.run(command, env=environment, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert "Handshake OK" in result.stdout
    assert "Echo OK" in result.stdout
    assert "Connection closed cleanly (1000)" in result.stdout
    rejected = subprocess.run(command + ["--binary"], env=environment, capture_output=True, text=True, timeout=10)
    assert rejected.returncode == 1
    assert "code 1003" in rejected.stderr


def test_client_timeout_is_bounded(monkeypatch):
    from scripts import ws_client

    class SilentConnection:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def send(self, message):
            pass

        async def recv(self):
            await asyncio.sleep(10)

    monkeypatch.setattr(ws_client, "connect", lambda *args, **kwargs: SilentConnection())
    with pytest.raises(TimeoutError):
        asyncio.run(ws_client.exchange("ws://127.0.0.1:8000/ws/dev-echo", "hello", 0.01, 4096, False))
