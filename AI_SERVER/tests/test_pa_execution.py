"""H-05 execution controls; all available API bindings below are unit doubles."""
import asyncio
from dataclasses import replace
import time

import httpx
import pytest

from app.clients.backend import BackendCode, BackendError
from app.personal_assistant.execution_contracts import BackendReceipt, ToolAvailability
from app.personal_assistant.tool_boundary import (BackendToolReply, ToolCall,
    ToolExecutionBoundary, TrustedToolContext)
from app.personal_assistant.tool_planning import ToolPlan
from app.personal_assistant.tool_registry import TOOLS, get_tool
from app.personal_assistant.workflow import WorkflowOrchestrator
from app.services.audio_context import AudioContext


def call(operation_id='op1', depends_on=()):
    return ToolCall(operation_id=operation_id, tool_id='task.create', feature='PA-10',
        arguments={'timezone': 'Asia/Bangkok', 'title': 'báo cáo',
                   'deadline': {'raw': 'ngày mai', 'date': '2026-11-16'}}, depends_on=list(depends_on))


def context():
    return TrustedToolContext(user_id='owner', session_id='session', correlation_id='request',
                              dialogue_ready=True, allowed_tools=frozenset(TOOLS))


def approved(ctx, invocation):
    return replace(ctx, confirmed_call_keys=frozenset({ctx.call_key(invocation)}))


class Adapter:
    def __init__(self):
        self.api = ToolAvailability(status='AVAILABLE', endpoint_verified=True,
            contract_verified=True, auth_verified=True, idempotency_verified=True)
        self.calls = []
        self.error = None
        self.fault_operation = None
        self.receipt_changes = {}
        self.omit_receipt = False
        self.data = None
        self.entered = None
        self.cancelled = False

    def availability(self, tool_id):
        return self.api

    def supports(self, tool_id):
        return True

    def supports_idempotency(self, tool_id):
        return True

    async def execute(self, tool_id, arguments, ctx, *, operation_id, idempotency_key, request_context):
        self.calls.append((operation_id, idempotency_key, request_context, arguments))
        if self.entered is not None:
            self.entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                self.cancelled = True
        if self.error is not None and (self.fault_operation is None or self.fault_operation == operation_id):
            raise self.error
        values = dict(execution_id='backend-' + operation_id, tool_id=tool_id,
            operation_id=operation_id, user_id=ctx.user_id, session_id=ctx.session_id,
            correlation_id=ctx.correlation_id, idempotency_key=idempotency_key)
        values.update(self.receipt_changes)
        receipt = None if self.omit_receipt else BackendReceipt(**values)
        return BackendToolReply('SUCCESS', self.data or {'id': 'record-' + operation_id}, True, receipt)


def boundary(monkeypatch, adapter=None, *, status='AVAILABLE', timeout=30):
    from app.personal_assistant import tool_boundary
    monkeypatch.setattr(tool_boundary, 'get_tool', lambda tool_id:
        replace(get_tool(tool_id), status=status) if get_tool(tool_id) else None)
    adapter = adapter or Adapter()
    return ToolExecutionBoundary(adapter, timeout_seconds=timeout), adapter


def execute(control, invocation=None, ctx=None, **kwargs):
    invocation = invocation or call()
    ctx = ctx or approved(context(), invocation)
    return asyncio.run(control.execute(invocation, ctx, **kwargs))


@pytest.mark.parametrize('status,code', [('NOT_IMPLEMENTED', 'NOT_IMPLEMENTED'),
    ('DISABLED', 'DISABLED'), ('UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE')])
def test_registry_availability_never_promotes_a_contract(monkeypatch, status, code):
    control, adapter = boundary(monkeypatch, status=status)
    result = execute(control)
    assert result.status == 'UNAVAILABLE' and result.code == code
    assert result.outcome == 'NOT_EXECUTED' and not adapter.calls


@pytest.mark.parametrize('field', ['endpoint_verified', 'contract_verified', 'auth_verified'])
def test_available_requires_verified_endpoint_contract_and_auth(monkeypatch, field):
    control, adapter = boundary(monkeypatch)
    adapter.api = adapter.api.model_copy(update={field: False})
    result = execute(control)
    assert result.code == 'TEMPORARILY_UNAVAILABLE' and not adapter.calls
    assert not control.can_retry_write('task.create')


def test_temporarily_unavailable_adapter_is_not_disabled(monkeypatch):
    control, adapter = boundary(monkeypatch)
    adapter.api = ToolAvailability(status='UNAVAILABLE')
    assert execute(control).code == 'TEMPORARILY_UNAVAILABLE'
    assert not adapter.calls


def test_invalid_schema_unknown_tool_and_unconfirmed_write_do_not_dispatch(monkeypatch):
    control, adapter = boundary(monkeypatch)
    invalid = call().model_copy(update={'arguments': {'user_id': 'attacker', 'url': 'http://fake'}})
    assert execute(control, invalid).status == 'VALIDATION_ERROR'
    unknown = call().model_copy(update={'tool_id': 'invented.execute'})
    assert execute(control, unknown).status == 'VALIDATION_ERROR'
    assert execute(control, ctx=context()).code == 'CONFIRMATION_REQUIRED'
    assert not adapter.calls


@pytest.mark.parametrize('field', ['user_id', 'session_id', 'correlation_id'])
def test_confirmation_is_bound_to_authenticated_context(monkeypatch, field):
    control, adapter = boundary(monkeypatch)
    ctx = approved(context(), call())
    assert execute(control, ctx=replace(ctx, **{field: 'other'})).code == 'CONFIRMATION_REQUIRED'
    assert not adapter.calls


def test_incomplete_dependency_does_not_dispatch(monkeypatch):
    control, adapter = boundary(monkeypatch)
    invocation = call(depends_on=['op2'])
    assert execute(control, invocation).code == 'DEPENDENCY_NOT_EXECUTED'
    assert not adapter.calls


def test_timeout_marks_unknown_and_pending_reconciliation(monkeypatch):
    control, adapter = boundary(monkeypatch)
    adapter.error = httpx.ReadTimeout('private-token')
    result = execute(control)
    assert result.status == 'TIMEOUT' and result.outcome == 'UNKNOWN'
    assert result.reconciliation_state == 'PENDING_RECONCILIATION'
    assert not result.executed and result.data is None
    assert 'private-token' not in result.model_dump_json()


def test_expired_deadline_is_known_not_dispatched(monkeypatch):
    control, adapter = boundary(monkeypatch)
    scope = AudioContext(deadline=time.monotonic() - 1)
    result = execute(control, request_context=scope)
    assert result.status == 'TIMEOUT' and result.outcome == 'NOT_EXECUTED'
    assert result.reconciliation_state == 'NOT_REQUIRED' and not adapter.calls


def test_cooperative_cancellation_stops_adapter_and_preserves_unknown(monkeypatch):
    async def run():
        control, adapter = boundary(monkeypatch)
        adapter.entered = asyncio.Event()
        scope = AudioContext(deadline=time.monotonic() + 2)
        running = asyncio.create_task(control.execute(call(), approved(context(), call()), request_context=scope))
        await asyncio.wait_for(adapter.entered.wait(), 1)
        scope.cancel()
        result = await running
        assert result.code == 'BACKEND_CANCELLED' and result.outcome == 'UNKNOWN'
        assert adapter.cancelled and result.reconciliation_state == 'PENDING_RECONCILIATION'
    asyncio.run(run())


def test_boundary_total_timeout_cancels_hanging_adapter(monkeypatch):
    async def run():
        control, adapter = boundary(monkeypatch, timeout=.01)
        adapter.entered = asyncio.Event()
        result = await control.execute(call(), approved(context(), call()))
        assert result.status == 'TIMEOUT' and result.outcome == 'UNKNOWN'
        assert adapter.cancelled
    asyncio.run(run())


@pytest.mark.parametrize('field,value', [('tool_id', 'event.create'), ('operation_id', 'op2'),
    ('user_id', 'other-user'), ('session_id', 'other-session'), ('correlation_id', 'other-request'),
    ('idempotency_key', 'other-key')])
def test_backend_response_must_match_execution_scope(monkeypatch, field, value):
    control, adapter = boundary(monkeypatch)
    adapter.receipt_changes = {field: value}
    result = execute(control)
    assert result.code == 'BACKEND_CONTEXT_MISMATCH' and result.outcome == 'UNKNOWN'
    assert result.status != 'SUCCESS' and result.data is None
    assert value not in result.model_dump_json()


def test_boolean_success_without_backend_receipt_is_not_success(monkeypatch):
    control, adapter = boundary(monkeypatch)
    adapter.omit_receipt = True
    result = execute(control)
    assert result.code == 'BACKEND_RECEIPT_REQUIRED' and result.outcome == 'UNKNOWN'


def test_backend_permission_error_is_rejected_without_leaking_body(monkeypatch):
    control, adapter = boundary(monkeypatch)
    adapter.error = BackendError(BackendCode.HTTP, status=403, reason='private-token')
    result = execute(control)
    assert result.status == 'FORBIDDEN' and result.outcome == 'REJECTED'
    assert result.reconciliation_state == 'NOT_REQUIRED'
    assert 'private-token' not in result.model_dump_json()


def test_wrong_response_schema_is_unknown_for_write(monkeypatch):
    control, adapter = boundary(monkeypatch)
    adapter.data = {'id': 'record', 'token': 'private-token'}
    result = execute(control)
    assert result.status == 'UNAVAILABLE' and result.outcome == 'UNKNOWN'
    assert result.data is None and 'private-token' not in result.model_dump_json()


def test_verified_ack_confirms_execution_but_hides_private_receipt(monkeypatch):
    control, adapter = boundary(monkeypatch)
    result = execute(control)
    assert result.status == 'SUCCESS' and result.outcome == 'CONFIRMED' and result.executed
    assert result.receipt.execution_id == 'backend-op1'
    public = result.model_dump_json()
    assert 'receipt' not in public and 'owner' not in public and 'request' not in public
    assert adapter.calls[0][0] == 'op1'
    assert adapter.calls[0][1] == approved(context(), call()).call_key(call())
    assert isinstance(adapter.calls[0][2], AudioContext)


def test_idempotency_claim_without_verified_contract_cannot_allow_retry(monkeypatch):
    async def run():
        control, adapter = boundary(monkeypatch)
        adapter.api = adapter.api.model_copy(update={'idempotency_verified': False})
        adapter.error = TimeoutError()
        engine = WorkflowOrchestrator(control)
        wf = await engine.create(ToolPlan(calls=[call()]), context())
        await engine.confirm(wf.id, context(), revision=1)
        failed = await engine.run(wf.id, context())
        assert failed.reconciliation_state == 'PENDING_RECONCILIATION'
        assert failed.steps[0].execution_outcome == 'UNKNOWN'
        assert (await engine.retry(wf.id, context())).code == 'RECONCILIATION_REQUIRED'
        assert len(adapter.calls) == 1
        adapter.api = adapter.api.model_copy(update={'idempotency_verified': True})
        adapter.error = None
        await engine.retry(wf.id, context())
        done = await engine.run(wf.id, context())
        assert done.state == 'COMPLETED' and done.reconciliation_state == 'NOT_REQUIRED'
        assert adapter.calls[0][1] == adapter.calls[1][1]
    asyncio.run(run())


def test_partial_execution_retains_receipt_and_blocks_dependent_step(monkeypatch):
    async def run():
        control, adapter = boundary(monkeypatch)
        adapter.error, adapter.fault_operation = TimeoutError(), 'op2'
        engine = WorkflowOrchestrator(control)
        wf = await engine.create(ToolPlan(calls=[call(), call('op2', ['op1']), call('op3', ['op2'])]), context())
        await engine.confirm(wf.id, context(), revision=1)
        result = await engine.run(wf.id, context())
        assert result.state == 'PARTIALLY_COMPLETED'
        assert result.steps[0].result.receipt.execution_id == 'backend-op1'
        assert result.steps[0].execution_outcome == 'CONFIRMED'
        assert result.steps[1].execution_outcome == 'UNKNOWN'
        assert result.steps[2].state == 'BLOCKED' and result.steps[2].result is None
        assert [item[0] for item in adapter.calls] == ['op1', 'op2']
    asyncio.run(run())


@pytest.mark.parametrize('http_status,expected', [(400, 'VALIDATION_ERROR'), (422, 'VALIDATION_ERROR'),
    (401, 'FORBIDDEN'), (404, 'NOT_FOUND'), (409, 'CONFLICT'), (504, 'TIMEOUT'), (503, 'UNAVAILABLE')])
def test_existing_backend_errors_are_normalized(monkeypatch, http_status, expected):
    control, adapter = boundary(monkeypatch)
    adapter.error = BackendError(BackendCode.HTTP, status=http_status)
    result = execute(control)
    assert result.status == expected and not result.executed
    assert result.outcome == ('UNKNOWN' if expected in ('TIMEOUT', 'UNAVAILABLE') else 'REJECTED')


def test_read_tools_do_not_claim_write_idempotency(monkeypatch):
    control, _ = boundary(monkeypatch)
    assert not control.can_retry_write('schedule.query')
