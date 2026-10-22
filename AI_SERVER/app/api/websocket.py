"""Local Development echo transport. This is not the Xiaozhi protocol."""

from ipaddress import ip_address
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

router = APIRouter()
logger = logging.getLogger("ai_server")


@router.websocket("/ws/dev-echo")
async def websocket_endpoint(websocket: WebSocket) -> None:
    close_code = 1000
    close_reason = ""
    peer_disconnected = False
    try:
        try:
            is_local = websocket.client is not None and ip_address(websocket.client.host).is_loopback
        except ValueError:
            is_local = False
        if not is_local:
            # Before accept(), this becomes HTTP 403 rather than a WS close frame.
            await websocket.close(code=1008)
            return

        await websocket.accept()
        limit = websocket.app.state.settings.ws_max_message_bytes
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            # Transport assembles fragments and validates UTF-8 before ASGI delivery.
            if message.get("bytes") is not None:
                close_code, close_reason = 1003, "Binary messages are unsupported"
                return
            text = message.get("text")
            if not text:
                close_code, close_reason = 1008, "Text must not be empty"
                return
            if len(text.encode("utf-8")) > limit:
                close_code, close_reason = 1009, "Message exceeds byte limit"
                return
            await websocket.send_text(text)
    except WebSocketDisconnect:
        # Includes failed sends after a TCP disconnect. No further data is sent.
        peer_disconnected = True
    except Exception:
        # Never log payloads, headers, exception text or tokens.
        logger.error("Development WebSocket handler failed")
        close_code, close_reason = 1011, "Internal transport error"
    finally:
        # The connection is the only handler-owned resource: no session/tasks/queues.
        if (
            not peer_disconnected
            and websocket.application_state == WebSocketState.CONNECTED
            and websocket.client_state == WebSocketState.CONNECTED
        ):
            try:
                await websocket.close(code=close_code, reason=close_reason)
            except (WebSocketDisconnect, OSError, RuntimeError):
                pass
