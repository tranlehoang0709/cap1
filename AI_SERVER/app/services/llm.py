"""Provider-neutral runner with bounded output, isolated history and half duplex."""

import asyncio
from collections.abc import AsyncIterator
import re
from typing import Protocol

from app.core.llm_config import LLMSettings
from app.models.audio import AudioError, ErrorCode, TranscriptionResult, positive_int
from app.models.llm import (
    ConversationKey, LLMError, LLMErrorCode, LLMRequest, LLMResult, Message,
    ProviderDelta, ProviderDone, TextChunk,
)
from app.services.audio_context import AudioContext
from app.services.turn_input import HalfDuplexTurn, TurnPhase


class LLMAdapter(Protocol):
    def stream(self, request: LLMRequest, context: AudioContext) -> AsyncIterator[ProviderDelta | ProviderDone]: ...


class Conversation:
    """One trusted User/Session/Device scope, never a global shared chat history.

    Retention budgets are mandatory caller input (no unapproved production
    defaults). Exhaustion rejects; it does not silently trim conversation.
    """
    def __init__(self, key: ConversationKey, *, max_turns: int, max_history_chars: int):
        if not isinstance(key, ConversationKey) or not positive_int(max_turns) or not positive_int(max_history_chars):
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        self._key = key
        self.max_turns, self.max_history_chars = max_turns, max_history_chars
        self._history: tuple[Message, ...] = ()
        self._attempted: set[str] = set()
        self._turn: HalfDuplexTurn | None = None
        self._pending: dict[str, tuple[LLMRequest, LLMResult | None]] = {}

    @property
    def key(self):
        return self._key

    @property
    def history(self):
        return self._history

    def claim(self, key: ConversationKey, turn: HalfDuplexTurn, transcript: TranscriptionResult,
              prompt: str, config: LLMSettings) -> LLMRequest:
        if key != self.key or not isinstance(transcript, TranscriptionResult) or not transcript.is_final:
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        if not transcript.text.strip() or not isinstance(prompt, str):
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        if turn.phase != TurnPhase.PROCESSING or self._turn is not None or turn.turn_id in self._attempted:
            raise LLMError(LLMErrorCode.SESSION_BUSY)
        if len(self._attempted) >= self.max_turns:
            raise LLMError(LLMErrorCode.CONTEXT_LIMIT)
        # Reserve enough history budget for the complete answer before paying provider.
        if sum(len(item.text) for item in self.history) + len(transcript.text) + config.max_output_chars > self.max_history_chars:
            raise LLMError(LLMErrorCode.CONTEXT_LIMIT)
        self._turn = turn
        self._attempted.add(turn.turn_id)
        request = LLMRequest(key, turn.turn_id, transcript.text, prompt, self.history, config)
        self._pending[turn.turn_id] = (request, None)
        return request

    def commit(self, request: LLMRequest, result: LLMResult) -> None:
        pending = self._pending.get(request.turn_id)
        if pending is None or pending[0] != request:
            raise LLMError(LLMErrorCode.SESSION_BUSY)
        self._pending[request.turn_id] = (request, result if result.complete else None)

    def release(self, turn: HalfDuplexTurn, *, interrupted: bool = False) -> None:
        """Only release after explicit close; never reopen during SPEAKING."""
        if self._turn is not turn:
            return
        if turn.phase != TurnPhase.CLOSED:
            raise LLMError(LLMErrorCode.SESSION_BUSY)
        pending = self._pending.pop(turn.turn_id, None)
        if pending is not None:
            request, result = pending
            if interrupted:
                self._history += (Message("user", request.transcript),
                                  Message("assistant", "[response interrupted]"))
            elif result is not None:
                self._history += (Message("user", request.transcript), Message("assistant", result.text))
        self._turn = None


class SentenceOutput:
    # Wait for whitespace after punctuation; decimals split across deltas remain pending.
    _boundary = re.compile(r'[.!?…]+[”’"\)\]]*(?=\s)')
    _ending = re.compile(r'[.!?…]+[”’"\)\]]*$')

    def __init__(self, limit: int):
        self.limit = limit
        self.pending = ""
        self.parts: list[str] = []
        self.length = 0
        self.limited = False

    def push(self, text: str) -> list[TextChunk]:
        if not isinstance(text, str):
            raise LLMError(LLMErrorCode.INVALID_STREAM)
        self.pending += text
        chunks = []
        while (match := self._boundary.search(self.pending)) is not None:
            sentence = self.pending[:match.end()]
            if self.length + len(sentence) > self.limit:
                self.limited = True
                self.pending = ""
                return chunks
            self.pending = self.pending[match.end():]
            chunks.append(self._append(sentence, True))
        if self.length + len(self.pending) > self.limit:
            self.limited = True
            self.pending = ""
        return chunks

    def finish(self, complete: bool) -> list[TextChunk]:
        tail = self.pending
        self.pending = ""
        if not tail.strip():
            return []
        # On incomplete/capped generation no unfinished tail can reach TTS.
        if not complete and self._ending.search(tail.rstrip()) is None:
            return []
        return [self._append(tail, self._ending.search(tail.rstrip()) is not None)]

    def _append(self, text: str, safe: bool) -> TextChunk:
        chunk = TextChunk(len(self.parts), text, safe)
        self.parts.append(text)
        self.length += len(text)
        return chunk


class LLMRunner:
    def __init__(self, config: LLMSettings):
        self.config = config
        self._slots = asyncio.Semaphore(config.max_concurrent_requests)

    async def stream(self, adapter: LLMAdapter, conversation: Conversation, key: ConversationKey,
                     turn: HalfDuplexTurn, transcript: TranscriptionResult, system_prompt: str,
                     context: AudioContext) -> AsyncIterator[TextChunk | LLMResult]:
        stream = None
        acquired = False
        try:
            context.check()
            if context is not turn.audio.context:
                raise LLMError(LLMErrorCode.INVALID_INPUT)
            if self._slots.locked():
                raise LLMError(LLMErrorCode.OVERLOADED)
            # acquire doesn't suspend when a slot is available; no waiting queue.
            await self._slots.acquire()
            acquired = True
            request = conversation.claim(key, turn, transcript, system_prompt, self.config)
            output = SentenceOutput(self.config.max_output_chars)
            stream = adapter.stream(request, context)
            done = None
            while True:
                try:
                    event = await context.run(lambda: anext(stream))
                except StopAsyncIteration:
                    break
                if turn.phase not in (TurnPhase.PROCESSING, TurnPhase.SPEAKING):
                    raise LLMError(LLMErrorCode.CANCELLED)
                if done is not None:
                    raise LLMError(LLMErrorCode.INVALID_STREAM)
                if isinstance(event, ProviderDelta):
                    for chunk in output.push(event.text):
                        yield chunk
                    if output.limited:
                        done = ProviderDone(False, "output_limit")
                        break
                elif isinstance(event, ProviderDone) and type(event.complete) is bool:
                    done = event
                else:
                    raise LLMError(LLMErrorCode.INVALID_STREAM)
            if done is None:
                raise LLMError(LLMErrorCode.INVALID_STREAM)
            for chunk in output.finish(done.complete):
                yield chunk
            text = "".join(output.parts)
            if done.complete and not text.strip():
                raise LLMError(LLMErrorCode.EMPTY_RESPONSE)
            result = LLMResult(text, done.complete, done.reason, done.usage)
            # Close remote HTTP/client before committing history or final delivery.
            await stream.aclose()
            stream = None
            context.check()
            conversation.commit(request, result)
            yield result
        except LLMError:
            raise
        except AudioError as error:
            raise LLMError(LLMErrorCode.CANCELLED if error.code == ErrorCode.CANCELLED else LLMErrorCode.TIMEOUT) from None
        except Exception:
            raise LLMError(LLMErrorCode.PROVIDER_ERROR) from None
        finally:
            try:
                if stream is not None:
                    try:
                        await stream.aclose()
                    except Exception:
                        raise LLMError(LLMErrorCode.PROVIDER_ERROR) from None
            finally:
                if acquired:
                    self._slots.release()
