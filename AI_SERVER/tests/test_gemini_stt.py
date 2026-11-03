import asyncio
import struct
import time
from types import SimpleNamespace

import pytest

from app.clients.gemini_stt import GeminiSTTAdapter, _ogg_opus_duration
from app.models.audio import AudioError, AudioFrame, AudioMetadata, ErrorCode
from app.services.audio_context import AudioContext
from app.services.stt import transcribe


def ogg_opus(duration=1.0):
    head = b"OpusHead" + bytes([1, 1]) + struct.pack("<H", 312) + struct.pack("<I", 24000) + b"\x00\x00\x00"
    # Minimal page framing for fixture metadata validation; provider is mocked.
    return (b"OggS\x00\x06" + struct.pack("<Q", int(duration * 48000) + 312)
        + b"\x01\x00\x00\x00" + b"\x00" * 8 + b"\x01" + bytes([len(head)]) + head)


class Audio:
    def __init__(self, payloads, codec="ogg_opus", *, rate=24000, channels=1, fmt=None, frame_ms=20):
        self.metadata = AudioMetadata(codec, rate, channels, frame_ms, fmt)
        self.payloads = list(payloads)
        self.closed = False
    async def read(self):
        if not self.payloads:
            return None
        return AudioFrame(self.payloads.pop(0))
    async def aclose(self):
        self.closed = True


class Client:
    def __init__(self, *, text="Xin ch?o, b?n c?a t?i!", error=None, hang=False):
        self.text, self.error, self.hang = text, error, hang
        self.calls = []
        self.closed = False
        self.started = asyncio.Event()
        self.proceed = asyncio.Event()
        self.aio = SimpleNamespace(models=SimpleNamespace(generate_content=self.generate), aclose=self.aclose)
    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        self.started.set()
        if self.hang:
            await self.proceed.wait()
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.text)
    async def aclose(self):
        self.closed = True
    def close(self):
        self.closed = True


def adapter(client, **kwargs):
    return GeminiSTTAdapter(api_key="fixture-secret", model="gemini-3.5-flash-lite",
        client_factory=lambda *_: client, **kwargs)


def test_valid_ogg_transcribes_via_adapter_and_returns_real_provider_text():
    client = Client(text="Xin ch?o, b?n c?a t?i!")
    source = Audio([ogg_opus()])
    result = asyncio.run(transcribe(adapter(client), source, AudioContext(deadline=time.monotonic() + 5)))
    assert result.text == "Xin ch?o, b?n c?a t?i!" and result.is_final and result.language == "vi"
    assert len(client.calls) == 1 and client.closed and source.closed
    args = client.calls[0]
    assert args["model"] == "gemini-3.5-flash-lite"
    part = args["contents"][1]
    assert part.inline_data.mime_type == "audio/ogg"
    assert part.inline_data.data == ogg_opus()


def test_empty_audio_rejected_before_provider_request():
    client, source = Client(), Audio([])
    with pytest.raises(AudioError) as error:
        asyncio.run(transcribe(adapter(client), source, AudioContext(deadline=time.monotonic() + 5)))
    assert error.value.code == ErrorCode.EMPTY_AUDIO
    assert not client.calls and source.closed


def test_wrong_format_rejected_before_provider_request():
    client = Client()
    source = Audio([b"not audio"], codec="raw-text")
    with pytest.raises(AudioError) as error:
        asyncio.run(transcribe(adapter(client), source, AudioContext(deadline=time.monotonic() + 5)))
    assert error.value.code == ErrorCode.INVALID_METADATA and not client.calls


def test_opus_packets_decode_to_wav_and_resample_before_provider():
    class Decoder:
        def __init__(self, rate, frame_ms):
            assert (rate, frame_ms) == (24000, 20)
            self.closed = False
        def decode(self, packet):
            assert packet == b"opus-packet"
            return b"\x00\x00" * 480
        def close(self):
            self.closed = True
    client, decoder = Client(), []
    source = Audio([b"opus-packet"], codec="opus", rate=24000, frame_ms=20)
    def make_decoder(rate, duration):
        item = Decoder(rate, duration); decoder.append(item); return item
    result = asyncio.run(transcribe(adapter(client, opus_factory=make_decoder), source,
        AudioContext(deadline=time.monotonic() + 5)))
    assert result.text == "Xin ch?o, b?n c?a t?i!" and decoder[0].closed
    part = client.calls[0]["contents"][1]
    assert part.inline_data.mime_type == "audio/wav"
    assert part.inline_data.data[:4] == b"RIFF" and part.inline_data.data[8:12] == b"WAVE"


def test_unavailable_libopus_is_explicitly_reported():
    def no_opus(*_):
        from app.services.opus_codec import CodecError
        raise CodecError("libopus unavailable")
    source, client = Audio([b"raw-packet"], codec="opus", rate=16000), Client()
    with pytest.raises(AudioError) as error:
        asyncio.run(transcribe(adapter(client, opus_factory=no_opus), source,
            AudioContext(deadline=time.monotonic() + 5)))
    assert error.value.code == ErrorCode.CODEC_UNAVAILABLE and not client.calls


@pytest.mark.parametrize("status,expected", [(429, ErrorCode.RATE_LIMIT), (503, ErrorCode.SERVICE_UNAVAILABLE)])
def test_rate_limit_and_unavailable_classified(status, expected):
    class ProviderError(Exception):
        def __init__(self): self.code = status
    client = Client(error=ProviderError())
    with pytest.raises(AudioError) as error:
        asyncio.run(transcribe(adapter(client), Audio([ogg_opus()]), AudioContext(deadline=time.monotonic() + 5)))
    assert error.value.code == expected and len(client.calls) == 1 and client.closed


def test_cancel_closes_http_client_and_audio_without_fabricating_transcript():
    async def scenario():
        client, source = Client(hang=True), Audio([ogg_opus()])
        context = AudioContext(deadline=time.monotonic() + 5)
        task = asyncio.create_task(transcribe(adapter(client), source, context))
        await client.started.wait()
        context.cancel()
        with pytest.raises(AudioError) as error:
            await task
        assert error.value.code == ErrorCode.CANCELLED
        assert source.closed and client.closed
    asyncio.run(scenario())


def test_ogg_duration_and_invalid_container():
    assert _ogg_opus_duration(ogg_opus(1.5)) == pytest.approx(1.5)
    with pytest.raises(AudioError, match="invalid_audio"):
        _ogg_opus_duration(b"not an Ogg file")


def test_size_and_duration_limits_fail_before_cloud_request():
    too_large = Audio([ogg_opus()])
    client = Client()
    with pytest.raises(AudioError) as error:
        asyncio.run(transcribe(adapter(client, max_audio_bytes=10), too_large,
            AudioContext(deadline=time.monotonic() + 5)))
    assert error.value.code == ErrorCode.AUDIO_TOO_LARGE and not client.calls

    too_long = Audio([ogg_opus(2)])
    with pytest.raises(AudioError) as error:
        asyncio.run(transcribe(adapter(client, max_duration_seconds=1), too_long,
            AudioContext(deadline=time.monotonic() + 5)))
    assert error.value.code == ErrorCode.AUDIO_TOO_LARGE and not client.calls



def test_audio_disconnect_is_provider_failure_and_releases_input():
    class Disconnected(Audio):
        async def read(self):
            raise ConnectionError("private socket detail")
    source, client = Disconnected([]), Client()
    with pytest.raises(AudioError) as error:
        asyncio.run(transcribe(adapter(client), source, AudioContext(deadline=time.monotonic() + 5)))
    assert error.value.code == ErrorCode.PROVIDER_FAILED
    assert source.closed and not client.calls


def test_long_pcm_wav_normalizes_without_short_frame_resampler_limit():
    import io
    import wave
    source_buffer = io.BytesIO()
    with wave.open(source_buffer, "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000)
        output.writeframes(b"\x01\x00" * 4800)  # 200 ms > the packet helper's 120 ms limit.
    client = Client()
    result = asyncio.run(transcribe(adapter(client), Audio([source_buffer.getvalue()], codec="wav", rate=24000),
        AudioContext(deadline=time.monotonic() + 5)))
    assert result.is_final
    normalized_audio = client.calls[0]["contents"][1].inline_data.data
    with wave.open(io.BytesIO(normalized_audio), "rb") as normalized:
        assert (normalized.getnchannels(), normalized.getframerate(), normalized.getnframes()) == (1, 16000, 3200)
