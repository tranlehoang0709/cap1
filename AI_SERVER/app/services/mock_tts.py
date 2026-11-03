"""Offline fixtures only: no speech synthesis, decoder, hardware or Cloud API."""

import asyncio

from app.models.tts import PlaybackEvidence, TTSAudioChunk, TTSError, TTSErrorCode


class MockTTS:
    def __init__(self, fixtures: tuple[tuple[bytes, ...], ...], *, delay_seconds: float = 0):
        self.fixtures, self.delay_seconds = fixtures, delay_seconds
        self.requests = []
        self.released = 0

    async def synthesize(self, request, context):
        self.requests.append(request)
        try:
            for sequence, payload in enumerate(self.fixtures[request.segment_index]):
                if self.delay_seconds:
                    await asyncio.sleep(self.delay_seconds)
                yield TTSAudioChunk(sequence, payload, request.config.audio_format)
        finally:
            self.released += 1


class MockAudioOutput:
    def __init__(self):
        self.scope = None
        self.audio_format = None
        self.delivered = []
        self.finished = asyncio.Event()
        self._confirmed = asyncio.Event()
        self._evidence = None
        self.aborted = False

    async def start(self, scope, audio_format, context):
        self.scope, self.audio_format = scope, audio_format
        self.finished.clear()
        self._confirmed.clear()
        self._evidence = None
        self.aborted = False

    async def write(self, audio, context):
        context.check()
        if self.aborted or audio.scope != self.scope or audio.chunk.audio_format != self.audio_format:
            raise TTSError(TTSErrorCode.INVALID_AUDIO)
        self.delivered.append(audio)

    async def finish(self, scope, context):
        if scope != self.scope:
            raise TTSError(TTSErrorCode.INVALID_AUDIO)
        self.finished.set()  # Intentionally does not confirm playback.

    def confirm_complete(self, scope):
        if self.aborted or scope != self.scope or not self.finished.is_set():
            raise TTSError(TTSErrorCode.INVALID_PROOF)
        self._evidence = PlaybackEvidence(scope, True, "mock-only")
        self._confirmed.set()

    async def wait_playback_complete(self, scope, context):
        await self._confirmed.wait()
        return self._evidence

    async def abort(self, scope):
        self.aborted = True
        self._evidence = None
        self._confirmed.set()
