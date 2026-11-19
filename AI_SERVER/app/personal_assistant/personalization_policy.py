"""PA-05 policy shared with Group III; no persistence or channel delivery."""
import hashlib
import asyncio
import math
import time
from typing import Literal, Protocol

from pydantic import ConfigDict, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.personal_assistant.schema import Entities, Operation, StrictModel
from app.personal_assistant.memory_understanding import guard_memory
from app.personal_assistant.execution_contracts import ToolAvailability
from app.services.audio_context import AudioContext
from app.personal_assistant.tool_registry import get_tool


class PersonalizationSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='LOCAL_PA05_', extra='ignore')
    # No business lifetime is invented when the configuration has not been agreed.
    max_age_seconds: int | None = Field(default=None, gt=0)


class MemoryUseReview(StrictModel):
    decision: Literal['use', 'clarify', 'blocked']


def prohibited(content):
    if len(content) > 16000:
        return True
    op = Operation(id='op1', intent='policy review', feature='PA-04', action='create',
                   source_text=content, entities=Entities())
    guard_memory(op)
    return op.memory.storage_policy == 'PROHIBITED'


def delivery_status():
    return {channel: {'status': 'NOT_CONNECTED', 'sent': False} for channel in ('website', 'xiaozhi_voice')}


def acknowledged_change(workflow, context):
    """Only a trusted in-process workflow carrying matching receipts can yield success text."""
    if (workflow.user_id, workflow.session_id, workflow.correlation_id) != (
            context.user_id, context.session_id, context.correlation_id):
        raise PermissionError('Memory change owner mismatch')
    messages, events, unverified = [], [], False
    for op in workflow.memory_operations:
        if op.stage not in ('CONFIRMED', 'ACKNOWLEDGED'):
            continue
        steps = [s for s in workflow.steps if s.call.operation_id in op.write_operation_ids]
        if not steps or len(steps) != len(op.write_operation_ids):
            unverified |= bool(op.write_operation_ids) or op.stage == 'ACKNOWLEDGED'
            continue
        for step in steps:
            result = step.result
            if step.state != 'SUCCEEDED' or result is None or result.status != 'SUCCESS':
                continue
            key = context.call_key(step.call)
            if (step.state != 'SUCCEEDED' or not result or not result.executed or not result.receipt
                    or result.outcome != 'CONFIRMED' or not result.data
                    or not result.receipt.matches(step.call.tool_id, step.call.operation_id, context, step.idempotency_key)
                    or step.call.tool_id != 'memory.' + ('create' if op.action == 'propose' else op.action)
                    or result.data.get('owner_user_id') != context.user_id
                    or step.idempotency_key != key or step.confirmed_key != key
                    or result.data.get('proposal_revision') != step.call.arguments.get('proposal_revision')
                    or ('memory_id' in step.call.arguments and result.data.get('memory_id') != step.call.arguments['memory_id'])):
                unverified = True
                continue
            args = step.call.arguments
            try:
                tool = get_tool(step.call.tool_id)
                tool.input_model.model_validate(args)
                tool.output_model.model_validate(result.data)
                if 'expected_revision' in args and result.data['revision'] <= args['expected_revision']:
                    raise ValueError('Stale memory acknowledgement')
            except Exception:
                unverified = True
                continue
            if step.call.tool_id == 'memory.delete':
                before = next((r for r in op.candidates if r.id == args['memory_id']), None)
                if before and before.revision == args['expected_revision']:
                    messages.append('Đã xóa trí nhớ “' + before.content + '” (' + before.id + ').')
                else:
                    unverified = True
            elif not prohibited(args['content']):
                content = args['content']
                if step.call.tool_id == 'memory.update' and args.get('update_mode') == 'append':
                    before = next((r for r in op.candidates if r.id == args['memory_id']), None)
                    if before is None or before.revision != args['expected_revision']:
                        unverified = True
                        continue
                    content = before.content + '\n' + content
                messages.append(('Đã lưu: ' if step.call.tool_id == 'memory.create' else 'Đã cập nhật: ')
                                + content + '.')
            else:
                unverified = True
                continue
            if len(messages) > len(events):
                event_id = hashlib.sha256(('memory.changed:' + step.idempotency_key).encode()).hexdigest()
                events.append(dict(event_id=event_id, type='memory.changed', operation_id=step.call.operation_id,
                                   tool_id=step.call.tool_id, content=messages[-1]))
    text = ' '.join(messages)
    if messages and workflow.state != 'COMPLETED':
        text += ' Các mục còn lại chưa được Backend xác nhận.'
    event_id = hashlib.sha256((workflow.id + ':' + str(workflow.revision) + ':' + text).encode()).hexdigest() if messages else None
    pending = unverified or workflow.reconciliation_state == 'PENDING_RECONCILIATION' or any(
        s.outcome_uncertain or s.reconciliation_state == 'PENDING_RECONCILIATION' for s in workflow.steps)
    complete = (workflow.state == 'COMPLETED' and not pending and bool(events) and
                len(events) == sum(len(op.write_operation_ids) for op in workflow.memory_operations))
    fallback = ('Kết quả ghi chưa xác định; cần đối soát Backend, chưa thể xác nhận thành công hoặc thực hiện lại.'
                if pending else 'Chưa có thay đổi trí nhớ được Backend xác nhận.')
    return {'content': text or fallback,
            'executed': bool(messages), 'workflow_id': workflow.id, 'revision': workflow.revision,
            'workflow_status': workflow.state, 'code': 'INVALID_MEMORY_ACK' if unverified else workflow.code,
            'status': 'COMPLETED' if complete else 'PARTIALLY_COMPLETED' if messages else
                      'BLOCKED' if workflow.state == 'COMPLETED' else workflow.state,
            'reconciliation_state': 'PENDING_RECONCILIATION' if pending else 'NOT_REQUIRED',
            'steps': [dict(operation_id=s.call.operation_id, tool_id=s.call.tool_id, state=s.state,
                           code=s.result.code if s.result else None, outcome=s.execution_outcome,
                           reconciliation_state=s.reconciliation_state,
                           executed=bool(s.result and s.result.executed)) for s in workflow.steps],
            'complete': complete,
            'notification': {'event_id': event_id, 'type': 'memory.changed', 'prepared': bool(messages), 'events': events},
            'delivery': delivery_status()}


class MemoryNotificationReceipt(StrictModel):
    event_id: str
    channel: Literal['website', 'xiaozhi_voice']
    user_id: str = Field(repr=False, exclude=True)
    session_id: str = Field(repr=False, exclude=True)
    correlation_id: str = Field(repr=False, exclude=True)
    accepted: Literal[True]

    @field_validator('accepted', mode='before')
    @classmethod
    def positive_ack(cls, value):
        if value is not True:
            raise ValueError('A positive transport acknowledgement is required')
        return value


class MemoryNotificationScope(StrictModel):
    model_config = ConfigDict(frozen=True)
    channel: Literal['website', 'xiaozhi_voice']
    user_id: str = Field(repr=False)
    session_id: str = Field(repr=False)
    correlation_id: str = Field(repr=False)


class MemoryNotificationChannel(Protocol):
    """Registered by authenticated application code after transport/ACK verification."""
    scope: MemoryNotificationScope
    def availability(self, context) -> ToolAvailability: ...
    async def send(self, event, context, *, idempotency_key, request_context) -> MemoryNotificationReceipt: ...


async def deliver_memory_notification(workflow, context, *, channels=None, timeout_seconds=5,
                                      request_context=None):
    """Optional one-shot delivery seam; no endpoint, background sender or automatic retry."""
    if type(timeout_seconds) not in (int, float) or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 30:
        raise ValueError('A bounded notification deadline is required')
    channels = dict(channels or {})
    if set(channels) - {'website', 'xiaozhi_voice'}:
        raise ValueError('Only verified Website/Xiaozhi channel bindings are supported')
    result = acknowledged_change(workflow, context)
    if not result['notification']['prepared']:
        return result
    scope = AudioContext(deadline=min(request_context.deadline, time.monotonic() + timeout_seconds)
                         if request_context else time.monotonic() + timeout_seconds)
    unregister = request_context.on_cancel(scope.cancel) if request_context else lambda: None
    try:
        for name, binding in channels.items():
            try:
                target = binding.scope
                if (not isinstance(target, MemoryNotificationScope) or
                        (target.channel, target.user_id, target.session_id, target.correlation_id) !=
                        (name, context.user_id, context.session_id, context.correlation_id)):
                    result['delivery'][name] = dict(status='FORBIDDEN', sent=False)
                    continue
                available = binding.availability(context)
                if (not isinstance(available, ToolAvailability) or available.status != 'AVAILABLE'
                        or not available.verified or not available.idempotency_verified):
                    result['delivery'][name] = dict(status='BLOCKED', sent=False)
                    continue
            except Exception:
                result['delivery'][name] = dict(status='UNAVAILABLE', sent=False)
                continue
            delivered = []
            for event in result['notification']['events']:
                dispatched = False

                async def send():
                    nonlocal dispatched
                    dispatched = True
                    return await binding.send(dict(event), context, idempotency_key=event['event_id'], request_context=scope)

                try:
                    ack = await scope.run(send)
                    if (not isinstance(ack, MemoryNotificationReceipt) or ack.accepted is not True or
                            (ack.event_id, ack.channel, ack.user_id, ack.session_id, ack.correlation_id) !=
                            (event['event_id'], name, context.user_id, context.session_id, context.correlation_id)):
                        raise ValueError('Notification acknowledgement scope mismatch')
                    delivered.append(dict(event_id=event['event_id'], status='ACKNOWLEDGED', sent=True))
                except asyncio.CancelledError:
                    raise
                except Exception:
                    delivered.append(dict(event_id=event['event_id'], status='UNKNOWN' if dispatched else 'UNAVAILABLE', sent=False))
            sent = all(item['sent'] for item in delivered)
            result['delivery'][name] = dict(status='ACKNOWLEDGED' if sent else 'PENDING_DELIVERY',
                                           sent=sent, events=delivered)
    finally:
        unregister()
    return result
