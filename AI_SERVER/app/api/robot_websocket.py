"""OFF by default, private development-only Xiaozhi gateway. Backend DEFERRED."""

import asyncio
import anyio
import hashlib
import hmac
import ipaddress
import json
import math
import struct
import time
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models.audio import AudioError, AudioFrame
from app.models.llm import ConversationKey, ProviderDelta, ProviderDone
from app.models.tts import PlaybackLimits, TTSConfig
from app.models.backend import DeviceProof
from app.protocol.audio_framing import FramingConfig, validate_audio_frame
from app.services.mock_llm import MockLLMAdapter
from app.services.mock_stt import MockStreamingSTT
from app.services.mock_tts import MockTTS
from app.services.opus_codec import CodecError, OpusCodec
from app.services.orchestrator import AIOrchestrator, Control, OrchestrationLimits, SessionState
from app.services.robot_transport import WavOpusTTSAdapter, OPUS_FORMAT, PCM_FORMAT, OpusTTSAdapter, RobotAudioOutput
from app.services.turn_detection import TextRules, TurnDetectionConfig
from app.services.audio_context import AudioContext
from app.services.device_auth import authorize_device, validate_local_device_credential
from app.clients.backend import BackendError
from pydantic import ValidationError

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


def validate_timestamp_order(version, frame, previous):
    """Check v2 sender-clock ordering while allowing uint32 millisecond wrap."""
    if version != 2:
        return previous
    current = frame.timestamp_ms
    if type(current) is not int or not 0 <= current <= 0xffffffff:
        raise ValueError("Invalid audio timestamp")
    if previous is not None:
        delta = (current - previous) & 0xffffffff
        if delta == 0 or delta >= 0x80000000:
            raise ValueError("Out-of-order audio timestamp")
    return current


@router.websocket("/ws/dev-robot")
async def robot_endpoint(ws: WebSocket):
    if ws.app.state.backend_settings.mode == "integrated":
        # Authenticate and resolve policy before accepting or reading any audio.
        # No mock fallback is reachable in this branch.
        client = ws.app.state.backend_client
        uids, credentials = ws.headers.getlist("device-uid"), ws.headers.getlist("device-credential")
        if client is None or len(uids) != 1 or len(credentials) != 1:
            await ws.close(code=1008)
            return
        context = AudioContext(deadline=time.monotonic() + ws.app.state.backend_settings.timeout_seconds)
        try:
            proof = DeviceProof(deviceUid=uids[0], credential=credentials[0])
            session = await authorize_device(client, proof, context)
            await session.resolve(context)
        except ValidationError:
            await ws.close(code=1008)
            return
        except BackendError as error:
            # Do not disclose Backend response bodies, credential details, or policy data.
            await ws.close(code=1013 if error.status == 429 or error.status is None or error.status >= 500 else 1008)
            return
        await ws.accept()
        await ws.send_json({"type": "error", "code": "AI_PIPELINE_UNAVAILABLE"})
        await ws.close(code=1013, reason="AI media pipeline is not configured")
        return
    settings = ws.app.state.robot_settings
    try:
        peer = ipaddress.ip_address(ws.client.host)
        permitted = any(peer in ipaddress.ip_network(n) for n in settings.allowed_networks)
    except (ValueError, AttributeError):
        permitted = False
    standalone_lan = ws.url.path == "/ws/robot" and ws.app.state.backend_settings.mode == "development-mock"
    if standalone_lan:
        uids, credentials = ws.headers.getlist("device-uid"), ws.headers.getlist("device-credential")
        if (ws.scope.get("scheme") != "wss" or len(uids) != 1 or len(credentials) != 1
            or not validate_local_device_credential(settings.local_device_credentials, uids[0], credentials[0])):
            await ws.close(code=1008)
            return
        local_principal = hashlib.sha256((uids[0] + ":" + credentials[0]).encode("utf-8")).hexdigest()
        local_device_uid = uids[0]
    else:
        auth = ws.headers.getlist("authorization")
        expected = "Bearer " + (settings.token.get_secret_value() if settings.token else "")
        if len(auth) != 1 or not hmac.compare_digest(auth[0].encode(), expected.encode()):
            await ws.close(code=1008)
            return
        local_principal = hashlib.sha256(auth[0].encode("utf-8")).hexdigest()
        local_device_uid = None
    if (not settings.enabled or not permitted or ws.app.state.robot_slots.locked()):
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
        def energy(frame):
            samples = struct.unpack("<960h", frame.payload)
            return sum(v*v for v in samples) / len(samples) > settings.energy_threshold ** 2
        if settings.ai_mode == "gemini":
            if ws.app.state.backend_settings.mode != "development-mock":
                raise ValueError("Gemini robot runtime requires explicit development-mock Backend mode")
            from app.clients.provider_factory import create_llm_adapter
            from app.clients.stt_factory import create_gemini_stt_adapter
            from app.clients.tts_factory import create_gemini_tts_adapter
            from app.clients.gemini_tts import WAV_FORMAT
            from app.core.llm_config import LLMSettings
            from app.core.provider_config import LLMProviderSettings
            from app.core.stt_config import GeminiSTTSettings
            from app.core.tts_config import GeminiTTSSettings
            from app.services.llm import LLMRunner
            from app.services.voice_response_policy import voice_system_prompt

            provider = LLMProviderSettings()
            if provider.provider != "gemini":
                raise ValueError("Explicit Gemini provider required; no fallback")
            stt_settings, tts_settings = GeminiSTTSettings(), GeminiTTSSettings()
            stt = create_gemini_stt_adapter(stt_settings)
            llm, llm_model = create_llm_adapter(provider)
            tts = create_gemini_tts_adapter(tts_settings)
            llm_settings = LLMSettings(model=llm_model)
            source_tts_config = TTSConfig(tts.model, tts.voice, "vi-VN", WAV_FORMAT)
            runtime_tts = WavOpusTTSAdapter(tts, source_tts_config,
                                               max_wav_bytes=settings.max_output_audio_bytes)
            max_frames = (settings.max_turn_duration_ms + 59) // 60
            runtime_limits = OrchestrationLimits(settings.deadline_seconds, .02, max_frames,
                max_frames * 1920, 16, 16000)
            orch = AIOrchestrator(
                ConversationKey(f"local-gateway:{local_principal}", session_id, local_device_uid or ws.headers["device-id"]),
                stt=stt, llm=llm, tts=runtime_tts, output=output,
                llm_runner=LLMRunner(llm_settings), input_metadata=PCM_FORMAT.metadata,
                turn_config=TurnDetectionConfig(settings.min_silence_ms, settings.transcript_stability_ms,
                                                settings.max_turn_duration_ms),
                language_rules=TextRules((".", "?", "!"), ("...", "và", "nhưng", "ừm")),
                speech_activity=energy, tts_config=TTSConfig(tts.model, tts.voice, "vi-VN", OPUS_FORMAT),
                playback_limits=PlaybackLimits(2, 4096, 1275, 8, 500, 16), limits=runtime_limits,
                system_prompt=voice_system_prompt("AIVA voice assistant."),
                defer_stt_until_input_complete=True)
        elif settings.ai_mode == "openai":
            if ws.app.state.backend_settings.mode != "development-mock":
                raise ValueError("OpenAI robot runtime requires explicit local development mode")
            from app.clients.openai_voice import OpenAISTTAdapter, OpenAITTSAdapter, WAV_FORMAT
            from app.clients.provider_factory import create_llm_adapter
            from app.core.llm_config import LLMSettings
            from app.core.openai_audio_config import OpenAIAudioSettings
            from app.core.provider_config import LLMProviderSettings
            from app.services.llm import LLMRunner
            from app.services.voice_response_policy import voice_system_prompt

            provider = LLMProviderSettings()
            if provider.provider != "openai" or provider.openai_api_key is None:
                raise ValueError("Explicit OpenAI provider and server API key required")
            api_key = provider.openai_api_key.get_secret_value()
            audio_settings = OpenAIAudioSettings()
            stt = OpenAISTTAdapter(api_key=api_key, model=audio_settings.stt_model,
                max_audio_bytes=audio_settings.max_audio_bytes,
                max_duration_seconds=settings.max_turn_duration_ms / 1000,
                timeout_seconds=audio_settings.timeout_seconds)
            llm, llm_model = create_llm_adapter(provider)
            tts = OpenAITTSAdapter(api_key=api_key, model=audio_settings.tts_model,
                voice=audio_settings.tts_voice, max_audio_bytes=audio_settings.max_output_audio_bytes,
                timeout_seconds=audio_settings.timeout_seconds)
            llm_settings = LLMSettings(model=llm_model)
            source_tts_config = TTSConfig(tts.model, tts.voice, "vi-VN", WAV_FORMAT)
            runtime_tts = WavOpusTTSAdapter(tts, source_tts_config,
                max_wav_bytes=settings.max_output_audio_bytes)
            max_frames = (settings.max_turn_duration_ms + 59) // 60
            runtime_limits = OrchestrationLimits(settings.deadline_seconds, .02, max_frames,
                max_frames * 1920, 16, 16000)
            orch = AIOrchestrator(
                ConversationKey(f"local-gateway:{local_principal}", session_id, local_device_uid or ws.headers["device-id"]),
                stt=stt, llm=llm, tts=runtime_tts, output=output,
                llm_runner=LLMRunner(llm_settings), input_metadata=PCM_FORMAT.metadata,
                turn_config=TurnDetectionConfig(settings.min_silence_ms, settings.transcript_stability_ms,
                                                settings.max_turn_duration_ms),
                language_rules=TextRules((".", "?", "!"), ("...", "và", "nhưng", "ừm")),
                speech_activity=energy, tts_config=TTSConfig(tts.model, tts.voice, "vi-VN", OPUS_FORMAT),
                playback_limits=PlaybackLimits(2, 4096, 1275, 8, 500, 16), limits=runtime_limits,
                system_prompt=voice_system_prompt("AIVA voice assistant."),
                defer_stt_until_input_complete=True)
        else:
            # Mock ASR/LLM/TTS only. Tone is not synthesized speech or Cloud success.
            pcm = struct.pack("<960h", *(int(3000 * math.sin(2 * math.pi * 440 * i / 16000)) for i in range(960)))
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
        features = {"aiva_half_duplex_v1": True}
        if standalone_lan:
            features["aiva_lan_v1"] = True
        await output.json({"type": "hello", "version": version, "transport": "websocket", "session_id": session_id,
            "features": features,
            "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60}})
        framing = FramingConfig(version, 4096 - framing_header(version))
        last_audio_timestamp = None
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
                last_audio_timestamp = validate_timestamp_order(version, audio, last_audio_timestamp)
                orch.microphone(orch.turn.turn_id, AudioFrame(codec.decode(audio.payload)))
                continue
            control = parse_message(message.get("text", ""))
            if control.get("session_id") != session_id:
                raise ValueError("Wrong session")
            kind = control.get("type")
            if kind == "heartbeat":
                await ws.send_json({"type": "heartbeat", "session_id": session_id, "accepted": True})
            elif kind == "playback":
                output.acknowledge(control)
            elif kind == "listen" and control.get("state") == "start":
                if control.get("mode") not in ("auto", "manual"):
                    raise ValueError("Realtime/barge-in disabled")
                if settings.ai_mode != "mock" and control.get("mode") != "manual":
                    raise ValueError("Cloud voice runtime requires an explicit listen.stop boundary")
                if settings.ai_mode != "mock" and not ws.app.state.robot_rate_limit.claim(local_principal):
                    await ws.send_json({"type": "error", "code": "RATE_LIMITED"})
                    await ws.close(code=1013, reason="Local gateway turn limit exceeded")
                    return
                if orch.task is not None and output.complete.is_set():
                    await orch.task
                if orch.state != SessionState.LISTENING or (orch.task is not None and not orch.task.done()):
                    raise ValueError("Busy turn")
                turn_id = uuid4().hex
                orch.start_turn(turn_id)
                last_audio_timestamp = None
                if standalone_lan:
                    # The LAN firmware gates microphone transmission on this
                    # scoped admission ACK. Without it the UI shows listening
                    # while the device sends no audio frames.
                    await ws.send_json({"type": "status", "state": "listening",
                        "session_id": session_id, "turn_id": turn_id})
            elif kind == "listen" and control.get("state") == "stop":
                if orch.turn is not None:
                    turn_id = orch.turn.turn_id
                    if orch.stop_input(turn_id) and standalone_lan:
                        await ws.send_json({"type": "status", "state": "processing",
                            "session_id": session_id, "turn_id": turn_id})
            elif kind == "listen" and control.get("state") == "detect":
                pass  # Wake-word text is metadata, never a transcript/identity.
            elif kind == "abort":
                turn_id = control.get("turn_id")
                if not isinstance(turn_id, str) or not turn_id:
                    raise ValueError("Turn-scoped abort required")
                accepted = await orch.control(Control.ABORT, key=orch.key, turn_id=turn_id)
                await ws.send_json({"type": "status", "state": "cancelled" if accepted else "abort_ignored",
                    "session_id": session_id, "turn_id": turn_id})
            else:
                raise ValueError("Unsupported control")
        await ws.close(code=1000)
    except WebSocketDisconnect:
        pass
    except CodecError as error:
        try:
            await ws.send_json({"type": "error", "code": "OPUS_CODEC_UNAVAILABLE" if "libopus unavailable" in str(error) else "OPUS_CODEC_ERROR"})
            await ws.close(code=1013)
        except Exception:
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
