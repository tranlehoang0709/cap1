"""PA-04 contract/routing safety. Backend success fixtures are unit-only."""
import asyncio
from dataclasses import replace
from datetime import datetime

import pytest
from pydantic import ValidationError

from app.personal_assistant import tool_contracts as c
from app.personal_assistant.execution_contracts import BackendReceipt, ToolAvailability
from app.personal_assistant.memory_contracts import MemoryAuthorization, MemoryQueryArgs, query_digest
from app.personal_assistant.schema import Analysis
from app.personal_assistant.tool_boundary import (BackendToolReply, ToolCall, ToolExecutionBoundary,
                                                TrustedToolContext)
from app.personal_assistant.tool_planning import plan_tools
from app.personal_assistant.tool_registry import TOOLS, get_tool


def context(**kw):
    values = dict(user_id='u', session_id='s', correlation_id='c', dialogue_ready=True,
        allowed_tools=frozenset(TOOLS), satisfied_preconditions=frozenset(
            ('op1', p) for p in ('sensitive_data_checked', 'memory_consent', 'content_read_back', 'target_resolved')))
    values.update(kw)
    return TrustedToolContext(**values)


def grant(**kw):
    return MemoryAuthorization(owner_user_id='u', session_id='s', correlation_id='c',
        proposal_revision=3, consent_to_store=True, **kw)


def analysis(action='propose'):
    return Analysis(scope='pa', operations=[dict(id='op1', intent='memory', feature='PA-04', action=action,
        source_text='Tôi thích trà.', entities={'content': 'Tôi thích trà.', 'category': 'preference'})],
        raw_input='Tôi thích trà.', reference_time=datetime.fromisoformat('2026-11-15T12:00:00+07:00'),
        timezone='Asia/Bangkok', model='unit-double')


def call(tool='memory.create', **kw):
    args = dict(proposal_revision=3)
    if tool != 'memory.delete':
        args['content'] = 'Tôi thích trà.'
    if tool in ('memory.update', 'memory.delete'):
        args.update(memory_id='m1', expected_revision=5)
    if tool == 'memory.update':
        args['update_mode'] = 'append'
    args.update(kw)
    return ToolCall(operation_id='op1', tool_id=tool, feature='PA-04', arguments=args)


def approved(call, **overrides):
    ctx = context()
    target = c.MemoryTarget(**{k: call.arguments[k] for k in ('memory_id', 'topic_group', 'expected_revision')
                               if k in call.arguments}) if call.tool_id != 'memory.create' else None
    auth = grant(target=target, update_mode=call.arguments.get('update_mode'),
                 confirmed_call_key=ctx.call_key(call))
    auth = auth.model_copy(update=overrides)
    return replace(ctx, memory_authorizations={'op1': auth}, confirmed_call_keys={ctx.call_key(call)})


class NoDispatch:
    def __getattr__(self, name):
        raise AssertionError('No Backend method may be invoked before availability/authorization')


def execute(call, ctx, adapter=None):
    return asyncio.run(ToolExecutionBoundary(adapter or NoDispatch()).execute(call, ctx))


def test_proposal_is_separate_and_cannot_be_dispatched():
    plan = plan_tools(analysis(), context())
    assert not plan.calls and plan.proposals[0].tool_id == 'memory.propose'
    assert plan.deferred_operations == {'op1': 'MEMORY_CONSENT_REQUIRED'}
    result = execute(plan.proposals[0], context())
    assert result.code == 'PROPOSAL_ONLY_NO_EXECUTION' and not result.executed
    contract = get_tool('memory.propose').contract()
    assert contract['confirmation_required']
    assert not contract['security_context']['backend_required']
    assert not contract['security_context']['execution_allowed']


def test_only_exact_approved_proposal_promotes_to_create():
    ctx = context(memory_authorizations={'op1': grant()})
    proposal = plan_tools(analysis(), ctx).proposals[0]
    candidate = proposal.model_copy(update={'tool_id': 'memory.create'})
    key = ctx.call_key(candidate)
    approved_ctx = replace(ctx, confirmed_call_keys={key}, memory_authorizations={
        'op1': grant(confirmed_call_key=key)})
    plan = plan_tools(analysis(), approved_ctx)
    assert not plan.proposals and plan.calls[0] == candidate
    assert not plan.calls[0].validation_errors
    assert execute(plan.calls[0], approved_ctx).code == 'NOT_IMPLEMENTED'
    wrong = replace(approved_ctx, memory_authorizations={'op1': grant(confirmed_call_key='0' * 64)})
    assert not plan_tools(analysis(), wrong).calls


def test_confirmation_without_exact_consent_is_deferred_not_a_write():
    for ctx in (context(), context(memory_authorizations={'op1': grant()}),
                context(memory_authorizations={'op1': grant(confirmed_call_key='0' * 64)})):
        plan = plan_tools(analysis('confirm'), ctx)
        assert not plan.calls and plan.deferred_operations['op1'] == 'MEMORY_CONFIRMATION_CONTEXT_REQUIRED'


@pytest.mark.parametrize('tool', ['memory.create', 'memory.update', 'memory.delete'])
def test_valid_memory_calls_remain_not_implemented_without_dispatch(tool):
    operation = call(tool)
    result = execute(operation, approved(operation))
    assert result.code == 'NOT_IMPLEMENTED' and result.executed is False


@pytest.mark.parametrize('change,code', [
    ({'owner_user_id': 'other'}, 'MEMORY_OWNERSHIP_CONTEXT_REQUIRED'),
    ({'session_id': 'other'}, 'MEMORY_OWNERSHIP_CONTEXT_REQUIRED'),
    ({'correlation_id': 'other'}, 'MEMORY_OWNERSHIP_CONTEXT_REQUIRED'),
    ({'proposal_revision': 4}, 'STALE_MEMORY_CONFIRMATION'),
    ({'confirmed_call_key': '0' * 64}, 'STALE_MEMORY_CONFIRMATION'),
    ({'consent_to_store': False}, 'MEMORY_STORAGE_CONSENT_REQUIRED'),
])
def test_trusted_memory_consent_and_identity_must_match(change, code):
    operation = call()
    assert execute(operation, approved(operation, **change)).code == code


@pytest.mark.parametrize('tool', ['memory.update', 'memory.delete'])
def test_item_and_topic_scopes_are_exactly_one_and_revision_required(tool):
    model = get_tool(tool).input_model
    assert len(model.model_json_schema()['oneOf']) == 2
    args = call(tool).arguments
    for bad in ({**args, 'topic_group': 'drinks'}, {k:v for k,v in args.items() if k != 'memory_id'},
                {k:v for k,v in args.items() if k != 'expected_revision'}, {**args, 'owner_user_id': 'other'}):
        with pytest.raises(ValidationError):
            model.model_validate(bad)
    group = {k:v for k,v in args.items() if k != 'memory_id'} | {'topic_group': 'drinks'}
    assert model.model_validate(group).topic_group == 'drinks'
    operation = call(tool, **group)
    operation.arguments.pop('memory_id', None)
    assert execute(operation, approved(operation)).code == 'NOT_IMPLEMENTED'


def test_update_mode_snapshot_and_revision_are_not_taken_from_llm():
    operation = call('memory.update')
    assert execute(operation, approved(operation, update_mode='replace')).code == 'MEMORY_UPDATE_MODE_REQUIRED'
    old = c.MemoryTarget(memory_id='m1', expected_revision=4)
    assert execute(operation, approved(operation, target=old)).code == 'MEMORY_SNAPSHOT_REQUIRED'
    ctx = context(memory_authorizations={'op1': grant(target=c.MemoryTarget(topic_group='drinks', expected_revision=5),
                                                       update_mode='append')})
    routed = plan_tools(analysis('update'), ctx).calls[0]
    assert routed.arguments['topic_group'] == 'drinks' and 'memory_id' not in routed.arguments
    assert routed.arguments['expected_revision'] == 5 and routed.arguments['update_mode'] == 'append'
    assert routed.arguments['proposal_revision'] == 3


def test_idempotency_is_stable_on_retry_and_confirmation_does_not_cover_edits():
    operation = call('memory.update')
    ctx = approved(operation)
    assert ctx.call_key(operation) == ctx.call_key(operation.model_copy(deep=True))
    changed = operation.model_copy(deep=True)
    changed.arguments['content'] = 'Nội dung mới'
    assert ctx.call_key(changed) != ctx.call_key(operation)
    assert execute(changed, ctx).code == 'CONFIRMATION_REQUIRED'


def test_revoked_storage_consent_does_not_prevent_confirmed_deletion():
    operation = call('memory.delete')
    assert execute(operation, approved(operation, consent_to_store=False)).code == 'NOT_IMPLEMENTED'


def test_blank_or_unversioned_scope_never_means_all_memories():
    for value in ({'topic_group':' ', 'expected_revision':1}, {'memory_id':' ', 'expected_revision':1},
                  {'topic_group':'drinks'}):
        with pytest.raises(ValidationError):
            c.MemoryTarget.model_validate(value)
    with pytest.raises(ValidationError):
        c.MemoryCreateArgs(content=' ', proposal_revision=1)


class BackendFixture:
    def __init__(self, data):
        self.data, self.calls = data, []

    def availability(self, tool):
        return ToolAvailability(status='AVAILABLE', endpoint_verified=True, contract_verified=True, auth_verified=True,
                                idempotency_verified=True, revision_verified=True)

    def supports(self, tool): return True
    def supports_idempotency(self, tool): return True

    async def execute(self, tool, args, ctx, *, operation_id, idempotency_key, request_context):
        self.calls.append(idempotency_key)
        receipt = BackendReceipt(execution_id='unit', tool_id=tool, operation_id=operation_id,
            user_id=ctx.user_id, session_id=ctx.session_id, correlation_id=ctx.correlation_id,
            idempotency_key=idempotency_key)
        return BackendToolReply('SUCCESS', self.data, True, receipt)


def enable_unit_binding(monkeypatch):
    from app.personal_assistant import tool_boundary
    original = tool_boundary.get_tool
    monkeypatch.setattr(tool_boundary, 'get_tool', lambda tool: replace(original(tool), status='AVAILABLE'))


@pytest.mark.parametrize('bad', [{'owner_user_id': 'other'}, {'consent_to_use': False},
    {'consent_to_store': False}, {'active': False}, {'sensitivity_reviewed': False},
    {'expires_at': '2020-01-01T00:00:00+00:00'}])
def test_read_never_exposes_unpermitted_memory(monkeypatch, bad):
    enable_unit_binding(monkeypatch)
    row = dict(id='m1', owner_user_id='u', category='preference', content='unit', relevance=1.0,
        consent_to_store=True, consent_to_use=True, active=True, sensitivity_reviewed=True) | bad
    data = dict(query_digest=query_digest('q'), items=[row])
    operation = ToolCall(operation_id='op1', tool_id='memory.query', feature='PA-04',
                         arguments={'query':'q', 'timezone':'UTC'})
    result = execute(operation, context(), BackendFixture(data))
    assert result.code == 'MEMORY_NOT_PERMITTED_FOR_USE' and result.data is None and not result.executed


def test_management_lookup_requires_explicit_application_scope():
    operation = ToolCall(operation_id='op1', tool_id='memory.query', feature='PA-04',
        arguments={'query':'q','timezone':'UTC','purpose':'management','permitted_use_only':False})
    assert execute(operation, context()).code == 'MEMORY_MANAGEMENT_SCOPE_REQUIRED'
    with pytest.raises(ValidationError):
        MemoryQueryArgs(query='q', timezone='UTC', permitted_use_only=False)


def test_management_lookup_can_read_owned_revoked_record_for_deletion_only(monkeypatch):
    enable_unit_binding(monkeypatch)
    operation = ToolCall(operation_id='op1', tool_id='memory.query', feature='PA-04',
        arguments={'query':'q', 'timezone':'UTC', 'purpose':'management', 'permitted_use_only':False})
    row = dict(id='m1', owner_user_id='u', category='preference', content='unit', relevance=1.0,
        consent_to_store=False, consent_to_use=False, active=True, sensitivity_reviewed=False, revision=5)
    ctx = context(satisfied_preconditions={('op1', 'memory_management_lookup')})
    backend = BackendFixture(dict(query_digest=query_digest('q'), items=[row]))
    assert execute(operation, ctx, backend).status == 'SUCCESS'
    assert backend.calls == [None]  # READ carries no WRITE idempotency key.


@pytest.mark.parametrize('bad', [{'owner_user_id':'other'}, {'memory_id':'other'},
                                {'proposal_revision':4}, {'revision':5}])
def test_invalid_write_ack_is_unknown_never_success(monkeypatch, bad):
    enable_unit_binding(monkeypatch)
    operation = call('memory.update')
    data = dict(owner_user_id='u', memory_id='m1', proposal_revision=3, revision=6) | bad
    result = execute(operation, approved(operation), BackendFixture(data))
    assert result.outcome == 'UNKNOWN' and result.reconciliation_state == 'PENDING_RECONCILIATION'
    assert result.status != 'SUCCESS' and result.executed is False
