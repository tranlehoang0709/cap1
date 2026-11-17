"""PA-23 memory stages. All reads/writes still cross the existing tool boundary."""
from dataclasses import replace
import asyncio
import hashlib
import json
from typing import Literal
from uuid import uuid4

from pydantic import Field

from app.personal_assistant.schema import StrictModel, Operation, Entities
from app.personal_assistant.memory_contracts import MemoryAuthorization, MemoryQueryOutput, MemoryRecord, query_digest
from app.personal_assistant.tool_contracts import MemoryTarget
from app.personal_assistant.memory_understanding import prepare_memory, guard_memory
from app.personal_assistant.tool_boundary import ToolCall, ToolResult, argument_errors
from app.personal_assistant.tool_registry import get_tool


class MemoryOperation(StrictModel):
    operation_id: str
    action: Literal['create', 'propose', 'update', 'delete']
    depends_on: list[str] = Field(default_factory=list)
    content: str | None = None
    query: str | None = None
    mode: Literal['replace', 'append'] | None = None
    stage: Literal['PROPOSED', 'PROHIBITED', 'CLARIFICATION', 'LOOKUP', 'SELECT_SCOPE',
                   'SELECT_MODE', 'READBACK', 'CONFIRMED', 'ACKNOWLEDGED'] = 'PROPOSED'
    candidates: list[MemoryRecord] = Field(default_factory=list, repr=False)
    selected_ids: list[str] = Field(default_factory=list)
    lookup_operation_id: str | None = None
    write_operation_ids: list[str] = Field(default_factory=list)
    readback_revision: int | None = None


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class MemoryWorkflowMixin:
    async def sync_memory(self, analysis, context, *, workflow_id=None, modes=None):
        """Retain the same workflow across dialogue turns; never execute from sync."""
        from app.personal_assistant.workflow_schema import Workflow, topological
        operations = []
        for original in analysis.operations:
            if original.feature != 'PA-04' or original.action not in ('create', 'propose', 'update', 'delete'):
                raise ValueError('Memory workflow requires memory mutation proposals only')
            op = original.model_copy(deep=True)
            prepare_memory(op)
            guard_memory(op)
            if original.entities.content and op.action != 'delete':
                content_check = original.model_copy(deep=True)
                content_check.source_text = original.entities.content
                guard_memory(content_check)
                op.memory.prohibited_categories = list(set(op.memory.prohibited_categories + content_check.memory.prohibited_categories))
                if op.memory.prohibited_categories:
                    op.memory.storage_policy = 'PROHIBITED'
            prohibited = op.memory.storage_policy == 'PROHIBITED' and op.action != 'delete'
            item = MemoryOperation(operation_id=op.id, action=op.action, depends_on=op.depends_on,
                content=None if prohibited else original.entities.content,
                query=None if prohibited else original.entities.target_query, mode=(modes or {}).get(op.id))
            item.stage = ('PROHIBITED' if prohibited else 'CLARIFICATION' if
                any(issue != 'update_mode_unclear' for issue in op.memory.issues) else
                'LOOKUP' if op.action in ('update', 'delete') else 'PROPOSED')
            operations.append(item)
        topological([ToolCall(operation_id=o.operation_id, tool_id='memory.' +
            ('create' if o.action == 'propose' else o.action), feature='PA-04',
            arguments={}, depends_on=o.depends_on) for o in operations])
        fingerprint = digest([o.model_dump(exclude={'candidates'}) for o in operations])
        if workflow_id is None:
            wf = Workflow(id='wf_' + uuid4().hex, user_id=context.user_id, session_id=context.session_id,
                correlation_id=context.correlation_id, steps=[], memory_operations=operations,
                plan_fingerprint=fingerprint)
            self._memory_refresh(wf)
            return await self.store.create(wf)
        async with self.store.edit(workflow_id, context) as wf:
            if not wf.memory_operations:
                raise ValueError('Not a memory workflow')
            if wf.plan_fingerprint != fingerprint:
                if wf.state in ('COMPLETED', 'CANCELLED') or any((s.state == 'SUCCEEDED' and s.call.tool_id != 'memory.query') or s.outcome_uncertain for s in wf.steps):
                    raise ValueError('Executed or uncertain memory workflow cannot be replaced')
                previous = {o.operation_id: o for o in wf.memory_operations}
                kept = set()
                for op in operations:
                    old = previous.get(op.operation_id)
                    if old and op.query == old.query and op.action == old.action and op.stage not in ('PROHIBITED', 'CLARIFICATION'):
                        op.candidates, op.selected_ids = old.candidates, old.selected_ids
                        op.lookup_operation_id = old.lookup_operation_id
                        if op.lookup_operation_id:
                            kept.add(op.lookup_operation_id)
                            op.stage = 'SELECT_SCOPE'
                wf.memory_operations = operations
                wf.steps = [s for s in wf.steps if s.call.operation_id in kept and s.state == 'SUCCEEDED']
                wf.plan_fingerprint = fingerprint
                wf.revision += 1
            self._memory_refresh(wf)
        return await self.store.get(workflow_id, context)

    def _memory_refresh(self, wf):
        if len(wf.steps) > 64 or len(wf.model_dump_json()) + len(wf.steps) * 2048 > self.store.max_chars:
            raise ValueError('Memory workflow state budget exceeded')
        if wf.cancel_requested:
            self._cancel(wf)
            return
        if all(o.stage == 'ACKNOWLEDGED' for o in wf.memory_operations):
            wf.state, wf.code, wf.questions = 'COMPLETED', None, []
            return
        if any(s.outcome_uncertain and not s.retry_authorized for s in wf.steps):
            wf.state, wf.code = 'BLOCKED', 'RECONCILIATION_REQUIRED'
            return
        failed = next((s for s in wf.steps if s.result and s.result.status != 'SUCCESS'), None)
        if failed:
            wf.state, wf.code = 'BLOCKED', failed.result.code
            return
        prohibited = any(o.stage == 'PROHIBITED' for o in wf.memory_operations)
        tools = {'memory.create' if o.action == 'propose' else 'memory.' + o.action for o in wf.memory_operations}
        if any(o.action in ('update', 'delete') for o in wf.memory_operations):
            tools.add('memory.query')
        unavailable = any(self.boundary.availability(t).status != 'AVAILABLE' for t in tools)
        wf.state, wf.code = ('BLOCKED', 'MEMORY_STORAGE_PROHIBITED') if prohibited else (
            ('BLOCKED', 'MEMORY_LOOKUP_NOT_IMPLEMENTED' if any(o.action in ('update', 'delete') for o in wf.memory_operations)
             else 'NOT_IMPLEMENTED') if unavailable else ('WAITING_FOR_INFORMATION', 'MEMORY_PREPARATION_REQUIRED'))
        wf.questions = []
        for op in wf.memory_operations:
            if op.stage == 'PROHIBITED':
                wf.questions.append('Nội dung bị cấm lưu; không thể xác nhận để bỏ qua kiểm tra.')
            elif op.stage == 'CLARIFICATION' or (op.action != 'delete' and not op.content):
                wf.questions.append('Bạn vui lòng nói lại nội dung chính xác cần ghi nhớ.')
            elif op.action in ('create', 'propose'):
                op.stage = op.stage if op.stage in ('CONFIRMED', 'ACKNOWLEDGED') else 'READBACK'
                wf.questions.append('Nội dung dự kiến lưu: ' + op.content + '. Bạn đồng ý lưu chứ?')
            elif not op.selected_ids:
                wf.questions.append('Cần đọc và chọn đúng mục/nhóm trí nhớ: ' + (op.query or '(chưa xác định)'))
            elif op.action == 'update' and not op.mode:
                op.stage = 'SELECT_MODE'
                wf.questions.append('Bạn muốn bổ sung hay thay thế nội dung hiện tại?')
            elif op.stage not in ('CONFIRMED', 'ACKNOWLEDGED'):
                op.stage = 'READBACK'
                for record in op.candidates:
                    if record.id in op.selected_ids:
                        after = self._memory_after(op, record)
                        wf.questions.append('Phạm vi: ' + record.id + '; trước: ' + record.content
                                            + '; sau: ' + (after if after is not None else '(xóa)'))
        if not prohibited and not unavailable and all(o.stage in ('READBACK', 'CONFIRMED', 'ACKNOWLEDGED') for o in wf.memory_operations):
            wf.state = 'READY' if all(o.stage in ('CONFIRMED', 'ACKNOWLEDGED') for o in wf.memory_operations) else 'WAITING_FOR_CONFIRMATION'
            wf.code = None if wf.state == 'READY' else 'CONFIRMATION_REQUIRED'

    @staticmethod
    def _memory_after(op, record):
        if op.action == 'delete':
            return None
        return record.content + '\n' + op.content if op.mode == 'append' else op.content

    async def memory_readback(self, workflow_id, context, *, revision):
        """Caller must show returned questions before requesting confirmation."""
        async with self.store.edit(workflow_id, context) as wf:
            if wf.revision != revision or not wf.memory_operations:
                raise ValueError('Stale memory readback')
            self._memory_refresh(wf)
            for op in wf.memory_operations:
                if op.stage == 'READBACK':
                    op.readback_revision = wf.revision
        return await self.store.get(workflow_id, context)

    async def select_memory(self, workflow_id, context, *, revision, operation_id, record_ids, mode=None):
        async with self.store.edit(workflow_id, context) as wf:
            if wf.revision != revision or wf.state in ('COMPLETED', 'CANCELLED'):
                raise ValueError('Stale memory selection')
            op = next(o for o in wf.memory_operations if o.operation_id == operation_id)
            if op.stage in ('CONFIRMED', 'ACKNOWLEDGED') or any(s.outcome_uncertain for s in wf.steps):
                raise ValueError('Cannot change confirmed or uncertain scope')
            known = {r.id for r in op.candidates}
            if not record_ids or len(set(record_ids)) != len(record_ids) or not set(record_ids) <= known:
                raise ValueError('Select only verified memory records')
            if op.action == 'update' and len(record_ids) != 1:
                raise ValueError('Update one exact memory record')
            if mode not in (None, 'append', 'replace'):
                raise ValueError('Unknown memory update mode')
            op.selected_ids, op.mode = list(record_ids), mode
            op.readback_revision = None
            wf.revision += 1
            self._memory_refresh(wf)
        return await self.store.get(workflow_id, context)

    async def confirm_memory(self, workflow_id, context, *, revision, accept=True):
        from app.personal_assistant.workflow_schema import WorkflowStep
        async with self.store.edit(workflow_id, context) as wf:
            if type(accept) is not bool or wf.revision != revision or not wf.memory_operations:
                raise ValueError('Stale memory confirmation')
            if wf.state == 'CANCELLED':
                raise ValueError('Cancelled memory workflow')
            if not accept:
                self._cancel(wf)
            else:
                for op in wf.memory_operations:
                    if op.stage in ('CONFIRMED', 'ACKNOWLEDGED'):
                        continue
                    if op.stage != 'READBACK' or op.readback_revision != revision:
                        raise ValueError('Verified scope and before/after readback required')
                used = {o.operation_id for o in wf.memory_operations} | {s.call.operation_id for s in wf.steps}
                for op in wf.memory_operations:
                    if op.stage in ('CONFIRMED', 'ACKNOWLEDGED'):
                        continue
                    records = [r for r in op.candidates if r.id in op.selected_ids] if op.action in ('update', 'delete') else [None]
                    for index, record in enumerate(records):
                        operation_id = op.operation_id if index == len(records) - 1 else self._memory_id(used)
                        args = {'proposal_revision': revision}
                        if record:
                            if record.revision is None:
                                raise ValueError('Verified memory revision required before mutation')
                            args.update(memory_id=record.id, expected_revision=record.revision)
                            if op.action == 'update':
                                args['update_mode'] = op.mode
                        if op.action != 'delete':
                            args['content'] = op.content
                            review = Operation(id=op.operation_id, intent='memory review', feature='PA-04',
                                action='create', source_text=self._memory_after(op, record) if record else op.content,
                                entities=Entities(content=self._memory_after(op, record) if record else op.content))
                            guard_memory(review)
                            if review.memory.storage_policy == 'PROHIBITED':
                                raise ValueError('Prohibited memory content cannot be confirmed')
                        deps = op.depends_on + ([op.lookup_operation_id] if op.lookup_operation_id else [])
                        call = ToolCall(operation_id=operation_id, tool_id='memory.' + ('create' if op.action == 'propose' else op.action),
                            feature='PA-04', arguments=args, depends_on=deps)
                        if argument_errors(get_tool(call.tool_id).input_model, args):
                            raise ValueError('Invalid memory mutation arguments')
                        key = context.call_key(call)
                        wf.steps.append(WorkflowStep(call=call, confirmed_key=key, idempotency_key=key))
                        op.write_operation_ids.append(operation_id)
                    op.stage = 'CONFIRMED'
                self._memory_refresh(wf)
        return await self.store.get(workflow_id, context)

    @staticmethod
    def _memory_id(used):
        value = 'op' + str(max((int(s[2:]) for s in used), default=0) + 1)
        used.add(value)
        return value

    async def retry_memory(self, workflow_id, context):
        """Explicit retry only; retain keys and pending reconciliation until a valid ACK."""
        async with self.store.edit(workflow_id, context) as wf:
            if wf.state in ('COMPLETED', 'CANCELLED'):
                raise ValueError('Terminal memory workflow cannot be retried')
            for step in wf.steps:
                if step.state == 'SUCCEEDED':
                    continue
                if step.result and step.result.outcome == 'REJECTED':
                    wf.state, wf.code = 'BLOCKED', 'MEMORY_REQUEST_REVIEW_REQUIRED'
                    wf.questions = ['Backend từ chối yêu cầu; cần đọc lại dữ liệu/quyền hiện tại và xác nhận yêu cầu mới.']
                    return wf.model_copy(deep=True)
                if step.call.tool_id != 'memory.query' and (step.result or step.outcome_uncertain):
                    key = context.call_key(step.call)
                    if (not self.boundary.can_retry_write(step.call.tool_id) or
                            key != step.idempotency_key or key != step.confirmed_key):
                        wf.state, wf.code = 'BLOCKED', 'RECONCILIATION_REQUIRED'
                        wf.questions = ['Kết quả ghi chưa rõ hoặc chưa có đảm bảo idempotency; cần đối soát Backend trước khi thử lại.']
                        return wf.model_copy(deep=True)
            failed_reads = {s.call.operation_id for s in wf.steps if s.call.tool_id == 'memory.query'
                            and s.state != 'SUCCEEDED'}
            wf.steps = [s for s in wf.steps if s.call.operation_id not in failed_reads]
            for op in wf.memory_operations:
                if op.lookup_operation_id in failed_reads:
                    op.lookup_operation_id = None
                    op.candidates, op.selected_ids, op.readback_revision = [], [], None
                    op.stage = 'LOOKUP'
            for step in wf.steps:
                if step.state != 'SUCCEEDED' and (step.result or step.outcome_uncertain):
                    step.retry_authorized = True
                    step.state, step.result = 'PENDING', None
            self._memory_refresh(wf)
        return await self.store.get(workflow_id, context)

    async def run_memory(self, workflow_id, context):
        from app.personal_assistant.workflow_schema import WorkflowStep, topological
        async with self.store.edit(workflow_id, context) as wf:
            if not wf.memory_operations:
                raise ValueError('Not a memory workflow')
            self._memory_refresh(wf)
            if not context.dialogue_ready:
                wf.state, wf.code = 'BLOCKED', 'DIALOGUE_NOT_READY'
                return wf.model_copy(deep=True)
            if wf.state in ('BLOCKED', 'COMPLETED', 'CANCELLED'):
                return wf.model_copy(deep=True)
            used = {o.operation_id for o in wf.memory_operations} | {s.call.operation_id for s in wf.steps}
            for op in wf.memory_operations:
                if wf.cancel_requested:
                    self._cancel(wf)
                    return wf.model_copy(deep=True)
                if op.stage != 'LOOKUP' or not op.query:
                    continue
                call = ToolCall(operation_id=self._memory_id(used), tool_id='memory.query', feature='PA-04',
                    arguments={'query': op.query, 'timezone': 'Asia/Bangkok', 'limit': 8,
                               'purpose': 'management', 'permitted_use_only': False})
                lookup_context = replace(context, satisfied_preconditions=context.satisfied_preconditions |
                                         {(call.operation_id, 'memory_management_lookup')})
                result = await asyncio.wait_for(self.boundary.execute(call, lookup_context), self.step_timeout_seconds)
                step = WorkflowStep(call=call, result=result, attempts=1,
                    state='SUCCEEDED' if result.status == 'SUCCESS' else 'BLOCKED')
                wf.steps.append(step)
                if result.status != 'SUCCESS':
                    wf.state, wf.code = 'BLOCKED', result.code
                    return wf.model_copy(deep=True)
                data = MemoryQueryOutput.model_validate(result.data)
                if (data.query_digest != query_digest(op.query) or any(r.owner_user_id != context.user_id for r in data.items)
                        or len({r.id for r in data.items}) != len(data.items)):
                    step.state = 'BLOCKED'
                    step.result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                        status='UNAVAILABLE', code='MEMORY_LOOKUP_SCOPE_MISMATCH')
                    wf.state, wf.code = 'BLOCKED', 'MEMORY_LOOKUP_SCOPE_MISMATCH'
                    return wf.model_copy(deep=True)
                op.candidates = [r for r in data.items if r.active and (op.action == 'delete' or r.sensitivity_reviewed)]
                op.lookup_operation_id, op.stage = call.operation_id, 'SELECT_SCOPE'
                wf.revision += 1
            self._memory_refresh(wf)
            if wf.state != 'READY':
                return wf.model_copy(deep=True)
            for call in topological([s.call for s in wf.steps]):
                step = next(s for s in wf.steps if s.call.operation_id == call.operation_id)
                if step.state == 'SUCCEEDED':
                    continue
                if (step.outcome_uncertain and not step.retry_authorized) or step.result:
                    wf.state, wf.code = 'BLOCKED', 'RECONCILIATION_REQUIRED' if step.outcome_uncertain else step.result.code
                    break
                if step.outcome_uncertain and not self.boundary.can_retry_write(call.tool_id):
                    step.retry_authorized = False
                    wf.state, wf.code = 'BLOCKED', 'RECONCILIATION_REQUIRED'
                    break
                done = {s.call.operation_id for s in wf.steps if s.state == 'SUCCEEDED'}
                if any(dep not in done for dep in call.depends_on):
                    wf.state, wf.code = 'BLOCKED', 'DEPENDENCY_NOT_SUCCEEDED'
                    break
                op = next(o for o in wf.memory_operations if call.operation_id in o.write_operation_ids)
                proofs = frozenset((call.operation_id, p) for p in ('sensitive_data_checked', 'memory_consent', 'content_read_back', 'target_resolved'))
                ctx = replace(context, dialogue_ready=True, completed_dependencies=frozenset(done),
                    confirmed_call_keys=frozenset({step.confirmed_key}), satisfied_preconditions=proofs,
                    memory_authorizations={call.operation_id: MemoryAuthorization(
                        owner_user_id=context.user_id, session_id=context.session_id,
                        correlation_id=context.correlation_id, proposal_revision=call.arguments['proposal_revision'],
                        target=MemoryTarget(memory_id=call.arguments['memory_id'],
                            expected_revision=call.arguments['expected_revision']) if 'memory_id' in call.arguments else None,
                        update_mode=call.arguments.get('update_mode'), consent_to_store=op.action != 'delete',
                        confirmed_call_key=step.confirmed_key)})
                step.attempts += 1
                step.state = 'RUNNING'
                was_uncertain = step.outcome_uncertain
                await self.store._publish(wf)
                if wf.cancel_requested:
                    self._cancel(wf)
                    break
                try:
                    result = await asyncio.wait_for(self.boundary.execute(call, ctx), self.step_timeout_seconds)
                except BaseException:
                    step.retry_authorized = False
                    step.outcome_uncertain = True
                    step.state = 'FAILED'
                    step.result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                        status='UNAVAILABLE', code='MEMORY_OUTCOME_UNKNOWN', outcome='UNKNOWN',
                        reconciliation_state='PENDING_RECONCILIATION')
                    wf.state, wf.code = 'BLOCKED', 'RECONCILIATION_REQUIRED'
                    step.execution_outcome = 'UNKNOWN'
                    step.reconciliation_state = wf.reconciliation_state = 'PENDING_RECONCILIATION'
                    await asyncio.shield(self.store._publish(wf))
                    raise
                if (result.status == 'SUCCESS' and 'memory_id' in call.arguments
                        and result.data.get('memory_id') != call.arguments['memory_id']):
                    result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                        status='UNAVAILABLE', code='MEMORY_ACK_TARGET_MISMATCH', outcome='UNKNOWN',
                        reconciliation_state='PENDING_RECONCILIATION')
                if was_uncertain and result.outcome != 'CONFIRMED':
                    result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                        status=result.status, code=result.code, outcome='UNKNOWN',
                        reconciliation_state='PENDING_RECONCILIATION')
                step.result = result
                step.retry_authorized = False
                step.outcome_uncertain = result.outcome == 'UNKNOWN'
                step.execution_outcome, step.reconciliation_state = result.outcome, result.reconciliation_state
                wf.reconciliation_state = ('PENDING_RECONCILIATION' if any(s.outcome_uncertain for s in wf.steps)
                                           else 'NOT_REQUIRED')
                if result.status != 'SUCCESS':
                    step.state, wf.state, wf.code = 'BLOCKED', 'BLOCKED', result.code
                    break
                step.state = 'SUCCEEDED'
                if all(s.state == 'SUCCEEDED' for s in wf.steps if s.call.operation_id in op.write_operation_ids):
                    op.stage = 'ACKNOWLEDGED'
            if all(o.stage == 'ACKNOWLEDGED' for o in wf.memory_operations):
                self._memory_refresh(wf)
        return await self.store.get(workflow_id, context)
