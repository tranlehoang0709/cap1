"""Group III stages with contract-faithful fixtures, never live Backend claims."""
import asyncio
from dataclasses import replace
from datetime import datetime

import pytest

from app.personal_assistant.execution_contracts import BackendReceipt, ToolAvailability
from app.personal_assistant.memory_contracts import query_digest
from app.personal_assistant.schema import Analysis, Operation, Entities
from app.personal_assistant.tool_boundary import BackendToolReply, ToolExecutionBoundary, TrustedToolContext
from app.personal_assistant.tool_registry import TOOLS, get_tool
from app.personal_assistant.workflow import WorkflowOrchestrator


def ctx():
    return TrustedToolContext('u', 's', 'correlation', dialogue_ready=True, allowed_tools=frozenset(TOOLS))


def analysis(action='create', content='Tôi thích uống trà', query=None, dependencies=False):
    ops = [Operation(id='op1', intent='trí nhớ', feature='PA-04', action=action,
        source_text=content or query or 'xóa trí nhớ', entities=Entities(content=content, target_query=query))]
    if dependencies:
        ops.append(Operation(id='op2', intent='trí nhớ khác', feature='PA-04', action='create',
            source_text='Tôi thích đọc sách', entities=Entities(content='Tôi thích đọc sách'), depends_on=['op1']))
    return Analysis(scope='pa', operations=ops, raw_input='\n'.join(o.source_text for o in ops),
        reference_time=datetime.fromisoformat('2026-11-15T12:00:00+07:00'), timezone='Asia/Bangkok', model='fixture')


class MemoryAdapter:
    def __init__(self, *, ack=True, fail_at=None, wrong_owner=False):
        self.calls = []
        self.ack = ack
        self.fail_at, self.wrong_owner = fail_at, wrong_owner
        self.entered = self.release = None

    def supports(self, tool):
        return True

    def supports_idempotency(self, tool):
        return True

    def availability(self, tool):
        return ToolAvailability(status='AVAILABLE', endpoint_verified=True, contract_verified=True, auth_verified=True,
                                idempotency_verified=True, revision_verified=True)

    async def execute(self, tool, args, context, *, operation_id, idempotency_key, request_context):
        self.calls.append((tool, args.model_dump(), idempotency_key))
        if self.entered is not None and tool != 'memory.query':
            self.entered.set()
            await self.release.wait()
        if tool == 'memory.query':
            data = dict(query_digest=query_digest(args.query), items=[dict(id='m' + str(i), owner_user_id='other' if self.wrong_owner else 'u',
                category='preference', content='thích cà phê ' + str(i), consent_to_store=True,
                consent_to_use=True, active=True, sensitivity_reviewed=True, relevance=1.0, revision=1) for i in (1, 2)])
        else:
            data = dict(owner_user_id=context.user_id, memory_id=getattr(args, 'memory_id', 'new-memory'),
                        revision=getattr(args, 'expected_revision', 0) + 1, proposal_revision=args.proposal_revision)
        receipt = BackendReceipt(execution_id='fixture-' + operation_id, tool_id=tool, operation_id=operation_id,
            user_id=context.user_id, session_id=context.session_id, correlation_id=context.correlation_id,
            idempotency_key=idempotency_key)
        ack = self.ack and len(self.calls) != self.fail_at
        return BackendToolReply('SUCCESS', data, ack, receipt if ack else None)


def engine(monkeypatch, **adapter_args):
    from app.personal_assistant import tool_boundary
    monkeypatch.setattr(tool_boundary, 'get_tool', lambda tool: replace(get_tool(tool), status='AVAILABLE'))
    adapter = MemoryAdapter(**adapter_args)
    return WorkflowOrchestrator(ToolExecutionBoundary(adapter)), adapter


def test_unversioned_memory_cannot_be_confirmed_for_mutation(monkeypatch):
    async def run():
        service, adapter = engine(monkeypatch)
        original = adapter.execute

        async def without_revision(tool, *args, **kwargs):
            reply = await original(tool, *args, **kwargs)
            if tool == 'memory.query':
                for row in reply.data['items']:
                    row.pop('revision', None)
            return reply

        adapter.execute = without_revision
        wf = await service.sync_memory(analysis('update', query='đồ uống'), ctx())
        wf = await service.run(wf.id, ctx())
        wf = await service.select_memory(wf.id, ctx(), revision=wf.revision,
            operation_id='op1', record_ids=['m1'], mode='replace')
        with pytest.raises(ValueError, match='revision required'):
            await consent(service, wf)
        assert [tool for tool, _, _ in adapter.calls] == ['memory.query']
    asyncio.run(run())


async def consent(service, wf):
    wf = await service.memory_readback(wf.id, ctx(), revision=wf.revision)
    return await service.confirm(wf.id, ctx(), revision=wf.revision)


def test_save_readback_consent_ack_and_repeat_do_not_repeat_success(monkeypatch):
    async def run():
        service, adapter = engine(monkeypatch)
        source = analysis(dependencies=True)
        wf = await service.sync_memory(source, ctx())
        assert wf.state == 'WAITING_FOR_CONFIRMATION'
        assert 'Tôi thích uống trà' in str(wf.questions)
        with pytest.raises(ValueError, match='readback'):
            await service.confirm(wf.id, ctx(), revision=wf.revision)
        await service.run(wf.id, ctx())
        assert not adapter.calls
        wf = await consent(service, wf)
        result = await service.run(wf.id, ctx())
        assert result.state == 'COMPLETED'
        assert all(o.stage == 'ACKNOWLEDGED' for o in result.memory_operations)
        assert result.steps[1].call.depends_on == ['op1']
        assert all(s.result.executed for s in result.steps)
        repeat = await service.confirm(wf.id, ctx(), revision=wf.revision)
        await service.run(wf.id, ctx())
        assert repeat.id == wf.id and repeat.revision == wf.revision and len(adapter.calls) == 2
    asyncio.run(run())


@pytest.mark.parametrize('mode', ['append', 'replace'])
def test_update_verified_before_mode_and_after(monkeypatch, mode):
    async def run():
        service, adapter = engine(monkeypatch)
        wf = await service.sync_memory(analysis('update', query='đồ uống'), ctx())
        wf = await service.run(wf.id, ctx())
        assert [c[0] for c in adapter.calls] == ['memory.query']
        with pytest.raises(ValueError, match='verified memory'):
            await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1', record_ids=['invented'])
        wf = await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1', record_ids=['m1'])
        assert wf.memory_operations[0].stage == 'SELECT_MODE'
        with pytest.raises(ValueError):
            await service.confirm(wf.id, ctx(), revision=wf.revision)
        previous_revision = wf.revision
        wf = await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1', record_ids=['m1'], mode=mode)
        assert wf.revision > previous_revision
        assert 'trước: thích cà phê 1' in str(wf.questions)
        assert 'sau:' in str(wf.questions)
        wf = await consent(service, wf)
        wf = await service.run(wf.id, ctx())
        assert wf.state == 'COMPLETED'
        sent = adapter.calls[-1][1]
        assert sent['memory_id'] == 'm1' and sent['expected_revision'] == 1
        assert sent['update_mode'] == mode
        assert sent['content'] == 'Tôi thích uống trà'
        assert wf.steps[-1].call.depends_on == [wf.memory_operations[0].lookup_operation_id]
        await service.run(wf.id, ctx())
        assert len(adapter.calls) == 2
    asyncio.run(run())


def test_delete_group_confirms_exact_scope_and_never_repeats_completed_delete(monkeypatch):
    async def run():
        service, adapter = engine(monkeypatch)
        wf = await service.sync_memory(analysis('delete', content=None, query='đồ uống'), ctx())
        wf = await service.run(wf.id, ctx())
        wf = await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1', record_ids=['m1', 'm2'])
        assert 'm1' in str(wf.questions) and 'm2' in str(wf.questions) and '(xóa)' in str(wf.questions)
        wf = await consent(service, wf)
        wf = await service.run(wf.id, ctx())
        assert wf.state == 'COMPLETED'
        assert [c[1]['memory_id'] for c in adapter.calls[1:]] == ['m1', 'm2']
        await service.confirm(wf.id, ctx(), revision=wf.revision)
        await service.run(wf.id, ctx())
        assert len(adapter.calls) == 3
    asyncio.run(run())


@pytest.mark.parametrize('secret', ['OTP của tôi là 123456', 'Mật khẩu là 123456',
    'Số thẻ thanh toán là 123456', 'CCCD của tôi là 123456', 'Bệnh án của tôi số 123456',
    'Bí mật doanh nghiệp số 123456', 'API key là 123456'])
def test_prohibited_data_is_not_retained_or_confirmable(monkeypatch, secret):
    async def run():
        service, adapter = engine(monkeypatch)
        wf = await service.sync_memory(analysis(content=secret, query=secret), ctx())
        assert wf.state == 'BLOCKED' and wf.code == 'MEMORY_STORAGE_PROHIBITED'
        assert '123456' not in wf.model_dump_json()
        with pytest.raises(ValueError):
            await consent(service, wf)
        await service.run(wf.id, ctx())
        assert not adapter.calls
    asyncio.run(run())


def test_partial_group_ack_keeps_success_and_never_replays_after_reconfirmation(monkeypatch):
    async def run():
        service, adapter = engine(monkeypatch, fail_at=3)
        wf = await service.sync_memory(analysis('delete', content=None, query='đồ uống'), ctx())
        wf = await service.run(wf.id, ctx())
        wf = await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1', record_ids=['m1', 'm2'])
        wf = await consent(service, wf)
        wf = await service.run(wf.id, ctx())
        assert wf.state == 'BLOCKED'
        assert [s.state for s in wf.steps] == ['SUCCEEDED', 'SUCCEEDED', 'BLOCKED']
        await service.confirm(wf.id, ctx(), revision=wf.revision)
        await service.run(wf.id, ctx())
        assert len(adapter.calls) == 3
    asyncio.run(run())


def test_lookup_wrong_owner_never_provides_candidates(monkeypatch):
    async def run():
        service, adapter = engine(monkeypatch, wrong_owner=True)
        wf = await service.sync_memory(analysis('update', query='đồ uống'), ctx())
        wf = await service.run(wf.id, ctx())
        assert wf.code == 'MEMORY_NOT_PERMITTED_FOR_USE'
        assert not wf.memory_operations[0].candidates
        assert 'thích cà phê' not in wf.model_dump_json()
        with pytest.raises(ValueError):
            await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1', record_ids=['m1'], mode='replace')
    asyncio.run(run())


def test_cancelled_write_preserves_unknown_outcome_and_cannot_replay(monkeypatch):
    async def run():
        service, adapter = engine(monkeypatch)
        adapter.entered, adapter.release = asyncio.Event(), asyncio.Event()
        wf = await service.sync_memory(analysis(), ctx())
        wf = await consent(service, wf)
        task = asyncio.create_task(service.run(wf.id, ctx()))
        await adapter.entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        persisted = await service.store.get(wf.id, ctx())
        assert persisted.steps[0].outcome_uncertain
        assert persisted.reconciliation_state == 'PENDING_RECONCILIATION'
        again = await service.run(wf.id, ctx())
        assert again.code == 'RECONCILIATION_REQUIRED' and len(adapter.calls) == 1
    asyncio.run(run())


def test_mode_change_preserves_successful_lookup_id_and_revises_readback(monkeypatch):
    async def run():
        service, adapter = engine(monkeypatch)
        source = analysis('update', query='đồ uống')
        wf = await service.sync_memory(source, ctx())
        wf = await service.run(wf.id, ctx())
        wf = await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1', record_ids=['m1'], mode='replace')
        wf = await service.memory_readback(wf.id, ctx(), revision=wf.revision)
        old_revision, lookup_id = wf.revision, wf.memory_operations[0].lookup_operation_id
        wf = await service.sync_memory(source, ctx(), workflow_id=wf.id, modes={'op1': 'append'})
        assert wf.revision > old_revision and wf.memory_operations[0].lookup_operation_id == lookup_id
        assert wf.steps[0].state == 'SUCCEEDED'
        with pytest.raises(ValueError, match='readback'):
            await service.confirm(wf.id, ctx(), revision=wf.revision)
        wf = await consent(service, wf)
        wf = await service.run(wf.id, ctx())
        assert wf.state == 'COMPLETED' and len(adapter.calls) == 2
    asyncio.run(run())


def test_habit_is_only_a_proposal_until_readback_and_explicit_consent(monkeypatch):
    async def run():
        service, adapter = engine(monkeypatch)
        wf = await service.sync_memory(analysis('propose', 'Mỗi sáng tôi đi bộ'), ctx())
        for _ in range(2):
            wf = await service.run(wf.id, ctx())
        assert wf.state == 'WAITING_FOR_CONFIRMATION' and not adapter.calls
    asyncio.run(run())


def test_missing_backend_keeps_blocked_and_same_workflow_across_turns():
    async def run():
        service = WorkflowOrchestrator()
        source = analysis('update', query='đồ uống')
        wf = await service.sync_memory(source, ctx())
        changed = await service.sync_memory(source, ctx(), workflow_id=wf.id, modes={'op1': 'replace'})
        assert changed.id == wf.id and changed.revision == wf.revision + 1
        repeat = await service.sync_memory(source, ctx(), workflow_id=wf.id, modes={'op1': 'replace'})
        assert repeat.revision == changed.revision
        result = await service.run(wf.id, ctx())
        assert result.state == 'BLOCKED' and not any(s.result and s.result.executed for s in result.steps)
    asyncio.run(run())


def test_missing_ack_is_not_success_and_cannot_be_reexecuted(monkeypatch):
    async def run():
        service, adapter = engine(monkeypatch, ack=False)
        wf = await service.sync_memory(analysis(), ctx())
        wf = await consent(service, wf)
        wf = await service.run(wf.id, ctx())
        assert wf.state == 'BLOCKED' and wf.steps[0].outcome_uncertain
        assert not wf.steps[0].result.executed
        await service.confirm(wf.id, ctx(), revision=wf.revision)
        again = await service.run(wf.id, ctx())
        assert again.code == 'RECONCILIATION_REQUIRED' and len(adapter.calls) == 1
    asyncio.run(run())
