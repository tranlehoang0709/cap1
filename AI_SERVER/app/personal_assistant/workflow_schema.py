"""RAM workflow snapshots; owner identities are not serialized to LLM output."""
from typing import Literal

from pydantic import Field

from app.personal_assistant.schema import StrictModel
from app.personal_assistant.tool_boundary import ToolCall, ToolResult
from app.personal_assistant.execution_contracts import ExecutionOutcome, ReconciliationState
from app.personal_assistant.memory_workflow import MemoryOperation

WorkflowState = Literal['PLANNED', 'WAITING_FOR_INFORMATION', 'WAITING_FOR_CONFIRMATION',
    'READY', 'RUNNING', 'PARTIALLY_COMPLETED', 'COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED']
StepState = Literal['PENDING', 'READY', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'BLOCKED']


class WorkflowStep(StrictModel):
    call: ToolCall
    state: StepState = 'PENDING'
    confirmed_key: str | None = None
    idempotency_key: str | None = None
    result: ToolResult | None = None
    attempts: int = 0
    outcome_uncertain: bool = False
    retry_authorized: bool = False
    execution_outcome: ExecutionOutcome = 'NOT_EXECUTED'
    reconciliation_state: ReconciliationState = 'NOT_REQUIRED'
    conflict_for: str | None = None
    conflict_decision: Literal['keep_overlap'] | None = None
    decided_conflict_key: str | None = None


class Workflow(StrictModel):
    id: str
    correlation_id: str
    user_id: str = Field(exclude=True, repr=False)
    session_id: str = Field(exclude=True, repr=False)
    state: WorkflowState = 'PLANNED'
    revision: int = 1
    steps: list[WorkflowStep] = Field(max_length=64)
    unsupported_operations: dict[str, str] = Field(default_factory=dict)
    deferred_operations: dict[str, str] = Field(default_factory=dict)
    questions: list[str] = Field(default_factory=list)
    code: str | None = None
    cancel_requested: bool = False
    reconciliation_state: ReconciliationState = 'NOT_REQUIRED'
    plan_fingerprint: str
    dialogue_integration: Literal['BLOCKED_H02', 'READY'] = 'BLOCKED_H02'
    memory_operations: list[MemoryOperation] = Field(default_factory=list, max_length=20)


def mark_cancelled(workflow):
    workflow.cancel_requested = True
    for step in workflow.steps:
        if step.state in ('PENDING', 'READY', 'BLOCKED') and not step.outcome_uncertain:
            step.state = 'SKIPPED'
    workflow.state, workflow.code = 'CANCELLED', 'USER_CANCELLED'
    workflow.questions = (['Đã dừng các bước chưa chạy. Kết quả thao tác ghi chưa rõ cần đối soát Backend.']
        if any(step.outcome_uncertain for step in workflow.steps) else
        ['Đã dừng các bước còn lại; giữ nguyên kết quả đã được Backend xác nhận.'])


def topological(calls):
    by_id = {call.operation_id: call for call in calls}
    if len(by_id) != len(calls):
        raise ValueError('Duplicate workflow operation ID')
    for call in calls:
        if len(set(call.depends_on)) != len(call.depends_on) or any(dep not in by_id for dep in call.depends_on):
            raise ValueError('Unknown or duplicate dependency')
    ordered, visiting, visited = [], set(), set()

    def visit(operation_id):
        if operation_id in visiting:
            raise ValueError('Cyclic workflow dependency')
        if operation_id in visited:
            return
        visiting.add(operation_id)
        for dep in by_id[operation_id].depends_on:
            visit(dep)
        visiting.remove(operation_id)
        visited.add(operation_id)
        ordered.append(by_id[operation_id])

    for call in calls:
        visit(call.operation_id)
    return ordered
