"""Provider-neutral text streaming contract; all identity is trusted caller input."""

from dataclasses import dataclass
from enum import StrEnum

from app.core.llm_config import LLMSettings


class LLMErrorCode(StrEnum):
    INVALID_INPUT = "invalid_input"
    INVALID_STREAM = "invalid_stream"
    EMPTY_RESPONSE = "empty_response"
    RATE_LIMIT = "rate_limit"
    PROVIDER_ERROR = "provider_error"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"
    OVERLOADED = "overloaded"
    SESSION_BUSY = "session_busy"
    CONTEXT_LIMIT = "context_limit"


class LLMError(Exception):
    def __init__(self, code: LLMErrorCode):
        self.code = code
        super().__init__(code.value)


@dataclass(frozen=True)
class ConversationKey:
    user_id: str
    session_id: str
    device_id: str

    def __post_init__(self):
        if any(not isinstance(value, str) or not value.strip()
               for value in (self.user_id, self.session_id, self.device_id)):
            raise LLMError(LLMErrorCode.INVALID_INPUT)


@dataclass(frozen=True)
class Message:
    role: str
    text: str

    def __post_init__(self):
        if self.role not in ("user", "assistant") or not isinstance(self.text, str):
            raise LLMError(LLMErrorCode.INVALID_INPUT)


@dataclass(frozen=True)
class LLMRequest:
    key: ConversationKey
    turn_id: str
    transcript: str
    system_prompt: str
    history: tuple[Message, ...]
    config: LLMSettings

    def __post_init__(self):
        if (not isinstance(self.key, ConversationKey) or not isinstance(self.turn_id, str) or not self.turn_id.strip()
            or not isinstance(self.transcript, str) or not self.transcript.strip()
            or not isinstance(self.system_prompt, str) or not isinstance(self.history, tuple)
            or any(not isinstance(message, Message) for message in self.history)
            or not isinstance(self.config, LLMSettings)):
            raise LLMError(LLMErrorCode.INVALID_INPUT)


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    output_tokens: int
    total_tokens: int

    def __post_init__(self):
        if any(type(value) is not int or value < 0
               for value in (self.input_tokens, self.output_tokens, self.total_tokens)):
            raise LLMError(LLMErrorCode.INVALID_STREAM)
        if self.total_tokens != self.input_tokens + self.output_tokens:
            raise LLMError(LLMErrorCode.INVALID_STREAM)


@dataclass(frozen=True)
class ProviderDelta:
    text: str

    def __post_init__(self):
        if not isinstance(self.text, str):
            raise LLMError(LLMErrorCode.INVALID_STREAM)


@dataclass(frozen=True)
class ProviderDone:
    complete: bool
    reason: str
    usage: Usage | None = None

    def __post_init__(self):
        if (type(self.complete) is not bool or self.reason not in ("completed", "token_limit", "incomplete", "output_limit")
            or self.complete != (self.reason == "completed")
            or (self.usage is not None and not isinstance(self.usage, Usage))):
            raise LLMError(LLMErrorCode.INVALID_STREAM)


@dataclass(frozen=True)
class TextChunk:
    index: int
    text: str
    tts_safe: bool


@dataclass(frozen=True)
class LLMResult:
    text: str
    complete: bool
    reason: str
    usage: Usage | None
