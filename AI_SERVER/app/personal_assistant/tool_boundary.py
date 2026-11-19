"""Single-call authorization boundary; no PA endpoints or workflow execution."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import asyncio
import hashlib
import json
import math
import time
from types import MappingProxyType
from typing import Literal, Mapping, Protocol

import httpx
from pydantic import BaseModel, Field, JsonValue, ValidationError, model_validator

from app.clients.backend import BackendError
from app.models.audio import AudioError, ErrorCode
from app.services.audio_context import AudioContext
from app.personal_assistant.execution_contracts import (BackendReceipt, ExecutionOutcome,
    ReconciliationState, ToolAvailability)
from app.personal_assistant.schema import Feature, StrictModel
from app.personal_assistant.tool_registry import get_tool
from app.personal_assistant.memory_contracts import MemoryAuthorization, query_digest

ResultStatus = Literal['SUCCESS', 'VALIDATION_ERROR', 'CONFLICT', 'NOT_FOUND',
                       'FORBIDDEN', 'UNAVAILABLE', 'TIMEOUT']


class ToolCall(StrictModel):
    operation_id: str = Field(pattern=r'^op[1-9][0-9]*$')
    tool_id: str = Field(min_length=1, max_length=100)
    feature: Feature
    arguments: dict[str, JsonValue] = Field(repr=False)
    depends_on: list[str] = Field(default_factory=list, max_length=20)
    target_query: str | None = Field(default=None, max_length=1000, repr=False)
    validation_errors: list[str] = Field(default_factory=list, max_length=50, repr=False)


class ToolResult(StrictModel):
    operation_id: str
    tool_id: str
    status: ResultStatus
    code: str
    executed: bool = False
    data: dict[str, JsonValue] | None = Field(default=None, repr=False)
    validation_errors: list[str] = Field(default_factory=list, repr=False)
    outcome: ExecutionOutcome = 'NOT_EXECUTED'
    reconciliation_state: ReconciliationState = 'NOT_REQUIRED'
    receipt: BackendReceipt | None = Field(default=None, exclude=True, repr=False)

    @model_validator(mode='after')
    def consistent_execution(self):
        if self.status == 'SUCCESS':
            if not self.executed or self.outcome != 'CONFIRMED' or self.receipt is None:
                raise ValueError('Success requires a confirmed Backend receipt')
        elif self.executed or self.outcome == 'CONFIRMED':
            raise ValueError('An unsuccessful operation cannot be confirmed')
        if (self.outcome == 'UNKNOWN') != (self.reconciliation_state == 'PENDING_RECONCILIATION'):
            raise ValueError('Unknown outcomes require reconciliation')
        return self


@dataclass(frozen=True)
class TrustedToolContext:
    """Supplied by authenticated application code, never parsed from LLM JSON."""
    user_id: str = field(repr=False)
    session_id: str = field(repr=False)
    correlation_id: str = field(repr=False)
    dialogue_ready: bool = False
    allowed_tools: frozenset[str] = field(default_factory=frozenset, repr=False)
    confirmed_call_keys: frozenset[str] = field(default_factory=frozenset, repr=False)
    resolved_targets: Mapping[str, str] = field(default_factory=dict, repr=False)
    satisfied_preconditions: frozenset[tuple[str, str]] = field(default_factory=frozenset, repr=False)
    completed_dependencies: frozenset[str] = field(default_factory=frozenset, repr=False)
    dependency_record_ids: Mapping[str, str] = field(default_factory=dict, repr=False)
    memory_authorizations: Mapping[str, MemoryAuthorization] = field(default_factory=dict, repr=False)

    def __post_init__(self):
        if any(not isinstance(value, str) or not value.strip() or len(value) > 128
               for value in (self.user_id, self.session_id, self.correlation_id)):
            raise ValueError('Trusted user/session/correlation context is required')
        if type(self.dialogue_ready) is not bool:
            raise ValueError('Dialogue readiness must be a trusted boolean')
        object.__setattr__(self, 'resolved_targets', MappingProxyType(dict(self.resolved_targets)))
        object.__setattr__(self, 'dependency_record_ids', MappingProxyType(dict(self.dependency_record_ids)))
        if any(not isinstance(value, MemoryAuthorization) for value in self.memory_authorizations.values()):
            raise ValueError('Memory authorization must come from typed application context')
        object.__setattr__(self, 'memory_authorizations', MappingProxyType(dict(self.memory_authorizations)))
        for name in ('allowed_tools', 'confirmed_call_keys', 'satisfied_preconditions', 'completed_dependencies'):
            object.__setattr__(self, name, frozenset(getattr(self, name)))

    def call_key(self, call: ToolCall):
        arguments = dict(call.arguments)
        parent = arguments.get('linked_operation_id')
        if (call.tool_id == 'reminder.create' and parent in self.dependency_record_ids
                and arguments.get('linked_record_id') == self.dependency_record_ids[parent]):
            arguments.pop('linked_record_id', None)
        value = [self.user_id, self.session_id, self.correlation_id, call.operation_id,
                 call.tool_id, arguments, call.depends_on]
        return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def argument_errors(model, arguments):
    try:
        model.model_validate(arguments)
        return []
    except ValidationError as error:
        return ['.'.join(map(str, item['loc'])) + ':' + item['type']
                for item in error.errors(include_input=False, include_url=False)]


@dataclass(frozen=True)
class BackendToolReply:
    status: ResultStatus
    data: Mapping | None = field(default=None, repr=False)
    backend_confirmed: bool = False
    receipt: BackendReceipt | None = field(default=None, repr=False)


class BackendToolAdapter(Protocol):
    def availability(self, tool_id: str) -> ToolAvailability: ...

    def supports(self, tool_id: str) -> bool: ...

    def supports_idempotency(self, tool_id: str) -> bool: ...

    async def execute(self, tool_id: str, arguments: BaseModel, context: TrustedToolContext,
                      *, operation_id: str, idempotency_key: str | None,
                      request_context: AudioContext) -> BackendToolReply: ...


class UnavailableBackendAdapter:
    def availability(self, tool_id):
        return ToolAvailability()

    def supports(self, tool_id):
        return False

    def supports_idempotency(self, tool_id):
        return False

    async def execute(self, tool_id, arguments, context, *, operation_id,
                      idempotency_key=None, request_context):
        return BackendToolReply('UNAVAILABLE')


class ToolExecutionBoundary:
    def __init__(self, adapter: BackendToolAdapter | None = None, *, timeout_seconds=30):
        if not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 300:
            raise ValueError('A finite PA execution deadline of at most 300 seconds is required')
        self.adapter = adapter if adapter is not None else UnavailableBackendAdapter()
        self.timeout_seconds = timeout_seconds

    def availability(self, tool_id):
        tool = get_tool(tool_id)
        if tool is None:
            return ToolAvailability(status='DISABLED')
        if tool.status != 'AVAILABLE':
            return ToolAvailability(status=tool.status)
        try:
            actual = self.adapter.availability(tool_id)
            if not isinstance(actual, ToolAvailability):
                return ToolAvailability(status='UNAVAILABLE')
            if actual.status != 'AVAILABLE':
                return actual
            if not actual.verified or self.adapter.supports(tool_id) is not True:
                return ToolAvailability(status='UNAVAILABLE')
            return actual
        except Exception:
            return ToolAvailability(status='UNAVAILABLE')

    def can_retry_write(self, tool_id):
        tool = get_tool(tool_id)
        if tool is None or tool.access != 'WRITE':
            return False
        available = self.availability(tool_id)
        try:
            return (available.status == 'AVAILABLE' and available.verified and available.idempotency_verified
                    and (tool_id not in ('memory.update', 'memory.delete') or available.revision_verified)
                    and self.adapter.supports_idempotency(tool_id) is True)
        except Exception:
            return False

    async def execute(self, call: ToolCall, context: TrustedToolContext, *, request_context=None):
        call = call.model_copy(deep=True)
        def result(status, code, **kwargs):
            return ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                              status=status, code=code, **kwargs)

        tool = get_tool(call.tool_id)
        if tool is None or call.feature not in tool.pa_codes:
            return result('VALIDATION_ERROR', 'UNKNOWN_TOOL_OR_FEATURE')
        if tool.access == 'PROPOSAL':
            return result('UNAVAILABLE', 'PROPOSAL_ONLY_NO_EXECUTION')
        errors = argument_errors(tool.input_model, call.arguments)
        errors.extend(call.validation_errors)
        if call.operation_id in call.depends_on or len(set(call.depends_on)) != len(call.depends_on):
            errors.append('invalid_dependencies')
        if errors:
            return result('VALIDATION_ERROR', 'INVALID_ARGUMENTS', validation_errors=errors)
        if not context.dialogue_ready:
            return result('FORBIDDEN', 'DIALOGUE_NOT_READY')
        if call.tool_id not in context.allowed_tools:
            return result('FORBIDDEN', 'TOOL_NOT_AUTHORIZED')
        if tool.confirmation_required and context.call_key(call) not in context.confirmed_call_keys:
            return result('FORBIDDEN', 'CONFIRMATION_REQUIRED')
        if (call.tool_id == 'memory.query' and call.arguments.get('purpose') == 'management' and
                (call.operation_id, 'memory_management_lookup') not in context.satisfied_preconditions):
            return result('FORBIDDEN', 'MEMORY_MANAGEMENT_SCOPE_REQUIRED')
        if call.tool_id in ('memory.create', 'memory.update', 'memory.delete'):
            grant = context.memory_authorizations.get(call.operation_id)
            if (grant is None or (grant.owner_user_id, grant.session_id, grant.correlation_id) !=
                    (context.user_id, context.session_id, context.correlation_id)):
                return result('FORBIDDEN', 'MEMORY_OWNERSHIP_CONTEXT_REQUIRED')
            if (grant.proposal_revision != call.arguments['proposal_revision'] or
                    grant.confirmed_call_key != context.call_key(call)):
                return result('FORBIDDEN', 'STALE_MEMORY_CONFIRMATION')
            if call.tool_id != 'memory.delete' and not grant.consent_to_store:
                return result('FORBIDDEN', 'MEMORY_STORAGE_CONSENT_REQUIRED')
            if call.tool_id in ('memory.update', 'memory.delete'):
                if (grant.target is None or any(call.arguments.get(name) != value
                        for name, value in grant.target.model_dump().items())):
                    return result('FORBIDDEN', 'MEMORY_SNAPSHOT_REQUIRED')
                if call.tool_id == 'memory.update' and grant.update_mode != call.arguments['update_mode']:
                    return result('FORBIDDEN', 'MEMORY_UPDATE_MODE_REQUIRED')
        available = self.availability(call.tool_id)
        if available.status != 'AVAILABLE':
            return result('UNAVAILABLE', {'NOT_IMPLEMENTED': 'NOT_IMPLEMENTED', 'DISABLED': 'DISABLED',
                                         'UNAVAILABLE': 'TEMPORARILY_UNAVAILABLE'}[available.status])
        if call.tool_id in ('memory.update', 'memory.delete') and not available.revision_verified:
            return result('FORBIDDEN', 'MEMORY_REVISION_NOT_VERIFIED')
        if call.tool_id in ('memory.create', 'memory.update', 'memory.delete') and not self.can_retry_write(call.tool_id):
            return result('FORBIDDEN', 'MEMORY_IDEMPOTENCY_NOT_VERIFIED')
        if 'target_id' in call.arguments and context.resolved_targets.get(call.operation_id) != call.arguments['target_id']:
            return result('FORBIDDEN', 'TARGET_NOT_RESOLVED')
        required = set(tool.preconditions)
        if call.arguments.get('linked_operation_id'):
            required.add('linked_creation_succeeded')
            parent = call.arguments['linked_operation_id']
            if (parent not in call.depends_on or parent not in context.completed_dependencies
                    or not context.dependency_record_ids.get(parent)
                    or call.arguments.get('linked_record_id') != context.dependency_record_ids[parent]):
                return result('FORBIDDEN', 'DEPENDENCY_RESULT_REQUIRED')
        changes = call.arguments.get('changes', {})
        if isinstance(changes, dict) and changes.get('reschedule_requested'):
            required.discard('preserve_existing_schedule')
            required.add('explicit_reschedule_confirmed')
        if any((call.operation_id, name) not in context.satisfied_preconditions for name in required):
            return result('FORBIDDEN', 'PRECONDITION_REQUIRED')
        if any(dep not in context.completed_dependencies for dep in call.depends_on):
            return result('FORBIDDEN', 'DEPENDENCY_NOT_EXECUTED')
        request_context = request_context or AudioContext(deadline=time.monotonic() + self.timeout_seconds)
        key = context.call_key(call) if tool.access == 'WRITE' else None
        dispatched = False

        def uncertain(status, code):
            unknown = dispatched and tool.access == 'WRITE'
            return result(status, code, outcome='UNKNOWN' if unknown else 'NOT_EXECUTED',
                          reconciliation_state='PENDING_RECONCILIATION' if unknown else 'NOT_REQUIRED')

        try:
            arguments = tool.input_model.model_validate(call.arguments)
            request_context.check()

            async def dispatch():
                nonlocal dispatched
                dispatched = True
                return await self.adapter.execute(call.tool_id, arguments, context,
                    operation_id=call.operation_id, idempotency_key=key, request_context=request_context)

            reply = await request_context.run(dispatch)
            if reply.status == 'SUCCESS':
                if reply.backend_confirmed is not True or reply.data is None:
                    return uncertain('UNAVAILABLE', 'BACKEND_ACK_REQUIRED')
                if not isinstance(reply.receipt, BackendReceipt):
                    return uncertain('UNAVAILABLE', 'BACKEND_RECEIPT_REQUIRED')
                if not reply.receipt.matches(call.tool_id, call.operation_id, context, key):
                    return uncertain('UNAVAILABLE', 'BACKEND_CONTEXT_MISMATCH')
                output = tool.output_model.model_validate(dict(reply.data))
                if call.tool_id == 'memory.query':
                    if (output.query_digest != query_digest(call.arguments['query']) or
                            len({item.id for item in output.items}) != len(output.items) or
                            len(output.items) > call.arguments.get('limit', 8)):
                        return result('FORBIDDEN', 'MEMORY_RESPONSE_SCOPE_MISMATCH')
                    for item in output.items:
                        use_only = call.arguments.get('purpose', 'personalization') == 'personalization' or call.arguments.get('permitted_use_only', True)
                        if (item.owner_user_id != context.user_id or (use_only and (
                                not item.consent_to_store or not item.consent_to_use or not item.active or
                                not item.sensitivity_reviewed or
                                (item.expires_at and datetime.fromisoformat(item.expires_at) <= datetime.now(timezone.utc)))) or
                                (call.arguments.get('memory_id') and item.id != call.arguments['memory_id']) or
                                (call.arguments.get('topic_group') and item.topic_group != call.arguments['topic_group'])):
                            return result('FORBIDDEN', 'MEMORY_NOT_PERMITTED_FOR_USE')
                elif call.tool_id in ('memory.create', 'memory.update', 'memory.delete'):
                    scope_matches = (output.memory_id == call.arguments['memory_id']
                        if call.arguments.get('memory_id') else
                        output.topic_group == call.arguments.get('topic_group') and output.memory_id is None)
                    if (output.owner_user_id != context.user_id or
                            output.proposal_revision != call.arguments['proposal_revision'] or
                            (call.tool_id == 'memory.create' and (not output.memory_id or
                             (call.arguments.get('topic_group') and output.topic_group != call.arguments['topic_group']))) or
                            (call.tool_id != 'memory.create' and (
                                not scope_matches or
                                output.revision <= call.arguments['expected_revision']))):
                        return uncertain('UNAVAILABLE', 'MEMORY_RESPONSE_SCOPE_OR_REVISION_MISMATCH')
                return result('SUCCESS', 'BACKEND_CONFIRMED', executed=True,
                              data=output.model_dump(mode='json'), outcome='CONFIRMED', receipt=reply.receipt)
            if reply.status in ('UNAVAILABLE', 'TIMEOUT'):
                return uncertain(reply.status, 'BACKEND_' + reply.status)
            return result(reply.status, 'BACKEND_' + reply.status, outcome='REJECTED')
        except asyncio.CancelledError:
            request_context.cancel()
            raise
        except AudioError as error:
            return uncertain('UNAVAILABLE' if error.code == ErrorCode.CANCELLED else 'TIMEOUT',
                             'BACKEND_CANCELLED' if error.code == ErrorCode.CANCELLED else 'BACKEND_TIMEOUT')
        except (TimeoutError, httpx.TimeoutException):
            return uncertain('TIMEOUT', 'BACKEND_TIMEOUT')
        except BackendError as error:
            if error.code.value == 'backend_cancelled':
                return uncertain('UNAVAILABLE', 'BACKEND_CANCELLED')
            status = ('FORBIDDEN' if error.status in (401, 403) else 'NOT_FOUND'
                      if error.status == 404 else 'CONFLICT' if error.status == 409 else
                      'VALIDATION_ERROR' if error.status in (400, 422) else
                      'TIMEOUT' if error.code.value == 'backend_timeout' or error.status in (408, 504) else 'UNAVAILABLE')
            return (uncertain(status, 'BACKEND_' + status) if status in ('TIMEOUT', 'UNAVAILABLE')
                    else result(status, 'BACKEND_' + status, outcome='REJECTED'))
        except Exception:
            return uncertain('UNAVAILABLE', 'INVALID_OR_UNAVAILABLE_BACKEND')
