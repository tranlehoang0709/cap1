"""Proposed PA-04 scoped search response; no memory persistence in AI_SERVER."""
from datetime import datetime
import hashlib
from typing import Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.personal_assistant.schema import StrictModel
from app.personal_assistant.tool_contracts import QueryArgs, MemoryTarget

MemoryCategory = Literal['addressing', 'communication_style', 'preference', 'habit', 'personal_information']


class MemoryQueryArgs(QueryArgs):
    limit: int = Field(default=8, ge=1, le=8)
    memory_id: str | None = Field(default=None, min_length=1, max_length=128)
    topic_group: str | None = Field(default=None, min_length=1, max_length=128)
    purpose: Literal['personalization', 'management'] = 'personalization'
    permitted_use_only: bool = True

    @model_validator(mode='after')
    def use_scope(self):
        if self.purpose == 'personalization' and not self.permitted_use_only:
            raise ValueError('Personalization can only read permitted memories')
        return self


class MemoryAuthorization(StrictModel):
    """Application-supplied scope/snapshot and consent; never populated from LLM entities."""
    model_config = ConfigDict(frozen=True)
    owner_user_id: str = Field(min_length=1, max_length=128, repr=False)
    session_id: str = Field(min_length=1, max_length=128, repr=False)
    correlation_id: str = Field(min_length=1, max_length=128, repr=False)
    proposal_revision: int = Field(ge=1)
    target: MemoryTarget | None = None
    update_mode: Literal['replace', 'append'] | None = None
    consent_to_store: bool = False
    consent_to_use: bool = False
    confirmed_call_key: str | None = Field(default=None, pattern=r'^[a-f0-9]{64}$', repr=False)


class MemoryRecord(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    owner_user_id: str = Field(min_length=1, max_length=128, repr=False)
    category: MemoryCategory
    content: str = Field(min_length=1, max_length=500, repr=False)
    consent_to_store: bool
    consent_to_use: bool
    active: bool
    sensitivity_reviewed: bool
    relevance: float = Field(ge=0, le=1)
    topic_group: str | None = Field(default=None, min_length=1, max_length=128)
    revision: int | None = Field(default=None, ge=1)
    updated_at: str | None = None
    expires_at: str | None = None

    @field_validator('updated_at', 'expires_at')
    @classmethod
    def aware_time(cls, value):
        if value is not None and datetime.fromisoformat(value).utcoffset() is None:
            raise ValueError('Memory timestamps require a timezone')
        return value


class MemoryQueryOutput(StrictModel):
    query_digest: str = Field(pattern=r'^[a-f0-9]{64}$')
    items: list[MemoryRecord] = Field(max_length=8)


def query_digest(query):
    return hashlib.sha256(query.encode()).hexdigest()
