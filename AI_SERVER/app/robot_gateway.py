"""Funnel-only ASGI entrypoint. No general reverse proxy or forwarded-header trust."""
import asyncio
import ipaddress
import logging
import time

import httpx
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed

from app.models.backend import DeviceProof
from app.services.audio_context import AudioContext
from app.services.device_auth import authorize_device
from app.core.logging import get_logger, log_event

PUBLIC_HOST = "desktop-m27leua.tail022082.ts.net"
PUBLIC_ORIGIN = "https://" + PUBLIC_HOST
logger = get_logger("gateway")


class RobotGateway:
    def __init__(self, application, *, authorization_ready=True):
        self.application = application
        self.authorization_ready = authorization_ready

    async def __call__(self, scope, receive, send):
        kind = scope["type"]
        if kind == "lifespan":
            return await self.application(scope, receive, send)
        if kind not in ("http", "websocket"):
            return
        path = scope.get("raw_path", b"").split(b"?", 1)[0]
        expected = b"/xiaozhi/ota/" if kind == "http" else b"/ws/robot"
        hosts = [v for k, v in scope["headers"] if k.lower() == b"host"]
        try:
            local = ipaddress.ip_address(scope["client"][0]).is_loopback
        except (ValueError, TypeError, KeyError):
            local = False
        allowed = (local and hosts == [PUBLIC_HOST.encode()] and path == expected
                   and scope.get("path") == expected.decode()
                   and not scope.get("query_string")
                   and (kind == "websocket" or scope.get("method") == "POST"))
        if not allowed or not self.authorization_ready:
            log_event(logger, logging.WARNING, "gateway.request.denied", "Gateway request denied", stage=kind, error_code="NOT_ALLOWED" if not allowed else "AUTH_UNAVAILABLE")
            if kind == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                await send({"type": "http.response.start", "status": 503 if allowed else 404,
                            "headers": [(b"cache-control", b"no-store")]})
                await send({"type": "http.response.body", "body":
                            b"Device authorization unavailable" if allowed else b"Not found"})
            return
        if kind == "websocket":
            try:
                provider = await self._provider(scope)
            except Exception:
                log_event(logger, logging.WARNING, "gateway.route.denied",
                          "Gateway could not resolve an authenticated route",
                          stage="websocket", error_code="ROUTE_UNAVAILABLE")
                await send({"type": "websocket.close", "code": 1013})
                return
            if provider == "LOCAL":
                await self._proxy_local(scope, receive, send)
                return
            if provider != "GEMINI":
                await send({"type": "websocket.close", "code": 1008})
                return
        # TLS ends at tailscaled. This assertion applies only to the dedicated
        # loopback listener; X-Forwarded-* never controls identity or scheme.
        secured = dict(scope, scheme="wss" if kind == "websocket" else "https")
        secured["headers"] = [(k, v) for k, v in scope["headers"]
                              if not k.lower().startswith(b"x-forwarded-")
                              and k.lower() != b"forwarded"]
        log_event(logger, logging.INFO, "gateway.upstream.forward", "Gateway forwarding request upstream", stage=kind)
        async def logged_send(message):
            if message.get("type") == "http.response.start":
                log_event(logger, logging.INFO if message.get("status", 500) < 400 else logging.WARNING,
                          "gateway.ota.response", "Gateway OTA response", http_status=message.get("status"), stage="ota")
            elif message.get("type") == "websocket.accept":
                log_event(logger, logging.INFO, "gateway.wss.accepted", "Gateway WSS handshake accepted", stage="websocket")
            elif message.get("type") == "websocket.close":
                log_event(logger, logging.INFO, "gateway.wss.closed", "Gateway WSS closed", close_code=message.get("code"), stage="websocket")
            await send(message)
        return await self.application(secured, receive, logged_send)

    async def _provider(self, scope) -> str:
        values = {}
        for name in (b"device-uid", b"device-credential"):
            found = [value.decode("utf-8") for key, value in scope["headers"]
                     if key.lower() == name]
            if len(found) != 1:
                raise ValueError("Device proof required")
            values[name] = found[0]
        state = self.application.state
        context = AudioContext(deadline=time.monotonic() + state.backend_settings.timeout_seconds)
        session = await authorize_device(state.backend_client,
            DeviceProof(deviceUid=values[b"device-uid"],
                        credential=values[b"device-credential"]), context)
        try:
            provider_id, model_id = state.gateway_routing.target_for(values[b"device-uid"])
            await session.resolve(context, provider_id=provider_id, model_id=model_id)
            return session.config.provider.code
        finally:
            await session.invalidate()

    async def _proxy_local(self, scope, receive, send):
        try:
            async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
                ready = await client.get("http://127.0.0.1:8002/ready")
                body = ready.json() if ready.status_code == 200 else {}
                if (ready.status_code != 200 or body.get("runtime") != "local"
                        or body.get("voice") != "READY"):
                    raise RuntimeError("Local voice not ready")
            first = await receive()
            if first.get("type") != "websocket.connect":
                return
            forwarded = [(key.decode("latin-1"), value.decode("latin-1"))
                         for key, value in scope["headers"]
                         if key.lower() in (b"device-uid", b"device-credential",
                                            b"protocol-version", b"device-id", b"client-id")]
            async with connect("ws://127.0.0.1:8002/ws/robot",
                    additional_headers=forwarded, proxy=None, compression=None,
                    max_size=4096, max_queue=16, ping_interval=20, ping_timeout=20) as upstream:
                await send({"type": "websocket.accept"})

                async def to_local():
                    while True:
                        event = await receive()
                        if event["type"] == "websocket.disconnect":
                            await upstream.close(code=event.get("code", 1000))
                            return
                        if event.get("bytes") is not None:
                            await upstream.send(event["bytes"])
                        elif event.get("text") is not None:
                            await upstream.send(event["text"])

                async def to_robot():
                    try:
                        async for message in upstream:
                            await send({"type": "websocket.send",
                                        "bytes": message if isinstance(message, bytes) else None,
                                        "text": message if isinstance(message, str) else None})
                    except ConnectionClosed as closed:
                        await send({"type": "websocket.close", "code": closed.code,
                                    "reason": closed.reason})

                tasks = [asyncio.create_task(to_local()), asyncio.create_task(to_robot())]
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                await asyncio.gather(*done, *pending, return_exceptions=True)
        except Exception as error:
            log_event(logger, logging.WARNING, "gateway.local_proxy.failed",
                      "Gateway Local proxy failed", stage="websocket",
                      error_type=type(error).__name__)
            await send({"type": "websocket.close", "code": 1013})


def create_gateway():
    from app.main import create_app
    from app.core.lan_config import LanSettings
    application = create_app()
    application.state.lan_settings = LanSettings(public_origin=PUBLIC_ORIGIN)
    ready = application.state.backend_settings.mode == "integrated"
    if not ready:
        import logging
        logging.getLogger(__name__).warning(
            "Public robot authorization unavailable: integrated Backend configuration required")
    return RobotGateway(application, authorization_ready=ready)
