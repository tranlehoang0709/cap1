"""Local Development echo transport. This is not the Xiaozhi protocol."""

from ipaddress import ip_address
import logging
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.core.logging import get_logger, log_event

router = APIRouter()
logger = get_logger("websocket")


@router.websocket("/ws/dev-echo")
async def websocket_endpoint(websocket: WebSocket) -> None:
    connection_id = uuid4().hex
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
            log_event(
                logger, logging.WARNING, "websocket.connection_rejected", "WebSocket peer rejected",
                connection_id=connection_id, close_code=1008, reason="non-local-peer",
            )
            await websocket.close(code=1008)
            return

        await websocket.accept()
        log_event(logger, logging.INFO, "websocket.connected", "WebSocket connection accepted", connection_id=connection_id)
        limit = websocket.app.state.settings.ws_max_message_bytes
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                peer_disconnected = True
                log_event(
                    logger, logging.INFO, "websocket.disconnected", "WebSocket peer disconnected",
                    connection_id=connection_id, close_code=message.get("code", 1000),
                )
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
        log_event(logger, logging.INFO, "websocket.disconnected", "WebSocket peer disconnected", connection_id=connection_id)
    except Exception as error:
        log_event(
            logger, logging.ERROR, "websocket.error", "Unexpected WebSocket handler error",
            connection_id=connection_id, error_type=type(error).__name__, exc_info=True,
        )
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
                log_event(
                    logger,
                    logging.WARNING if close_code != 1000 else logging.INFO,
                    "websocket.closed",
                    "WebSocket closed by server",
                    connection_id=connection_id,
                    close_code=close_code,
                    reason=close_reason,
                )
            except (WebSocketDisconnect, OSError, RuntimeError):
                pass
            except Exception as error:
                log_event(
                    logger, logging.ERROR, "websocket.close_error", "WebSocket close failed",
                    connection_id=connection_id, error_type=type(error).__name__, exc_info=True,
                )
