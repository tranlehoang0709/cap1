"""Bounded, single-consumer input; instances belong to one turn/event loop."""

import asyncio
from collections import deque
from typing import Protocol

from app.models.audio import AudioError, AudioFrame, AudioMetadata, ErrorCode, positive_int
from app.services.audio_context import AudioContext


class AudioInput(Protocol):
    @property
    def metadata(self) -> AudioMetadata: ...

    async def read(self) -> AudioFrame | None:
        """None is clean end of input, distinct from abort."""
        ...

    async def aclose(self) -> None: ...


class BoundedAudioInput:
    def __init__(self, metadata: AudioMetadata, context: AudioContext, *,
                 max_frames: int, max_bytes: int):
        if not isinstance(metadata, AudioMetadata):
            raise AudioError(ErrorCode.INVALID_METADATA)
        if not positive_int(max_frames) or not positive_int(max_bytes):
            raise ValueError("Positive frame and byte limits required")
        context.check()
        self._metadata = metadata
        self.context = context
        self.max_frames, self.max_bytes = max_frames, max_bytes
        self._frames: deque[AudioFrame] = deque()
        self._bytes = 0
        self._finished = False
        self._closed = False
        self._reading = False
        self._ready = asyncio.Event()
        self._unsubscribe = context.on_cancel(self._discard)

    @property
    def metadata(self) -> AudioMetadata:
        return self._metadata

    @property
    def buffered_bytes(self) -> int:
        return self._bytes

    @property
    def buffered_frames(self) -> int:
        return len(self._frames)

    def _check(self) -> None:
        try:
            self.context.check()
        except AudioError:
            self._discard()
            self._unsubscribe()
            raise
        if self._closed:
            raise AudioError(ErrorCode.INPUT_CLOSED)

    def feed(self, frame: AudioFrame, *, metadata: AudioMetadata) -> None:
        self._check()
        if self._finished:
            raise AudioError(ErrorCode.INPUT_CLOSED)
        if metadata != self.metadata:
            raise AudioError(ErrorCode.INVALID_METADATA)
        if not isinstance(frame, AudioFrame):
            raise AudioError(ErrorCode.INVALID_FRAME)
        if len(frame.payload) > self.max_bytes:
            raise AudioError(ErrorCode.FRAME_TOO_LARGE)
        if len(self._frames) >= self.max_frames or self._bytes + len(frame.payload) > self.max_bytes:
            raise AudioError(ErrorCode.BUFFER_FULL)
        self._frames.append(frame)
        self._bytes += len(frame.payload)
        self._ready.set()

    def finish(self) -> None:
        self._check()
        self._finished = True
        self._ready.set()

    async def read(self) -> AudioFrame | None:
        if self._reading:
            raise RuntimeError("AudioInput supports one consumer")
        self._reading = True
        try:
            while True:
                self._check()
                if self._frames:
                    frame = self._frames.popleft()
                    self._bytes -= len(frame.payload)
                    return frame
                if self._finished:
                    return None
                self._ready.clear()
                await self.context.run(self._ready.wait)
        except (AudioError, asyncio.CancelledError):
            await self.aclose()
            raise
        finally:
            self._reading = False

    def _discard(self) -> None:
        self._closed = True
        self._frames.clear()
        self._bytes = 0
        self._ready.set()

    async def aclose(self) -> None:
        self._discard()
        self._unsubscribe()
