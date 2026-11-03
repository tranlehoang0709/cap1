"""Envelope fixtures are synthetic bytes, not validated Opus recordings."""

import asyncio
from contextlib import aclosing
from dataclasses import FrozenInstanceError
import time

import pytest

from app.models.audio import AudioError, AudioFrame, AudioMetadata, ErrorCode, TranscriptionResult
from app.protocol.audio_framing import FramingConfig, validate_audio_frame
from app.services.audio_context import AudioContext
from app.services.audio_input import AudioInput, BoundedAudioInput
from app.services.stt import stream_transcription, transcribe


@pytest.fixture
def metadata():
    # Upload metadata observed in firmware, not an STT provider requirement.
    return AudioMetadata("opus", 16000, 1, 60)


@pytest.fixture(params=[1, 2, 3])
def envelope(request):
    # Literal network-order fixtures, independently specified from the parser.
    return {
        1: (b"\xaa\xbb", None),
        2: (bytes.fromhex("0002 0000 00000000 01020304 00000002 aabb"), 0x01020304),
        3: (bytes.fromhex("00 00 0002 aabb"), None),
    }[request.param], request.param


def test_valid_framing_and_exact_limit(envelope):
    (message, timestamp), version = envelope
    result = validate_audio_frame(message, FramingConfig(version, 2))
    assert result == AudioFrame(b"\xaa\xbb", timestamp)


@pytest.mark.parametrize("version,frame,code", [
    (1, b"", ErrorCode.INVALID_FRAME),
    (1, b"abc", ErrorCode.FRAME_TOO_LARGE),
    (2, b"\x00" * 15, ErrorCode.INVALID_FRAME),
    (2, bytes.fromhex("0002 0000 00000000 00000000 00000000"), ErrorCode.INVALID_FRAME),
    (2, bytes.fromhex("0001 0000 00000000 00000000 00000001 aa"), ErrorCode.INVALID_FRAME),
    (2, bytes.fromhex("0002 0001 00000000 00000000 00000001 aa"), ErrorCode.INVALID_FRAME),
    (2, bytes.fromhex("0002 0000 00000001 00000000 00000001 aa"), ErrorCode.INVALID_FRAME),
    (2, bytes.fromhex("0002 0000 00000000 00000000 00000002 aa"), ErrorCode.INVALID_FRAME),
    (2, bytes.fromhex("0002 0000 00000000 00000000 00000001 aabb"), ErrorCode.INVALID_FRAME),
    (2, bytes.fromhex("0002 0000 00000000 00000000 ffffffff aa"), ErrorCode.FRAME_TOO_LARGE),
    (3, b"\x00" * 3, ErrorCode.INVALID_FRAME),
    (3, bytes.fromhex("00 00 0000"), ErrorCode.INVALID_FRAME),
    (3, bytes.fromhex("01 00 0001 aa"), ErrorCode.INVALID_FRAME),
    (3, bytes.fromhex("00 01 0001 aa"), ErrorCode.INVALID_FRAME),
    (3, bytes.fromhex("00 00 0002 aa"), ErrorCode.INVALID_FRAME),
    (3, bytes.fromhex("00 00 0001 aabb"), ErrorCode.INVALID_FRAME),
    (3, bytes.fromhex("00 00 ffff aa"), ErrorCode.FRAME_TOO_LARGE),
    (3, bytes.fromhex("00 00 0003 aabbcc"), ErrorCode.FRAME_TOO_LARGE),
])
def test_invalid_frames(version, frame, code):
    with pytest.raises(AudioError) as error:
        validate_audio_frame(frame, FramingConfig(version, 2))
    assert error.value.code == code


@pytest.mark.parametrize("data", ["audio", bytearray(b"abc"), None, 123])
def test_framing_requires_binary_bytes(data):
    with pytest.raises(AudioError):
        validate_audio_frame(data, FramingConfig(1, 10))


@pytest.mark.parametrize("version,limit", [(0, 1), (4, 1), (True, 1), ("2", 1), (1, 0), (1, True)])
def test_explicit_framing_config(version, limit):
    with pytest.raises(ValueError):
        FramingConfig(version, limit)


@pytest.mark.parametrize("changes", [
    {"codec": ""}, {"sample_rate_hz": 0}, {"sample_rate_hz": True},
    {"channels": 0}, {"channels": 1.5}, {"frame_duration_ms": float("nan")},
    {"frame_duration_ms": float("inf")}, {"frame_duration_ms": -1},
    {"frame_duration_ms": True}, {"sample_format": ""},
])
def test_invalid_metadata(changes):
    fields = dict(codec="opus", sample_rate_hz=16000, channels=1, frame_duration_ms=60)
    with pytest.raises(AudioError, match="invalid_metadata"):
        AudioMetadata(**(fields | changes))


def test_metadata_is_immutable(metadata):
    with pytest.raises(FrozenInstanceError):
        metadata.channels = 2


def make_input(metadata, *, seconds=2, max_frames=2, max_bytes=4):
    context = AudioContext(deadline=time.monotonic() + seconds)
    audio = BoundedAudioInput(metadata, context, max_frames=max_frames, max_bytes=max_bytes)
    return audio, context


def test_buffer_limits_drain_finish_and_format(metadata):
    async def scenario():
        audio, _ = make_input(metadata)
        audio.feed(AudioFrame(b"ab"), metadata=metadata)
        audio.feed(AudioFrame(b"cd"), metadata=metadata)
        with pytest.raises(AudioError, match="buffer_full"):
            audio.feed(AudioFrame(b"e"), metadata=metadata)
        assert (audio.buffered_frames, audio.buffered_bytes) == (2, 4)
        assert (await audio.read()).payload == b"ab"
        with pytest.raises(AudioError, match="invalid_metadata"):
            audio.feed(AudioFrame(b"x"), metadata=AudioMetadata("opus", 24000, 1, 60))
        audio.finish()
        with pytest.raises(AudioError, match="input_closed"):
            audio.feed(AudioFrame(b"x"), metadata=metadata)
        assert (await audio.read()).payload == b"cd"
        assert await audio.read() is None
        await audio.aclose()
        assert audio.buffered_bytes == 0
    asyncio.run(scenario())


def test_byte_limit_independent_of_frame_count(metadata):
    async def scenario():
        audio, _ = make_input(metadata, max_frames=10)
        with pytest.raises(AudioError, match="frame_too_large"):
            audio.feed(AudioFrame(b"12345"), metadata=metadata)
        audio.feed(AudioFrame(b"123"), metadata=metadata)
        with pytest.raises(AudioError, match="buffer_full"):
            audio.feed(AudioFrame(b"45"), metadata=metadata)
        assert audio.buffered_bytes == 3
        await audio.aclose()
    asyncio.run(scenario())


def test_cancel_releases_buffer_and_wakes_reader(metadata):
    async def scenario():
        audio, context = make_input(metadata)
        waiting = asyncio.create_task(audio.read())
        await asyncio.sleep(0)
        context.cancel()
        with pytest.raises(AudioError, match="cancelled"):
            await waiting
        other, other_context = make_input(metadata)
        other.feed(AudioFrame(b"ab"), metadata=metadata)
        other_context.cancel()
        assert (other.buffered_frames, other.buffered_bytes) == (0, 0)
        with pytest.raises(AudioError, match="cancelled"):
            other.feed(AudioFrame(b"c"), metadata=metadata)
    asyncio.run(scenario())


def test_input_deadline_and_caller_cancellation(metadata):
    async def scenario():
        audio, _ = make_input(metadata, seconds=.02)
        with pytest.raises(AudioError, match="deadline_exceeded"):
            await audio.read()
        audio, _ = make_input(metadata)
        waiting = asyncio.create_task(audio.read())
        await asyncio.sleep(0)
        waiting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting
        with pytest.raises(AudioError, match="input_closed"):
            audio.feed(AudioFrame(b"x"), metadata=metadata)
    asyncio.run(scenario())


class MockSTT:
    """Test double: fixed scripted transcript, no speech recognition or I/O."""

    def __init__(self, text="MOCK transcript", *, partial=False, hang=False):
        self.text, self.partial, self.hang = text, partial, hang
        self.received = []
        self.started = asyncio.Event()
        self.released = False

    async def transcribe(self, audio: AudioInput, context):
        self.started.set()
        try:
            if self.hang:
                await asyncio.Event().wait()
            while (frame := await audio.read()) is not None:
                self.received.append(frame.payload)
            if self.partial:
                yield TranscriptionResult("MOCK partial", False)
            yield TranscriptionResult(self.text, True)
        finally:
            self.released = True


def test_mock_final_partial_and_framing_integration(metadata, envelope):
    async def scenario():
        (message, _), version = envelope
        audio, context = make_input(metadata)
        audio.feed(validate_audio_frame(message, FramingConfig(version, 2)), metadata=metadata)
        audio.finish()
        mock = MockSTT(partial=True)
        results = [result async for result in stream_transcription(mock, audio, context)]
        assert [result.is_final for result in results] == [False, True]
        assert results[-1].text == "MOCK transcript"
        assert mock.received == [b"\xaa\xbb"]
        assert mock.released and audio.buffered_bytes == 0
    asyncio.run(scenario())


def test_mock_sessions_are_isolated(metadata):
    async def scenario():
        a, ca = make_input(metadata)
        b, cb = make_input(metadata)
        a.feed(AudioFrame(b"A"), metadata=metadata)
        b.feed(AudioFrame(b"B"), metadata=metadata)
        a.finish()
        b.finish()
        pa, pb = MockSTT("MOCK A"), MockSTT("MOCK B")
        ra, rb = await asyncio.gather(transcribe(pa, a, ca), transcribe(pb, b, cb))
        assert (ra.text, rb.text) == ("MOCK A", "MOCK B")
        assert pa.received == [b"A"] and pb.received == [b"B"]
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["timeout", "context", "task"])
def test_mock_timeout_cancel_cleanup_and_isolation(metadata, mode):
    async def scenario():
        audio, context = make_input(metadata, seconds=.03 if mode == "timeout" else 2)
        audio.feed(AudioFrame(b"x"), metadata=metadata)
        mock = MockSTT(hang=True)
        task = asyncio.create_task(transcribe(mock, audio, context))
        await mock.started.wait()
        if mode == "context":
            context.cancel()
        elif mode == "task":
            task.cancel()
        if mode == "task":
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            expected = "deadline_exceeded" if mode == "timeout" else "cancelled"
            with pytest.raises(AudioError, match=expected):
                await task
        assert mock.released and audio.buffered_bytes == 0
        other, ctx = make_input(metadata)
        other.finish()
        assert (await transcribe(MockSTT(), other, ctx)).is_final
        assert not [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()]
    asyncio.run(scenario())


@pytest.mark.parametrize("results", [[], [TranscriptionResult("partial", False)],
    [TranscriptionResult("one", True), TranscriptionResult("two", True)], ["not typed"]])
def test_invalid_provider_result_contract(metadata, results):
    class InvalidProvider:
        async def transcribe(self, audio, context):
            for result in results:
                yield result
    async def scenario():
        audio, context = make_input(metadata)
        with pytest.raises(AudioError, match="invalid_transcript"):
            await transcribe(InvalidProvider(), audio, context)
        assert audio.buffered_bytes == 0
    asyncio.run(scenario())


def test_provider_error_is_safe_and_input_closed(metadata):
    class FailedProvider:
        async def transcribe(self, audio, context):
            raise RuntimeError("secret-provider-payload")
            yield
    async def scenario():
        audio, context = make_input(metadata)
        with pytest.raises(AudioError, match="provider_failed") as error:
            await transcribe(FailedProvider(), audio, context)
        assert "secret" not in str(error.value)
        with pytest.raises(AudioError, match="input_closed"):
            await audio.read()
    asyncio.run(scenario())


def test_early_stream_close_releases_resources(metadata):
    async def scenario():
        audio, context = make_input(metadata)
        audio.finish()
        mock = MockSTT(partial=True)
        async with aclosing(stream_transcription(mock, audio, context)) as stream:
            assert not (await anext(stream)).is_final
        assert mock.released
        with pytest.raises(AudioError, match="input_closed"):
            await audio.read()
    asyncio.run(scenario())


@pytest.mark.parametrize("version,header_bytes", [(2, 16), (3, 4)])
def test_every_truncated_header_is_rejected(version, header_bytes):
    for length in range(header_bytes + 1):
        with pytest.raises(AudioError, match="invalid_frame"):
            validate_audio_frame(b"\x00" * length, FramingConfig(version, 100))


@pytest.mark.parametrize("payload,timestamp", [(b"", None), ("text", None),
    (b"a", -1), (b"a", 0x100000000), (b"a", True)])
def test_invalid_typed_audio_frame(payload, timestamp):
    with pytest.raises(AudioError, match="invalid_frame"):
        AudioFrame(payload, timestamp)


@pytest.mark.parametrize("text,final,language", [(None, True, None), ("x", 1, None), ("x", True, "")])
def test_invalid_transcription_metadata(text, final, language):
    with pytest.raises(AudioError, match="invalid_transcript"):
        TranscriptionResult(text, final, language)


@pytest.mark.parametrize("mode", ["expired", "cancelled"])
def test_context_stops_before_provider_is_started(metadata, mode):
    async def scenario():
        audio, context = make_input(metadata)
        mock = MockSTT()
        if mode == "cancelled":
            context.cancel()
        else:
            context.deadline = time.monotonic() - 1
        with pytest.raises(AudioError, match="cancelled" if mode == "cancelled" else "deadline_exceeded"):
            await transcribe(mock, audio, context)
        assert not mock.started.is_set() and audio.buffered_bytes == 0
    asyncio.run(scenario())


def test_total_deadline_is_not_reset_by_partial_results(metadata):
    class SlowPartials:
        async def transcribe(self, audio, context):
            while True:
                yield TranscriptionResult("MOCK partial", False)
                await asyncio.sleep(.005)
    async def scenario():
        audio, context = make_input(metadata, seconds=.03)
        with pytest.raises(AudioError, match="deadline_exceeded"):
            await transcribe(SlowPartials(), audio, context)
        assert audio.buffered_bytes == 0
    asyncio.run(scenario())
