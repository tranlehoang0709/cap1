"""Bounded in-memory Local text sessions; no Backend or database persistence."""
import asyncio
import time

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

    async def claim(self, user_id: str, session_id: str) -> tuple[Message, ...]:
        key = (user_id, session_id)
        async with self._lock:
            now = time.monotonic()
            self._items = {item_key: item for item_key, item in self._items.items() if item[0] > now}
            current = self._items.get(key)
            if current is None:
                if len(self._items) >= self.max_sessions:
                    raise LLMError(LLMErrorCode.OVERLOADED)
                history = ()
            else:
                _, history, busy = current
                if busy:
                    raise LLMError(LLMErrorCode.SESSION_BUSY)
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
                    return
                history = next_history
            self._items[key] = (time.monotonic() + self.ttl_seconds, history, False)
