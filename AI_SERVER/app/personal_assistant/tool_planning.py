"""Allowlisted proposals with trusted dialogue readiness supplied by the caller."""
from typing import Literal

from pydantic import Field

from app.personal_assistant.schema import Analysis, StrictModel
from app.personal_assistant.tool_boundary import ToolCall, TrustedToolContext, argument_errors
from app.personal_assistant.tool_registry import get_tool


class ToolPlan(StrictModel):
    integration_status: Literal['BLOCKED_H02', 'READY'] = 'BLOCKED_H02'
    calls: list[ToolCall] = Field(default_factory=list, max_length=20)
    proposals: list[ToolCall] = Field(default_factory=list, max_length=20)
    unsupported_operations: dict[str, str] = Field(default_factory=dict, max_length=20)
    deferred_operations: dict[str, str] = Field(default_factory=dict, max_length=20)


_MAPPING = {
    ('PA-01', 'create'): 'event.create', ('PA-01', 'query'): 'event.query',
    ('PA-01', 'update'): 'event.update', ('PA-01', 'cancel'): 'event.cancel',
    ('PA-01', 'delete'): 'event.delete',
    ('PA-14', 'query'): 'event.check_conflict', ('PA-14', 'propose'): 'event.check_conflict',
    ('PA-02', 'create'): 'reminder.create', ('PA-02', 'query'): 'reminder.query',
    ('PA-02', 'update'): 'reminder.update', ('PA-02', 'cancel'): 'reminder.cancel',
    ('PA-02', 'delete'): 'reminder.delete', ('PA-02', 'confirm'): 'reminder.acknowledge',
    ('PA-04', 'create'): 'memory.create', ('PA-04', 'propose'): 'memory.propose',
    ('PA-04', 'confirm'): 'memory.create',
    ('PA-04', 'query'): 'memory.query', ('PA-04', 'update'): 'memory.update',
    ('PA-04', 'delete'): 'memory.delete',
    ('PA-06', 'create'): 'plan.create', ('PA-06', 'query'): 'plan.query',
    ('PA-06', 'update'): 'plan.update', ('PA-06', 'cancel'): 'plan.cancel',
    ('PA-10', 'create'): 'task.create', ('PA-10', 'query'): 'task.query',
    ('PA-10', 'update'): 'task.update', ('PA-10', 'cancel'): 'task.cancel',
    ('PA-10', 'delete'): 'task.delete', ('PA-10', 'set_status'): 'task.set_status',
    ('PA-11', 'update'): 'task.update_priority', ('PA-11', 'propose'): 'task.update_priority',
    ('PA-11', 'query'): 'task.priority_query',
    ('PA-12', 'set_status'): 'task.update_progress', ('PA-12', 'update'): 'task.update_progress',
    ('PA-12', 'query'): 'task.progress_query',
    ('PA-15', 'query'): 'task.unfinished_query', ('PA-15', 'set_status'): 'task.set_status',
    ('PA-15', 'cancel'): 'task.cancel',
    ('PA-08', 'query'): 'schedule.query',
    ('PA-18', 'query'): 'report.generate', ('PA-18', 'create'): 'report.generate',
    ('PA-22', 'query'): 'deadline.query', ('PA-22', 'confirm'): 'deadline.acknowledge',
    ('PA-22', 'create'): 'deadline.configure', ('PA-22', 'update'): 'deadline.configure',
    ('PA-22', 'propose'): 'deadline.configure',
}


def plan_tools(analysis: Analysis, context: TrustedToolContext):
    plan = ToolPlan(integration_status='READY' if context.dialogue_ready else 'BLOCKED_H02')
    for op in analysis.operations:
        if op.feature == 'PA-04' and op.action == 'cancel':
            plan.deferred_operations[op.id] = 'MEMORY_STORAGE_DECLINED'
            continue
        if op.feature == 'PA-04' and op.memory and op.memory.requires_clarification:
            plan.deferred_operations[op.id] = 'MEMORY_CLARIFICATION_REQUIRED'
            continue
        if op.feature == 'PA-04' and op.action == 'confirm' and (
                op.id not in context.memory_authorizations or
                not context.memory_authorizations[op.id].consent_to_store or
                not context.memory_authorizations[op.id].confirmed_call_key or
                (context.memory_authorizations[op.id].owner_user_id,
                 context.memory_authorizations[op.id].session_id,
                 context.memory_authorizations[op.id].correlation_id) !=
                (context.user_id, context.session_id, context.correlation_id)):
            plan.deferred_operations[op.id] = 'MEMORY_CONFIRMATION_CONTEXT_REQUIRED'
            continue
        tool_id = _MAPPING.get((op.feature, op.action))
        if tool_id is None or op.state == 'unsupported':
            plan.unsupported_operations[op.id] = 'UNSUPPORTED_FEATURE_OR_ACTION'
            continue
        tool = get_tool(tool_id)
        e = op.entities.model_dump(exclude_none=True, exclude_defaults=True)
        args = {}
        for name in tool.input_model.model_fields:
            if name in e:
                args[name] = e[name]
        if 'timezone' in tool.input_model.model_fields:
            args['timezone'] = analysis.timezone
        if 'query' in tool.input_model.model_fields:
            args['query'] = op.entities.target_query or op.source_text
        if 'target_id' in tool.input_model.model_fields and op.id in context.resolved_targets:
            args['target_id'] = context.resolved_targets[op.id]
        if tool_id in ('memory.create', 'memory.update', 'memory.delete'):
            grant = context.memory_authorizations.get(op.id)
            if grant is not None and (grant.owner_user_id, grant.session_id, grant.correlation_id) == (
                    context.user_id, context.session_id, context.correlation_id):
                args['proposal_revision'] = grant.proposal_revision
                if tool_id != 'memory.create' and grant.target is not None:
                    args.update(grant.target.model_dump(exclude_none=True))
                if tool_id == 'memory.update' and grant.update_mode is not None:
                    args['update_mode'] = grant.update_mode
        if 'changes' in tool.input_model.model_fields:
            change_model = tool.input_model.model_fields['changes'].annotation
            args['changes'] = {name: value for name, value in e.items() if name in change_model.model_fields}
        if tool_id == 'reminder.create':
            if not op.entities.content and op.entities.title:
                args['content'] = op.entities.title
            if op.entities.start:
                args['at'] = op.entities.start.model_dump(exclude_none=True)
            if op.entities.reminder_offset_minutes is not None:
                args['offset_minutes'] = op.entities.reminder_offset_minutes
            if len(op.depends_on) == 1:
                args['linked_operation_id'] = op.depends_on[0]
        if tool_id == 'plan.create':
            if op.entities.category:
                categories = {'study': 'study', 'học tập': 'study', 'personal': 'personal', 'cá nhân': 'personal'}
                args['category'] = categories.get(op.entities.category.lower(), op.entities.category)
            if op.entities.start and op.entities.start.date:
                args['start_date'] = op.entities.start.date
            if op.entities.end and op.entities.end.date:
                args['end_date'] = op.entities.end.date
        if tool_id == 'task.update_progress' and op.entities.status:
            args['result'] = op.entities.status
        errors = argument_errors(tool.input_model, args)
        errors.extend('dependency_unavailable:' + dep for dep in op.depends_on if dep in plan.unsupported_operations)
        call = ToolCall(operation_id=op.id, tool_id=tool_id, feature=op.feature,
            arguments=args, depends_on=op.depends_on.copy(), target_query=op.entities.target_query,
            validation_errors=errors)
        if tool.access == 'PROPOSAL':
            grant = context.memory_authorizations.get(op.id)
            if grant is not None and (grant.owner_user_id, grant.session_id, grant.correlation_id) == (
                    context.user_id, context.session_id, context.correlation_id):
                call.arguments['proposal_revision'] = grant.proposal_revision
                candidate = call.model_copy(deep=True)
                candidate.tool_id = 'memory.create'
                candidate.validation_errors = argument_errors(get_tool(candidate.tool_id).input_model, candidate.arguments)
                candidate.validation_errors.extend(e for e in call.validation_errors if e.startswith('dependency_unavailable:'))
                key = context.call_key(candidate)
                if (grant.consent_to_store and not candidate.validation_errors and
                        grant.confirmed_call_key == key and key in context.confirmed_call_keys):
                    plan.calls.append(candidate)
                    continue
            plan.proposals.append(call)
            plan.deferred_operations[op.id] = 'MEMORY_CONSENT_REQUIRED'
        else:
            if op.feature == 'PA-04' and op.action == 'confirm':
                key = context.call_key(call)
                if (context.memory_authorizations[op.id].confirmed_call_key != key or
                        key not in context.confirmed_call_keys):
                    plan.deferred_operations[op.id] = 'MEMORY_CONFIRMATION_CONTEXT_REQUIRED'
                    continue
            plan.calls.append(call)
    return plan
