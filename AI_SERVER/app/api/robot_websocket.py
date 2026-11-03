"""OFF by default, private development-only Xiaozhi gateway. Backend DEFERRED."""

import asyncio
import anyio
import hmac
import ipaddress
import json
import math
import struct
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models.audio import AudioError, AudioFrame
from app.models.llm import ConversationKey, ProviderDelta, ProviderDone
from app.models.tts import PlaybackLimits, TTSConfig
from app.protocol.audio_framing import FramingConfig, validate_audio_frame
from app.services.mock_llm import MockLLMAdapter
from app.services.mock_stt import MockStreamingSTT
from app.services.mock_tts import MockTTS
from app.services.opus_codec import OpusCodec
from app.services.orchestrator import AIOrchestrator, Control, OrchestrationLimits, SessionState
from app.services.robot_transport import OPUS_FORMAT, PCM_FORMAT, OpusTTSAdapter, RobotAudioOutput
from app.services.turn_detection import TextRules, TurnDetectionConfig

router = APIRouter()


def parse_message(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate key")
            result[key] = value
        return result
    result = json.loads(text, object_pairs_hook=unique)
    if not isinstance(result, dict):
        raise ValueError("JSON object required")
    return result


@router.websocket("/ws/dev-robot")
async def robot_endpoint(ws: WebSocket):
    settings = ws.app.state.robot_settings
    try:
        peer = ipaddress.ip_address(ws.client.host)
        permitted = any(peer in ipaddress.ip_network(n) for n in settings.allowed_networks)
    except (ValueError, AttributeError):
        permitted = False
    auth = ws.headers.getlist("authorization")
    expected = "Bearer " + (settings.token.get_secret_value() if settings.token else "")
    if (not settings.enabled or not permitted or len(auth) != 1
        or not hmac.compare_digest(auth[0].encode(), expected.encode()) or ws.app.state.robot_slots.locked()):
        await ws.close(code=1008)
        return
    await ws.app.state.robot_slots.acquire()
    codec = orch = None
    try:
        await ws.accept()
        versions = ws.headers.getlist("protocol-version")
        if len(versions) != 1 or versions[0] not in ("1", "2", "3"):
            raise ValueError("Explicit version required")
        version = int(versions[0])
        first = await asyncio.wait_for(ws.receive(), 5)
        if first["type"] == "websocket.disconnect":
            return
        hello_text = first.get("text")
        if not isinstance(hello_text, str):
            raise ValueError("Text hello required")
        if len(hello_text.encode("utf-8")) > 4096:
            raise ValueError("Hello too large")
        hello = parse_message(hello_text)
        if (hello.get("type") != "hello" or hello.get("transport") != "websocket"
            or type(hello.get("version")) is not int or hello["version"] != version
            or hello.get("audio_params") != {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60}
            or not isinstance(hello.get("features"), dict) or hello["features"].get("aiva_half_duplex_v1") is not True):
            raise ValueError("Unsupported hello/profile")
        # Header identifiers are metadata, NEVER Backend-authenticated identity.
        if any(len(ws.headers.getlist(n)) != 1 or not 1 <= len(ws.headers[n]) <= 128 for n in ("device-id", "client-id")):
            raise ValueError("Missing device metadata")
        session_id = uuid4().hex
        codec = OpusCodec(16000, 60)
        output = RobotAudioOutput(ws, session_id, version)
        pcm = struct.pack("<960h", *(int(3000 * math.sin(2 * math.pi * 440 * i / 16000)) for i in range(960)))
        def energy(frame):
            samples = struct.unpack("<960h", frame.payload)
            return sum(v*v for v in samples) / len(samples) > settings.energy_threshold ** 2
        # Mock ASR/LLM/TTS only. Tone is not synthesized speech or Cloud success.
        orch = AIOrchestrator(ConversationKey("local-development", session_id, uuid4().hex),
            stt=MockStreamingSTT("Xin chào."),
            llm=MockLLMAdapter((ProviderDelta("Xin chào. "), ProviderDelta("Đây là thử nghiệm."), ProviderDone(True, "completed"))),
            tts=OpusTTSAdapter(MockTTS(((pcm,), (pcm,)))), output=output, llm_runner=ws.app.state.robot_llm_runner,
            input_metadata=PCM_FORMAT.metadata, turn_config=TurnDetectionConfig(settings.min_silence_ms, settings.transcript_stability_ms, settings.max_turn_duration_ms),
            language_rules=TextRules((".", "?", "!"), ("...", "và", "nhưng", "ừm")), speech_activity=energy,
            tts_config=TTSConfig("mock-model", "mock-voice", "vi", OPUS_FORMAT),
            playback_limits=PlaybackLimits(2, 4096, 2048, 4, 500, 16),
            limits=OrchestrationLimits(settings.deadline_seconds, .02, 32, 61440, 16, 16000),
            system_prompt="Trả lời bằng tiếng Việt.")
        await output.json({"type": "hello", "version": version, "transport": "websocket", "session_id": session_id,
            "features": {"aiva_half_duplex_v1": True},
            "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60}})
        framing = FramingConfig(version, 4096 - framing_header(version))
        while True:
            if orch.state in (SessionState.ERROR, SessionState.CLOSED):
                break
            try:
                message = await asyncio.wait_for(ws.receive(), 1)
            except TimeoutError:
                continue
            if message["type"] == "websocket.disconnect":
                return
            if message.get("text") is not None and len(message["text"].encode("utf-8")) > 4096:
                raise ValueError("Control message too large")
            if message.get("bytes") is not None:
                # Drop busy mic BEFORE packet parsing/Opus decoding/VAD/STT.
                if not orch.accepting_input:
                    continue
                audio = validate_audio_frame(message["bytes"], framing)
                orch.microphone(orch.turn.turn_id, AudioFrame(codec.decode(audio.payload)))
                continue
            control = parse_message(message.get("text", ""))
            if control.get("session_id") != session_id:
                raise ValueError("Wrong session")
            kind = control.get("type")
            if kind == "playback":
                output.acknowledge(control)
            elif kind == "listen" and control.get("state") == "start":
                if control.get("mode") not in ("auto", "manual"):
                    raise ValueError("Realtime/barge-in disabled")
                if orch.task is not None and output.complete.is_set():
                    await orch.task
                if orch.state != SessionState.LISTENING or (orch.task is not None and not orch.task.done()):
                    raise ValueError("Busy turn")
                orch.start_turn(uuid4().hex)
            elif kind == "listen" and control.get("state") == "stop":
                if orch.turn is not None:
                    orch.stop_input(orch.turn.turn_id)
            elif kind == "listen" and control.get("state") == "detect":
                pass  # Wake-word text is metadata, never a transcript/identity.
            elif kind == "abort":
                if orch.turn is not None:
                    await orch.control(Control.ABORT, key=orch.key, turn_id=orch.turn.turn_id)
                break
            else:
                raise ValueError("Unsupported control")
        await ws.close(code=1000)
    except WebSocketDisconnect:
        pass
    except (AudioError, ValueError, TimeoutError):
        try:
            await ws.close(code=1008)
        except RuntimeError:
            pass
    except Exception:
        # Normalize unexpected transport/native errors without logging payloads.
        try:
            await ws.close(code=1011)
        except Exception:
            pass
    finally:
        try:
            with anyio.CancelScope(shield=True):
                if orch is not None and orch.turn is not None:
                    await orch.control(Control.DISCONNECT, key=orch.key, turn_id=orch.turn.turn_id)
        finally:
            if codec is not None:
                codec.close()
            ws.app.state.robot_slots.release()


def framing_header(version):
    return {1: 0, 2: 16, 3: 4}[version]
