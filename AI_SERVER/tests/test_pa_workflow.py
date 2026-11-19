import asyncio
from dataclasses import replace
import json

import pytest

from app.personal_assistant.tool_boundary import (BackendToolReply, ToolCall,
    ToolExecutionBoundary, TrustedToolContext)
from app.personal_assistant.tool_planning import ToolPlan
from app.personal_assistant.tool_registry import TOOLS, get_tool
from app.personal_assistant.workflow import WorkflowOrchestrator
from app.personal_assistant.workflow_store import WorkflowStore
from app.personal_assistant.execution_contracts import BackendReceipt, ToolAvailability


def context(**updates):
    proofs = {'never_overwrite', 'content_read_back', 'memory_consent', 'explicit_user_status',
              'preserve_existing_schedule', 'derive_plan_progress_in_backend'}
    values = dict(user_id='user-a', session_id='session-a', correlation_id='request-a',
        dialogue_ready=True, allowed_tools=frozenset(TOOLS),
        satisfied_preconditions=frozenset(('op' + str(i), proof) for i in range(1, 10) for proof in proofs))
    values.update(updates)
    return TrustedToolContext(**values)


def event_arguments(**updates):
    values = dict(timezone='Asia/Bangkok', title='học',
        start={'raw': '19 giờ', 'date': '2026-11-16', 'time': '19:00'},
        end={'raw': '21 giờ', 'date': '2026-11-16', 'time': '21:00'})
    values.update(updates)
    return values


def plan(*, reminder=True, recurrence=False):
    args = event_arguments()
    if recurrence:
        args['recurrence'] = 'mỗi thứ Hai'
    calls = [ToolCall(operation_id='op1', tool_id='event.create', feature='PA-01', arguments=args)]
    if reminder:
        calls.append(ToolCall(operation_id='op2', tool_id='reminder.create', feature='PA-02',
            arguments=dict(timezone='Asia/Bangkok', linked_operation_id='op1', offset_minutes=30), depends_on=['op1']))
    return ToolPlan(calls=calls)


def task_plan():
    return ToolPlan(calls=[ToolCall(operation_id='op1', tool_id='task.create', feature='PA-10',
        arguments=dict(timezone='Asia/Bangkok', title='báo cáo', deadline={'raw': 'ngày mai', 'date': '2026-11-16'}))])


class Adapter:
    def __init__(self, *, faults=None, conflict=None, idempotency=False):
        self.faults = {key: list(value) for key, value in (faults or {}).items()}
        self.conflict = conflict or dict(has_conflict=False, conflicts=[], overlap_ratio=0.0)
        self.idempotency = idempotency
        self.calls = []
        self.records = {}
        self.created = 0
        self.entered = None
        self.release = None

    def supports(self, tool_id):
        return True

    def supports_idempotency(self, tool_id):
        return self.idempotency

    def availability(self, tool_id):
        return ToolAvailability(status='AVAILABLE', endpoint_verified=True, contract_verified=True,
                                auth_verified=True, idempotency_verified=self.idempotency)

    async def execute(self, tool_id, arguments, ctx, *, operation_id, idempotency_key, request_context):
        self.calls.append((tool_id, arguments.model_dump(exclude_none=True), idempotency_key, ctx))
        if self.entered is not None and tool_id != 'event.check_conflict':
            self.entered.set()
            await self.release.wait()
        if self.faults.get(tool_id):
            fault = self.faults[tool_id].pop(0)
            if isinstance(fault, BaseException):
                raise fault
            return BackendToolReply(fault)
        receipt = BackendReceipt(execution_id='test-' + operation_id, tool_id=tool_id, operation_id=operation_id,
            user_id=ctx.user_id, session_id=ctx.session_id, correlation_id=ctx.correlation_id,
            idempotency_key=idempotency_key)
        if tool_id == 'event.check_conflict':
            return BackendToolReply('SUCCESS', self.conflict, True, receipt)
        if tool_id.startswith('memory.'):
            return BackendToolReply('SUCCESS', dict(owner_user_id=ctx.user_id, memory_id='backend-memory',
                revision=1, proposal_revision=arguments.proposal_revision), True, receipt)
        if idempotency_key not in self.records:
            self.created += 1
            self.records[idempotency_key] = {'id': 'backend-' + str(self.created)}
        return BackendToolReply('SUCCESS', self.records[idempotency_key], True, receipt)


def available(monkeypatch, adapter=None, **engine_args):
    from app.personal_assistant import workflow, tool_boundary
    def bound(tool_id):
        spec = get_tool(tool_id)
        return replace(spec, status='AVAILABLE') if spec else None
    monkeypatch.setattr(workflow, 'get_tool', bound)
    monkeypatch.setattr(tool_boundary, 'get_tool', bound)
    adapter = adapter or Adapter()
    return WorkflowOrchestrator(ToolExecutionBoundary(adapter), **engine_args), adapter


async def approved(engine, source=None, ctx=None):
    ctx = ctx or context()
    wf = await engine.create(source or plan(), ctx)
    return await engine.confirm(wf.id, ctx, revision=wf.revision)


def test_one_step_completion_requires_valid_backend_ack(monkeypatch):
    async def run():
        engine, adapter = available(monkeypatch)
        wf = await approved(engine, task_plan())
        assert wf.state == 'READY'
        result = await engine.run(wf.id, context())
        assert result.state == 'COMPLETED' and result.steps[0].state == 'SUCCEEDED'
        assert result.steps[0].result.data['id'] == 'backend-1'
        again = await engine.run(wf.id, context())
        assert again.state == 'COMPLETED' and len(adapter.calls) == 1
    asyncio.run(run())


def test_three_steps_use_real_dependency_result_and_stable_keys(monkeypatch):
    async def run():
        engine, adapter = available(monkeypatch)
        wf = await approved(engine)
        assert [s.call.tool_id for s in wf.steps] == ['event.check_conflict', 'event.create', 'reminder.create']
        assert wf.steps[1].call.depends_on == [wf.steps[0].call.operation_id]
        assert wf.steps[2].call.depends_on == ['op1']
        result = await engine.run(wf.id, context())
        assert result.state == 'COMPLETED'
        assert adapter.calls[2][1]['linked_record_id'] == result.steps[1].result.data['id']
        assert adapter.calls[2][1]['linked_record_id'] != 'op1'
        assert [call[2] for call in adapter.calls] == [s.idempotency_key for s in result.steps]
        assert all(s.state == 'SUCCEEDED' for s in result.steps)
    asyncio.run(run())


@pytest.mark.parametrize('dependencies', [['op99'], ['op1'], ['op2', 'op2']])
def test_unknown_self_and_duplicate_dependencies_are_rejected(dependencies):
    async def run():
        source = task_plan()
        source.calls[0].depends_on = dependencies
        with pytest.raises(ValueError):
            await WorkflowOrchestrator().create(source, context())
    asyncio.run(run())


def test_cycle_is_rejected():
    async def run():
        source = task_plan()
        second = source.calls[0].model_copy(deep=True)
        second.operation_id, second.depends_on = 'op2', ['op1']
        source.calls[0].depends_on = ['op2']
        source.calls.append(second)
        with pytest.raises(ValueError, match='Cyclic'):
            await WorkflowOrchestrator().create(source, context())
    asyncio.run(run())


def test_production_unavailable_blocks_dependency_and_never_completes():
    async def run():
        engine = WorkflowOrchestrator()
        wf = await approved(engine)
        result = await engine.run(wf.id, context())
        assert result.state == 'BLOCKED'
        assert result.steps[0].result.code == 'NOT_IMPLEMENTED'
        assert all(s.state == 'BLOCKED' for s in result.steps)
        assert not any(s.result and s.result.executed for s in result.steps)
    asyncio.run(run())


def test_unconfirmed_write_and_decline_do_not_execute(monkeypatch):
    async def run():
        engine, adapter = available(monkeypatch)
        wf = await engine.create(task_plan(), context())
        assert (await engine.run(wf.id, context())).state == 'WAITING_FOR_CONFIRMATION'
        rejected = await engine.confirm(wf.id, context(), revision=1, accept=False)
        assert rejected.state == 'CANCELLED' and rejected.steps[0].state == 'SKIPPED'
        assert (await engine.run(wf.id, context())).state == 'CANCELLED'
        assert not adapter.calls
    asyncio.run(run())


def test_absent_h02_does_not_become_ready_after_confirmation():
    async def run():
        engine = WorkflowOrchestrator()
        ctx = context(dialogue_ready=False)
        wf = await approved(engine, task_plan(), ctx)
        assert wf.state == 'BLOCKED' and wf.code == 'DIALOGUE_NOT_READY'
        assert (await engine.run(wf.id, ctx)).state == 'BLOCKED'
    asyncio.run(run())


def test_revise_invalidates_checks_dependent_approvals_and_stale_confirmation(monkeypatch):
    async def run():
        engine, adapter = available(monkeypatch)
        wf = await approved(engine)
        old_keys = frozenset(s.confirmed_key for s in wf.steps if s.confirmed_key)
        changed = event_arguments(start={'raw': '20 giờ', 'date': '2026-11-16', 'time': '20:00'},
                                  end={'raw': '22 giờ', 'date': '2026-11-16', 'time': '22:00'})
        stale_ctx = context(confirmed_call_keys=old_keys)
        new = await engine.revise(wf.id, stale_ctx, revision=1, arguments_by_operation={'op1': changed})
        assert new.revision == 2 and new.state == 'WAITING_FOR_CONFIRMATION'
        assert all(s.confirmed_key is None for s in new.steps)
        assert new.steps[0].call.arguments['start']['time'] == '20:00'
        assert new.steps[1].idempotency_key != wf.steps[1].idempotency_key
        with pytest.raises(ValueError):
            await engine.confirm(wf.id, stale_ctx, revision=1)
        result = await engine.run(wf.id, stale_ctx)
        assert result.state == 'WAITING_FOR_CONFIRMATION'
        assert [call[0] for call in adapter.calls] == ['event.check_conflict']
    asyncio.run(run())


def test_partial_failure_preserves_success_and_retry_does_not_repeat_it(monkeypatch):
    async def run():
        adapter = Adapter(faults={'reminder.create': ['FORBIDDEN']})
        engine, _ = available(monkeypatch, adapter)
        wf = await approved(engine)
        result = await engine.run(wf.id, context())
        assert result.state == 'PARTIALLY_COMPLETED'
        assert result.steps[1].state == 'SUCCEEDED' and result.steps[2].state == 'FAILED'
        event_id = result.steps[1].result.data['id']
        await engine.run(wf.id, context())
        assert len(adapter.calls) == 3
        await engine.retry(wf.id, context())
        finished = await engine.run(wf.id, context())
        assert finished.state == 'COMPLETED'
        assert finished.steps[1].result.data['id'] == event_id
        assert [call[0] for call in adapter.calls].count('event.create') == 1
        assert adapter.calls[2][2] == adapter.calls[3][2]
    asyncio.run(run())


@pytest.mark.parametrize('supported', [False, True])
def test_unknown_write_timeout_needs_reconciliation_or_real_idempotency(monkeypatch, supported):
    async def run():
        adapter = Adapter(faults={'task.create': [TimeoutError()]}, idempotency=supported)
        engine, _ = available(monkeypatch, adapter)
        wf = await approved(engine, task_plan())
        failed = await engine.run(wf.id, context())
        assert failed.state == 'FAILED' and failed.steps[0].outcome_uncertain
        with pytest.raises(ValueError):
            await engine.revise(wf.id, context(), revision=1,
                                arguments_by_operation={'op1': wf.steps[0].call.arguments})
        retried = await engine.retry(wf.id, context())
        if supported:
            assert (await engine.run(wf.id, context())).state == 'COMPLETED'
            assert adapter.calls[0][2] == adapter.calls[1][2]
        else:
            assert retried.code == 'RECONCILIATION_REQUIRED'
            await engine.run(wf.id, context())
            assert len(adapter.calls) == 1
    asyncio.run(run())


def test_concurrent_run_rejected_and_cancel_preserves_inflight_ack(monkeypatch):
    async def run():
        adapter = Adapter()
        adapter.entered, adapter.release = asyncio.Event(), asyncio.Event()
        engine, _ = available(monkeypatch, adapter)
        wf = await approved(engine, task_plan())
        active = asyncio.create_task(engine.run(wf.id, context()))
        await asyncio.wait_for(adapter.entered.wait(), 2)
        with pytest.raises(RuntimeError, match='WORKFLOW_BUSY'):
            await engine.run(wf.id, context())
        pending = await engine.cancel(wf.id, context())
        assert pending.cancel_requested and pending.state == 'RUNNING'
        adapter.release.set()
        result = await active
        assert result.state == 'CANCELLED' and result.steps[0].state == 'SUCCEEDED'
        assert len(adapter.calls) == 1
    asyncio.run(run())


def test_users_sessions_and_snapshots_are_isolated(monkeypatch):
    async def run():
        engine, adapter = available(monkeypatch)
        owner = context()
        wf = await engine.create(task_plan(), owner)
        for other in (context(user_id='user-b'), context(session_id='session-b')):
            with pytest.raises(PermissionError):
                await engine.confirm(wf.id, other, revision=1)
            with pytest.raises(PermissionError):
                await engine.cancel(wf.id, other)
            independent = await engine.create(task_plan(), other)
            assert independent.id != wf.id
        wf.steps[0].call.arguments['title'] = 'tampered snapshot'
        stored = await engine.store.get(wf.id, owner)
        assert stored.steps[0].call.arguments['title'] == 'báo cáo'
        public = stored.model_dump_json()
        assert 'user-a' not in public and 'session-a' not in public and 'allowed_tools' not in public
        assert not adapter.calls
    asyncio.run(run())


def test_ttl_capacity_and_duplicate_proposal_are_bounded():
    async def run():
        now = [0.0]
        store = WorkflowStore(max_workflows=1, ttl_seconds=1, clock=lambda: now[0])
        engine = WorkflowOrchestrator(store=store)
        wf = await engine.create(task_plan(), context())
        assert (await engine.create(task_plan(), context())).id == wf.id
        with pytest.raises(ValueError, match='capacity'):
            await engine.create(task_plan(), context(correlation_id='other'))
        now[0] = 2
        assert await store.cleanup() == 1
        with pytest.raises(KeyError):
            await engine.run(wf.id, context())
    asyncio.run(run())


def conflict_data(ratio=.5):
    return dict(has_conflict=True, overlap_ratio=ratio, conflicts=[dict(id='old-event', title='lịch cũ',
        start={'raw': '19 giờ', 'date': '2026-11-16', 'time': '19:00'},
        end={'raw': '20 giờ', 'date': '2026-11-16', 'time': '20:00'}, occurrence_id='occurrence-1')])


@pytest.mark.parametrize('ratio,warning', [(.30, False), (.31, True)])
def test_conflicts_require_explicit_decisions_for_each_occurrence(monkeypatch, ratio, warning):
    async def run():
        adapter = Adapter(conflict=conflict_data(ratio))
        engine, _ = available(monkeypatch, adapter)
        wf = await approved(engine, plan(recurrence=True))
        paused = await engine.run(wf.id, context())
        assert paused.state == 'WAITING_FOR_CONFIRMATION' and paused.code == 'CONFLICT_DECISION_REQUIRED'
        assert ('Trên 30%' in paused.questions[0]) == warning
        assert 'lịch cũ' in paused.questions[0] and '19:00' in paused.questions[0]
        assert len(adapter.calls) == 1
        with pytest.raises(ValueError):
            await engine.decide_conflict(wf.id, context(), operation_id='op1', revision=1, keep_overlap=True)
        await engine.decide_conflict(wf.id, context(), operation_id='op1', revision=1,
                                    keep_overlap=True, occurrence_ids=['occurrence-1'])
        done = await engine.run(wf.id, context())
        assert done.state == 'COMPLETED'
        assert [call[0] for call in adapter.calls] == ['event.check_conflict', 'event.create', 'reminder.create']
    asyncio.run(run())


def test_invalid_information_and_no_fake_backend_success(monkeypatch):
    async def run():
        engine, adapter = available(monkeypatch)
        source = task_plan()
        del source.calls[0].arguments['deadline']
        wf = await engine.create(source, context())
        assert wf.state == 'WAITING_FOR_INFORMATION'
        assert (await engine.run(wf.id, context())).state == 'WAITING_FOR_INFORMATION'
        assert not adapter.calls
        source = task_plan()
        source.calls[0].arguments['token'] = 'secret-not-to-store'
        with pytest.raises(ValueError):
            await engine.create(source, context(correlation_id='unsafe'))
    asyncio.run(run())


def test_plan_end_date_change_does_not_expand_schedule_operations():
    async def run():
        call = ToolCall(operation_id='op1', tool_id='plan.update', feature='PA-06',
            arguments={'timezone': 'Asia/Bangkok', 'target_id': 'existing-plan',
                       'changes': {'end': {'raw': '30/11', 'date': '2026-11-30'}}})
        wf = await WorkflowOrchestrator().create(ToolPlan(calls=[call]), context())
        assert len(wf.steps) == 1 and wf.steps[0].call.tool_id == 'plan.update'
        assert 'reschedule_requested' not in wf.steps[0].call.arguments['changes']
    asyncio.run(run())


def test_backend_committed_before_timeout_deduplicates_retry(monkeypatch):
    class CommitThenTimeout(Adapter):
        async def execute(self, *args, **kwargs):
            reply = await super().execute(*args, **kwargs)
            if len(self.calls) == 1:
                raise TimeoutError()
            return reply
    async def run():
        adapter = CommitThenTimeout(idempotency=True)
        engine, _ = available(monkeypatch, adapter)
        wf = await approved(engine, task_plan())
        failed = await engine.run(wf.id, context())
        assert failed.steps[0].outcome_uncertain and adapter.created == 1
        assert len(adapter.calls) == 1
        await engine.retry(wf.id, context())
        done = await engine.run(wf.id, context())
        assert done.state == 'COMPLETED' and done.steps[0].result.data['id'] == 'backend-1'
        assert adapter.created == 1 and len(adapter.calls) == 2
        assert adapter.calls[0][2] == adapter.calls[1][2]
    asyncio.run(run())


def test_cancelled_runner_records_uncertain_write_and_releases_lease(monkeypatch):
    async def run():
        adapter = Adapter()
        adapter.entered, adapter.release = asyncio.Event(), asyncio.Event()
        engine, _ = available(monkeypatch, adapter)
        wf = await approved(engine, task_plan())
        active = asyncio.create_task(engine.run(wf.id, context()))
        await asyncio.wait_for(adapter.entered.wait(), 2)
        active.cancel()
        with pytest.raises(asyncio.CancelledError):
            await active
        saved = await engine.store.get(wf.id, context())
        assert saved.state == 'FAILED' and saved.steps[0].outcome_uncertain
        assert (await engine.retry(wf.id, context())).code == 'RECONCILIATION_REQUIRED'
        assert len(adapter.calls) == 1
    asyncio.run(run())


def test_managed_conflict_check_cannot_be_edited_to_bypass_real_interval(monkeypatch):
    async def run():
        engine, _ = available(monkeypatch)
        wf = await approved(engine)
        check = wf.steps[0]
        with pytest.raises(ValueError, match='managed prerequisite'):
            await engine.revise(wf.id, context(), revision=1,
                arguments_by_operation={check.call.operation_id: check.call.arguments})
        stored = await engine.store.get(wf.id, context())
        assert stored.revision == 1
    asyncio.run(run())


def test_memory_content_is_reviewed_and_read_back_before_execution(monkeypatch):
    async def run():
        engine, adapter = available(monkeypatch, adapter=Adapter(idempotency=True))
        source = ToolPlan(calls=[ToolCall(operation_id='op1', tool_id='memory.create', feature='PA-04',
                                        arguments={'content': 'thích ăn kem', 'proposal_revision': 1})])
        with pytest.raises(ValueError, match='privacy review'):
            await engine.create(source, context())
        ctx = context(satisfied_preconditions=frozenset({('op1', 'sensitive_data_checked')}))
        wf = await engine.create(source, ctx)
        assert wf.state == 'WAITING_FOR_CONFIRMATION' and 'thích ăn kem' in wf.questions[0]
        wf = await engine.confirm(wf.id, ctx, revision=1)
        blocked = await engine.run(wf.id, ctx)
        assert blocked.code == 'MEMORY_OWNERSHIP_CONTEXT_REQUIRED' and not adapter.calls
        from app.personal_assistant.memory_contracts import MemoryAuthorization
        grant = MemoryAuthorization(owner_user_id=ctx.user_id, session_id=ctx.session_id,
            correlation_id=ctx.correlation_id, proposal_revision=1, consent_to_store=True,
            confirmed_call_key=ctx.call_key(source.calls[0]))
        complete_context = replace(ctx, satisfied_preconditions=ctx.satisfied_preconditions | {
            ('op1', 'memory_consent'), ('op1', 'content_read_back')}, memory_authorizations={'op1': grant})
        await engine.retry(wf.id, complete_context)
        assert (await engine.run(wf.id, complete_context)).state == 'COMPLETED'
    asyncio.run(run())


def test_boundary_requires_verified_parent_id_and_cannot_rebind_confirmation(monkeypatch):
    from app.personal_assistant.tool_boundary import ToolExecutionBoundary
    async def run():
        engine, adapter = available(monkeypatch)
        logical = plan().calls[1]
        ctx = context(completed_dependencies=frozenset({'op1'}), dependency_record_ids={'op1': 'real-parent'},
            satisfied_preconditions=context().satisfied_preconditions | {('op2', 'linked_creation_succeeded')})
        ctx = replace(ctx, confirmed_call_keys=frozenset({ctx.call_key(logical)}))
        forged = logical.model_copy(deep=True)
        forged.arguments['linked_record_id'] = 'forged-parent'
        boundary = ToolExecutionBoundary(adapter)
        assert (await boundary.execute(logical, ctx)).code == 'DEPENDENCY_RESULT_REQUIRED'
        assert (await boundary.execute(forged, ctx)).code == 'CONFIRMATION_REQUIRED'
        assert not adapter.calls
    asyncio.run(run())


def test_reusing_correlation_cannot_replace_a_confirmed_plan():
    async def run():
        engine = WorkflowOrchestrator()
        wf = await approved(engine, task_plan())
        changed = task_plan()
        changed.calls[0].arguments['title'] = 'nội dung khác'
        with pytest.raises(ValueError, match='explicit revision'):
            await engine.create(changed, context())
        assert (await engine.store.get(wf.id, context())).steps[0].call.arguments['title'] == 'báo cáo'
    asyncio.run(run())


def test_cancelling_after_unknown_write_does_not_label_it_skipped(monkeypatch):
    async def run():
        engine, adapter = available(monkeypatch, Adapter(faults={'task.create': [TimeoutError()]}))
        wf = await approved(engine, task_plan())
        await engine.run(wf.id, context())
        cancelled = await engine.cancel(wf.id, context())
        assert cancelled.state == 'CANCELLED'
        assert cancelled.steps[0].state == 'FAILED' and cancelled.steps[0].outcome_uncertain
        assert 'đối soát' in cancelled.questions[0]
        assert len(adapter.calls) == 1
    asyncio.run(run())
