"""Funnel-only ASGI entrypoint. No general reverse proxy or forwarded-header trust."""
import ipaddress

PUBLIC_HOST = "desktop-m27leua.tail022082.ts.net"
PUBLIC_ORIGIN = "https://" + PUBLIC_HOST


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
            if kind == "websocket":
                await send({"type": "websocket.close", "code": 1008})
            else:
                await send({"type": "http.response.start", "status": 503 if allowed else 404,
                            "headers": [(b"cache-control", b"no-store")]})
                await send({"type": "http.response.body", "body":
                            b"Device authorization unavailable" if allowed else b"Not found"})
            return
        # TLS ends at tailscaled. This assertion applies only to the dedicated
        # loopback listener; X-Forwarded-* never controls identity or scheme.
        secured = dict(scope, scheme="wss" if kind == "websocket" else "https")
        secured["headers"] = [(k, v) for k, v in scope["headers"]
                              if not k.lower().startswith(b"x-forwarded-")
                              and k.lower() != b"forwarded"]
        return await self.application(secured, receive, send)


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
