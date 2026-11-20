"""Bounded in-memory Local text sessions; no Backend or database persistence."""
import asyncio
import time
from copy import deepcopy

from app.models.llm import LLMError, LLMErrorCode, Message


class LocalChatSessions:
    def __init__(self, *, max_sessions: int, max_turns: int, max_history_chars: int,
                 ttl_seconds: int):
        self.max_sessions = max_sessions
        self.max_turns = max_turns
        self.max_history_chars = max_history_chars
        self.ttl_seconds = ttl_seconds
        self._items: dict[tuple[str, str], tuple[float, tuple[Message, ...], bool]] = {}
        self._lock = asyncio.Lock()
        self._pending = {}

    def _prune(self):
        now = time.monotonic()
        expired = [key for key, item in self._items.items() if item[0] <= now and not item[2]]
        for key in expired:
            del self._items[key]
            self._pending.pop(key, None)
        return len(expired)

    async def cleanup(self):
        async with self._lock:
            return self._prune()

    async def pending(self, user_id, session_id):
        async with self._lock:
            self._prune()
            return deepcopy(self._pending.get((user_id, session_id)))

    async def save_pending(self, user_id, session_id, value):
        async with self._lock:
            key = (user_id, session_id)
            if key not in self._items or not self._items[key][2]:
                raise RuntimeError('Pending state requires a claimed session')
            if len(value.model_dump_json()) > self.max_history_chars:
                raise LLMError(LLMErrorCode.CONTEXT_LIMIT)
            self._pending[key] = deepcopy(value)

    async def claim(self, user_id: str, session_id: str,
                    restored: tuple[Message, ...] | None = None) -> tuple[Message, ...]:
        key = (user_id, session_id)
        async with self._lock:
            now = time.monotonic()
            self._prune()
            current = self._items.get(key)
            if current is None:
                if len(self._items) >= self.max_sessions:
                    raise LLMError(LLMErrorCode.OVERLOADED)
                history = ()
            else:
                _, history, busy = current
                if busy:
                    raise LLMError(LLMErrorCode.SESSION_BUSY)
            if restored is not None:
                # Only authenticated Backend ingress supplies this snapshot.
                # Replace, do not append: restart/retry must not duplicate turns.
                history = restored
                while history and (len(history) // 2 >= self.max_turns or
                        sum(len(m.text) for m in history) > self.max_history_chars):
                    history = history[2:]
            if len(history) // 2 >= self.max_turns:
                raise LLMError(LLMErrorCode.CONTEXT_LIMIT)
            self._items[key] = (now + self.ttl_seconds, history, True)
            return history

    async def finish(self, user_id: str, session_id: str, transcript: str,
                     answer: str | None) -> None:
        key = (user_id, session_id)
        async with self._lock:
            current = self._items.get(key)
            if current is None:
                return
            _, history, _ = current
            if answer is not None:
                next_history = history + (Message("user", transcript), Message("assistant", answer))
                if sum(len(item.text) for item in next_history) > self.max_history_chars:
                    self._items.pop(key, None)
                    self._pending.pop(key, None)
                    return
                history = next_history
            self._items[key] = (time.monotonic() + self.ttl_seconds, history, False)
