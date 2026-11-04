"""Negotiated development WebSocket output and Opus TTS transport adapters."""

import asyncio
from dataclasses import replace
import io
import wave

from app.models.audio import AudioFrame, AudioMetadata
from app.models.tts import AudioFormat, PlaybackEvidence, TTSConfig, TTSAudioChunk, TTSRequest, TTSError, TTSErrorCode
from app.protocol.audio_framing import FramingConfig, encode_audio_frame
from app.clients.gemini_tts import PCM_FORMAT as GEMINI_PCM_FORMAT
from app.services.opus_codec import CodecError, OpusCodec, PCMOpusFrames, resample_pcm16

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


class WavOpusTTSAdapter:
    """Convert provider WAV output to negotiated 16 kHz mono 60 ms Opus."""
    def __init__(self, delegate, source_config: TTSConfig, *, max_wav_bytes: int = 5_000_000):
        if not isinstance(source_config, TTSConfig) or source_config.audio_format.data_format != "wav":
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        if type(max_wav_bytes) is not int or not 0 < max_wav_bytes <= 19_000_000:
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        self.delegate, self.source_config, self.max_wav_bytes = delegate, source_config, max_wav_bytes

    async def synthesize(self, request: TTSRequest, context):
        if request.config.audio_format != OPUS_FORMAT:
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        source_request = replace(request, config=self.source_config)
        pcm_stream = getattr(self.delegate, "stream_pcm", None)
        if callable(pcm_stream):
            source = pcm_stream(source_request, context)
            encoder = None
            sequence = input_sequence = total_bytes = 0
            try:
                encoder = PCMOpusFrames(24000, 16000, max_chunk_bytes=65536)
                async for chunk in source:
                    context.check()
                    if (not isinstance(chunk, TTSAudioChunk) or chunk.sequence != input_sequence
                            or chunk.audio_format != GEMINI_PCM_FORMAT):
                        raise TTSError(TTSErrorCode.INVALID_AUDIO)
                    input_sequence += 1
                    total_bytes += len(chunk.payload)
                    if total_bytes > self.max_wav_bytes:
                        raise TTSError(TTSErrorCode.LIMIT)
                    for packet in encoder.feed(chunk.payload):
                        yield TTSAudioChunk(sequence, packet, OPUS_FORMAT)
                        sequence += 1
                if input_sequence == 0:
                    raise TTSError(TTSErrorCode.INVALID_AUDIO)
                for packet in encoder.finish():
                    yield TTSAudioChunk(sequence, packet, OPUS_FORMAT)
                    sequence += 1
                if sequence == 0:
                    raise TTSError(TTSErrorCode.INVALID_AUDIO)
            except (TTSError, GeneratorExit):
                raise
            except CodecError as error:
                if "libopus unavailable" in str(error):
                    raise TTSError(TTSErrorCode.CODEC_UNAVAILABLE) from None
                raise TTSError(TTSErrorCode.INVALID_AUDIO) from None
            except Exception:
                raise TTSError(TTSErrorCode.OUTPUT_ERROR) from None
            finally:
                try:
                    await source.aclose()
                finally:
                    if encoder is not None:
                        encoder.close()
            return

        source = self.delegate.synthesize(source_request, context)
        encoder = None
        try:
            wav_bytes = bytearray()
            sequence = 0
            async for chunk in source:
                context.check()
                if not isinstance(chunk, TTSAudioChunk) or chunk.sequence != sequence or chunk.audio_format != self.source_config.audio_format:
                    raise TTSError(TTSErrorCode.INVALID_AUDIO)
                sequence += 1
                if len(wav_bytes) + len(chunk.payload) > self.max_wav_bytes:
                    raise TTSError(TTSErrorCode.LIMIT)
                wav_bytes.extend(chunk.payload)
            if not wav_bytes:
                raise TTSError(TTSErrorCode.INVALID_AUDIO)
            try:
                with wave.open(io.BytesIO(wav_bytes), "rb") as audio:
                    if (audio.getnchannels() != 1 or audio.getframerate() != 24000
                            or audio.getsampwidth() != 2 or audio.getcomptype() != "NONE"):
                        raise ValueError
                    pcm = audio.readframes(audio.getnframes())
                    if not pcm or len(pcm) % 2:
                        raise ValueError
            except Exception:
                raise TTSError(TTSErrorCode.INVALID_AUDIO) from None

            try:
                encoder = OpusCodec(16000, 60)
            except CodecError as error:
                if "libopus unavailable" in str(error):
                    raise TTSError(TTSErrorCode.CODEC_UNAVAILABLE) from None
                raise TTSError(TTSErrorCode.OUTPUT_ERROR) from None
            source_frame_bytes = 24000 * 60 // 1000 * 2
            sequence = 0
            for offset in range(0, len(pcm), source_frame_bytes):
                context.check()
                frame = pcm[offset:offset + source_frame_bytes]
                if len(frame) < source_frame_bytes:
                    frame += b"\x00" * (source_frame_bytes - len(frame))
                converted = resample_pcm16(frame, 24000, 16000)
                packet = encoder.encode(converted)
                yield TTSAudioChunk(sequence, packet, OPUS_FORMAT)
                sequence += 1
        except (TTSError, GeneratorExit):
            raise
        except Exception:
            raise TTSError(TTSErrorCode.OUTPUT_ERROR) from None
        finally:
            try:
                await source.aclose()
            finally:
                if encoder is not None:
                    encoder.close()


# Compatibility name retained for existing Gemini-specific callers/tests.
GeminiOpusTTSAdapter = WavOpusTTSAdapter


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
        self.next_packet_at = 0.0

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
        self.next_packet_at = asyncio.get_running_loop().time()

    async def write(self, audio, context):
        context.check()
        if audio.scope != self.scope or self.finished or self.aborted or not self.ready.is_set():
            raise ValueError("Stale audio")
        # Native WebSocket sends can outrun the device's bounded decoder queue.
        # Pace delivery at the negotiated 60 ms frame rate; completion still
        # requires the separate matching hardware playback proof below.
        loop = asyncio.get_running_loop()
        delay = self.next_packet_at - loop.time()
        if delay > 0:
            await context.run(lambda: asyncio.sleep(delay))
        packet = encode_audio_frame(AudioFrame(audio.chunk.payload, (self.count * 60) & 0xffffffff), self.framing)
        async with self.lock:
            context.check()
            if audio.scope != self.scope or self.finished or self.aborted:
                raise ValueError("Stale audio after transport wait")
            await self.ws.send_bytes(packet)
            self.next_packet_at = max(self.next_packet_at, loop.time()) + .06
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
            return False  # A delayed ACK for an aborted/previous turn is harmless.
        state = message.get("state")
        if (state == "ready" and type(message.get("audio_chunks")) is int
            and message["audio_chunks"] == 0 and not self.ready.is_set() and not self.finished):
            self.ready.set()
        elif (state == "complete" and self.finished and not self.complete.is_set()
              and type(message.get("audio_chunks")) is int and message["audio_chunks"] == self.count):
            self.complete.set()
        else:
            raise ValueError("Unexpected playback event")
        return True

    async def abort(self, scope):
        if self.scope == scope:
            self.aborted = True
            await self.json(self.control("abort"))
