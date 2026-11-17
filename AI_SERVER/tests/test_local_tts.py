import asyncio
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.clients.local.voice import LocalTTSAdapter, OPUS_FORMAT
from app.core.local_tts_config import LocalTTSSettings
from app.models.llm import ConversationKey
from app.models.tts import PlaybackScope, TTSConfig, TTSRequest, TTSError
from app.services.audio_context import AudioContext
from app.services.opus_codec import resample_pcm16


def request(text: str):
    return TTSRequest(PlaybackScope(ConversationKey("u", "s", "d"), "turn", "generation"),
        0, text, TTSConfig("vi_VN-vais1000-medium", "vais1000", "vi", OPUS_FORMAT))


def adapter(tmp_path: Path, captured: list[str]):
    root = Path(tempfile.mkdtemp(prefix="aiva-piper-test-"))
    model = root / "voice.onnx"
    config = root / "voice.onnx.json"
    model.write_bytes(b"model")
    config.write_text("{}", encoding="utf-8")

    class Voice:
        def synthesize(self, text):
            captured.append(text)
            yield SimpleNamespace(sample_rate=22050, sample_width=2, sample_channels=1,
                                  audio_int16_bytes=b"\x01\x00" * 1323)

    class Encoder:
        def __init__(self, source, target, *, max_chunk_bytes):
            assert (source, target, max_chunk_bytes) == (22050, 16000, 65536)
        def feed(self, pcm): return [b"opus-packet"]
        def finish(self): return []
        def close(self): pass

    settings = LocalTTSSettings(_env_file=None, model_path=model, config_path=config)
    return LocalTTSAdapter(settings, voice_factory=lambda *a, **k: Voice(), encoder_factory=Encoder)


def test_local_tts_normalizes_vietnamese_and_streams_opus(tmp_path):
    captured = []
    tts = adapter(tmp_path, captured)

    async def run():
        context = AudioContext(deadline=time.monotonic() + 5)
        await tts.load(context)
        return [chunk async for chunk in tts.synthesize(request("  Xin chào lúc 08:30.  "), context)]

    chunks = asyncio.run(run())
    assert captured == ["Xin chào lúc 08:30."]
    assert [chunk.sequence for chunk in chunks] == [0]
    assert chunks[0].payload == b"opus-packet" and chunks[0].audio_format == OPUS_FORMAT


def test_local_tts_rejects_invalid_text(tmp_path):
    tts = adapter(tmp_path, [])

    async def run(text):
        return [chunk async for chunk in tts.synthesize(
            request(text), AudioContext(deadline=time.monotonic() + 5))]

    with pytest.raises(TTSError, match="invalid_input"):
        asyncio.run(run("\x00private"))


def test_22050_pcm_resamples_to_one_16k_opus_frame_size():
    converted = resample_pcm16(b"\x00\x00" * 1323, 22050, 16000)
    assert len(converted) == 960 * 2
