"""One event-loop-local cancellation/deadline scope per transcription turn."""

import asyncio
from collections.abc import Awaitable, Callable
import math
import time
from typing import TypeVar

from app.models.audio import AudioError, ErrorCode

T = TypeVar("T")


class AudioContext:
    def __init__(self, *, deadline: float):
        """deadline is an absolute time.monotonic() value, never wall time."""
        if type(deadline) not in (int, float) or not math.isfinite(deadline):
            raise ValueError("A finite monotonic deadline is required")
        self.deadline = deadline
        self._cancelled = asyncio.Event()
        self._callbacks: set[Callable[[], None]] = set()

    def check(self) -> None:
        if self._cancelled.is_set():
            raise AudioError(ErrorCode.CANCELLED)
        if time.monotonic() >= self.deadline:
            raise AudioError(ErrorCode.DEADLINE_EXCEEDED)

    def on_cancel(self, callback: Callable[[], None]) -> Callable[[], None]:
        self._callbacks.add(callback)
        if self._cancelled.is_set():
            callback()
        return lambda: self._callbacks.discard(callback)

    def cancel(self) -> None:
        self._cancelled.set()
        callbacks = tuple(self._callbacks)
        self._callbacks.clear()
        for callback in callbacks:
            callback()

    async def run(self, operation: Callable[[], Awaitable[T]]) -> T:
        """Race a cooperative operation against cancellation and total deadline."""
        self.check()
        work = asyncio.ensure_future(operation())
        cancelled = asyncio.create_task(self._cancelled.wait())
        try:
            done, _ = await asyncio.wait(
                (work, cancelled), timeout=max(0, self.deadline - time.monotonic()),
                return_when=asyncio.FIRST_COMPLETED,
            )
            self.check()  # Cancellation/deadline wins a simultaneous completion.
            if work not in done:
                raise AudioError(ErrorCode.DEADLINE_EXCEEDED)
            return work.result()
        finally:
            for task in (work, cancelled):
                if not task.done():
                    task.cancel()
            await asyncio.gather(work, cancelled, return_exceptions=True)
