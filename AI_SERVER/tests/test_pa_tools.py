import asyncio
from dataclasses import replace
from datetime import datetime
import json

import pytest
from pydantic import ValidationError

from app.personal_assistant.schema import Analysis
from app.personal_assistant.tool_boundary import (BackendToolReply, ToolCall,
    ToolExecutionBoundary, TrustedToolContext)
from app.personal_assistant.tool_planning import plan_tools
from app.personal_assistant.tool_registry import CAPABILITIES, TOOLS
from app.personal_assistant.execution_contracts import BackendReceipt, ToolAvailability


def operation(feature='PA-01', action='create', **changes):
    op = dict(id='op1', intent='test', feature=feature, action=action, source_text='test',
              entities={'title': 'học', 'start': {'raw': 'test', 'date': '2026-11-16', 'time': '19:00'},
                        'end': {'raw': 'test', 'date': '2026-11-16', 'time': '21:00'}})
    op.update(changes)
    return op


def analysis(*ops):
    return Analysis(scope='pa', operations=list(ops), raw_input='test',
                    reference_time=datetime.fromisoformat('2026-11-15T10:00:00+07:00'),
                    timezone='Asia/Bangkok', model='gemma')


def context(**changes):
    data = dict(user_id='user-a', session_id='session-a', correlation_id='proposal-a',
                dialogue_ready=True, allowed_tools=frozenset(TOOLS), resolved_targets={'op1': 'record-1'})
    data.update(changes)
    return TrustedToolContext(**data)


def event_call():
    return plan_tools(analysis(operation()), context()).calls[0]


def confirmed(ctx, call):
    return replace(ctx, confirmed_call_keys=frozenset({ctx.call_key(call)}))


def execute(call, ctx, adapter=None):
    return asyncio.run(ToolExecutionBoundary(adapter).execute(call, ctx))


@pytest.mark.parametrize('feature,action,entities,tool_id', [
    ('PA-01', 'create', None, 'event.create'),
    ('PA-14', 'query', None, 'event.check_conflict'),
    ('PA-02', 'create', {'content': 'uống nước', 'start': {'raw': 'test', 'date': '2026-11-16', 'time': '08:00'}}, 'reminder.create'),
    ('PA-06', 'create', {'title': 'ôn từ', 'goal': 'ôn từ vựng',
        'start': {'raw': 'test', 'date': '2026-11-16'}, 'end': {'raw': 'test', 'date': '2026-11-30'},
        'sessions_per_week': 3, 'duration_minutes': 60}, 'plan.create'),
    ('PA-10', 'create', {'title': 'báo cáo', 'deadline': {'raw': 'test', 'date': '2026-11-20'}}, 'task.create'),
    ('PA-11', 'update', {'target_query': 'báo cáo', 'priority': 'high'}, 'task.update_priority'),
    ('PA-12', 'set_status', {'target_query': 'buổi 2', 'status': 'completed'}, 'task.update_progress'),
    ('PA-04', 'propose', {'content': 'thích ăn kem'}, 'memory.propose'),
    ('PA-08', 'query', {}, 'schedule.query'),
    ('PA-18', 'query', {}, 'report.generate'),
    ('PA-15', 'query', {}, 'task.unfinished_query'),
    ('PA-22', 'query', {}, 'deadline.query'),
    ('PA-11', 'query', {}, 'task.priority_query'),
    ('PA-12', 'query', {}, 'task.progress_query'),
])
def test_mapping_validated_arguments(feature, action, entities, tool_id):
    op = operation(feature, action)
    if entities is not None:
        op['entities'] = entities
    parsed = analysis(op)
    before = parsed.model_dump_json()
    plan = plan_tools(parsed, context())
    routed = plan.proposals if tool_id == 'memory.propose' else plan.calls
    assert routed[0].tool_id == tool_id
    assert routed[0].validation_errors == []
    assert plan.integration_status == 'READY'
    assert parsed.model_dump_json() == before


def test_registry_all_features_and_schemas_are_explicit_and_unavailable():
    expected = {'PA-01', 'PA-02', 'PA-04', 'PA-05', 'PA-06', 'PA-08', 'PA-09',
                'PA-10', 'PA-11', 'PA-12', 'PA-14', 'PA-15', 'PA-18', 'PA-22', 'PA-23'}
    assert {code for tool in TOOLS.values() for code in tool.pa_codes} | set(CAPABILITIES) == expected
    for tool in TOOLS.values():
        contract = tool.contract()
        assert contract['status'] == 'NOT_IMPLEMENTED'
        assert 'endpoint' not in contract
        assert contract['input_schema']['additionalProperties'] is False
        assert contract['output_schema']['additionalProperties'] is False
        assert tool.confirmation_required == (tool.access in ('WRITE', 'PROPOSAL'))
    for code in ('PA-05', 'PA-09', 'PA-23'):
        assert CAPABILITIES[code][0] == 'DISABLED'
        assert all(code not in tool.pa_codes for tool in TOOLS.values())
    for tool_id in ('event.check_conflict', 'schedule.query', 'report.generate'):
        assert TOOLS[tool_id].access == 'READ'
    with pytest.raises(TypeError):
        TOOLS['invented'] = None


def test_capabilities_and_unmapped_actions_never_invent_tools():
    for feature in ('PA-05', 'PA-09', 'PA-23'):
        plan = plan_tools(analysis(operation(feature)), context())
        assert plan.calls == [] and 'op1' in plan.unsupported_operations
    plan = plan_tools(analysis(operation(action='orchestrate')), context())
    assert plan.calls == [] and plan.unsupported_operations


def test_unknown_tool_and_mismatched_feature_are_rejected():
    call = event_call()
    for changed in (call.model_copy(update={'tool_id': 'shell.execute'}),
                    call.model_copy(update={'feature': 'PA-04'})):
        result = execute(changed, context())
        assert result.status == 'VALIDATION_ERROR' and not result.executed


@pytest.mark.parametrize('bad', [{'title': 'học'}, {'title': 4}, {'user_id': 'other'}, {'endpoint': '/fake'},
                               {'token': 'secret'}, {'duration_minutes': '60'}])
def test_invalid_or_missing_input_is_rejected_without_echoing_values(bad):
    call = event_call().model_copy(update={'arguments': bad})
    result = execute(call, context())
    assert result.status == 'VALIDATION_ERROR' and result.validation_errors
    assert 'secret' not in result.model_dump_json()
    assert result.data is None and not result.executed


def test_unconfirmed_write_and_missing_h02_are_blocked():
    call = event_call()
    assert execute(call, context()).code == 'CONFIRMATION_REQUIRED'
    assert execute(call, confirmed(context(dialogue_ready=False), call)).code == 'DIALOGUE_NOT_READY'


class ForbiddenAdapter:
    def supports(self, tool_id):
        raise AssertionError('No PA adapter may be consulted for unimplemented tools')

    async def execute(self, *args, **kwargs):
        raise AssertionError('No Backend or SQL call is allowed')


def test_unimplemented_tools_never_dispatch_or_report_success(monkeypatch):
    import socket
    import sqlite3
    def forbidden(*args, **kwargs):
        raise AssertionError('No network or SQL in the unimplemented boundary')
    call = event_call()
    async def run():
        with monkeypatch.context() as patch:
            patch.setattr(socket.socket, 'connect', forbidden)
            patch.setattr(sqlite3, 'connect', forbidden)
            return await ToolExecutionBoundary(ForbiddenAdapter()).execute(call, confirmed(context(), call))
    result = asyncio.run(run())
    assert (result.status, result.code, result.executed, result.data) == (
        'UNAVAILABLE', 'NOT_IMPLEMENTED', False, None)


def test_read_needs_authorization_but_never_write_confirmation():
    call = plan_tools(analysis(operation('PA-08', 'query', entities={})), context()).calls[0]
    assert execute(call, context(), ForbiddenAdapter()).code == 'NOT_IMPLEMENTED'
    assert execute(call, context(allowed_tools=frozenset())).code == 'TOOL_NOT_AUTHORIZED'


def test_three_intents_keep_dependency_order_and_isolate_arguments():
    ops = [operation(), operation('PA-02', id='op2', entities={'reminder_offset_minutes': 30}, depends_on=['op1']),
           operation('PA-04', 'propose', id='op3', entities={'content': 'thích ăn kem'})]
    plan = plan_tools(analysis(*ops), context())
    assert [call.tool_id for call in plan.calls] == ['event.create', 'reminder.create']
    assert [call.tool_id for call in plan.proposals] == ['memory.propose']
    assert plan.calls[1].depends_on == ['op1']
    assert plan.calls[1].arguments['linked_operation_id'] == 'op1'
    assert plan.calls[1].arguments['offset_minutes'] == 30
    assert 'title' not in plan.calls[1].arguments
    assert plan.proposals[0].depends_on == []
    assert set(plan.proposals[0].arguments) == {'content'}
    assert not any(call.validation_errors for call in plan.calls)


def test_unavailable_parent_keeps_other_intents_and_blocks_its_dependent():
    plan = plan_tools(analysis(operation('PA-05'),
        operation('PA-02', id='op2', entities={'reminder_offset_minutes': 30}, depends_on=['op1']),
        operation('PA-04', 'propose', id='op3', entities={'content': 'kem'})), context())
    assert 'op1' in plan.unsupported_operations
    assert [call.operation_id for call in plan.calls] == ['op2']
    assert [call.operation_id for call in plan.proposals] == ['op3']
    assert 'dependency_unavailable:op1' in plan.calls[0].validation_errors
    assert execute(plan.calls[0], confirmed(context(), plan.calls[0])).status == 'VALIDATION_ERROR'


def test_same_intent_normalization_does_not_fill_missing_values():
    reminder = operation('PA-02', entities={'title': 'uống nước',
        'start': {'raw': 'test', 'date': '2026-11-16', 'time': '08:00'}})
    call = plan_tools(analysis(reminder), context()).calls[0]
    assert call.arguments['content'] == 'uống nước' and not call.validation_errors
    for value, expected in [('Học tập', 'study'), ('PERSONAL', 'personal')]:
        plan = operation('PA-06', entities={'title': 'học', 'category': value})
        call = plan_tools(analysis(plan), context()).calls[0]
        assert call.arguments['category'] == expected
        assert 'goal:missing' in call.validation_errors


def test_call_dependency_validation_is_rechecked_at_boundary():
    call = event_call().model_copy(update={'depends_on': ['op1']})
    result = execute(call, confirmed(context(), call))
    assert result.status == 'VALIDATION_ERROR' and 'invalid_dependencies' in result.validation_errors


def test_context_readiness_does_not_accept_llm_style_string_booleans():
    with pytest.raises(ValueError):
        context(dialogue_ready='true')


def test_unresolved_target_is_not_synthesized():
    op = operation('PA-11', 'update', entities={'priority': 'high', 'target_query': 'báo cáo'})
    call = plan_tools(analysis(op), context(resolved_targets={})).calls[0]
    assert 'target_id' not in call.arguments
    assert 'target_id:missing' in call.validation_errors
    assert call.target_query == 'báo cáo'


def test_plan_end_date_update_keeps_existing_schedule_and_no_extra_calls():
    op = operation('PA-06', 'update', entities={'target_query': 'ôn từ',
                    'end': {'raw': 'test', 'date': '2026-11-30'}})
    plan = plan_tools(analysis(op), context())
    assert len(plan.calls) == 1
    call = plan.calls[0]
    assert call.arguments['changes'] == {'end': {'raw': 'test', 'date': '2026-11-30'}}
    assert 'preserve_existing_schedule' in TOOLS[call.tool_id].preconditions


def test_progress_rejects_manual_percent_and_partial_session_result():
    op = operation('PA-12', 'set_status', entities={'status': 'in_progress'})
    call = plan_tools(analysis(op), context()).calls[0]
    assert call.validation_errors
    args = dict(target_id='record-1', progress_percent=50)
    assert execute(call.model_copy(update={'arguments': args}), context()).status == 'VALIDATION_ERROR'


def test_context_is_not_a_model_argument_and_confirmation_cannot_cross_users():
    call = event_call()
    owner = confirmed(context(), call)
    other = replace(owner, user_id='user-b')
    assert owner.call_key(call) != other.call_key(call)
    assert execute(call, other).code == 'CONFIRMATION_REQUIRED'
    assert execute(call, owner).code == 'NOT_IMPLEMENTED'
    changed_args = dict(call.arguments, title='đi bộ')
    changed = call.model_copy(update={'arguments': changed_args})
    assert execute(changed, owner).code == 'CONFIRMATION_REQUIRED'
    public = plan_tools(analysis(operation()), owner).model_dump_json()
    for private in ('user-a', 'session-a', 'proposal-a', 'confirmed_call_keys', 'allowed_tools', 'token'):
        assert private not in public and private not in repr(owner)
    with pytest.raises(ValidationError):
        ToolCall(**call.model_dump(), user_id='other')


class FutureAdapter:
    def __init__(self, *, acknowledge=True, data=None, error=None):
        self.acknowledge, self.data, self.error = acknowledge, data, error
        self.calls = []

    def supports(self, tool_id):
        return True

    def availability(self, tool_id):
        return ToolAvailability(status='AVAILABLE', endpoint_verified=True, contract_verified=True, auth_verified=True)

    async def execute(self, tool_id, arguments, ctx, *, operation_id, idempotency_key, request_context):
        self.calls.append((tool_id, arguments, ctx, idempotency_key))
        if self.error:
            raise self.error
        receipt = BackendReceipt(execution_id='test-receipt', tool_id=tool_id, operation_id=operation_id,
            user_id=ctx.user_id, session_id=ctx.session_id, correlation_id=ctx.correlation_id,
            idempotency_key=idempotency_key)
        return BackendToolReply('SUCCESS', self.data or {'id': 'record-1'}, self.acknowledge, receipt)


def future_binding(monkeypatch, call):
    from app.personal_assistant import tool_boundary
    spec = TOOLS[call.tool_id]
    monkeypatch.setattr(tool_boundary, 'get_tool', lambda tool_id: replace(spec, status='AVAILABLE'))
    ctx = confirmed(context(), call)
    return replace(ctx, satisfied_preconditions=frozenset((call.operation_id, name) for name in spec.preconditions))


def test_fake_success_without_backend_ack_and_invalid_output_are_rejected(monkeypatch):
    call = event_call()
    ctx = future_binding(monkeypatch, call)
    for adapter in (FutureAdapter(acknowledge=False), FutureAdapter(data={'id': 'record-1', 'token': 'private'})):
        result = execute(call, ctx, adapter)
        assert result.status == 'UNAVAILABLE' and not result.executed and result.data is None
        assert 'private' not in result.model_dump_json()


def test_future_write_has_bound_idempotency_and_backend_validated_output(monkeypatch):
    call = event_call()
    ctx = future_binding(monkeypatch, call)
    adapter = FutureAdapter()
    result = execute(call, ctx, adapter)
    assert result.status == 'SUCCESS' and result.executed
    assert adapter.calls[0][3] == ctx.call_key(call)
    assert 'user-a' not in adapter.calls[0][3]
    assert ctx.call_key(call) != replace(ctx, correlation_id='another-proposal').call_key(call)


def test_future_preconditions_and_dependencies_are_not_auto_satisfied(monkeypatch):
    call = event_call()
    ctx = future_binding(monkeypatch, call)
    adapter = FutureAdapter()
    assert execute(call, replace(ctx, satisfied_preconditions=frozenset()), adapter).code == 'PRECONDITION_REQUIRED'
    dependent = call.model_copy(update={'depends_on': ['op9']})
    assert execute(dependent, confirmed(ctx, dependent), adapter).code == 'DEPENDENCY_NOT_EXECUTED'
    assert not adapter.calls


def test_timeout_does_not_report_execution(monkeypatch):
    call = event_call()
    ctx = future_binding(monkeypatch, call)
    result = execute(call, ctx, FutureAdapter(error=TimeoutError('private')))
    assert result.status == 'TIMEOUT' and not result.executed and result.data is None
