"""PA-23 dependency execution over H-03; no HTTP bindings or dialogue parser."""
import asyncio
from dataclasses import replace
import hashlib
import json
from uuid import uuid4

from app.personal_assistant.tool_boundary import ToolCall, ToolResult, ToolExecutionBoundary, argument_errors
from app.personal_assistant.tool_registry import get_tool
from app.personal_assistant.workflow_schema import Workflow, WorkflowStep, mark_cancelled, topological
from app.personal_assistant.workflow_store import WorkflowStore
from app.personal_assistant.memory_workflow import MemoryWorkflowMixin


def _hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _interval(call):
    source = call.arguments if call.tool_id == 'event.create' else call.arguments.get('changes', {})
    return {key: value for key, value in source.items()
            if key in ('start', 'end', 'duration_minutes', 'recurrence')} | {
                'timezone': call.arguments.get('timezone')}


def _expand(plan):
    calls = [call.model_copy(deep=True) for call in topological(plan.calls)]
    conflict_for = {}
    next_id = max((int(call.operation_id[2:]) for call in calls), default=0) + 1
    for call in list(calls):
        if call.tool_id not in ('event.create', 'event.update'):
            continue
        interval = _interval(call)
        if call.tool_id == 'event.update' and set(interval) == {'timezone'}:
            continue
        existing = next((parent for parent in calls if parent.operation_id in call.depends_on
            and parent.tool_id == 'event.check_conflict' and parent.arguments == interval), None)
        if existing is None:
            existing = ToolCall(operation_id='op' + str(next_id), tool_id='event.check_conflict',
                feature='PA-14', arguments=interval, depends_on=call.depends_on.copy())
            next_id += 1
            calls.append(existing)
            call.depends_on.append(existing.operation_id)
        conflict_for[call.operation_id] = existing.operation_id
    return topological(calls), conflict_for


class WorkflowOrchestrator(MemoryWorkflowMixin):
    def __init__(self, boundary=None, store=None, *, step_timeout_seconds=300):
        if step_timeout_seconds <= 0:
            raise ValueError('A positive step deadline is required')
        self.boundary = boundary if boundary is not None else ToolExecutionBoundary()
        self.store = store if store is not None else WorkflowStore()
        self.step_timeout_seconds = step_timeout_seconds

    def _context(self, wf, context):
        done, record_ids, proofs = set(), {}, set(context.satisfied_preconditions)
        controlled = {'conflict_checked', 'conflict_decision_if_needed', 'linked_creation_succeeded'}
        proofs = {(operation_id, proof) for operation_id, proof in proofs if proof not in controlled}
        for step in wf.steps:
            result = step.result
            if step.state == 'SUCCEEDED' and result and result.status == 'SUCCESS' and result.executed:
                operation_id = step.call.operation_id
                done.add(operation_id)
                if result.data and isinstance(result.data.get('id'), str):
                    record_ids[operation_id] = result.data['id']
        for step in wf.steps:
            if step.conflict_for:
                check = next(item for item in wf.steps if item.call.operation_id == step.conflict_for)
                if (check.call.operation_id in done and check.result and check.result.data
                        and check.call.arguments == _interval(step.call)):
                    proofs.add((step.call.operation_id, 'conflict_checked'))
                    data = check.result.data
                    if not data['has_conflict'] or (step.conflict_decision == 'keep_overlap'
                            and step.decided_conflict_key == _hash(data)):
                        proofs.add((step.call.operation_id, 'conflict_decision_if_needed'))
            parent = step.call.arguments.get('linked_operation_id')
            if parent in record_ids:
                proofs.add((step.call.operation_id, 'linked_creation_succeeded'))
        keys = {step.confirmed_key for step in wf.steps if step.confirmed_key}
        return replace(context, confirmed_call_keys=frozenset(keys), completed_dependencies=frozenset(done),
            dependency_record_ids=record_ids, satisfied_preconditions=frozenset(proofs))

    def _refresh(self, wf, context):
        wf.dialogue_integration = 'READY' if context.dialogue_ready else 'BLOCKED_H02'
        wf.questions = []
        if wf.cancel_requested:
            self._cancel(wf)
            return
        if wf.steps and all(step.state == 'SUCCEEDED' for step in wf.steps):
            wf.state, wf.code = 'COMPLETED', None
            return
        if wf.unsupported_operations or not wf.steps:
            wf.state, wf.code = 'BLOCKED', 'UNSUPPORTED_OR_EMPTY_PLAN'
            return
        for step in wf.steps:
            if step.state not in ('PENDING', 'READY') or step.result or step.call.validation_errors:
                continue
            availability = self.boundary.availability(step.call.tool_id)
            if availability.status != 'AVAILABLE':
                step.state = 'BLOCKED'
                step.result = ToolResult(operation_id=step.call.operation_id, tool_id=step.call.tool_id,
                    status='UNAVAILABLE', code=availability.status)
        if not context.dialogue_ready:
            wf.state, wf.code = 'BLOCKED', 'DIALOGUE_NOT_READY'
            return
        if any(step.call.validation_errors for step in wf.steps):
            wf.state, wf.code = 'WAITING_FOR_INFORMATION', 'INVALID_ARGUMENTS'
            wf.questions = [step.call.operation_id + ': ' + ', '.join(step.call.validation_errors)
                            for step in wf.steps if step.call.validation_errors]
            return
        bad = next((step for step in wf.steps if step.state in ('FAILED', 'BLOCKED') and step.result), None)
        if bad:
            self._stop(wf, bad)
            return
        ctx = self._context(wf, context)
        waiting = []
        for step in wf.steps:
            tool = get_tool(step.call.tool_id)
            if step.state == 'SUCCEEDED' or tool.access == 'READ':
                continue
            key = ctx.call_key(step.call)
            if step.confirmed_key != key:
                waiting.append(step)
        for step in wf.steps:
            if step.state not in ('SUCCEEDED', 'FAILED', 'BLOCKED', 'SKIPPED'):
                tool = get_tool(step.call.tool_id)
                step.state = ('READY' if all(dep in ctx.completed_dependencies for dep in step.call.depends_on)
                    and (tool.access == 'READ' or step.confirmed_key == ctx.call_key(step.call)) else 'PENDING')
        if waiting:
            wf.state, wf.code = 'WAITING_FOR_CONFIRMATION', 'CONFIRMATION_REQUIRED'
            wf.questions = ['Xác nhận ' + step.call.tool_id + ': ' + json.dumps(step.call.arguments, ensure_ascii=False)
                            for step in waiting]
        else:
            wf.state, wf.code = 'READY', None

    @staticmethod
    def _cancel(wf):
        mark_cancelled(wf)

    @staticmethod
    def _stop(wf, failed):
        succeeded = any(step.state == 'SUCCEEDED' for step in wf.steps)
        wf.state = 'PARTIALLY_COMPLETED' if succeeded else ('BLOCKED' if failed.state == 'BLOCKED' else 'FAILED')
        wf.code = failed.result.code
        blocked_ids = {failed.call.operation_id}
        for step in wf.steps:
            if step.state != 'SUCCEEDED' and any(dep in blocked_ids for dep in step.call.depends_on):
                step.state = 'BLOCKED'
                blocked_ids.add(step.call.operation_id)
        wf.questions = ['Bước ' + failed.call.operation_id + ' chưa thành công (' + wf.code
            + '). Bạn muốn thử lại, sửa thông tin hay dừng? Các bước đã thành công được giữ nguyên.']

    async def create(self, plan, context):
        calls, conflict_for = _expand(plan)
        if len(calls) > 64:
            raise ValueError('Workflow step limit reached')
        steps = []
        for call in calls:
            tool = get_tool(call.tool_id)
            if tool is None or call.feature not in tool.pa_codes:
                raise ValueError('Unknown workflow tool')
            if tool.access == 'PROPOSAL':
                raise ValueError('Proposal-only tools cannot become executable workflow steps')
            errors = argument_errors(tool.input_model, call.arguments)
            if any(error.endswith(':extra_forbidden') for error in errors):
                raise ValueError('Unknown tool argument; workflow not stored')
            call.validation_errors = list(dict.fromkeys(call.validation_errors + errors))
            if call.arguments.get('linked_record_id'):
                raise ValueError('Dependency record IDs must come from workflow results')
            if call.tool_id in ('memory.create', 'memory.update') and (
                    call.operation_id, 'sensitive_data_checked') not in context.satisfied_preconditions:
                raise ValueError('Memory content requires trusted privacy review before retention')
            key = context.call_key(call)
            steps.append(WorkflowStep(call=call, conflict_for=conflict_for.get(call.operation_id),
                confirmed_key=key if key in context.confirmed_call_keys else None,
                idempotency_key=key if tool.access == 'WRITE' else None))
        wf = Workflow(id='wf_' + uuid4().hex, correlation_id=context.correlation_id,
            user_id=context.user_id, session_id=context.session_id, steps=steps,
            unsupported_operations=dict(plan.unsupported_operations), deferred_operations=dict(plan.deferred_operations),
            plan_fingerprint=_hash(plan.model_dump(mode='json')))
        self._refresh(wf, context)
        return await self.store.create(wf)

    async def confirm(self, workflow_id, context, *, revision, accept=True):
        snapshot = await self.store.get(workflow_id, context)
        if snapshot.memory_operations:
            return await self.confirm_memory(workflow_id, context, revision=revision, accept=accept)
        if type(accept) is not bool:
            raise ValueError('Explicit user confirmation required')
        async with self.store.edit(workflow_id, context) as wf:
            if wf.revision != revision or wf.state in ('COMPLETED', 'CANCELLED'):
                raise ValueError('Stale or terminal workflow confirmation')
            if not accept:
                wf.cancel_requested = True
                self._cancel(wf)
            else:
                for step in wf.steps:
                    if get_tool(step.call.tool_id).access == 'WRITE':
                        step.confirmed_key = context.call_key(step.call)
                self._refresh(wf, context)
        return await self.store.get(workflow_id, context)

    async def cancel(self, workflow_id, context):
        return await self.store.request_cancel(workflow_id, context)

    def _pause_conflict(self, wf, step):
        if not step.conflict_for:
            return False
        check = next(item for item in wf.steps if item.call.operation_id == step.conflict_for)
        if check.call.arguments != _interval(step.call):
            wf.state, wf.code = 'WAITING_FOR_INFORMATION', 'CONFLICT_CHECK_MISMATCH'
            wf.questions = ['Cần kiểm tra lại xung đột cho đúng khung giờ mới.']
            return True
        data = check.result.data
        if not data['has_conflict'] or (step.conflict_decision == 'keep_overlap' and step.decided_conflict_key == _hash(data)):
            return False
        wf.state, wf.code = 'WAITING_FOR_CONFIRMATION', 'CONFLICT_DECISION_REQUIRED'
        warning = ''
        if _interval(step.call).get('recurrence') and (data.get('overlap_ratio') or 0) > .30:
            warning = 'Trên 30% số buổi bị trùng; đề nghị đổi giờ và chọn cách xử lý riêng từng buổi. '
        wf.questions = [warning + 'Các xung đột: ' + json.dumps(data['conflicts'], ensure_ascii=False)
                        + '. Bạn muốn đổi giờ hay xác nhận giữ lịch trùng? Không ghi đè lịch cũ.']
        return True

    async def decide_conflict(self, workflow_id, context, *, operation_id, revision,
                              keep_overlap, occurrence_ids=()):
        if type(keep_overlap) is not bool:
            raise ValueError('Explicit conflict decision required')
        async with self.store.edit(workflow_id, context) as wf:
            if wf.revision != revision or wf.state in ('COMPLETED', 'CANCELLED'):
                raise ValueError('Stale conflict decision')
            step = next((item for item in wf.steps if item.call.operation_id == operation_id), None)
            if step is None:
                raise ValueError('Unknown conflict target')
            check = next((item for item in wf.steps if item.call.operation_id == step.conflict_for), None)
            if check is None or check.state != 'SUCCEEDED' or not check.result.data['has_conflict']:
                raise ValueError('No verified conflict to decide')
            data = check.result.data
            if keep_overlap:
                if _interval(step.call).get('recurrence'):
                    expected = {item.get('occurrence_id') for item in data['conflicts']}
                    if None in expected or set(occurrence_ids) != expected:
                        raise ValueError('A decision is required for every conflicting occurrence')
                step.conflict_decision = 'keep_overlap'
                step.decided_conflict_key = _hash(data)
                self._refresh(wf, context)
            else:
                step.conflict_decision, step.decided_conflict_key = None, None
                wf.state, wf.code = 'WAITING_FOR_INFORMATION', 'CONFLICT_TIME_CHANGE_REQUIRED'
                wf.questions = ['Bạn muốn đổi sang ngày/giờ nào?']
        return await self.store.get(workflow_id, context)

    async def run(self, workflow_id, context):
        snapshot = await self.store.get(workflow_id, context)
        if snapshot.memory_operations:
            return await self.run_memory(workflow_id, context)
        async with self.store.edit(workflow_id, context) as wf:
            if wf.state in ('COMPLETED', 'CANCELLED') or wf.code == 'CONFLICT_TIME_CHANGE_REQUIRED':
                return wf.model_copy(deep=True)
            self._refresh(wf, context)
            if wf.state in ('BLOCKED', 'FAILED', 'PARTIALLY_COMPLETED', 'WAITING_FOR_INFORMATION'):
                return wf.model_copy(deep=True)
            for step in wf.steps:
                if step.state == 'SUCCEEDED':
                    continue
                if wf.cancel_requested:
                    self._cancel(wf)
                    break
                ctx = self._context(wf, context)
                if any(dep not in ctx.completed_dependencies for dep in step.call.depends_on):
                    step.state, wf.state, wf.code = 'BLOCKED', 'BLOCKED', 'DEPENDENCY_NOT_SUCCEEDED'
                    break
                if self._pause_conflict(wf, step):
                    break
                tool = get_tool(step.call.tool_id)
                if step.outcome_uncertain and not self.boundary.can_retry_write(step.call.tool_id):
                    wf.state, wf.code = 'BLOCKED', 'RECONCILIATION_REQUIRED'
                    break
                if tool.confirmation_required and ctx.call_key(step.call) not in ctx.confirmed_call_keys:
                    wf.state, wf.code = 'WAITING_FOR_CONFIRMATION', 'CONFIRMATION_REQUIRED'
                    break
                call = step.call.model_copy(deep=True)
                parent = call.arguments.get('linked_operation_id')
                if parent:
                    if parent not in ctx.dependency_record_ids:
                        step.state, wf.state, wf.code = 'BLOCKED', 'BLOCKED', 'DEPENDENCY_RESULT_REQUIRED'
                        break
                    call.arguments['linked_record_id'] = ctx.dependency_record_ids[parent]
                if len(wf.model_dump_json()) > self.store.max_chars - 4096:
                    step.state = 'BLOCKED'
                    step.result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                                             status='UNAVAILABLE', code='WORKFLOW_RESULT_BUDGET')
                    self._stop(wf, step)
                    break
                step.state, wf.state, wf.code = 'RUNNING', 'RUNNING', None
                was_uncertain = step.outcome_uncertain
                step.attempts += 1
                await self.store._publish(wf)
                try:
                    result = await asyncio.wait_for(self.boundary.execute(call, ctx), self.step_timeout_seconds)
                except asyncio.CancelledError:
                    step.outcome_uncertain = tool.access == 'WRITE'
                    step.state = 'FAILED'
                    step.result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                        status='TIMEOUT', code='CANCELLED_OUTCOME_UNKNOWN',
                        outcome='UNKNOWN' if tool.access == 'WRITE' else 'NOT_EXECUTED',
                        reconciliation_state='PENDING_RECONCILIATION' if tool.access == 'WRITE' else 'NOT_REQUIRED')
                    step.execution_outcome = step.result.outcome
                    step.reconciliation_state = step.result.reconciliation_state
                    wf.reconciliation_state = step.result.reconciliation_state
                    self._stop(wf, step)
                    await asyncio.shield(self.store._publish(wf))
                    raise
                except TimeoutError:
                    result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                        status='TIMEOUT', code='STEP_TIMEOUT',
                        outcome='UNKNOWN' if tool.access == 'WRITE' else 'NOT_EXECUTED',
                        reconciliation_state='PENDING_RECONCILIATION' if tool.access == 'WRITE' else 'NOT_REQUIRED')
                except Exception:
                    result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                        status='UNAVAILABLE', code='EXECUTION_OUTCOME_UNKNOWN',
                        outcome='UNKNOWN' if tool.access == 'WRITE' else 'NOT_EXECUTED',
                        reconciliation_state='PENDING_RECONCILIATION' if tool.access == 'WRITE' else 'NOT_REQUIRED')
                if was_uncertain and result.outcome != 'CONFIRMED':
                    result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                        status=result.status, code=result.code, outcome='UNKNOWN',
                        reconciliation_state='PENDING_RECONCILIATION')
                if len(result.model_dump_json()) > 64000:
                    result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                                        status='UNAVAILABLE', code='RESULT_LIMIT_NARROW_REQUEST')
                step.result = result
                if tool.access == 'READ' and len(wf.model_dump_json()) > self.store.max_chars - 4096:
                    step.result = result = ToolResult(operation_id=call.operation_id, tool_id=call.tool_id,
                        status='UNAVAILABLE', code='WORKFLOW_RESULT_BUDGET')
                step.execution_outcome = result.outcome
                step.reconciliation_state = result.reconciliation_state
                step.outcome_uncertain = result.outcome == 'UNKNOWN'
                wf.reconciliation_state = ('PENDING_RECONCILIATION' if any(s.outcome_uncertain for s in wf.steps)
                                           else 'NOT_REQUIRED')
                if result.status == 'SUCCESS' and result.executed:
                    step.state = 'SUCCEEDED'
                else:
                    step.state = 'BLOCKED' if result.status == 'UNAVAILABLE' else 'FAILED'
                    self._stop(wf, step)
                await self.store._publish(wf)
                if wf.cancel_requested:
                    self._cancel(wf)
                    break
                if step.state != 'SUCCEEDED':
                    break
            if not wf.cancel_requested and all(step.state == 'SUCCEEDED' for step in wf.steps):
                wf.state, wf.code, wf.questions = 'COMPLETED', None, []
        return await self.store.get(workflow_id, context)

    async def revise(self, workflow_id, context, *, revision, arguments_by_operation):
        if not arguments_by_operation:
            raise ValueError('An explicit revision is required')
        async with self.store.edit(workflow_id, context) as wf:
            if wf.revision != revision or wf.state in ('COMPLETED', 'CANCELLED'):
                raise ValueError('Stale or terminal workflow revision')
            by_id = {step.call.operation_id: step for step in wf.steps}
            if any(key not in by_id for key in arguments_by_operation):
                raise ValueError('Unknown workflow step')
            checks = [step.conflict_for for step in wf.steps if step.conflict_for]
            if any(key in checks for key in arguments_by_operation):
                raise ValueError('Revise the event, not its managed prerequisite check')
            if any(by_id[key].conflict_for and checks.count(by_id[key].conflict_for) > 1
                   for key in arguments_by_operation):
                raise ValueError('Shared conflict checks require an explicitly rebuilt plan')
            affected = set(arguments_by_operation)
            affected.update(step.conflict_for for step in wf.steps
                            if step.call.operation_id in affected and step.conflict_for)
            for step in wf.steps:
                if any(dep in affected for dep in step.call.depends_on):
                    affected.add(step.call.operation_id)
            if any(step.outcome_uncertain or (step.state == 'SUCCEEDED' and get_tool(step.call.tool_id).access == 'WRITE')
                   for step in wf.steps if step.call.operation_id in affected):
                raise ValueError('Cannot revise an executed or uncertain write; reconcile first')
            for operation_id, args in arguments_by_operation.items():
                if args.get('linked_record_id'):
                    raise ValueError('Cannot provide a dependency record ID')
                step = by_id[operation_id]
                errors = argument_errors(get_tool(step.call.tool_id).input_model, args)
                if any(error.endswith(':extra_forbidden') for error in errors):
                    raise ValueError('Unknown tool argument')
                step.call.arguments = json.loads(json.dumps(args))
                if step.conflict_for:
                    by_id[step.conflict_for].call.arguments = _interval(step.call)
            for operation_id in affected:
                step = by_id[operation_id]
                step.state, step.result, step.confirmed_key = 'PENDING', None, None
                step.conflict_decision, step.decided_conflict_key = None, None
                step.call.validation_errors = argument_errors(get_tool(step.call.tool_id).input_model, step.call.arguments)
                step.idempotency_key = context.call_key(step.call) if get_tool(step.call.tool_id).access == 'WRITE' else None
            wf.revision += 1
            self._refresh(wf, context)
            if len(wf.model_dump_json()) + len(wf.steps) * 2048 > self.store.max_chars:
                raise ValueError('Workflow revision exceeds state budget')
        return await self.store.get(workflow_id, context)

    async def retry(self, workflow_id, context):
        snapshot = await self.store.get(workflow_id, context)
        if snapshot.memory_operations:
            return await self.retry_memory(workflow_id, context)
        async with self.store.edit(workflow_id, context) as wf:
            if wf.state in ('COMPLETED', 'CANCELLED'):
                raise ValueError('Terminal workflow cannot be retried')
            for step in wf.steps:
                if step.outcome_uncertain:
                    if not self.boundary.can_retry_write(step.call.tool_id):
                        wf.code = 'RECONCILIATION_REQUIRED'
                        wf.questions = ['Kết quả thao tác ghi chưa rõ; cần đối soát Backend trước khi thử lại.']
                        return wf.model_copy(deep=True)
            for step in wf.steps:
                if step.state in ('FAILED', 'BLOCKED'):
                    step.state, step.result = 'PENDING', None
            self._refresh(wf, context)
        return await self.store.get(workflow_id, context)
