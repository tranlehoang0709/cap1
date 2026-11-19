"""H-05 memory controls. All successful Backend/channel replies are unit fixtures."""
import asyncio
from dataclasses import replace
import time

import httpx
import pytest

from app.clients.backend import BackendCode, BackendError
from app.personal_assistant.execution_contracts import ToolAvailability
from app.personal_assistant.personalization import PersonalizedAssistant
from app.personal_assistant.personalization_policy import (MemoryNotificationReceipt,
    MemoryNotificationScope, deliver_memory_notification)
from app.personal_assistant.tool_boundary import BackendToolReply, ToolExecutionBoundary
from app.services.audio_context import AudioContext
from tests.test_pa_memory_workflow import analysis, consent, ctx, engine
from tests.test_memory_tool_contracts import BackendFixture, approved, call, enable_unit_binding


async def ready(service, action='create'):
    wf = await service.sync_memory(analysis(action, content=None if action == 'delete' else 'Tôi thích uống trà',
        query='đồ uống' if action != 'create' else None), ctx())
    if action != 'create':
        wf = await service.run(wf.id, ctx())
        wf = await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1',
            record_ids=['m1', 'm2'] if action == 'delete' else ['m1'], mode='replace' if action == 'update' else None)
    return await consent(service, wf)


def test_memory_write_requires_verified_backend_idempotency(monkeypatch):
    async def run():
        service, backend = engine(monkeypatch)
        original = backend.availability
        backend.availability = lambda tool: original(tool).model_copy(update={'idempotency_verified':False})
        wf = await service.run((await ready(service)).id, ctx())
        assert wf.code == 'MEMORY_IDEMPOTENCY_NOT_VERIFIED' and not backend.calls
        assert wf.steps[0].result.outcome == 'NOT_EXECUTED'
    asyncio.run(run())


@pytest.mark.parametrize('action', ['update', 'delete'])
def test_mutation_requires_verified_compare_and_swap_contract(monkeypatch, action):
    async def run():
        service, backend = engine(monkeypatch)
        wf = await ready(service, action)
        original = backend.availability
        backend.availability = lambda tool: original(tool).model_copy(update={'revision_verified':False})
        wf = await service.run(wf.id, ctx())
        assert wf.code == 'MEMORY_REVISION_NOT_VERIFIED'
        assert [tool for tool, _, _ in backend.calls] == ['memory.query']
    asyncio.run(run())


def test_lost_ack_retry_reuses_key_and_preserves_uncertainty_until_ack(monkeypatch):
    async def run():
        service, backend = engine(monkeypatch)
        original = backend.execute
        lose_ack = [True]

        async def execute(tool, *args, **kwargs):
            response = await original(tool, *args, **kwargs)
            if lose_ack[0]:
                raise httpx.ReadTimeout('private-exception-marker')
            return response

        backend.execute = execute
        wf = await service.run((await ready(service)).id, ctx())
        reply = PersonalizedAssistant.workflow_reply(wf, ctx())
        assert reply['reconciliation_state'] == 'PENDING_RECONCILIATION'
        assert not reply['executed'] and not reply['notification']['prepared']
        assert 'chưa xác định' in reply['content'] and 'Chưa thực hiện thay đổi' not in reply['content']
        availability = backend.availability
        backend.availability = lambda tool: availability(tool).model_copy(update={'idempotency_verified':False})
        blocked = await service.retry(wf.id, ctx())
        assert blocked.code == 'RECONCILIATION_REQUIRED' and len(backend.calls) == 1
        backend.availability = availability
        retriable = await service.retry(wf.id, ctx())
        assert retriable.reconciliation_state == 'PENDING_RECONCILIATION'
        assert retriable.steps[0].outcome_uncertain and retriable.steps[0].retry_authorized
        backend.availability = lambda tool: availability(tool).model_copy(update={'idempotency_verified':False})
        revoked = await service.run(wf.id, ctx())
        assert revoked.reconciliation_state == 'PENDING_RECONCILIATION' and len(backend.calls) == 1
        backend.availability = availability
        await service.retry(wf.id, ctx())
        lose_ack[0] = False
        completed = await service.run(wf.id, ctx())
        assert completed.state == 'COMPLETED' and completed.reconciliation_state == 'NOT_REQUIRED'
        assert backend.calls[0][2] == backend.calls[1][2]
        await service.run(wf.id, ctx())
        assert len(backend.calls) == 2
    asyncio.run(run())


def test_generic_retry_rechecks_idempotency_before_dispatch(monkeypatch):
    from tests import test_pa_execution as base
    from app.personal_assistant.tool_planning import ToolPlan
    from app.personal_assistant.workflow import WorkflowOrchestrator

    async def run():
        boundary, backend = base.boundary(monkeypatch)
        backend.error = TimeoutError()
        service = WorkflowOrchestrator(boundary)
        wf = await service.create(ToolPlan(calls=[base.call()]), base.context())
        await service.confirm(wf.id, base.context(), revision=wf.revision)
        wf = await service.run(wf.id, base.context())
        await service.retry(wf.id, base.context())
        backend.api = backend.api.model_copy(update={'idempotency_verified':False})
        wf = await service.run(wf.id, base.context())
        assert wf.code == 'RECONCILIATION_REQUIRED' and len(backend.calls) == 1
        assert wf.reconciliation_state == 'PENDING_RECONCILIATION'
    asyncio.run(run())


def test_stale_revision_is_not_retried_or_rebased_automatically(monkeypatch):
    async def run():
        service, backend = engine(monkeypatch)
        wf = await ready(service, 'update')
        original = backend.execute

        async def stale(tool, args, *rest, **kw):
            if tool == 'memory.update':
                backend.calls.append((tool, args.model_dump(), kw['idempotency_key']))
                raise BackendError(BackendCode.HTTP, status=409)
            return await original(tool, args, *rest, **kw)

        backend.execute = stale
        wf = await service.run(wf.id, ctx())
        assert wf.steps[-1].result.status == 'CONFLICT' and wf.steps[-1].result.outcome == 'REJECTED'
        blocked = await service.retry(wf.id, ctx())
        assert blocked.code == 'MEMORY_REQUEST_REVIEW_REQUIRED'
        assert backend.calls[-1][1]['expected_revision'] == 1
        assert not PersonalizedAssistant.workflow_reply(blocked, ctx())['executed']
        assert len(backend.calls) == 2
    asyncio.run(run())


def test_failed_read_can_be_explicitly_retried_without_creating_a_write(monkeypatch):
    async def run():
        service, backend = engine(monkeypatch)
        original = backend.execute
        failed = [False]

        async def read(tool, *args, **kwargs):
            result = await original(tool, *args, **kwargs)
            if not failed[0]:
                failed[0] = True
                raise TimeoutError('read response lost')
            return result

        backend.execute = read
        wf = await service.sync_memory(analysis('update', query='đồ uống'), ctx())
        wf = await service.run(wf.id, ctx())
        assert wf.steps[0].result.outcome == 'NOT_EXECUTED'
        await service.retry(wf.id, ctx())
        wf = await service.run(wf.id, ctx())
        assert wf.memory_operations[0].candidates and not wf.memory_operations[0].selected_ids
        assert [tool for tool, _, _ in backend.calls] == ['memory.query','memory.query']
    asyncio.run(run())


def test_adapter_snapshots_call_and_never_logs_exception_payload(monkeypatch, caplog):
    enable_unit_binding(monkeypatch)
    operation = call()
    context = approved(operation)
    secret = 'private-sensitive-marker'
    backend = BackendFixture(dict(owner_user_id='u', memory_id='m1', proposal_revision=3, revision=1))

    class MutatingScope(AudioContext):
        async def run(self, callback):
            operation.tool_id = 'memory.delete'
            operation.arguments['content'] = secret
            return await super().run(callback)

    async def run():
        return await ToolExecutionBoundary(backend).execute(operation, context,
            request_context=MutatingScope(deadline=time.monotonic()+5))

    result = asyncio.run(run())
    assert result.status == 'SUCCESS' and result.tool_id == 'memory.create'
    assert secret not in repr(operation)
    assert secret not in repr(BackendToolReply('UNAVAILABLE', {'content':secret}))
    assert secret not in caplog.text


def test_backend_exception_secret_is_not_exposed_or_logged(monkeypatch, caplog):
    enable_unit_binding(monkeypatch)
    secret = 'SECRET_EXCEPTION_CANARY'
    operation = call()
    backend = BackendFixture({})

    async def broken(*args, **kwargs):
        raise RuntimeError(secret)

    backend.execute = broken
    result = asyncio.run(ToolExecutionBoundary(backend).execute(operation, approved(operation)))
    assert result.outcome == 'UNKNOWN' and result.code == 'INVALID_OR_UNAVAILABLE_BACKEND'
    assert secret not in repr(result) and secret not in caplog.text


class ChannelFixture:
    def __init__(self, name, *, owner='u', fault=None, idempotency=True):
        self.scope = MemoryNotificationScope(channel=name, user_id=owner, session_id='s', correlation_id='correlation')
        self.calls, self.delivered = [], set()
        self.fault, self.idempotency = fault, idempotency

    def availability(self, context):
        return ToolAvailability(status='AVAILABLE', endpoint_verified=True, contract_verified=True,
                                auth_verified=True, idempotency_verified=self.idempotency)

    async def send(self, event, context, *, idempotency_key, request_context):
        self.calls.append(idempotency_key)
        if self.fault == 'timeout':
            raise TimeoutError('private-channel-secret')
        self.delivered.add(idempotency_key)
        return MemoryNotificationReceipt(event_id=event['event_id'], channel=self.scope.channel,
            user_id='other' if self.fault == 'wrong_ack' else context.user_id,
            session_id=context.session_id, correlation_id=context.correlation_id, accepted=True)


def test_no_backend_ack_means_no_channel_send(monkeypatch):
    async def run():
        service, _ = engine(monkeypatch, ack=False)
        wf = await service.run((await ready(service)).id, ctx())
        channel = ChannelFixture('website')
        response = await PersonalizedAssistant.workflow_notification(wf, ctx(), channels={'website':channel})
        assert not channel.calls and not response['notification']['prepared']
        assert response['reconciliation_state'] == 'PENDING_RECONCILIATION'
    asyncio.run(run())


@pytest.mark.parametrize('field', ['session_id','correlation_id'])
def test_notification_session_scope_is_checked_before_send(monkeypatch, field):
    async def run():
        service, _ = engine(monkeypatch)
        wf = await service.run((await ready(service)).id, ctx())
        channel = ChannelFixture('website')
        channel.scope = channel.scope.model_copy(update={field:'other'})
        result = await deliver_memory_notification(wf, ctx(), channels={'website':channel})
        assert not channel.calls and result['delivery']['website']['status'] == 'FORBIDDEN'
    asyncio.run(run())


@pytest.mark.parametrize('name', ['website','xiaozhi_voice'])
def test_verified_channel_ack_and_stable_notification_key(monkeypatch, name):
    async def run():
        service, _ = engine(monkeypatch)
        wf = await service.run((await ready(service)).id, ctx())
        channel = ChannelFixture(name)
        first = await deliver_memory_notification(wf, ctx(), channels={name:channel})
        second = await deliver_memory_notification(wf, ctx(), channels={name:channel})
        assert first['delivery'][name]['sent'] and second['delivery'][name]['sent']
        assert channel.calls[0] == channel.calls[1] and len(channel.delivered) == 1
    asyncio.run(run())


@pytest.mark.parametrize('settings,status', [({'owner':'other'},'FORBIDDEN'),
    ({'idempotency':False},'BLOCKED'), ({'fault':'timeout'},'PENDING_DELIVERY'),
    ({'fault':'wrong_ack'},'PENDING_DELIVERY')])
def test_channel_scope_and_ack_fail_closed_without_changing_business_ack(monkeypatch, settings, status):
    async def run():
        service, _ = engine(monkeypatch)
        wf = await service.run((await ready(service)).id, ctx())
        channel = ChannelFixture('website', **settings)
        result = await deliver_memory_notification(wf, ctx(), channels={'website':channel})
        assert result['complete'] and result['executed']
        assert result['delivery']['website']['status'] == status and not result['delivery']['website']['sent']
        if status in ('FORBIDDEN','BLOCKED'):
            assert not channel.calls
    asyncio.run(run())


def test_partial_group_retry_preserves_completed_step_and_notification_ids(monkeypatch):
    async def run():
        service, backend = engine(monkeypatch, fail_at=3)
        wf = await service.run((await ready(service, 'delete')).id, ctx())
        partial = PersonalizedAssistant.workflow_reply(wf, ctx())
        assert partial['status'] == 'PARTIALLY_COMPLETED' and not partial['complete']
        assert len(partial['notification']['events']) == 1
        channel = ChannelFixture('website')
        await deliver_memory_notification(wf, ctx(), channels={'website':channel})
        wf = await service.retry(wf.id, ctx())
        assert wf.reconciliation_state == 'PENDING_RECONCILIATION'
        wf = await service.run(wf.id, ctx())
        final = await deliver_memory_notification(wf, ctx(), channels={'website':channel})
        assert wf.state == 'COMPLETED' and len(backend.calls) == 4
        assert final['notification']['events'][0]['event_id'] == partial['notification']['events'][0]['event_id']
        assert len(channel.delivered) == 2
        assert backend.calls[2][2] == backend.calls[3][2]
    asyncio.run(run())


def test_corrupt_completed_snapshot_cannot_create_success_or_notification(monkeypatch):
    async def run():
        service, _ = engine(monkeypatch)
        wf = await service.run((await ready(service)).id, ctx())
        wf.steps[0].result.data['owner_user_id'] = 'other'
        result = PersonalizedAssistant.workflow_reply(wf, ctx())
        assert not result['complete'] and not result['executed'] and not result['notification']['prepared']
        assert result['reconciliation_state'] == 'PENDING_RECONCILIATION'
    asyncio.run(run())
