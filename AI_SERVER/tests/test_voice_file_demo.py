"""File container parsing tests; fixtures are not live transcription evidence."""

import asyncio
import io
import wave

import pytest

from app.core.stt_config import GeminiSTTSettings
from app.models.audio import AudioError, ErrorCode
from scripts.gemini_voice_file_pipeline import FileAudioInput


def make_pcm_wav():
    stream = io.BytesIO()
    with wave.open(stream, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000); wav.writeframes(b"\x01\x00" * 1600)
    return stream.getvalue()


def test_wav_file_input_preserves_real_file_bytes_and_closes(tmp_path):
    path = tmp_path / "utterance.wav"
    data = make_pcm_wav(); path.write_bytes(data)
    source = FileAudioInput(path, GeminiSTTSettings(_env_file=None, AI_SERVER_STT_MAX_DURATION_SECONDS=2))
    assert source.metadata.codec == "wav" and source.metadata.sample_rate_hz == 16000
    frame = asyncio.run(source.read())
    assert frame.payload == data
    asyncio.run(source.aclose())
    assert source.data == b""


@pytest.mark.parametrize("suffix,data", [(".mp3", b"mp3"), (".wav", b"invalid wav")])
def test_invalid_file_format_fails_closed(tmp_path, suffix, data):
    path = tmp_path / f"input{suffix}"; path.write_bytes(data)
    with pytest.raises(AudioError):
        FileAudioInput(path, GeminiSTTSettings(_env_file=None))


def test_file_size_limit_fails_closed(tmp_path):
    path = tmp_path / "oversize.wav"; path.write_bytes(make_pcm_wav())
    with pytest.raises(AudioError) as error:
        FileAudioInput(path, GeminiSTTSettings(_env_file=None, AI_SERVER_STT_MAX_AUDIO_BYTES=32))
    assert error.value.code == ErrorCode.AUDIO_TOO_LARGE
