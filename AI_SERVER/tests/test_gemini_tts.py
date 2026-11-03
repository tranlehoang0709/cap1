"""Mock-provider unit tests for Gemini TTS adapter and voice-only policy."""

import asyncio
from types import SimpleNamespace
import time
import wave
import io
import socket

import pytest

from app.clients.gemini_tts import GeminiTTSAdapter, PCM_FORMAT, WAV_FORMAT, classify_provider_error
from app.core.tts_config import GeminiTTSSettings
from app.models.audio import AudioError, ErrorCode
from app.models.llm import ConversationKey
from app.models.tts import PlaybackScope, TTSConfig, TTSRequest, TTSError, TTSErrorCode
from app.services.audio_context import AudioContext
from app.services.voice_response_policy import voice_system_prompt


def wav_data():
    result = io.BytesIO()
    with wave.open(result, "wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(24000); out.writeframes(b"\x00\x00" * 2400)
    return result.getvalue()


class Client:
    def __init__(self, *, data=None, mime="audio/wav", error=None, hang=False):
        self.data, self.mime, self.error, self.hang = data, mime, error, hang
        self.calls, self.closed, self.started = [], False, asyncio.Event()
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self.generate), aclose=self.aclose)

    async def generate(self, **kwargs):
        self.calls.append(kwargs); self.started.set()
        if self.hang:
            await asyncio.Event().wait()
        if self.error:
            raise self.error
        return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[
            SimpleNamespace(inline_data=SimpleNamespace(data=self.data, mime_type=self.mime))]))])

    async def aclose(self): self.closed = True
    def close(self): pass


def make_request(adapter, text="Tiếng Việt có dấu, số 123!"):
    key = ConversationKey("user", "session", "device")
    return TTSRequest(PlaybackScope(key, "turn", "generation"), 0, text,
                      TTSConfig(adapter.model, adapter.voice, "vi-VN", WAV_FORMAT))


def run(adapter, request, context=None):
    async def scenario():
        return [item async for item in adapter.synthesize(request, context or AudioContext(deadline=time.monotonic()+3))]
    return asyncio.run(scenario())


def test_settings_and_adapter_hide_secret_and_use_explicit_free_tier_model():
    settings = GeminiTTSSettings(_env_file=None, GEMINI_API_KEY="fixture-secret", GEMINI_TTS_MODEL="gemini-3.8-flash-tts")
    assert "fixture-secret" not in repr(settings)
    client = Client(data=wav_data())
    adapter = GeminiTTSAdapter(api_key="fixture-secret", client_factory=lambda *_: client)
    assert "fixture-secret" not in repr(adapter)
    result = run(adapter, make_request(adapter))
    assert result[0].payload.startswith(b"RIFF")
    assert client.calls[0]["model"] == "gemini-3.8-flash-tts"
    assert client.calls[0]["config"].response_modalities == ["AUDIO"] and client.closed


@pytest.mark.parametrize("data,mime", [(None, "audio/wav"), (b"not wav", "audio/wav"), (wav_data(), "audio/l16")])
def test_empty_or_invalid_audio_fails_closed(data, mime):
    adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: Client(data=data, mime=mime))
    with pytest.raises(TTSError) as error: run(adapter, make_request(adapter))
    assert error.value.code == TTSErrorCode.INVALID_AUDIO


def test_empty_input_and_wrong_format_rejected_before_cloud():
    client = Client(data=wav_data())
    adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: client)
    with pytest.raises(TTSError): run(adapter, make_request(adapter, "   "))
    assert not client.calls


def test_oversized_provider_audio_is_rejected_in_memory():
    client = Client(data=b"RIFF" + b"\x00" * 5_000_000)
    adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: client)
    with pytest.raises(TTSError) as error:
        run(adapter, make_request(adapter))
    assert error.value.code == TTSErrorCode.LIMIT
    assert client.closed


@pytest.mark.parametrize("status,expected", [(401, TTSErrorCode.AUTHENTICATION), (403, TTSErrorCode.PERMISSION),
                                               (429, TTSErrorCode.RATE_LIMIT), (503, TTSErrorCode.SERVICE_UNAVAILABLE)])
def test_http_errors_are_sanitized_no_retry(status, expected):
    class ProviderFailure(Exception):
        code = status
    client = Client(error=ProviderFailure())
    adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: client)
    with pytest.raises(TTSError) as error: run(adapter, make_request(adapter))
    assert error.value.code == expected
    assert len(client.calls) == 1 and client.closed


def test_deadline_and_cancel_are_mapped_and_client_closed():
    async def scenario(cancel):
        client = Client(hang=True)
        adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: client)
        context = AudioContext(deadline=time.monotonic() + (0.05 if not cancel else 2))
        task = asyncio.create_task(anext(adapter.synthesize(make_request(adapter), context)))
        await client.started.wait()
        if cancel: context.cancel()
        with pytest.raises(TTSError) as error: await task
        assert error.value.code == (TTSErrorCode.CANCELLED if cancel else TTSErrorCode.TIMEOUT)
        assert client.closed
    asyncio.run(scenario(False)); asyncio.run(scenario(True))


@pytest.mark.parametrize("error,expected", [
    (socket.gaierror(11001, "name lookup failed"), TTSErrorCode.DNS_FAILURE),
    (ConnectionError("connection reset"), TTSErrorCode.NETWORK_FAILURE),
    (TimeoutError("timed out"), TTSErrorCode.TIMEOUT),
    (type("SSLError", (Exception,), {})(), TTSErrorCode.TLS_FAILURE),
    (type("HTTPFailure", (Exception,), {"status_code": 404})(), TTSErrorCode.NOT_FOUND),
])
def test_network_and_http_errors_have_safe_specific_categories(error, expected):
    assert classify_provider_error(error) == expected


@pytest.mark.parametrize("cause,expected", [
    (socket.gaierror(11001, "lookup"), TTSErrorCode.DNS_FAILURE),
    (type("SSLError", (Exception,), {})(), TTSErrorCode.TLS_FAILURE),
])
def test_wrapped_transport_cause_is_classified(cause, expected):
    wrapper = RuntimeError("SDK transport wrapper")
    wrapper.__cause__ = cause
    assert classify_provider_error(wrapper) == expected


def test_voice_policy_only_adds_speaking_instructions_and_keeps_followup_context():
    text_prompt = "Act as AIVA."
    voice_prompt = voice_system_prompt(text_prompt)
    assert text_prompt == "Act as AIVA."
    assert "15–35" in voice_prompt and "40–80" in voice_prompt
    assert "conversation history" in voice_prompt and "real-time" in voice_prompt
    assert "Do not add a greeting" in voice_prompt
    assert "Markdown, tables, bullet lists, or emoji" in voice_prompt
    assert "unsolicited follow-up question" in voice_prompt


def test_interactions_pcm_stream_is_decoded_in_order_and_closed():
    import base64
    pcm = b"\x01\x00" * 240
    class StreamClient:
        def __init__(self):
            self.calls = []
            self.closed = False
            self.aio = SimpleNamespace(interactions=SimpleNamespace(create=self.create), aclose=self.aclose)
        async def create(self, **kwargs):
            self.calls.append(kwargs)
            async def events():
                yield SimpleNamespace(event_type="step.delta", delta=SimpleNamespace(
                    type="audio", data=base64.b64encode(pcm).decode(), mime_type="audio/l16",
                    sample_rate=24000, channels=1))
                yield SimpleNamespace(event_type="interaction.completed")
            return events()
        async def aclose(self): self.closed = True
        def close(self): pass
    client = StreamClient()
    diagnostics = []
    adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: client,
                               diagnostic_hook=lambda event, request: diagnostics.append(
                                   (event, request.segment_index, len(request.text))))
    async def scenario():
        context = AudioContext(deadline=time.monotonic() + 3)
        chunks = [chunk async for chunk in adapter.stream_pcm(make_request(adapter), context)]
        assert chunks == [__import__("app.models.tts", fromlist=["TTSAudioChunk"]).TTSAudioChunk(0, pcm, PCM_FORMAT)]
        assert client.calls[0]["stream"] is True
        assert client.calls[0]["response_format"]["mime_type"] == "audio/l16"
        assert client.calls[0]["input"][0]["type"] == "user_input"
        assert diagnostics == [("tts_request_started", 0, len(make_request(adapter).text)),
                               ("first_pcm_chunk", 0, len(make_request(adapter).text))]
        assert client.closed
    asyncio.run(scenario())


def test_reused_client_is_closed_only_at_adapter_shutdown():
    client = Client(data=wav_data())
    adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: client, reuse_client=True)
    first = run(adapter, make_request(adapter))
    second = run(adapter, make_request(adapter))
    assert first and second and len(client.calls) == 2 and not client.closed
    asyncio.run(adapter.aclose())
    assert client.closed


@pytest.mark.parametrize("mime,rate,channels,data", [
    ("audio/wav", 24000, 1, "AA=="), ("audio/l16", 16000, 1, "AA=="),
    ("audio/l16", 24000, 2, "AA=="), ("audio/l16", 24000, 1, "%%%"),
])
def test_interactions_pcm_schema_errors_fail_closed(mime, rate, channels, data):
    class StreamClient:
        def __init__(self):
            self.aio = SimpleNamespace(interactions=SimpleNamespace(create=self.create), aclose=self.aclose)
        async def create(self, **kwargs):
            async def events():
                yield SimpleNamespace(event_type="step.delta", delta=SimpleNamespace(
                    type="audio", data=data, mime_type=mime, sample_rate=rate, channels=channels))
            return events()
        async def aclose(self): pass
        def close(self): pass
    adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: StreamClient())
    async def scenario():
        with pytest.raises(TTSError) as error:
            async for _ in adapter.stream_pcm(make_request(adapter), AudioContext(deadline=time.monotonic()+3)):
                pass
        assert error.value.code == TTSErrorCode.INVALID_AUDIO
    asyncio.run(scenario())


@pytest.mark.parametrize("cancel,expected", [(False, TTSErrorCode.TIMEOUT), (True, TTSErrorCode.CANCELLED)])
def test_interactions_pcm_timeout_cancel_close_stream_and_client(cancel, expected):
    class StreamClient:
        def __init__(self):
            self.started, self.closed = asyncio.Event(), False
            self.aio = SimpleNamespace(interactions=SimpleNamespace(create=self.create), aclose=self.aclose)
        async def create(self, **kwargs):
            async def events():
                self.started.set()
                await asyncio.Event().wait()
                yield None
            return events()
        async def aclose(self): self.closed = True
        def close(self): pass
    async def scenario():
        client = StreamClient()
        adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: client)
        diagnostics = []
        adapter._diagnostic_hook = lambda event, request: diagnostics.append(event)
        context = AudioContext(deadline=time.monotonic() + (2 if cancel else .03))
        task = asyncio.create_task(anext(adapter.stream_pcm(make_request(adapter), context)))
        await client.started.wait()
        if cancel:
            context.cancel()
        with pytest.raises(TTSError) as error:
            await task
        assert error.value.code == expected
        assert ("sdk_cancelled" if cancel else "sdk_deadline") in diagnostics
        assert client.closed
    asyncio.run(scenario())


def test_interactions_stream_accepts_omitted_mime_when_request_format_is_explicit():
    import base64
    pcm = b"\x01\x00" * 120
    class StreamClient:
        def __init__(self):
            self.aio = SimpleNamespace(interactions=SimpleNamespace(create=self.create), aclose=self.aclose)
        async def create(self, **kwargs):
            async def events():
                yield SimpleNamespace(event_type="step.delta", delta=SimpleNamespace(
                    type="audio", data=base64.b64encode(pcm).decode(), mime_type=None,
                    sample_rate=24000, rate=None, channels=1))
            return events()
        async def aclose(self): pass
        def close(self): pass
    adapter = GeminiTTSAdapter(api_key="fixture", client_factory=lambda *_: StreamClient())
    async def scenario():
        chunks = [chunk async for chunk in adapter.stream_pcm(make_request(adapter),
            AudioContext(deadline=time.monotonic()+3))]
        assert chunks[0].payload == pcm and chunks[0].audio_format == PCM_FORMAT
    asyncio.run(scenario())
