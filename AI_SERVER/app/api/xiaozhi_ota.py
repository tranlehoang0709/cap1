"""Xiaozhi Ota::CheckVersion bootstrap, not an enrollment or firmware registry."""
import asyncio
import ipaddress
import time
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from app.clients.backend import BackendError
from app.models.backend import DeviceProof
from app.services.audio_context import AudioContext
from app.services.device_auth import authorize_device
from app.services.device_auth import validate_local_device_credential

router = APIRouter()


def device_proof(headers):
    values = [headers.getlist(name) for name in ("device-uid", "device-credential")]
    if any(len(items) != 1 for items in values):
        raise ValueError("Provisioned device proof required")
    return DeviceProof(deviceUid=values[0][0], credential=values[1][0])


@router.post("/xiaozhi/ota/")
async def bootstrap(request: Request):
    if request.url.scheme != "https":
        raise HTTPException(426, "HTTPS_REQUIRED")
    state = request.app.state
    if state.backend_settings.mode == "development-mock":
        robot = state.robot_settings
        try:
            peer = ipaddress.ip_address(request.client.host)
            permitted = any(peer in ipaddress.ip_network(n) for n in robot.allowed_networks)
            proof = device_proof(request.headers)
        except (ValueError, AttributeError, ValidationError):
            permitted = False
            proof = None
        if (not robot.enabled or robot.ai_mode != "gemini" or not robot.local_device_credentials
            or not permitted or proof is None
            or not validate_local_device_credential(robot.local_device_credentials,
                                                    proof.deviceUid, proof.credential)):
            raise HTTPException(403, "LOCAL_DEVICE_ACCESS_DENIED")
        try:
            websocket_url = state.lan_settings.websocket_url()
        except ValueError:
            raise HTTPException(503, "HTTPS_LAN_ORIGIN_NOT_CONFIGURED") from None
        try:
            size = 0
            async with asyncio.timeout(5):
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 16384:
                        raise HTTPException(413, "BOOTSTRAP_BODY_TOO_LARGE")
            return JSONResponse({
                "websocket": {"url": websocket_url, "version": 1},
                "server_time": {"timestamp": int(time.time() * 1000), "timezone_offset": 0},
            }, headers={"Cache-Control": "no-store"})
        except TimeoutError:
            raise HTTPException(408, "BOOTSTRAP_BODY_TIMEOUT") from None
    if state.backend_settings.mode != "integrated" or state.backend_client is None:
        raise HTTPException(503, "INTEGRATED_BACKEND_REQUIRED")
    try:
        proof = device_proof(request.headers)
    except (ValueError, ValidationError):
        raise HTTPException(401, "DEVICE_PROOF_REQUIRED") from None
    try:
        websocket_url = state.lan_settings.websocket_url()
    except ValueError:
        raise HTTPException(503, "HTTPS_LAN_ORIGIN_NOT_CONFIGURED") from None
    try:
        session = await authorize_device(state.backend_client, proof,
            AudioContext(deadline=time.monotonic() + state.backend_settings.timeout_seconds))
    except BackendError as error:
        status = 503 if error.status is None or error.status >= 500 else 403
        raise HTTPException(status, "DEVICE_AUTHORIZATION_UNAVAILABLE" if status == 503 else "DEVICE_ACCESS_DENIED") from None
    try:
        # Firmware POSTs board system info. Bound/discard it; no audio or identity
        # is persisted or inferred from MAC/Client-Id or self-declared board JSON.
        size = 0
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                size += len(chunk)
                if size > 16384:
                    raise HTTPException(413, "BOOTSTRAP_BODY_TOO_LARGE")
        # Existing NVS token and device proof are retained. No fake activation
        # code, firmware image/version, system key, or shared LAN token is issued.
        return JSONResponse({
            "websocket": {"url": websocket_url, "version": 1},
            "server_time": {"timestamp": int(time.time() * 1000), "timezone_offset": 0},
        }, headers={"Cache-Control": "no-store"})
    except TimeoutError:
        raise HTTPException(408, "BOOTSTRAP_BODY_TIMEOUT") from None
    finally:
        await session.invalidate()
