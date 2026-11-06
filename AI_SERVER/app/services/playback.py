"""One scheduler per trusted session. Sequential synthesis, concurrent playback.

No new turns are allowed until the sink proves completion. Failure/cancel leaves
the session blocked pending an explicitly approved recovery/drain policy.
"""

import asyncio
from collections import deque
from collections.abc import AsyncIterator
from uuid import uuid4

from app.models.audio import AudioError, ErrorCode
from app.models.llm import ConversationKey, LLMResult, TextChunk
from app.models.tts import (
    PlaybackEvidence, PlaybackLimits, PlaybackReceipt, PlaybackScope, ScheduledAudio,
    TTSAudioChunk, TTSConfig, TTSError, TTSErrorCode, TTSRequest,
)
from app.services.tts import AudioOutput, TTSAdapter
from app.services.turn_input import HalfDuplexTurn, TurnPhase


class AudioQueue:
    """Single producer/consumer, bounded payload bytes AND object count."""
    def __init__(self, limits: PlaybackLimits):
        self.limits = limits
        self._items: deque[ScheduledAudio] = deque()
        self.bytes = self.peak_bytes = self.peak_chunks = self.blocked_puts = 0
        self._changed = asyncio.Event()
        self._finished = self._closed = False

    @property
    def chunks(self):
        return len(self._items)

    async def put(self, item: ScheduledAudio):
        size = len(item.chunk.payload)
        if size > self.limits.max_chunk_bytes:
            raise TTSError(TTSErrorCode.LIMIT)
        waited = False
        while True:
            if self._closed or self._finished:
                raise TTSError(TTSErrorCode.CANCELLED)
            if self.chunks < self.limits.max_queue_chunks and self.bytes + size <= self.limits.max_queue_bytes:
                self._items.append(item)
                self.bytes += size
                self.peak_bytes = max(self.peak_bytes, self.bytes)
                self.peak_chunks = max(self.peak_chunks, self.chunks)
                self._changed.set()
                return
            if not waited:
                self.blocked_puts += 1
                waited = True
            self._changed.clear()
            await self._changed.wait()

    async def get(self):
        while True:
            if self._closed:
                raise TTSError(TTSErrorCode.CANCELLED)
            if self._items:
                item = self._items.popleft()
                self.bytes -= len(item.chunk.payload)
                self._changed.set()
                return item
            if self._finished:
                return None
            self._changed.clear()
            await self._changed.wait()

    def finish(self):
        self._finished = True
        self._changed.set()

    def abort(self):
        self._closed = True
        self._items.clear()
        self.bytes = 0
        self._changed.set()


class PlaybackScheduler:
    def __init__(self, key: ConversationKey, limits: PlaybackLimits):
        if not isinstance(key, ConversationKey) or not isinstance(limits, PlaybackLimits):
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        self.key, self.limits = key, limits
        self._busy = False
        self._attempted: set[str] = set()
        self.queue: AudioQueue | None = None
        self.scope: PlaybackScope | None = None
        self.coalesce_segments = False

    async def play(self, adapter: TTSAdapter, output: AudioOutput,
                   texts: AsyncIterator[TextChunk | LLMResult], *, key: ConversationKey,
                   turn: HalfDuplexTurn, config: TTSConfig) -> PlaybackReceipt:
        if key != self.key or not isinstance(config, TTSConfig):
            raise TTSError(TTSErrorCode.INVALID_INPUT)
        if self._busy or turn.turn_id in self._attempted or turn.phase != TurnPhase.PROCESSING:
            raise TTSError(TTSErrorCode.SESSION_BUSY)
        if len(self._attempted) >= self.limits.max_turns:
            raise TTSError(TTSErrorCode.LIMIT)
        self._busy = True
        self._attempted.add(turn.turn_id)
        scope = self.scope = PlaybackScope(key, turn.turn_id, uuid4().hex)
        queue = self.queue = AudioQueue(self.limits)
        context = turn.audio.context
        unsubscribe = context.on_cancel(queue.abort)
        tasks = []
        success = False
        try:
            context.check()
            tasks = [asyncio.create_task(self._produce(adapter, texts, scope, queue, config, context)),
                     asyncio.create_task(self._consume(output, scope, queue, config, turn))]
            evidence = (await context.run(lambda: asyncio.gather(*tasks)))[1]
            if (not isinstance(evidence, PlaybackEvidence) or evidence.scope != scope
                or evidence.completed is not True or not isinstance(evidence.source, str) or not evidence.source.strip()):
                raise TTSError(TTSErrorCode.INVALID_PROOF)
            context.check()
            await turn.aclose()  # Close OLD turn; do not mutate it back to LISTENING.
            self._busy = False
            success = True
            return PlaybackReceipt(scope, evidence, True)
        except TTSError:
            raise
        except AudioError as error:
            raise TTSError(TTSErrorCode.CANCELLED if error.code == ErrorCode.CANCELLED else TTSErrorCode.TIMEOUT) from None
        except Exception:
            raise TTSError(TTSErrorCode.PROVIDER_ERROR) from None
        finally:
            queue.abort()
            if not success:
                turn.cancel()
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            unsubscribe()
            try:
                await texts.aclose()
            except Exception:
                if success:
                    raise TTSError(TTSErrorCode.PROVIDER_ERROR) from None
            if not success:
                try:
                    await output.abort(scope)
                except Exception:
                    raise TTSError(TTSErrorCode.OUTPUT_ERROR) from None

    async def _produce(self, adapter, texts, scope, queue, config, context):
        index = total_chars = 0
        received = []
        final = False
        async for text in texts:
            context.check()
            if final:
                raise TTSError(TTSErrorCode.INVALID_INPUT)
            if isinstance(text, LLMResult):
                if not text.complete:
                    raise TTSError(TTSErrorCode.INCOMPLETE_INPUT)
                if text.text != "".join(received) or index == 0:
                    raise TTSError(TTSErrorCode.INVALID_INPUT)
                final = True
                continue
            if (not isinstance(text, TextChunk) or type(text.index) is not int or text.index != index
                or not isinstance(text.text, str) or not text.text.strip()):
                raise TTSError(TTSErrorCode.INVALID_INPUT)
            if text.tts_safe is not True:
                raise TTSError(TTSErrorCode.UNSAFE_TEXT)
            total_chars += len(text.text)
            if index >= self.limits.max_segments or total_chars > self.limits.max_text_chars:
                raise TTSError(TTSErrorCode.LIMIT)
            if not self.coalesce_segments:
                await self._synthesize_segment(adapter, scope, queue, config, context, index, text.text)
            received.append(text.text)
            index += 1
        if not final:
            raise TTSError(TTSErrorCode.INCOMPLETE_INPUT)
        # Gemini TTS has a much tighter request-rate budget than text
        # generation. One provider request per sentence exhausts that budget
        # and can cut playback after the first sentence of a later turn.
        # Coalesce the already bounded, TTS-safe answer into one request.
        if self.coalesce_segments:
            await self._synthesize_segment(adapter, scope, queue, config, context, 0, "".join(received))
        queue.finish()

    async def _synthesize_segment(self, adapter, scope, queue, config, context, index, text):
        stream = adapter.synthesize(TTSRequest(scope, index, text, config), context)
        sequence = 0
        try:
            async for audio in stream:
                context.check()  # Drop late provider output from a cancelled turn.
                if (not isinstance(audio, TTSAudioChunk) or audio.sequence != sequence
                    or audio.audio_format != config.audio_format):
                    raise TTSError(TTSErrorCode.INVALID_AUDIO)
                await queue.put(ScheduledAudio(scope, index, audio))
                sequence += 1
            if sequence == 0:
                raise TTSError(TTSErrorCode.INVALID_AUDIO)
        finally:
            await stream.aclose()

    async def _consume(self, output, scope, queue, config, turn):
        context = turn.audio.context
        started = False
        try:
            while (item := await queue.get()) is not None:
                context.check()
                if item.scope != scope:
                    raise TTSError(TTSErrorCode.INVALID_AUDIO)
                if not started:
                    turn.speaking()
                    await output.start(scope, config.audio_format, context)
                    started = True
                context.check()
                await output.write(item, context)
                context.check()
            if not started:
                raise TTSError(TTSErrorCode.INVALID_AUDIO)
            await output.finish(scope, context)  # Not a playback ACK.
            return await output.wait_playback_complete(scope, context)
        except (TTSError, AudioError):
            raise
        except Exception:
            raise TTSError(TTSErrorCode.OUTPUT_ERROR) from None
