"""Validated analysis proposals, deliberately without execution capabilities."""
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, model_validator

Feature = Literal['PA-01', 'PA-02', 'PA-04', 'PA-05', 'PA-06', 'PA-08', 'PA-09',
                  'PA-10', 'PA-11', 'PA-12', 'PA-14', 'PA-15', 'PA-18', 'PA-22', 'PA-23']
Action = Literal['query', 'create', 'update', 'cancel', 'delete', 'set_status',
                 'propose', 'confirm', 'orchestrate']


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, hide_input_in_errors=True)


class Temporal(StrictModel):
    raw: str = Field(min_length=1, max_length=300)
    date: str | None = Field(default=None, pattern=r'^\d{4}-\d{2}-\d{2}$')
    time: str | None = Field(default=None, pattern=r'^([01]\d|2[0-3]):[0-5]\d$')

    @model_validator(mode='after')
    def valid_date(self):
        if self.date:
            from datetime import date
            date.fromisoformat(self.date)
        return self


class Entities(StrictModel):
    title: str | None = Field(default=None, max_length=500)
    content: str | None = Field(default=None, max_length=4000)
    goal: str | None = Field(default=None, max_length=1000)
    start: Temporal | None = None
    end: Temporal | None = None
    deadline: Temporal | None = None
    duration_minutes: int | None = Field(default=None, gt=0, le=525600, strict=True)
    reminder_offset_minutes: int | None = Field(default=None, ge=0, le=525600, strict=True)
    priority: Literal['low', 'medium', 'high', 'urgent'] | None = None
    recurrence: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=100)
    sessions_per_week: int | None = Field(default=None, ge=1, le=168, strict=True)
    status: Literal['not_started', 'in_progress', 'paused', 'completed', 'overdue',
                    'cancelled', 'not_completed', 'acknowledged'] | None = None
    target_query: str | None = Field(default=None, max_length=1000)
    reschedule_requested: bool = False


class MemoryUnderstanding(StrictModel):
    interaction: Literal['statement', 'proposal', 'save_request', 'update_request',
                         'query_request', 'delete_request', 'decline', 'confirmation']
    prohibited_categories: list[Literal['otp', 'password', 'payment', 'identity', 'medical',
                                       'business_secret', 'sensitive_other']] = Field(default_factory=list, max_length=7)
    issues: list[Literal['ambiguous', 'unusual', 'possible_stt_error',
                        'update_mode_unclear']] = Field(default_factory=list, max_length=4)
    original_text: str | None = Field(default=None, max_length=16000, repr=False)
    summary: str | None = Field(default=None, max_length=16000, repr=False)
    storage_policy: Literal['CONSENT_REQUIRED', 'PROHIBITED', 'CLARIFICATION_REQUIRED',
                            'READ_ONLY', 'DECLINED'] = 'CONSENT_REQUIRED'
    requires_clarification: bool = False


class Operation(StrictModel):
    id: str = Field(pattern=r'^op[1-9][0-9]*$')
    intent: str = Field(min_length=1, max_length=300)
    feature: Feature
    action: Action
    source_text: str = Field(min_length=1, max_length=16000)
    entities: Entities = Field(default_factory=Entities)
    memory: MemoryUnderstanding | None = None
    depends_on: list[str] = Field(default_factory=list, max_length=20)
    missing_fields: list[str] = Field(default_factory=list, max_length=30)
    questions: list[str] = Field(default_factory=list, max_length=30)
    target_resolution: Literal['not_needed', 'lookup_required', 'selection_required'] = 'not_needed'
    confirmation_required: bool = False
    confirmation_prompt: str | None = Field(default=None, max_length=2000)
    constraints: list[str] = Field(default_factory=list, max_length=30)
    state: Literal['proposed', 'missing_information', 'awaiting_selection',
                   'awaiting_confirmation', 'unsupported'] = 'proposed'


class Interpretation(StrictModel):
    scope: Literal['pa', 'mixed', 'out_of_scope', 'ambiguous']
    operations: list[Operation] = Field(default_factory=list, max_length=20)
    unhandled: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode='after')
    def valid_dependencies(self):
        seen = set()
        for op in self.operations:
            if op.id in seen or any(dep not in seen for dep in op.depends_on):
                raise ValueError('Operations must have unique IDs and topological dependencies')
            if len(set(op.depends_on)) != len(op.depends_on):
                raise ValueError('Duplicate dependency')
            seen.add(op.id)
        if self.scope == 'out_of_scope' and self.operations:
            raise ValueError('Out-of-scope input cannot contain PA operations')
        if self.scope == 'pa' and not self.operations:
            raise ValueError('PA input requires operations')
        return self


class Analysis(Interpretation):
    schema_version: Literal['1.0'] = '1.0'
    mode: Literal['analysis_only'] = 'analysis_only'
    raw_input: str = Field(min_length=1, max_length=16000, repr=False)
    reference_time: datetime
    timezone: str
    model: str
    executed: Literal[False] = False

    @model_validator(mode='after')
    def valid_reference(self):
        ZoneInfo(self.timezone)
        if self.reference_time.utcoffset() is None:
            raise ValueError('Reference time requires timezone')
        for op in self.operations:
            if op.source_text not in self.raw_input:
                raise ValueError('Source text must quote current input')
        return self


def generation_schema():
    """Omit server-derived fields and nulls from Gemma's output grammar."""
    schema = Interpretation.model_json_schema()
    operation = schema['$defs']['Operation']
    for name in ('missing_fields', 'questions', 'confirmation_required',
                 'confirmation_prompt', 'constraints'):
        operation['properties'].pop(name)
    memory = schema['$defs']['MemoryUnderstanding']['properties']
    for name in ('original_text', 'summary', 'storage_policy', 'requires_clarification'):
        memory.pop(name)

    def compact(value):
        if isinstance(value, list):
            return [compact(item) for item in value]
        if not isinstance(value, dict):
            return value
        result = {key: compact(item) for key, item in value.items()
                  if key != 'default' and not (key == 'title' and isinstance(item, str))}
        if 'anyOf' in result:
            options = [item for item in result['anyOf'] if item.get('type') != 'null']
            if len(options) == 1:
                result.pop('anyOf')
                result.update(options[0])
        return result
    return compact(schema)
