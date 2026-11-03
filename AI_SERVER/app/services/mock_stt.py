"""Offline utterance STT fixture: scripted partial/final, no speech inference."""

import asyncio

from app.models.audio import TranscriptionResult


class MockStreamingSTT:
    def __init__(self, text: str):
        self.text = text
        self.partial_ready = asyncio.Event()
        self.released = 0

    async def transcribe(self, audio, context):
        try:
            frame = await audio.read()
            if frame is not None:
                yield TranscriptionResult(self.text, False)
            self.partial_ready.set()
            while await audio.read() is not None:
                pass
            yield TranscriptionResult(self.text, True)
        finally:
            self.released += 1
