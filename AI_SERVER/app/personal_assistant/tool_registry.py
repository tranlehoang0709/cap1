"""Allowlisted proposed contracts; no PA HTTP bindings exist yet."""
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from pydantic import BaseModel

from app.personal_assistant import tool_contracts as c
from app.personal_assistant.schema import Feature
from app.personal_assistant.execution_contracts import AvailabilityStatus
from app.personal_assistant.memory_contracts import MemoryQueryArgs, MemoryQueryOutput


@dataclass(frozen=True)
class ToolSpec:
    tool_id: str
    pa_codes: tuple[Feature, ...]
    action: str
    purpose: str
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    access: Literal['READ', 'WRITE', 'PROPOSAL']
    preconditions: tuple[str, ...] = ()
    validation_rules: tuple[str, ...] = ()
    status: AvailabilityStatus = 'NOT_IMPLEMENTED'

    @property
    def confirmation_required(self):
        return self.access != 'READ'

    def contract(self):
        value = dict(tool_id=self.tool_id, pa_codes=list(self.pa_codes), action=self.action,
                    purpose=self.purpose, access=self.access, status=self.status,
                    confirmation_required=self.confirmation_required,
                    preconditions=list(self.preconditions),
                    validation_rules=list(self.validation_rules),
                    required_fields=[name for name, field in self.input_model.model_fields.items()
                                     if field.is_required()],
                    input_schema=self.input_model.model_json_schema(),
                    output_schema=self.output_model.model_json_schema())
        if self.tool_id.startswith('memory.'):
            value['security_context'] = dict(ownership='authenticated_user_session_correlation',
                consent='trusted_memory_authorizations_and_backend_record_consent',
                confirmation='exact_call_key_and_proposal_revision',
                revision='verified_record_or_topic_snapshot_for_update_delete',
                idempotency='stable_context_call_key_for_writes_reused_on_retry',
                backend_requirements=dict(authenticated_ack=True, idempotency_verified=self.access == 'WRITE',
                    revision_verified=self.tool_id in ('memory.update', 'memory.delete')),
                backend_required=self.access != 'PROPOSAL',
                execution_allowed=self.access != 'PROPOSAL')
        return value


_RULES = {
    c.EventCreateArgs: ('Ngày/giờ bắt đầu và giờ kết thúc hoặc thời lượng là bắt buộc.',),
    c.ConflictCheckArgs: ('Cần khoảng thời gian; chỉ Backend trả dữ liệu xung đột thật.',),
    c.ReminderCreateArgs: ('Nội dung + thời điểm, hoặc tham chiếu thao tác + offset.',
                         'Tham chiếu thao tác chưa phải ID bản ghi; cần kết quả tạo thành công.'),
    c.PlanCreateArgs: ('Ngày kết thúc không trước ngày bắt đầu; chỉ học tập/cá nhân.',),
    c.TaskCreateArgs: ('Mọi công việc mới bắt buộc có deadline.',),
    c.UpdateArgs: ('Ít nhất một thay đổi tường minh; không áp dụng default như thay đổi.',),
    c.ReminderUpdateArgs: ('Ít nhất một thay đổi tường minh.',),
    c.TaskUpdateArgs: ('Ít nhất một thay đổi tường minh; Backend quyết định trạng thái hợp lệ.',),
    c.PlanUpdateArgs: ('Ít nhất một thay đổi; đổi ngày kết thúc giữ nguyên lịch hiện tại.',
                       'Chỉ phân bổ lại sau yêu cầu và xác nhận riêng.'),
    c.ProgressArgs: ('Mỗi buổi chỉ completed/not_completed; không nhận phần trăm thủ công.',),
}
_SUBJECTS = {'event': 'lịch cá nhân', 'reminder': 'nhắc nhở', 'memory': 'trí nhớ đã được đồng ý lưu',
             'plan': 'kế hoạch cá nhân/học tập', 'task': 'công việc', 'schedule': 'lịch trình',
             'report': 'báo cáo từ dữ liệu thật', 'deadline': 'cảnh báo thời hạn'}
_VERBS = {'create': 'Đề nghị tạo', 'query': 'Truy vấn', 'update': 'Đề nghị cập nhật',
          'cancel': 'Đề nghị hủy', 'delete': 'Đề nghị xóa', 'acknowledge': 'Xác nhận đã nhận',
          'check_conflict': 'Kiểm tra chồng lấn', 'configure': 'Đề nghị cấu hình',
          'set_status': 'Đề nghị đổi trạng thái', 'update_priority': 'Đề nghị đổi mức ưu tiên',
          'update_progress': 'Đề nghị cập nhật kết quả buổi', 'unfinished_query': 'Truy vấn mục chưa hoàn thành của',
          'progress_query': 'Truy vấn tiến độ của', 'priority_query': 'Truy vấn mức ưu tiên của',
          'generate': 'Tổng hợp'}


def _spec(tool_id, pa, model, *, read=False, output=None, prerequisites=()):
    subject, action = tool_id.split('.', 1)
    return ToolSpec(tool_id, (pa,) if isinstance(pa, str) else pa,
                    action, _VERBS[action] + ' ' + _SUBJECTS[subject], model,
                    output or (c.QueryOutput if read else c.RecordOutput),
                    'READ' if read else 'WRITE', prerequisites, _RULES.get(model, ()))


_specs = [
    ToolSpec('memory.propose', ('PA-04',), 'propose', 'Đề xuất ghi nhớ, chờ đồng ý; không thực thi',
             c.MemoryProposalArgs, c.MemoryProposalOutput, 'PROPOSAL'),
    _spec('event.create', 'PA-01', c.EventCreateArgs,
          prerequisites=('conflict_checked', 'conflict_decision_if_needed', 'never_overwrite')),
    _spec('event.query', 'PA-01', c.QueryArgs, read=True),
    _spec('event.update', 'PA-01', c.UpdateArgs,
          prerequisites=('target_resolved', 'conflict_checked', 'conflict_decision_if_needed', 'never_overwrite')),
    _spec('event.cancel', 'PA-01', c.TargetArgs, prerequisites=('target_resolved',)),
    _spec('event.delete', 'PA-01', c.TargetArgs, prerequisites=('target_resolved',)),
    _spec('event.check_conflict', 'PA-14', c.ConflictCheckArgs, read=True, output=c.ConflictOutput),
    _spec('reminder.create', 'PA-02', c.ReminderCreateArgs),
    _spec('reminder.query', 'PA-02', c.QueryArgs, read=True),
    _spec('reminder.update', 'PA-02', c.ReminderUpdateArgs, prerequisites=('target_resolved',)),
    _spec('reminder.cancel', 'PA-02', c.TargetArgs, prerequisites=('target_resolved',)),
    _spec('reminder.delete', 'PA-02', c.TargetArgs, prerequisites=('target_resolved',)),
    _spec('reminder.acknowledge', 'PA-02', c.TargetArgs, prerequisites=('target_resolved',)),
    _spec('memory.create', 'PA-04', c.MemoryCreateArgs,
          output=c.MemoryMutationOutput,
          prerequisites=('sensitive_data_checked', 'memory_consent', 'content_read_back')),
    _spec('memory.query', 'PA-04', MemoryQueryArgs, read=True, output=MemoryQueryOutput),
    _spec('memory.update', 'PA-04', c.MemoryUpdateArgs,
          output=c.MemoryMutationOutput,
          prerequisites=('target_resolved', 'sensitive_data_checked', 'memory_consent', 'content_read_back')),
    _spec('memory.delete', 'PA-04', c.MemoryDeleteArgs, output=c.MemoryMutationOutput,
          prerequisites=('target_resolved', 'content_read_back')),
    _spec('plan.create', 'PA-06', c.PlanCreateArgs,
          prerequisites=('conflict_checked', 'conflict_decision_if_needed', 'content_read_back')),
    _spec('plan.query', 'PA-06', c.QueryArgs, read=True),
    _spec('plan.update', 'PA-06', c.PlanUpdateArgs, prerequisites=('target_resolved', 'preserve_existing_schedule')),
    _spec('plan.cancel', 'PA-06', c.TargetArgs, prerequisites=('target_resolved', 'cascade_cancellation_confirmed')),
    _spec('task.create', 'PA-10', c.TaskCreateArgs),
    _spec('task.query', 'PA-10', c.QueryArgs, read=True),
    _spec('task.update', 'PA-10', c.TaskUpdateArgs, prerequisites=('target_resolved',)),
    _spec('task.cancel', ('PA-10', 'PA-15'), c.TargetArgs, prerequisites=('target_resolved',)),
    _spec('task.delete', 'PA-10', c.TargetArgs, prerequisites=('target_resolved',)),
    _spec('task.set_status', ('PA-10', 'PA-15'), c.StatusArgs,
          prerequisites=('target_resolved', 'explicit_user_status')),
    _spec('task.update_priority', 'PA-11', c.PriorityArgs, prerequisites=('target_resolved',)),
    _spec('task.priority_query', 'PA-11', c.QueryArgs, read=True),
    _spec('task.update_progress', 'PA-12', c.ProgressArgs,
          prerequisites=('target_resolved', 'explicit_user_status', 'derive_plan_progress_in_backend')),
    _spec('task.progress_query', 'PA-12', c.QueryArgs, read=True),
    _spec('task.unfinished_query', 'PA-15', c.QueryArgs, read=True),
    _spec('schedule.query', 'PA-08', c.QueryArgs, read=True),
    _spec('report.generate', 'PA-18', c.QueryArgs, read=True, output=c.ReportOutput),
    _spec('deadline.query', 'PA-22', c.QueryArgs, read=True),
    _spec('deadline.acknowledge', 'PA-22', c.TargetArgs, prerequisites=('target_resolved',)),
    _spec('deadline.configure', 'PA-22', c.DeadlineConfigureArgs, prerequisites=('target_resolved',)),
]
TOOLS = MappingProxyType({spec.tool_id: spec for spec in _specs})
CAPABILITIES = MappingProxyType({
    'PA-05': ('DISABLED', 'Read-only AI_SERVER personalization; not a Backend tool; PA-04 integration unavailable'),
    'PA-09': ('DISABLED', 'AI_SERVER understanding capability, not a Backend tool'),
    'PA-23': ('DISABLED', 'AI_SERVER workflow capability, not a Backend tool; Backend APIs unavailable'),
})


def get_tool(tool_id):
    return TOOLS.get(tool_id)
