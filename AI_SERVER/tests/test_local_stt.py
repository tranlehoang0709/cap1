import asyncio
import time
from types import SimpleNamespace

import pytest

from app.clients.local import stt as module
from app.clients.local.stt import LocalSTTAdapter
from app.core.local_stt_config import LocalSTTSettings
from app.models.audio import AudioError, AudioFrame, AudioMetadata, ErrorCode
from app.services.audio_context import AudioContext
from app.services.audio_input import BoundedAudioInput
from app.services.stt import transcribe


class Model:
    def __init__(self, text="xin chào Việt Nam"):
        self.text = text
        self.calls = []

    def transcribe(self, samples, **kwargs):
        self.calls.append((samples.copy(), kwargs))
        return iter([SimpleNamespace(text=self.text)] if self.text else []), SimpleNamespace(language="vi")


def context():
    return AudioContext(deadline=time.monotonic() + 5)


def pcm_input(payload: bytes):
    ctx = context()
    audio = BoundedAudioInput(AudioMetadata("pcm", 16000, 1, 60, "s16le"), ctx,
                              max_frames=10, max_bytes=100000)
    audio.feed(AudioFrame(payload), metadata=audio.metadata)
    audio.finish()
    return audio, ctx


def test_pcm_utf8_transcription_and_model_loaded_once(monkeypatch):
    module._models.clear()
    model = Model()
    created = []
    def factory(*args, **kwargs):
        created.append((args, kwargs))
        return model
    settings = LocalSTTSettings(_env_file=None, silence_rms_threshold=1)
    adapter = LocalSTTAdapter(settings, model_factory=factory)

    async def run_once():
        audio, ctx = pcm_input((1000).to_bytes(2, "little", signed=True) * 1600)
        return await transcribe(adapter, audio, ctx)
    first = asyncio.run(run_once())
    second = asyncio.run(run_once())
    assert first.text == second.text == "xin chào Việt Nam"
    assert first.language == "vi" and first.is_final
    assert len(created) == 1 and len(model.calls) == 2
    assert model.calls[0][1]["language"] == "vi"
    assert model.calls[0][1]["vad_parameters"]["min_silence_duration_ms"] == 2000


def test_silence_returns_empty_without_model_inference():
    model = Model("không được gọi")
    adapter = LocalSTTAdapter(LocalSTTSettings(_env_file=None), model_factory=lambda *a, **k: model)
    async def run():
        audio, ctx = pcm_input(b"\0\0" * 1600)
        return await transcribe(adapter, audio, ctx)
    result = asyncio.run(run())
    assert result.text == "" and result.language == "vi"
    assert model.calls == []


def test_invalid_pcm_is_rejected_safely():
    adapter = LocalSTTAdapter(LocalSTTSettings(_env_file=None))
    async def run():
        audio, ctx = pcm_input(b"odd")
        return await transcribe(adapter, audio, ctx)
    with pytest.raises(AudioError) as error:
        asyncio.run(run())
    assert error.value.code == ErrorCode.INVALID_AUDIO


def test_raw_opus_is_decoded_in_memory(monkeypatch):
    module._models.clear()
    model = Model()
    closed = []
    class Codec:
        def decode(self, packet):
            assert packet == b"real-opus-packet"
            return (1200).to_bytes(2, "little", signed=True) * 960
        def close(self):
            closed.append(True)
    ctx = context()
    metadata = AudioMetadata("opus", 16000, 1, 60)
    audio = BoundedAudioInput(metadata, ctx, max_frames=2, max_bytes=1000)
    audio.feed(AudioFrame(b"real-opus-packet"), metadata=metadata)
    audio.finish()
    adapter = LocalSTTAdapter(LocalSTTSettings(_env_file=None, silence_rms_threshold=1),
        model_factory=lambda *a, **k: model, opus_factory=lambda rate, frame: Codec())
    result = asyncio.run(transcribe(adapter, audio, ctx))
    assert result.text == "xin chào Việt Nam" and closed == [True]


def test_model_cache_must_be_outside_repository():
    with pytest.raises(ValueError, match="outside AI_SERVER"):
        LocalSTTSettings(_env_file=None, cache_dir=module.__file__)
