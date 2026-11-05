import asyncio
from io import BytesIO
import json
from pathlib import Path
import struct
import time
import wave

import pytest

from app.clients.openai_voice import OpenAISTTAdapter, OpenAITTSAdapter, WAV_FORMAT
from app.models.audio import AudioError, AudioFrame, AudioMetadata
from app.models.llm import ConversationKey
from app.models.tts import PlaybackScope, TTSConfig, TTSRequest
from app.services.audio_context import AudioContext
from app.services.audio_input import BoundedAudioInput
from app.services.gateway_rate_limit import GatewayRateLimit


def make_wav(rate=24000, frames=2400):
    output = BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(b"\x01\x00" * frames)
    return output.getvalue()


def context():
    return AudioContext(deadline=time.monotonic() + 10)


def test_openai_stt_builds_16khz_wav_in_memory_and_closes_client():
    class Transcriptions:
        calls = []
        async def create(self, **kwargs):
            self.calls.append(kwargs)
            data = kwargs["file"][1]
            with wave.open(BytesIO(data), "rb") as source:
                assert source.getframerate() == 16000
                assert source.getnchannels() == 1
                assert source.getsampwidth() == 2
            return type("Result", (), {"text": "xin chào"})()

    class Client:
        def __init__(self, **kwargs):
            self.audio = type("Audio", (), {"transcriptions": Transcriptions()})()
            self.closed = False
        async def close(self):
            self.closed = True

    clients = []
    def factory(**kwargs):
        item = Client(**kwargs)
        clients.append(item)
        return item

    async def run():
        ctx = context()
        metadata = AudioMetadata("pcm", 16000, 1, 60, "s16le")
        audio = BoundedAudioInput(metadata, ctx, max_frames=2, max_bytes=4096)
        audio.feed(AudioFrame(b"\x00\x00" * 960), metadata=metadata)
        audio.finish()
        adapter = OpenAISTTAdapter(api_key="fixture-secret", model="gpt-transcribe", client_factory=factory)
        results = [item async for item in adapter.transcribe(audio, ctx)]
        assert [(item.text, item.language, item.is_final) for item in results] == [("xin chào", "vi", True)]
        assert clients[0].audio.transcriptions.calls[0]["model"] == "gpt-transcribe"
        assert clients[0].closed
        assert "fixture-secret" not in repr(adapter)
    asyncio.run(run())


def test_openai_stt_rejects_wrong_audio_profile_without_provider_call():
    async def run():
        metadata = AudioMetadata("opus", 16000, 1, 60)
        audio = BoundedAudioInput(metadata, context(), max_frames=1, max_bytes=128)
        adapter = OpenAISTTAdapter(api_key="fixture", model="gpt-transcribe")
        with pytest.raises(AudioError):
            await anext(adapter.transcribe(audio, context()))
    asyncio.run(run())


def test_openai_tts_returns_bounded_valid_wav_only_in_memory():
    class Speech:
        async def create(self, **kwargs):
            assert kwargs["model"] == "gpt-4o-mini-tts"
            assert kwargs["voice"] == "coral"
            assert kwargs["response_format"] == "wav"
            assert "Vietnamese" in kwargs["instructions"]
            return type("Response", (), {"content": make_wav()})()

    class Client:
        def __init__(self, **kwargs):
            self.audio = type("Audio", (), {"speech": Speech()})()
            self.closed = False
        async def close(self):
            self.closed = True

    clients = []
    def factory(**kwargs):
        item = Client(**kwargs)
        clients.append(item)
        return item

    async def run():
        key = ConversationKey("u", "s", "d")
        scope = PlaybackScope(key, "turn", "playback")
        config = TTSConfig("gpt-4o-mini-tts", "coral", "vi-VN", WAV_FORMAT)
        request = TTSRequest(scope, 0, "Xin chào.", config)
        adapter = OpenAITTSAdapter(api_key="fixture-secret", model=config.model, voice=config.voice,
                                   client_factory=factory)
        chunks = [chunk async for chunk in adapter.synthesize(request, context())]
        assert len(chunks) == 1 and chunks[0].audio_format == WAV_FORMAT
        assert chunks[0].payload.startswith(b"RIFF")
        assert clients[0].closed
        assert "fixture-secret" not in repr(adapter)
    asyncio.run(run())


def test_openai_tts_rejects_wrong_wav_sample_rate():
    class Speech:
        async def create(self, **kwargs):
            return type("Response", (), {"content": make_wav(rate=16000)})()

    class Client:
        def __init__(self, **kwargs): self.audio = type("Audio", (), {"speech": Speech()})()
        async def close(self): pass

    async def run():
        key = ConversationKey("u", "s", "d")
        request = TTSRequest(PlaybackScope(key, "t", "p"), 0, "Hi",
                             TTSConfig("model", "coral", "vi", WAV_FORMAT))
        adapter = OpenAITTSAdapter(api_key="fixture", model="model", voice="coral", client_factory=Client)
        with pytest.raises(Exception):
            await anext(adapter.synthesize(request, context()))
    asyncio.run(run())


def test_gateway_limit_is_12_in_a_sliding_minute_and_not_user_metadata():
    now = [100.0]
    limiter = GatewayRateLimit(clock=lambda: now[0])
    for _ in range(12):
        assert limiter.claim("credential-principal")
    assert not limiter.claim("credential-principal")
    now[0] += 60
    assert limiter.claim("credential-principal")


def test_robot_gateway_selects_openai_without_calling_provider_or_mock_auth(monkeypatch):
    from fastapi.testclient import TestClient
    import app.api.robot_websocket as gateway
    from app.main import create_app

    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "development-mock")
    monkeypatch.setenv("AI_SERVER_ROBOT_ENABLED", "true")
    monkeypatch.setenv("AI_SERVER_ROBOT_AI_MODE", "openai")
    monkeypatch.setenv("AI_SERVER_ROBOT_TOKEN", "fixture-gateway-token-12345678901234567890")
    monkeypatch.setenv("AI_SERVER_ROBOT_ALLOWED_NETWORKS", '["127.0.0.0/8"]')
    monkeypatch.setenv("AI_SERVER_ROBOT_ENERGY_THRESHOLD", "100")
    monkeypatch.setenv("AI_SERVER_LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "fixture-openai-key-not-live")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-6-luna")

    class Codec:
        def __init__(self, *_): pass
        def close(self): pass

    monkeypatch.setattr(gateway, "OpusCodec", Codec)
    headers = {
        "Authorization": "Bearer fixture-gateway-token-12345678901234567890",
        "Protocol-Version": "1", "Device-Id": "sd2-test", "Client-Id": "sd2-client",
    }
    hello = {
        "type": "hello", "version": 1, "transport": "websocket",
        "features": {"aiva_half_duplex_v1": True},
        "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60},
    }
    with TestClient(create_app(), client=("127.0.0.1", 1234)) as client:
        with client.websocket_connect("/ws/dev-robot", headers=headers) as ws:
            ws.send_json(hello)
            response = ws.receive_json()
            assert response["type"] == "hello"
            assert response["session_id"]
            assert response["audio_params"]["format"] == "opus"
            ws.send_json({"type": "abort", "session_id": response["session_id"]})
            assert ws.receive()["type"] == "websocket.close"


def test_openai_selected_robot_session_audio_path_and_history_with_host_fixtures(monkeypatch):
    """Exercise Opus -> STT -> streaming LLM -> TTS -> paced Opus on a host."""
    from fastapi.testclient import TestClient
    import app.api.robot_websocket as gateway
    import app.clients.openai_voice as openai_voice
    import app.clients.provider_factory as provider_factory
    from app.core.config import get_settings
    from app.main import create_app
    from app.models.audio import AudioFrame, TranscriptionResult
    from app.models.llm import ProviderDelta, ProviderDone, Usage
    from app.models.tts import TTSAudioChunk
    from app.protocol.audio_framing import FramingConfig, encode_audio_frame, validate_audio_frame
    from app.services.opus_codec import OpusCodec
    from app.services.robot_transport import OPUS_FORMAT

    # conftest discovers native Opus from the active venv, including external venvs.
    from app.core.config import Settings
    opus_path = Settings(_env_file=None).opus_library
    opus_dll = Path(opus_path) if opus_path else None
    if opus_dll is None or not opus_dll.is_file():
        pytest.skip("The test environment has no native libopus DLL")
    monkeypatch.setenv("AI_SERVER_OPUS_LIBRARY", str(opus_dll))
    get_settings.cache_clear()

    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "development-mock")
    monkeypatch.setenv("AI_SERVER_ROBOT_ENABLED", "true")
    monkeypatch.setenv("AI_SERVER_ROBOT_AI_MODE", "openai")
    monkeypatch.setenv("AI_SERVER_ROBOT_TOKEN", "fixture-gateway-token-12345678901234567890")
    monkeypatch.setenv("AI_SERVER_ROBOT_ALLOWED_NETWORKS", '["127.0.0.0/8"]')
    monkeypatch.setenv("AI_SERVER_ROBOT_ENERGY_THRESHOLD", "100")
    monkeypatch.setenv("AI_SERVER_LLM_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "fixture-openai-key-not-live")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-6-luna")

    class STT:
        async def transcribe(self, audio, ctx):
            frames = 0
            while await audio.read() is not None:
                frames += 1
            assert frames > 0
            yield TranscriptionResult("xin chào", True, "vi")

    class LLM:
        def __init__(self): self.requests = []
        async def stream(self, request, ctx):
            self.requests.append(request)
            yield ProviderDelta("Xin chào, tôi nghe rõ.")
            yield ProviderDone(True, "completed", Usage(3, 4, 7))

    class TTS:
        model, voice = "gpt-4o-mini-tts", "coral"
        async def synthesize(self, request, ctx):
            yield TTSAudioChunk(0, make_wav(frames=4800), openai_voice.WAV_FORMAT)

    llm = LLM()
    monkeypatch.setattr(openai_voice, "OpenAISTTAdapter", lambda **_: STT())
    monkeypatch.setattr(openai_voice, "OpenAITTSAdapter", lambda **_: TTS())
    monkeypatch.setattr(provider_factory, "create_llm_adapter", lambda _: (llm, "gpt-6-luna"))
    token = "fixture-gateway-token-12345678901234567890"
    headers = {"Authorization": "Bearer " + token, "Protocol-Version": "1",
               "Device-Id": "sd2-test", "Client-Id": "sd2-client"}
    hello = {"type": "hello", "version": 1, "transport": "websocket",
             "features": {"aiva_half_duplex_v1": True},
             "audio_params": {"format": "opus", "sample_rate": 16000, "channels": 1, "frame_duration": 60}}

    def exchange_turn(ws, session, mic_codec):
        ws.send_json({"type": "listen", "state": "start", "mode": "manual", "session_id": session})
        pcm = struct.pack("<960h", *([4000] * 960))
        ws.send_bytes(encode_audio_frame(AudioFrame(mic_codec.encode(pcm), 0), FramingConfig(1, 4096)))
        ws.send_json({"type": "listen", "state": "stop", "session_id": session})
        start = ws.receive_json()
        assert start["type"] == "tts" and start["state"] == "start"
        proof = {key: start[key] for key in ("session_id", "turn_id", "playback_id")}
        ws.send_json(proof | {"type": "playback", "state": "ready", "audio_chunks": 0})
        speaker_codec = OpusCodec(16000, 60)
        count = 0
        try:
            while True:
                message = ws.receive()
                if message.get("bytes") is not None:
                    packet = validate_audio_frame(message["bytes"], FramingConfig(1, 1275))
                    assert len(speaker_codec.decode(packet.payload)) == 1920
                    count += 1
                    continue
                stop = json.loads(message["text"])
                assert stop["state"] == "stop" and stop["audio_chunks"] == count == 4
                break
        finally:
            speaker_codec.close()
        ws.send_json(proof | {"type": "playback", "state": "complete", "audio_chunks": count})

    with TestClient(create_app(), client=("127.0.0.1", 1234)) as client:
        with client.websocket_connect("/ws/dev-robot", headers=headers) as ws:
            ws.send_json(hello)
            session = ws.receive_json()["session_id"]
            mic_codec = OpusCodec(16000, 60)
            try:
                exchange_turn(ws, session, mic_codec)
                exchange_turn(ws, session, mic_codec)
            finally:
                mic_codec.close()
            assert len(llm.requests) == 2
            assert llm.requests[0].history == ()
            assert [(m.role, m.text) for m in llm.requests[1].history] == [
                ("user", "xin chào"), ("assistant", "Xin chào, tôi nghe rõ."),
            ]
            ws.send_json({"type": "abort", "session_id": session})
            assert ws.receive()["type"] == "websocket.close"
