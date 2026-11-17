"""Proposed PA argument/result contracts, independent of HTTP endpoints."""
from datetime import date
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.personal_assistant.schema import StrictModel, Temporal


class ZonedArgs(StrictModel):
    timezone: str

    @field_validator('timezone')
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (KeyError, ValueError):
            raise ValueError('Invalid IANA timezone') from None
        return value


class ScheduledTime(Temporal):
    date: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    time: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')


class Deadline(Temporal):
    date: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')


class QueryArgs(ZonedArgs):
    query: str = Field(min_length=1, max_length=16000)
    start: Temporal | None = None
    end: Temporal | None = None


class EventCreateArgs(ZonedArgs):
    title: str = Field(min_length=1, max_length=500)
    start: ScheduledTime
    end: Temporal | None = None
    duration_minutes: int | None = Field(default=None, gt=0, le=525600)
    content: str | None = Field(default=None, max_length=4000)
    recurrence: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def complete_interval(self):
        if self.duration_minutes is None and (self.end is None or self.end.time is None):
            raise ValueError('End time or duration is required')
        return self


class ConflictCheckArgs(ZonedArgs):
    start: ScheduledTime
    end: Temporal | None = None
    duration_minutes: int | None = Field(default=None, gt=0, le=525600)
    recurrence: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def complete_interval(self):
        if self.duration_minutes is None and (self.end is None or self.end.time is None):
            raise ValueError('End time or duration is required')
        return self


class ReminderCreateArgs(ZonedArgs):
    content: str | None = Field(default=None, min_length=1, max_length=4000)
    at: ScheduledTime | None = None
    offset_minutes: int | None = Field(default=None, ge=0, le=525600)
    linked_operation_id: str | None = Field(default=None, pattern=r'^op[1-9][0-9]*$')
    linked_record_id: str | None = Field(default=None, min_length=1, max_length=128)
    recurrence: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def complete_reminder(self):
        linked = self.linked_operation_id is not None and self.offset_minutes is not None
        if not linked and (not self.content or self.at is None):
            raise ValueError('Content and time, or linked operation and offset, are required')
        return self


class PlanCreateArgs(ZonedArgs):
    title: str = Field(min_length=1, max_length=500)
    goal: str = Field(min_length=1, max_length=1000)
    start_date: str
    end_date: str
    sessions_per_week: int = Field(ge=1, le=168)
    duration_minutes: int = Field(gt=0, le=525600)
    category: Literal['study', 'personal'] | None = None
    content: str | None = Field(default=None, max_length=4000)
    priority: Literal['low', 'medium', 'high', 'urgent'] | None = None

    @model_validator(mode='after')
    def ordered_dates(self):
        if date.fromisoformat(self.start_date) > date.fromisoformat(self.end_date):
            raise ValueError('Plan ends before it starts')
        return self


class TaskCreateArgs(ZonedArgs):
    title: str = Field(min_length=1, max_length=500)
    deadline: Deadline
    content: str | None = Field(default=None, max_length=4000)
    priority: Literal['low', 'medium', 'high', 'urgent'] | None = None


class TargetArgs(StrictModel):
    target_id: str = Field(min_length=1, max_length=128)


class EventChanges(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    content: str | None = Field(default=None, max_length=4000)
    start: Temporal | None = None
    end: Temporal | None = None
    duration_minutes: int | None = Field(default=None, gt=0, le=525600)
    recurrence: str | None = Field(default=None, max_length=500)


class PlanChanges(EventChanges):
    goal: str | None = Field(default=None, min_length=1, max_length=1000)
    sessions_per_week: int | None = Field(default=None, ge=1, le=168)
    priority: Literal['low', 'medium', 'high', 'urgent'] | None = None
    reschedule_requested: bool = False


class TaskChanges(EventChanges):
    deadline: Deadline | None = None
    priority: Literal['low', 'medium', 'high', 'urgent'] | None = None


class UpdateArgs(TargetArgs, ZonedArgs):
    changes: EventChanges

    @model_validator(mode='after')
    def nonempty_changes(self):
        if not self.changes.model_dump(exclude_none=True, exclude_defaults=True):
            raise ValueError('At least one explicit change is required')
        return self


class PlanUpdateArgs(UpdateArgs):
    changes: PlanChanges


class TaskUpdateArgs(UpdateArgs):
    changes: TaskChanges


class ReminderChanges(StrictModel):
    content: str | None = Field(default=None, max_length=4000)
    start: Temporal | None = None
    reminder_offset_minutes: int | None = Field(default=None, ge=0, le=525600)
    recurrence: str | None = Field(default=None, max_length=500)


class ReminderUpdateArgs(UpdateArgs):
    changes: ReminderChanges


class MemoryProposalArgs(StrictModel):
    content: str = Field(min_length=1, max_length=4000, repr=False)
    category: Literal['addressing', 'communication_style', 'preference', 'habit', 'personal_information'] | None = None
    topic_group: str | None = Field(default=None, min_length=1, max_length=128)
    proposal_revision: int | None = Field(default=None, ge=1)

    @field_validator('content', 'topic_group')
    @classmethod
    def nonblank_memory_value(cls, value):
        if value is not None and not value.strip():
            raise ValueError('Memory values must not be blank')
        return value


class MemoryCreateArgs(MemoryProposalArgs):
    proposal_revision: int = Field(ge=1)


class MemoryTarget(StrictModel):
    model_config = ConfigDict(frozen=True, json_schema_extra={'oneOf': [
        {'required': ['memory_id'], 'properties': {'memory_id': {'type': 'string', 'minLength': 1},
                                                 'topic_group': {'type': 'null'}}},
        {'required': ['topic_group'], 'properties': {'topic_group': {'type': 'string', 'minLength': 1},
                                                   'memory_id': {'type': 'null'}}},
    ]})
    memory_id: str | None = Field(default=None, min_length=1, max_length=128)
    topic_group: str | None = Field(default=None, min_length=1, max_length=128)
    expected_revision: int = Field(ge=1)

    @field_validator('memory_id', 'topic_group')
    @classmethod
    def nonblank_scope(cls, value):
        if value is not None and not value.strip():
            raise ValueError('Memory scope must not be blank')
        return value

    @model_validator(mode='after')
    def exactly_one_scope(self):
        if (self.memory_id is None) == (self.topic_group is None):
            raise ValueError('Select exactly one memory or verified topic group')
        return self


class MemoryUpdateArgs(MemoryTarget):
    content: str = Field(min_length=1, max_length=4000, repr=False)
    update_mode: Literal['replace', 'append']
    proposal_revision: int = Field(ge=1)

    @field_validator('content')
    @classmethod
    def nonblank_content(cls, value):
        if not value.strip():
            raise ValueError('New memory content is required')
        return value


class MemoryDeleteArgs(MemoryTarget):
    proposal_revision: int = Field(ge=1)


class MemoryProposalOutput(StrictModel):
    status: Literal['AWAITING_CONFIRMATION'] = 'AWAITING_CONFIRMATION'
    executed: Literal[False] = False
    proposal_revision: int | None = Field(default=None, ge=1)


class MemoryMutationOutput(StrictModel):
    owner_user_id: str = Field(min_length=1, max_length=128, repr=False)
    memory_id: str | None = Field(default=None, min_length=1, max_length=128)
    topic_group: str | None = Field(default=None, min_length=1, max_length=128)
    revision: int = Field(ge=1)
    proposal_revision: int = Field(ge=1)


class PriorityArgs(TargetArgs):
    priority: Literal['low', 'medium', 'high', 'urgent']


class ProgressArgs(TargetArgs):
    result: Literal['completed', 'not_completed']


class StatusArgs(TargetArgs):
    status: Literal['not_started', 'in_progress', 'paused', 'completed', 'cancelled']


class DeadlineConfigureArgs(TargetArgs):
    content: str = Field(min_length=1, max_length=4000)


class RecordOutput(StrictModel):
    id: str = Field(min_length=1, max_length=128)
    title: str | None = Field(default=None, max_length=500)
    status: str | None = Field(default=None, max_length=100)


class QueryOutput(StrictModel):
    items: list[RecordOutput]


class ConflictRecord(RecordOutput):
    start: ScheduledTime
    end: ScheduledTime
    occurrence_id: str | None = Field(default=None, min_length=1, max_length=128)


class ConflictOutput(StrictModel):
    has_conflict: bool
    conflicts: list[ConflictRecord]
    overlap_ratio: float | None = Field(default=None, ge=0, le=1)

    @model_validator(mode='after')
    def consistent_conflicts(self):
        if self.has_conflict != bool(self.conflicts):
            raise ValueError('Conflict flag must agree with the full conflict list')
        return self


class ReportOutput(StrictModel):
    content: str
    source_ids: list[str]
