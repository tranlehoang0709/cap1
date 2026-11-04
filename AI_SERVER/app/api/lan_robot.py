"""Authenticated LAN control plane. Media remains closed until contract readiness."""
import asyncio
import time
from uuid import uuid4
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from app.api.robot_websocket import parse_message, framing_header, validate_timestamp_order
from app.api.xiaozhi_ota import device_proof
from app.clients.backend import BackendError
from app.models.backend import Telemetry
from app.services.audio_context import AudioContext
from app.services.device_auth import authorize_device
from app.services.live_robot import create_live_robot
from app.services.orchestrator import Control, SessionState
from app.models.audio import AudioFrame
from app.protocol.audio_framing import FramingConfig, validate_audio_frame
from app.services.opus_codec import CodecError

router = APIRouter()
AUDIO_PARAMS = {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60}
HELLO_TIMEOUT_SECONDS = 5
IDLE_TIMEOUT_SECONDS = 45


@router.websocket("/ws/robot")
async def robot(ws: WebSocket):
    if ws.scope.get("scheme") != "wss":
        await ws.close(1008)
        return
    state = ws.app.state
    if state.backend_settings.mode == "development-mock":
        if (not state.robot_settings.enabled or state.robot_settings.ai_mode != "gemini"
            or not state.robot_settings.local_device_credentials):
            await ws.close(1008)
            return
        from app.api.robot_websocket import robot_endpoint
        await robot_endpoint(ws)
        return
    if state.backend_settings.mode != "integrated" or state.backend_client is None:
        await ws.close(1008)
        return
    session = None
    codec = orch = None
    acquired = False
    def context():
        return AudioContext(deadline=time.monotonic() + state.backend_settings.timeout_seconds)
    try:
        proof = device_proof(ws.headers)
        versions = ws.headers.getlist("protocol-version")
        if len(versions) != 1 or versions[0] not in ("1", "2", "3"):
            raise ValueError("Explicit protocol version required")
        if state.robot_slots.locked():
            await ws.close(1013)
            return
        await state.robot_slots.acquire()
        acquired = True
        session = await authorize_device(state.backend_client, proof, context())
        await session.resolve(context(), include_credential=True)
        initial_config = session.config
        await ws.accept()
        incoming = await asyncio.wait_for(ws.receive(), HELLO_TIMEOUT_SECONDS)
        text = incoming.get("text")
        if not isinstance(text, str) or len(text.encode()) > 4096:
            raise ValueError("Bounded text hello required")
        hello = parse_message(text)
        version = int(versions[0])
        if (hello.get("type") != "hello" or hello.get("transport") != "websocket"
                or type(hello.get("version")) is not int or hello["version"] != version
                or hello.get("audio_params") != AUDIO_PARAMS
                or any(type(hello["audio_params"].get(key)) is not int for key in ("sample_rate", "channels", "frame_duration"))
                or not isinstance(hello.get("features"), dict)
                or hello["features"].get("aiva_half_duplex_v1") is not True
                or hello["features"].get("aiva_lan_v1") is not True):
            raise ValueError("Unsupported hello")
        session_id = uuid4().hex
        orch, codec, llm, output = create_live_robot(state, ws, session, session_id, version)
        framing = FramingConfig(version, 4096-framing_header(version))
        last_timestamp = None
        await ws.send_json({"type": "hello", "version": version, "transport": "websocket",
            "session_id": session_id, "features": {"aiva_half_duplex_v1": True, "aiva_lan_v1": True},
            "audio_params": AUDIO_PARAMS})
        # Ping/Pong is transport liveness, not device presence. Only direct
        # heartbeat events invoke BE and revalidate the credential/owner.
        last_received = time.monotonic()
        while True:
            if orch.state in (SessionState.ERROR, SessionState.CLOSED):
                if orch.turn is not None:
                    await ws.send_json({"type": "status", "state": "failed",
                        "session_id": session_id, "turn_id": orch.turn.turn_id})
                await ws.send_json({'type':'error','session_id':session_id,'code':'AI_TURN_FAILED'})
                await ws.close(1013)
                return
            try:
                message = await asyncio.wait_for(ws.receive(), min(1, IDLE_TIMEOUT_SECONDS))
            except TimeoutError:
                if time.monotonic()-last_received >= IDLE_TIMEOUT_SECONDS:
                    raise
                continue
            last_received = time.monotonic()
            if message["type"] == "websocket.disconnect":
                return
            text = message.get("text")
            if message.get('bytes') is not None:
                if orch.turn is None:
                    raise ValueError('Audio before admission')
                if not orch.accepting_input:
                    continue
                frame = validate_audio_frame(message['bytes'], framing)
                last_timestamp = validate_timestamp_order(version, frame, last_timestamp)
                session.microphone(orch.turn.turn_id, AudioFrame(codec.decode(frame.payload)))
                continue
            if not isinstance(text, str) or len(text.encode()) > 4096:
                raise ValueError("Audio cannot precede admission")
            event = parse_message(text)
            if event.get("session_id") != session_id:
                raise ValueError("Wrong session")
            if event.get("type") == "heartbeat":
                telemetry = Telemetry.model_validate(event["telemetry"]) if "telemetry" in event else None
                result = await session.heartbeat_received(context(), telemetry=telemetry)
                await ws.send_json({"type": "heartbeat", "session_id": session_id, "accepted": result.accepted})
            elif event.get("type") == "listen" and event.get("state") == "start":
                if event.get('mode') != 'manual':
                    raise ValueError('Explicit stop boundary required')
                if orch.task is not None and output.complete.is_set():
                    await orch.task
                if orch.state != SessionState.LISTENING or (orch.task is not None and not orch.task.done()):
                    raise ValueError('Busy turn')
                await session.resolve(context(), include_credential=True)
                if session.config != initial_config:
                    raise ValueError('Configuration changed; reconnect required')
                turn_id = uuid4().hex
                await llm.prepare(turn_id, context())
                session.start_turn(turn_id)
                await ws.send_json({"type": "status", "state": "listening",
                    "session_id": session_id, "turn_id": turn_id})
                last_timestamp = None
            elif event.get('type') == 'listen' and event.get('state') == 'stop':
                if orch.turn is not None and orch.stop_input(orch.turn.turn_id):
                    await ws.send_json({"type": "status", "state": "processing",
                        "session_id": session_id, "turn_id": orch.turn.turn_id})
            elif event.get('type') == 'playback':
                output.acknowledge(event)
                if event.get('state') == 'complete' and orch.task is not None:
                    await orch.task
                    await ws.send_json({"type": "status", "state": "complete",
                        "session_id": session_id, "turn_id": event.get("turn_id")})
            elif event.get('type') == 'abort':
                turn_id = event.get('turn_id')
                if not isinstance(turn_id, str) or not turn_id:
                    raise ValueError("Turn-scoped abort required")
                accepted = await orch.control(Control.ABORT, key=orch.key, turn_id=turn_id)
                await ws.send_json({"type": "status", "state": "cancelled" if accepted else "abort_ignored",
                    "session_id": session_id, "turn_id": turn_id})
            else:
                raise ValueError("Unsupported control")
    except WebSocketDisconnect:
        pass
    except BackendError as error:
        await ws.close(1013 if error.status is None or error.status >= 500 or error.status == 429 else 1008)
    except (ValueError, ValidationError, TimeoutError, CodecError):
        await ws.close(1008)
    except Exception:
        await ws.close(1011)
    finally:
        import anyio
        try:
            with anyio.CancelScope(shield=True):
                if session is not None:
                    await session.invalidate()
        finally:
            if codec is not None:
                codec.close()
            if acquired:
                state.robot_slots.release()
