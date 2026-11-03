"""RAM bounds, per-session isolation and cleanup tests (no Cloud/hardware)."""

import asyncio
import tracemalloc

import pytest

from app.models.audio import AudioError, AudioFrame, AudioMetadata, ErrorCode
from app.core.robot_config import RobotSettings
from app.services.audio_context import AudioContext
from app.services.audio_input import BoundedAudioInput


async def measure_sessions(attempts: int):
    max_sessions = 16
    max_frames = 250  # 15 seconds at 60 ms/frame.
    frame_bytes = 1920  # PCM16 mono 16 kHz, decoded in RAM.
    metadata = AudioMetadata("pcm", 16000, 1, 60, "s16le")
    slots = asyncio.Semaphore(max_sessions)
    buffers = []
    tracemalloc.start()
    tracemalloc.reset_peak()

    async def admit(index):
        if slots.locked():
            return False
        await slots.acquire()
        context = AudioContext(deadline=asyncio.get_running_loop().time() + 30)
        audio = BoundedAudioInput(metadata, context, max_frames=max_frames,
                                  max_bytes=max_frames * frame_bytes)
        for frame_index in range(max_frames):
            payload = bytes(bytearray([index & 0xff]) * frame_bytes)
            audio.feed(AudioFrame(payload, frame_index * 60), metadata=metadata)
        audio.finish()
        buffers.append((audio, context, index))
        return True

    try:
        accepted = await asyncio.gather(*(admit(index) for index in range(attempts)))
        _, peak = tracemalloc.get_traced_memory()
        # Every session owns distinct audio payload objects, and frame ordering is stable.
        for audio, _, index in buffers:
            assert audio.buffered_frames == max_frames
            assert audio.buffered_bytes == max_frames * frame_bytes
            previous = -1
            while (frame := await audio.read()) is not None:
                assert frame.timestamp_ms > previous
                assert frame.payload[0] == index & 0xff
                previous = frame.timestamp_ms
        return sum(accepted), peak
    finally:
        for audio, context, _ in buffers:
            context.cancel()
            await audio.aclose()
            assert audio.buffered_bytes == 0
            slots.release()
        tracemalloc.stop()


@pytest.mark.parametrize("attempts,expected", [(1, 1), (5, 5), (20, 16)])
def test_bounded_ram_under_1_5_20_concurrent_session_load(attempts, expected):
    accepted, peak_bytes = asyncio.run(measure_sessions(attempts))
    print(f"attempts={attempts}, admitted={accepted}, max_sessions=16, peak_python_ram_bytes={peak_bytes}")
    assert accepted == expected
    assert peak_bytes < 24 * 1024 * 1024


def test_audio_queue_overflow_and_cancel_discards_buffer():
    async def scenario():
        metadata = AudioMetadata("pcm", 16000, 1, 60, "s16le")
        context = AudioContext(deadline=asyncio.get_running_loop().time() + 2)
        audio = BoundedAudioInput(metadata, context, max_frames=1, max_bytes=1920)
        audio.feed(AudioFrame(b"a" * 1920), metadata=metadata)
        with pytest.raises(AudioError) as error:
            audio.feed(AudioFrame(b"b" * 1920), metadata=metadata)
        assert error.value.code == ErrorCode.BUFFER_FULL
        context.cancel()
        assert audio.buffered_bytes == 0 and audio.buffered_frames == 0
        await audio.aclose()
    asyncio.run(scenario())


def test_configured_session_and_audio_limits_fit_aggregate_memory_budget():
    defaults = RobotSettings(_env_file=None)
    assert defaults.max_sessions == 2
    assert defaults.max_total_audio_memory_bytes == 256_000_000
    assert RobotSettings(_env_file=None, max_sessions=16).max_sessions == 16
    with pytest.raises(ValueError, match="total audio memory budget"):
        RobotSettings(_env_file=None, max_sessions=16, max_turn_duration_ms=120000,
                      max_total_audio_memory_bytes=256_000_000)
