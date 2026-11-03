"""Scripted test/demo provider. Performs no inference and no API calls."""

import asyncio

from app.models.llm import ProviderDelta, ProviderDone


class MockLLMAdapter:
    def __init__(self, events: tuple[ProviderDelta | ProviderDone, ...], *, delay_seconds: float = 0):
        self.events, self.delay_seconds = events, delay_seconds
        self.requests = []
        self.started = asyncio.Event()
        self.released = 0

    async def stream(self, request, context):
        self.requests.append(request)
        self.started.set()
        try:
            for event in self.events:
                if self.delay_seconds:
                    await asyncio.sleep(self.delay_seconds)
                yield event
        finally:
            self.released += 1
