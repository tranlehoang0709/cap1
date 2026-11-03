"""Negotiated local-development WebSocket output and mock Opus TTS adapter."""

import asyncio
from dataclasses import replace

from app.models.audio import AudioFrame, AudioMetadata
from app.models.tts import AudioFormat, PlaybackEvidence, TTSConfig, TTSAudioChunk
from app.protocol.audio_framing import FramingConfig, encode_audio_frame
from app.services.opus_codec import PCMOpusFrames

OPUS_FORMAT = AudioFormat(AudioMetadata("opus", 16000, 1, 60), "raw")
PCM_FORMAT = AudioFormat(AudioMetadata("pcm", 16000, 1, 60, "s16le"), "raw")


class OpusTTSAdapter:
    def __init__(self, delegate):
        self.delegate = delegate

    async def synthesize(self, request, context):
        encoder = PCMOpusFrames(16000, 16000, max_chunk_bytes=4096)
        source = self.delegate.synthesize(replace(request, config=TTSConfig("mock-model", "mock-voice", "vi", PCM_FORMAT)), context)
        sequence = 0
        try:
            async for chunk in source:
                context.check()
                if chunk.audio_format != PCM_FORMAT:
                    raise ValueError("Unexpected PCM source format")
                for packet in encoder.feed(chunk.payload):
                    yield TTSAudioChunk(sequence, packet, OPUS_FORMAT)
                    sequence += 1
            for packet in encoder.finish():
                yield TTSAudioChunk(sequence, packet, OPUS_FORMAT)
        finally:
            try:
                await source.aclose()
            finally:
                encoder.close()


class RobotAudioOutput:
    def __init__(self, websocket, session_id, version):
        self.ws, self.session_id = websocket, session_id
        self.framing = FramingConfig(version, 1275)
        self.lock = asyncio.Lock()
        self.scope = None
        self.ready = asyncio.Event()
        self.complete = asyncio.Event()
        self.count = 0
        self.finished = False
        self.aborted = False

    async def json(self, value):
        async with self.lock:
            await self.ws.send_json(value)

    def control(self, state):
        return {"type": "tts", "state": state, "session_id": self.session_id,
                "turn_id": self.scope.turn_id, "playback_id": self.scope.generation}

    async def start(self, scope, audio_format, context):
        context.check()
        if audio_format != OPUS_FORMAT:
            raise ValueError("Unsupported negotiated audio")
        self.scope, self.count, self.finished, self.aborted = scope, 0, False, False
        self.ready.clear()
        self.complete.clear()
        await self.json(self.control("start"))
        await context.run(self.ready.wait)

    async def write(self, audio, context):
        context.check()
        if audio.scope != self.scope or self.finished or self.aborted or not self.ready.is_set():
            raise ValueError("Stale audio")
        packet = encode_audio_frame(AudioFrame(audio.chunk.payload, (self.count * 60) & 0xffffffff), self.framing)
        async with self.lock:
            context.check()
            if audio.scope != self.scope or self.finished or self.aborted:
                raise ValueError("Stale audio after transport wait")
            await self.ws.send_bytes(packet)
        self.count += 1

    async def finish(self, scope, context):
        context.check()
        if scope != self.scope or self.finished or self.aborted or self.count < 1:
            raise ValueError("Invalid playback finish")
        self.finished = True
        await self.json(self.control("stop") | {"audio_chunks": self.count})

    async def wait_playback_complete(self, scope, context):
        if scope != self.scope or self.aborted:
            raise ValueError("Stale playback wait")
        await context.run(self.complete.wait)
        if scope != self.scope or self.aborted:
            raise ValueError("Stale playback completion")
        return PlaybackEvidence(scope, True, "development-firmware-drained-v1")

    def acknowledge(self, message):
        if (self.aborted or self.scope is None or message.get("session_id") != self.session_id
            or message.get("turn_id") != self.scope.turn_id or message.get("playback_id") != self.scope.generation):
            raise ValueError("Stale playback event")
        state = message.get("state")
        if (state == "ready" and type(message.get("audio_chunks")) is int
            and message["audio_chunks"] == 0 and not self.ready.is_set() and not self.finished):
            self.ready.set()
        elif (state == "complete" and self.finished and not self.complete.is_set()
              and type(message.get("audio_chunks")) is int and message["audio_chunks"] == self.count):
            self.complete.set()
        else:
            raise ValueError("Unexpected playback event")

    async def abort(self, scope):
        if self.scope == scope:
            self.aborted = True
            await self.json(self.control("abort"))
