'use client';

import { useRef, useState } from 'react';
import {
  Bell,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CornerDownRight,
  Eye,
  Filter,
  Flag,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/client';
import { PlanDraftEditor, ScheduleSummary } from './PersonalAssistantPlanning';
import type { PlanStep } from '@/lib/personal-planning';
import { date, display } from '@/lib/utils';
import {
  buildPriorityUpdatePayload,
  computeTaskProgressSummary,
  DEFAULT_TASK_PRIORITIES,
  extractAvailablePriorities,
  extractTaskDetailRecord,
  formatPlanProgressSummary,
  getDisplayTaskProgress,
  isPriorityConflictOrInvalidError,
  isTaskCancelled,
  isTaskCompleted,
  normalizeDueAtInput,
  organizeTasksForDisplay,
  parsePersonalEvents,
  parsePersonalMemories,
  parsePersonalPlans,
  parsePersonalReminders,
  parsePersonalTasks,
  parseTaskListMeta,
  validatePersonalAssistantBody,
  type PersonalEvent,
  type PersonalMemory,
  type PersonalPlanProgress,
  type PersonalReminder,
  type PersonalTask,
} from '@/lib/personal-assistant';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  Notice,
  Pagination,
  Panel,
  ResourceState,
  Status,
  StructuredDataView,
  useResource,
} from '@/components/data-ui';

export type ResourceLike = {
  data?: unknown;
  error?: string;
  loading: boolean;
  reload: () => void;
};

export type TaskFilterState = {
  search: string;
  status: string;
  priority: string;
  sort_by?: string;
  plan_id: string;
};

function toDateTimeLocalValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PersonalAssistantWorkspace() {
  const [appliedFilters, setAppliedFilters] = useState<Record<string, string>>({
    page: '1',
    limit: '20',
  });
  const tasksState = useResource('personalTasks', appliedFilters);
  const plansState = useResource('personalPlans', { page: '1', limit: '20' });
  const eventsState = useResource('personalEvents', { page: '1', limit: '50' });

  return (
    <>
      <PersonalAssistantWorkspaceView
        tasksState={tasksState}
        plansState={plansState}
        eventsState={eventsState}
        onApplyFilters={(filters) => {
          const next: Record<string, string> = { page: '1', limit: '20' };
          if (filters.search.trim()) next.search = filters.search.trim();
          if (filters.status.trim()) next.status = filters.status.trim();
          if (filters.priority.trim()) next.priority = filters.priority.trim();
          if (filters.sort_by?.trim() && filters.sort_by.trim() !== 'default') {
            next.sort_by = filters.sort_by.trim();
          }
          if (filters.plan_id.trim()) next.plan_id = filters.plan_id.trim();
          setAppliedFilters(next);
        }}
        onChangePage={(nextPage) => {
          setAppliedFilters((prev) => ({
            ...prev,
            page: String(Math.max(1, nextPage)),
          }));
        }}
      />
      <ScheduleSummary />
      <PersonalAssistantExtensions />
    </>
  );
}

export function PersonalAssistantWorkspaceView({
  tasksState,
  plansState,
  eventsState,
  onApplyFilters,
  onChangePage,
}: {
  tasksState: ResourceLike;
  plansState: ResourceLike;
  eventsState?: ResourceLike;
  onApplyFilters?: (filters: TaskFilterState) => void;
  onChangePage?: (page: number) => void;
}) {
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [sortFilter, setSortFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');

  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create / Edit modal state
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingTask, setEditingTask] = useState<PersonalTask | null>(null);
  const [titleInput, setTitleInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  const [dueAtInput, setDueAtInput] = useState('');
  const [priorityInput, setPriorityInput] = useState('');
  const [planIdInput, setPlanIdInput] = useState('');
  const [eventIdInput, setEventIdInput] = useState('');
  const [parentTaskIdInput, setParentTaskIdInput] = useState('');
  const [sessionNumberInput, setSessionNumberInput] = useState('');
  const [statusInput, setStatusInput] = useState<'pending' | 'in_progress' | 'partial'>('pending');
  const [progressInput, setProgressInput] = useState(0);
  const [formError, setFormError] = useState('');
  const [formBusy, setFormBusy] = useState(false);

  // Priority modal state (PA-11)
  const [priorityTask, setPriorityTask] = useState<PersonalTask | null>(null);
  const [nextPriorityValue, setNextPriorityValue] = useState('');
  const [priorityError, setPriorityError] = useState('');
  const [priorityBusy, setPriorityBusy] = useState(false);

  // Cancel / Delete modal state (PA-10)
  const [cancelTask, setCancelTask] = useState<PersonalTask | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteTask, setDeleteTask] = useState<PersonalTask | null>(null);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');

  // Task detail drawer/dialog state (PA-10)
  const [selectedTask, setSelectedTask] = useState<PersonalTask | null>(null);
  const [detailData, setDetailData] = useState<unknown>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  // Create Plan modal state (PA-12)
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [planDraftBusy, setPlanDraftBusy] = useState(false);
  const [planTitleInput, setPlanTitleInput] = useState('');
  const [planGoalInput, setPlanGoalInput] = useState('');
  const [planDescInput, setPlanDescInput] = useState('');
  const [planTotalSessionsInput, setPlanTotalSessionsInput] = useState('10');
  const [planStartDateInput, setPlanStartDateInput] = useState('');
  const [planEndDateInput, setPlanEndDateInput] = useState('');
  const [planFormError, setPlanFormError] = useState('');
  const [planFormBusy, setPlanFormBusy] = useState(false);
  const planSaving = useRef(false);
  const [confirmedPlanRevision, setConfirmedPlanRevision] = useState('');
  const planRevision = JSON.stringify([
    planTitleInput, planGoalInput, planDescInput, planTotalSessionsInput,
    planStartDateInput, planEndDateInput, planSteps,
  ]);
  const planConfirmed = confirmedPlanRevision === planRevision;


  let tasks: PersonalTask[] = [];
  let tasksParseError = '';
  if (!tasksState.loading && !tasksState.error && tasksState.data !== undefined) {
    try {
      tasks = parsePersonalTasks(tasksState.data);
    } catch (e) {
      tasksParseError = (e as Error).message;
    }
  }

  let plans: PersonalPlanProgress[] = [];
  let plansParseError = '';
  if (!plansState.loading && !plansState.error && plansState.data !== undefined) {
    try {
      plans = parsePersonalPlans(plansState.data);
    } catch (e) {
      plansParseError = (e as Error).message;
    }
  }

  let events: PersonalEvent[] = [];
  if (eventsState && !eventsState.loading && !eventsState.error && eventsState.data !== undefined) {
    try {
      events = parsePersonalEvents(eventsState.data);
    } catch {
      events = [];
    }
  }

  const availablePriorities = extractAvailablePriorities(tasksState.data, tasks);
  const priorityOptions = availablePriorities.length > 0 ? availablePriorities : [...DEFAULT_TASK_PRIORITIES];
  const taskSummary = computeTaskProgressSummary(tasksState.data, tasks);
  const taskMeta = parseTaskListMeta(tasksState.data, tasks.length);
  const hierarchicalTasks = organizeTasksForDisplay(tasks);

  const blockedParentIds = new Set<string>();
  if (editingTask) {
    blockedParentIds.add(editingTask.id);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const candidate of tasks) {
        if (
          candidate.parent_task_id &&
          blockedParentIds.has(candidate.parent_task_id) &&
          !blockedParentIds.has(candidate.id)
        ) {
          blockedParentIds.add(candidate.id);
          expanded = true;
        }
      }
    }
  }
  const eligibleParentTasks = tasks.filter((t) => !blockedParentIds.has(t.id));

  function reloadAll() {
    tasksState.reload();
    plansState.reload();
  }

  function openCreateDialog(presetParentTaskId = '') {
    setFormMode('create');
    setEditingTask(null);
    setTitleInput('');
    setDescriptionInput('');
    setDueAtInput('');
    setPriorityInput('');
    setPlanIdInput(planFilter || '');
    setEventIdInput('');
    setParentTaskIdInput(presetParentTaskId);
    setSessionNumberInput('');
    setStatusInput('pending');
    setProgressInput(0);
    setFormError('');
  }

  function openEditDialog(task: PersonalTask) {
    const editableStatus =
      task.status === 'in_progress' || task.status === 'partial' ? task.status : 'pending';
    setStatusInput(editableStatus);
    setProgressInput(task.progress_percent);
    setFormMode('edit');
    setEditingTask(task);
    setTitleInput(task.title);
    setDescriptionInput(task.description ?? '');
    setDueAtInput(toDateTimeLocalValue(task.due_at));
    setPriorityInput(task.priority ?? '');
    setPlanIdInput(task.plan_id ?? '');
    setEventIdInput(task.event_id ?? '');
    setParentTaskIdInput(task.parent_task_id ?? '');
    setSessionNumberInput(task.session_number !== null ? String(task.session_number) : '');
    setFormError('');
  }

  function openPriorityDialog(task: PersonalTask) {
    setPriorityTask(task);
    setNextPriorityValue(task.priority ?? '');
    setPriorityError('');
  }

  async function inspectTaskDetail(task: PersonalTask) {
    setSelectedTask(task);
    setDetailData(task.raw);
    setDetailError('');
    setDetailLoading(true);
    try {
      const response = await api('personalTaskDetail', { params: { id: task.id } });
      setDetailData(response);
      const parsed = extractTaskDetailRecord(response);
      if (parsed) setSelectedTask(parsed);
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSaveTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setActionError('');
    setActionSuccess('');

    try {
      const dueIso = normalizeDueAtInput(dueAtInput);
      const sessionNum = sessionNumberInput.trim() ? Number(sessionNumberInput.trim()) : undefined;
      if (sessionNum !== undefined && (!Number.isInteger(sessionNum) || sessionNum < 1)) {
        throw new Error('Số thứ tự buổi trong kế hoạch phải là số nguyên dương.');
      }

      if (formMode === 'create') {
        const rawPayload: Record<string, unknown> = {
          title: titleInput,
        };
        if (descriptionInput.trim()) rawPayload.description = descriptionInput.trim();
        if (dueIso) rawPayload.due_at = dueIso;
        if (priorityInput.trim()) rawPayload.priority = priorityInput.trim();
        if (planIdInput.trim()) rawPayload.plan_id = planIdInput.trim();
        if (eventIdInput.trim()) rawPayload.event_id = eventIdInput.trim();
        if (parentTaskIdInput.trim()) rawPayload.parent_task_id = parentTaskIdInput.trim();
        if (sessionNum !== undefined) rawPayload.session_number = sessionNum;

        const body = validatePersonalAssistantBody('personalTaskCreate', rawPayload);
        setFormBusy(true);
        await api('personalTaskCreate', { body });
        setActionSuccess('Đã tạo công việc cá nhân và lưu trên Backend.');
      } else if (formMode === 'edit' && editingTask) {
        const rawPayload: Record<string, unknown> = {
          ...(!isTaskCompleted(editingTask.status)
            ? {
                status: statusInput,
                progress_percent: statusInput === 'pending' ? 0 : progressInput,
              }
            : {}),
          title: titleInput,
          description: descriptionInput.trim() ? descriptionInput.trim() : null,
          due_at: dueIso ?? null,
          plan_id: planIdInput.trim() ? planIdInput.trim() : null,
          event_id: eventIdInput.trim() ? eventIdInput.trim() : null,
          parent_task_id: parentTaskIdInput.trim() ? parentTaskIdInput.trim() : null,
          session_number: sessionNum ?? null,
        };
        if (priorityInput.trim()) rawPayload.priority = priorityInput.trim();
        if (editingTask.updated_at) rawPayload.expected_updated_at = editingTask.updated_at;

        const body = validatePersonalAssistantBody('personalTaskUpdate', rawPayload);
        setFormBusy(true);
        await api('personalTaskUpdate', {
          params: { id: editingTask.id },
          body,
        });
        setActionSuccess('Đã cập nhật thông tin công việc trên Backend.');
      }

      setFormMode(null);
      setEditingTask(null);
      reloadAll();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setFormBusy(false);
    }
  }

  async function handlePrioritySubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!priorityTask) return;
    setPriorityError('');
    setActionError('');
    setActionSuccess('');

    try {
      const payload = buildPriorityUpdatePayload(
        priorityTask,
        nextPriorityValue,
        priorityOptions
      );
      setPriorityBusy(true);
      await api('personalTaskPriority', {
        params: { id: priorityTask.id },
        body: payload,
      });
      setPriorityTask(null);
      setActionSuccess(
        `Đã cập nhật mức độ ưu tiên cho công việc "${priorityTask.title}" mà không làm mất thông tin khác.`
      );
      reloadAll();
    } catch (e) {
      const message = (e as Error).message;
      setPriorityError(message);
      if (isPriorityConflictOrInvalidError(message)) {
        tasksState.reload();
      }
    } finally {
      setPriorityBusy(false);
    }
  }

  async function handleCompleteTask(task: PersonalTask) {
    setActionError('');
    setActionSuccess('');
    setBusyId(`task-${task.id}`);
    try {
      const body: Record<string, unknown> = {};
      if (task.updated_at) body.expected_updated_at = task.updated_at;
      await api('personalTaskComplete', {
        params: { id: task.id },
        body: validatePersonalAssistantBody('personalTaskComplete', body),
      });
      setActionSuccess(`Đã đánh dấu hoàn thành công việc "${task.title}".`);
      reloadAll();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReopenTask(task: PersonalTask) {
    setActionError('');
    setActionSuccess('');
    setBusyId(`task-${task.id}`);
    try {
      const body: Record<string, unknown> = {
        status: 'pending',
        progress_percent: 0,
      };
      if (task.updated_at) body.expected_updated_at = task.updated_at;
      await api('personalTaskReopen', {
        params: { id: task.id },
        body: validatePersonalAssistantBody('personalTaskReopen', body),
      });
      setActionSuccess(`Đã mở lại công việc "${task.title}" về trạng thái chưa hoàn thành.`);
      reloadAll();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cancelTask) return;
    setConfirmError('');
    setActionError('');
    setActionSuccess('');
    setConfirmBusy(true);
    try {
      const rawBody: Record<string, unknown> = {};
      if (cancelReason.trim()) rawBody.reason = cancelReason.trim();
      if (cancelTask.updated_at) rawBody.expected_updated_at = cancelTask.updated_at;
      const body = validatePersonalAssistantBody('personalTaskCancel', rawBody);
      await api('personalTaskCancel', {
        params: { id: cancelTask.id },
        body,
      });
      setCancelTask(null);
      setCancelReason('');
      setActionSuccess(`Đã hủy công việc "${cancelTask.title}".`);
      reloadAll();
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      setConfirmBusy(false);
    }
  }

  async function handleDeleteConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTask || !deleteConfirmed) return;
    setConfirmError('');
    setActionError('');
    setActionSuccess('');
    setConfirmBusy(true);
    try {
      await api('personalTaskDelete', {
        params: { id: deleteTask.id },
      });
      setDeleteTask(null);
      setDeleteConfirmed(false);
      setActionSuccess(`Đã xóa công việc "${deleteTask.title}".`);
      reloadAll();
    } catch (e) {
      setConfirmError((e as Error).message);
    } finally {
      setConfirmBusy(false);
    }
  }

  async function handleCompletePlanSession(plan: PersonalPlanProgress, sessionId: string) {
    setActionError('');
    setActionSuccess('');
    setBusyId(`session-${plan.id}-${sessionId}`);
    try {
      const body: Record<string, unknown> = {};
      if (plan.updated_at) body.expected_updated_at = plan.updated_at;
      await api('personalPlanSessionComplete', {
        params: { id: plan.id, sessionId },
        body: validatePersonalAssistantBody('personalPlanSessionComplete', body),
      });
      setActionSuccess(`Đã cập nhật hoàn thành buổi trong kế hoạch "${plan.title}".`);
      reloadAll();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreatePlanSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (planSaving.current || planFormBusy || planDraftBusy) return;
    planSaving.current = true;
    setPlanFormError('');
    setActionError('');
    setActionSuccess('');
    try {
      if (!planConfirmed) throw new Error('Vui lòng xác nhận nội dung kế hoạch hiện tại.');
      if (!planSteps.length) throw new Error('Kế hoạch cần ít nhất một bước cụ thể.');
      const totalSessions = Number(planTotalSessionsInput.trim());
      const rawPayload: Record<string, unknown> = {
        title: planTitleInput,
        total_sessions: totalSessions,
      };
      if (planGoalInput.trim()) rawPayload.goal = planGoalInput.trim();
      if (planDescInput.trim()) rawPayload.description = planDescInput.trim();
      if (planStartDateInput.trim()) rawPayload.start_date = planStartDateInput.trim();
      if (planEndDateInput.trim()) rawPayload.end_date = planEndDateInput.trim();
      if (planSteps.length) {
        rawPayload.sessions = planSteps.map((step, index) => ({ ...step, session_number: index + 1 }));
        rawPayload.total_sessions = planSteps.length;
        rawPayload.confirmed = true;
      }
      const body = validatePersonalAssistantBody('personalPlanCreate', rawPayload);
      setPlanFormBusy(true);
      await api('personalPlanCreate', { body });
      setPlanDialogOpen(false);
      setPlanSteps([]);
      setPlanTitleInput('');
      setPlanGoalInput('');
      setPlanDescInput('');
      setPlanTotalSessionsInput('10');
      setPlanStartDateInput('');
      setPlanEndDateInput('');
      setActionSuccess('Đã tạo kế hoạch cá nhân nhiều buổi và lưu trên Backend.');
      reloadAll();
    } catch (e) {
      setPlanFormError((e as Error).message);
    } finally {
      planSaving.current = false;
      setPlanFormBusy(false);
    }
  }

  return (
    <div className="ud-pa-grid" data-testid="personal-assistant-workspace">
      {/* PA-10 & PA-11: Personal Task Management & Task Priority Management */}
      <Panel
        className="ud-pa-tasks"
        title="Quản lý công việc cá nhân & Mức độ ưu tiên"
        description="Theo dõi, tạo mới, cập nhật mức độ ưu tiên và xử lý công việc gắn với kế hoạch cá nhân của bạn."
        actions={
          <div className="ud-pa-header-actions">
            <Button
              variant="ghost"
              onClick={tasksState.reload}
              aria-label="Tải lại công việc cá nhân"
            >
              <RefreshCw size={16} />
            </Button>
            <Button onClick={() => openCreateDialog()}>
              <Plus size={16} aria-hidden="true" />
              Tạo công việc mới
            </Button>
          </div>
        }
      >
        <form
          className="ud-filter ud-pa-filter"
          onSubmit={(event) => {
            event.preventDefault();
            onApplyFilters?.({
              search: searchInput,
              status: statusFilter,
              priority: priorityFilter,
              sort_by: sortFilter,
              plan_id: planFilter,
            });
          }}
        >
          <Filter size={18} aria-hidden="true" />
          <label>
            Tìm kiếm công việc
            <input
              name="task_search"
              type="search"
              placeholder="Ví dụ: Hoàn thành báo cáo đồ án…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </label>
          <label>
            Trạng thái
            <select
              name="task_status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="pending">Đang chờ (pending)</option>
              <option value="in_progress">Đang thực hiện (in_progress)</option>
              <option value="partial">Hoàn thành một phần (partial)</option>
              <option value="completed">Đã hoàn thành (completed)</option>
              <option value="cancelled">Đã hủy (cancelled)</option>
            </select>
          </label>
          <label>
            Mức độ ưu tiên
            <select
              name="task_priority"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <option value="">Tất cả mức ưu tiên</option>
              {priorityOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sắp xếp theo ưu tiên
            <select
              name="task_sort"
              value={sortFilter}
              onChange={(e) => setSortFilter(e.target.value)}
            >
              <option value="">Mặc định</option>
              <option value="priority_desc">Ưu tiên: Cao → Thấp (HIGH → LOW)</option>
              <option value="priority_asc">Ưu tiên: Thấp → Cao (LOW → HIGH)</option>
            </select>
          </label>
          <label>
            Kế hoạch cá nhân
            {plans.length > 0 ? (
              <select
                name="task_plan_id"
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
              >
                <option value="">Tất cả kế hoạch</option>
                {plans.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.title}
                  </option>
                ))}
              </select>
            ) : (
              <input
                name="task_plan_id"
                type="text"
                inputMode="numeric"
                placeholder="Mã kế hoạch (ID)…"
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
              />
            )}
          </label>
          <div className="ud-pa-filter-buttons">
            <Button variant="outline" type="submit">
              Lọc công việc
            </Button>
            {(searchInput || statusFilter || priorityFilter || sortFilter || planFilter) && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setSearchInput('');
                  setStatusFilter('');
                  setPriorityFilter('');
                  setSortFilter('');
                  setPlanFilter('');
                  onApplyFilters?.({ search: '', status: '', priority: '', sort_by: '', plan_id: '' });
                }}
              >
                Đặt lại bộ lọc
              </Button>
            )}
          </div>
        </form>

        <Notice error={actionError || tasksParseError} success={actionSuccess} />

        <ResourceState state={tasksState}>
          {tasks.length === 0 ? (
            <div className="empty-state">
              <ClipboardList size={28} />
              <h3>Chưa có công việc cá nhân</h3>
              <p>
                Tạo công việc mới (ví dụ: &ldquo;Hoàn thành báo cáo đồ án trước 17:00 ngày
                mai.&rdquo;) để lưu và đồng bộ với Backend.
              </p>
            </div>
          ) : (
            <div className="table-scroll">
              <table aria-label="Danh sách công việc cá nhân">
                <thead>
                  <tr>
                    <th>Công việc</th>
                    <th>Kế hoạch cá nhân</th>
                    <th>Thời hạn</th>
                    <th>Mức độ ưu tiên</th>
                    <th>Trạng thái</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {hierarchicalTasks.map(({ task, depth, hasDetachedParent }) => {
                    const completed = isTaskCompleted(task.status);
                    const cancelled = isTaskCancelled(task.status);
                    const rowBusy = busyId === `task-${task.id}`;
                    const displayProgress = getDisplayTaskProgress(task);
                    return (
                      <tr
                        key={task.id}
                        data-task-id={task.id}
                        data-parent-task-id={task.parent_task_id ?? ''}
                        data-task-depth={depth}
                      >
                        <td>
                          <div
                            className={`ud-pa-task-cell${depth > 0 ? ' ud-pa-subtask-cell' : ''}`}
                            style={depth > 0 ? { paddingLeft: `${depth * 20}px` } : undefined}
                          >
                            <strong className="ud-pa-task-title">
                              {depth > 0 && (
                                <CornerDownRight
                                  size={13}
                                  className="ud-pa-subtask-icon"
                                  aria-hidden="true"
                                />
                              )}
                              <span>{task.title}</span>
                            </strong>
                            {task.description && (
                              <span className="ud-pa-task-desc">{task.description}</span>
                            )}
                            <div className="ud-pa-task-meta">
                              {task.parent_task_id && (hasDetachedParent || depth > 0) && (
                                <span className="ud-pa-subtask-badge">
                                  Công việc con của: {task.parent_task_title ?? `#${task.parent_task_id}`}
                                </span>
                              )}
                              {task.subtask_count > 0 && (
                                <span className="ud-pa-subtask-count">
                                  {task.subtask_count} công việc con
                                </span>
                              )}
                              {task.event_id && (
                                <span className="ud-pa-event-badge">
                                  <Calendar size={12} aria-hidden="true" />
                                  <span>{task.event_title ?? `Sự kiện #${task.event_id}`}</span>
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>
                          {task.plan_title || task.plan_id ? (
                            <span className="ud-pa-plan-badge">
                              <Layers size={13} aria-hidden="true" />
                              <span>
                                {task.plan_title ?? `Kế hoạch #${task.plan_id}`}
                                {task.session_number !== null
                                  ? ` · Buổi ${task.session_number}`
                                  : ''}
                              </span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{task.due_at ? date(task.due_at) : '—'}</td>
                        <td>
                          <span className="ud-pa-priority-badge" data-priority={task.priority ?? ''}>
                            <Flag size={12} aria-hidden="true" />
                            <span>{task.priority ?? 'Chưa đặt'}</span>
                          </span>
                        </td>
                        <td>
                          <div className="ud-pa-status-cell">
                            <Status>{task.status}</Status>
                            <span
                              className="ud-pa-progress-pill"
                              data-testid={`task-${task.id}-progress`}
                            >
                              {displayProgress}%
                            </span>
                            <div
                              className="ud-pa-task-progress-track"
                              role="progressbar"
                              aria-label={`Tiến độ ${task.title}`}
                              aria-valuenow={displayProgress}
                              aria-valuemin={0}
                              aria-valuemax={100}
                            >
                              <div
                                className="ud-pa-task-progress-fill"
                                style={{
                                  width: `${Math.min(100, Math.max(0, displayProgress))}%`,
                                }}
                              />
                            </div>
                            {task.aggregated_progress_percent !== null && (
                              <span className="ud-pa-partial-note">
                                Tổng hợp ({task.active_subtask_count} việc con)
                                {task.aggregated_progress_percent === 100 && !completed
                                  ? ' · Chờ xác nhận hoàn thành'
                                  : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => inspectTaskDetail(task)}
                              aria-label={`Chi tiết ${task.title}`}
                            >
                              <Eye size={14} aria-hidden="true" />
                              Chi tiết
                            </Button>
                            {!cancelled && (
                              <Button
                                variant="ghost"
                                type="button"
                                onClick={() => openCreateDialog(task.id)}
                                aria-label={`Thêm việc con cho ${task.title}`}
                              >
                                <Plus size={14} aria-hidden="true" />
                                Thêm việc con
                              </Button>
                            )}
                            {!cancelled && (
                              <Button
                                variant="outline"
                                type="button"
                                onClick={() => openEditDialog(task)}
                                aria-label={`Chỉnh sửa ${task.title}`}
                              >
                                <Pencil size={14} aria-hidden="true" />
                                Chỉnh sửa
                              </Button>
                            )}
                            {!cancelled && (
                              <Button
                                variant="outline"
                                type="button"
                                onClick={() => openPriorityDialog(task)}
                                aria-label={`Đổi ưu tiên ${task.title}`}
                              >
                                <Flag size={14} aria-hidden="true" />
                                Đổi ưu tiên
                              </Button>
                            )}
                            {!completed && !cancelled && (
                              <Button
                                variant="default"
                                type="button"
                                disabled={rowBusy}
                                onClick={() => handleCompleteTask(task)}
                                aria-label={`Hoàn thành ${task.title}`}
                              >
                                <CheckCircle2 size={14} aria-hidden="true" />
                                {rowBusy ? 'Đang lưu…' : 'Hoàn thành'}
                              </Button>
                            )}
                            {completed && !cancelled && (
                              <Button
                                variant="outline"
                                type="button"
                                disabled={rowBusy}
                                onClick={() => handleReopenTask(task)}
                                aria-label={`Mở lại công việc ${task.title}`}
                              >
                                <RotateCcw size={14} aria-hidden="true" />
                                {rowBusy ? 'Đang lưu…' : 'Mở lại công việc'}
                              </Button>
                            )}
                            {task.can_cancel && !completed && !cancelled && (
                              <Button
                                variant="outline"
                                type="button"
                                onClick={() => {
                                  setCancelTask(task);
                                  setCancelReason('');
                                  setConfirmError('');
                                }}
                                aria-label={`Hủy ${task.title}`}
                              >
                                <XCircle size={14} aria-hidden="true" />
                                Hủy
                              </Button>
                            )}
                            {task.can_delete && (
                              <Button
                                variant="destructive"
                                type="button"
                                onClick={() => {
                                  setDeleteTask(task);
                                  setDeleteConfirmed(false);
                                  setConfirmError('');
                                }}
                                aria-label={`Xóa ${task.title}`}
                              >
                                <Trash2 size={14} aria-hidden="true" />
                                Xóa
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="ud-pa-pagination" aria-label="Phân trang công việc cá nhân">
                <span className="muted" data-testid="pa-tasks-page-info">
                  Trang {taskMeta.page} / {taskMeta.total_pages} · Tổng {taskMeta.total} công việc
                </span>
                <div className="ud-pa-pagination-actions">
                  <Button
                    variant="outline"
                    type="button"
                    disabled={taskMeta.page <= 1}
                    onClick={() => onChangePage?.(taskMeta.page - 1)}
                    aria-label="Trang trước"
                  >
                    <ChevronLeft size={14} aria-hidden="true" />
                    Trang trước
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={taskMeta.page >= taskMeta.total_pages}
                    onClick={() => onChangePage?.(taskMeta.page + 1)}
                    aria-label="Trang sau"
                  >
                    Trang sau
                    <ChevronRight size={14} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </ResourceState>

        {selectedTask && (
          <div className="ud-pa-detail-box" role="region" aria-label="Chi tiết công việc">
            <div className="ud-pa-detail-header">
              <div>
                <h3>Chi tiết công việc: {selectedTask.title}</h3>
                <p className="muted">
                  ID: {selectedTask.id} · Trạng thái: {display(selectedTask.status)} · Tiến độ:{' '}
                  {getDisplayTaskProgress(selectedTask)}%
                  {selectedTask.aggregated_progress_percent !== null
                    ? ` (tổng hợp từ ${selectedTask.active_subtask_count} việc con; riêng task cha: ${selectedTask.progress_percent}%)`
                    : ''}{' '}
                  · Ưu tiên: {selectedTask.priority ?? 'Chưa đặt'}
                  {selectedTask.parent_task_id
                    ? ` · Công việc cha: ${selectedTask.parent_task_title ?? `#${selectedTask.parent_task_id}`}`
                    : ''}
                  {selectedTask.event_id
                    ? ` · Sự kiện: ${selectedTask.event_title ?? `#${selectedTask.event_id}`}`
                    : ''}
                </p>
              </div>
              <Button variant="ghost" type="button" onClick={() => setSelectedTask(null)}>
                Đóng chi tiết
              </Button>
            </div>
            {selectedTask.subtasks && selectedTask.subtasks.length > 0 && (
              <div className="ud-pa-detail-subtasks">
                <strong>Công việc con ({selectedTask.subtasks.length}):</strong>
                <p className="muted">
                  Tiến độ tổng hợp của công việc cha bằng trung bình cộng các công việc con đang
                  hoạt động (không tính công việc đã hủy hoặc đã xóa) và không tự đánh dấu hoàn
                  thành công việc cha.
                </p>
                <ul>
                  {selectedTask.subtasks.map((sub) => (
                    <li key={sub.id}>
                      {sub.title} ·{' '}
                      <span className="ud-pa-priority-badge" data-priority={sub.priority ?? 'MEDIUM'}>
                        {sub.priority ?? 'MEDIUM'}
                      </span>{' '}
                      · {display(sub.status)} ({sub.progress_percent}%)
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detailLoading && <p className="muted">Đang đồng bộ chi tiết từ Backend…</p>}
            <Notice error={detailError} />
            <StructuredDataView data={detailData} />
          </div>
        )}
      </Panel>

      {/* PA-12: Task Progress Tracking & Multi-Session Plans */}
      <Panel
        className="ud-pa-progress"
        title="Theo dõi tiến độ công việc & Kế hoạch nhiều buổi"
        description="Tổng hợp công việc đã hoàn thành, công việc đang chờ và tiến độ các kế hoạch cá nhân nhiều buổi từ dữ liệu Backend."
        actions={
          <div className="ud-pa-header-actions">
            <Button
              variant="ghost"
              onClick={plansState.reload}
              aria-label="Tải lại tiến độ kế hoạch"
            >
              <RefreshCw size={16} />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPlanFormError('');
                setPlanDialogOpen(true);
              }}
            >
              <Plus size={16} aria-hidden="true" />
              Tạo kế hoạch mới
            </Button>
          </div>
        }
      >
        <div className="ud-pa-summary-cards" aria-label="Tổng quan tiến độ công việc">
          <div className="ud-pa-summary-card">
            <span className="ud-pa-summary-label">Công việc hoàn thành</span>
            <strong data-testid="pa-completed-tasks">
              {tasksState.loading || tasksState.error ? '—' : taskSummary.completed_tasks}
            </strong>
            <span className="muted">Xác nhận hoàn thành từ Backend</span>
          </div>
          <div className="ud-pa-summary-card">
            <span className="ud-pa-summary-label">Công việc đang chờ</span>
            <strong data-testid="pa-pending-tasks">
              {tasksState.loading || tasksState.error ? '—' : taskSummary.pending_tasks}
            </strong>
            <span className="muted">Bao gồm đang chờ & đang thực hiện</span>
          </div>
          <div className="ud-pa-summary-card">
            <span className="ud-pa-summary-label">Tỷ lệ hoàn thành</span>
            <strong data-testid="pa-task-completion-percent">
              {tasksState.loading || tasksState.error
                ? '—'
                : `${taskSummary.completion_percent}%`}
            </strong>
            <span className="muted">Trên tổng số công việc đang hoạt động</span>
          </div>
          <div className="ud-pa-summary-card">
            <span className="ud-pa-summary-label">Công việc đã hủy</span>
            <strong data-testid="pa-cancelled-tasks">
              {tasksState.loading || tasksState.error ? '—' : taskSummary.cancelled_tasks}
            </strong>
            <span className="muted">
              {tasksState.loading || tasksState.error
                ? 'Đang tải thống kê…'
                : `Trên tổng ${taskSummary.total_tasks} công việc`}
            </span>
          </div>
        </div>

        <Notice error={plansParseError} />

        <ResourceState state={plansState}>
          {plans.length === 0 ? (
            <div className="empty-state">
              <Layers size={28} />
              <h3>Chưa có kế hoạch nhiều buổi</h3>
              <p>
                Tiến độ các buổi (ví dụ: Completed: 3/10 sessions · Progress: 30% · Remaining: 7
                sessions) sẽ xuất hiện khi Backend có bản ghi kế hoạch.
              </p>
            </div>
          ) : (
            <div className="ud-pa-plans-list">
              {plans.map((plan) => {
                const formatted = formatPlanProgressSummary(plan);
                return (
                  <article
                    key={plan.id}
                    className="ud-pa-plan-card"
                    data-plan-id={plan.id}
                    aria-label={`Kế hoạch ${plan.title}`}
                  >
                    <div className="ud-pa-plan-card-head">
                      <div>
                        <h3>{plan.title}</h3>
                        {plan.description && <p className="muted">{plan.description}</p>}
                      </div>
                      <div className="ud-pa-plan-head-meta">
                        <Status>{plan.status}</Status>
                        <Button
                          variant="ghost"
                          type="button"
                          onClick={() => {
                            setPlanFilter(plan.id);
                            onApplyFilters?.({
                              search: searchInput,
                              status: statusFilter,
                              priority: priorityFilter,
                              sort_by: sortFilter,
                              plan_id: plan.id,
                            });
                          }}
                        >
                          Xem công việc thuộc kế hoạch
                        </Button>
                      </div>
                    </div>

                    <div className="ud-pa-plan-metrics">
                      <span data-testid={`plan-${plan.id}-completed`}>
                        {formatted.completedText} ({formatted.viCompletedText})
                      </span>
                      <span data-testid={`plan-${plan.id}-progress`}>
                        {formatted.progressText} ({formatted.viProgressText})
                      </span>
                      <span data-testid={`plan-${plan.id}-remaining`}>
                        {formatted.remainingText} ({formatted.viRemainingText})
                      </span>
                    </div>

                    <div
                      className="ud-pa-progress-track"
                      role="progressbar"
                      aria-label={`Tiến độ ${plan.title}`}
                      aria-valuenow={plan.progress_percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div
                        className="ud-pa-progress-fill"
                        style={{ width: `${plan.progress_percent}%` }}
                      />
                    </div>

                    {plan.sessions.length > 0 && (
                      <div className="ud-pa-sessions-list" aria-label={`Danh sách buổi của ${plan.title}`}>
                        {plan.sessions.map((session) => {
                          const sessionBusy = busyId === `session-${plan.id}-${session.id}`;
                          return (
                            <div
                              key={session.id}
                              className="ud-pa-session-item"
                              data-session-id={session.id}
                              data-session-completed={session.is_completed ? 'true' : 'false'}
                            >
                              <div className="ud-pa-session-info">
                                <strong>
                                  Buổi {session.session_number}: {session.title}
                                </strong>
                                <div className="ud-pa-session-badges">
                                  <Status>{session.status}</Status>
                                  <span className="ud-pa-progress-pill">{session.progress_percent}%</span>
                                  {session.is_partial && !session.is_completed && (
                                    <span className="ud-pa-partial-note">
                                      Chưa hoàn tất toàn bộ buổi (không tự động tính hoàn thành)
                                    </span>
                                  )}
                                  {session.completed_at && (
                                    <span className="muted">
                                      Hoàn thành lúc: {date(session.completed_at)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {!session.is_completed && (
                                <Button
                                  variant="outline"
                                  type="button"
                                  disabled={sessionBusy}
                                  onClick={() => handleCompletePlanSession(plan, session.id)}
                                  aria-label={`Hoàn thành buổi ${session.session_number} của ${plan.title}`}
                                >
                                  <CheckCircle2 size={14} aria-hidden="true" />
                                  {sessionBusy ? 'Đang cập nhật…' : 'Hoàn thành buổi'}
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </ResourceState>
      </Panel>

      {/* Dialog: Create / Edit Task (PA-10) */}
      <Dialog
        open={formMode !== null}
        busy={formBusy}
        onOpenChange={(open) => {
          if (!open && !formBusy) {
            setFormMode(null);
            setEditingTask(null);
          }
        }}
        title={formMode === 'edit' ? 'Chỉnh sửa công việc cá nhân' : 'Tạo công việc cá nhân mới'}
        description="Dữ liệu được kiểm tra hợp lệ trước khi gửi tới Backend qua BFF."
      >
        <form className="form-stack" onSubmit={handleSaveTask}>
          {formMode === 'edit' && editingTask && isTaskCompleted(editingTask.status) && (
            <p className="muted">
              Trạng thái: Đã hoàn thành (100%). Dùng thao tác &quot;Mở lại công việc&quot; nếu cần
              đưa về trạng thái đang thực hiện và cập nhật tiến độ.
            </p>
          )}
          {formMode === 'edit' && editingTask && !isTaskCompleted(editingTask.status) && (
            <>
              {editingTask.aggregated_progress_percent !== null && (
                <p className="muted">
                  Tiến độ tổng hợp hiện tại từ công việc con:{' '}
                  {editingTask.aggregated_progress_percent}% (giá trị riêng của task cha khi không
                  còn việc con hợp lệ: {editingTask.progress_percent}%).
                </p>
              )}
              <label>
                Trạng thái công việc
                <select
                  name="status"
                  value={statusInput}
                  onChange={(e) => {
                    const next = e.target.value as 'pending' | 'in_progress' | 'partial';
                    setStatusInput(next);
                    if (next === 'pending') {
                      setProgressInput(0);
                    }
                  }}
                >
                  <option value="pending">Đang chờ (pending)</option>
                  <option value="in_progress">Đang thực hiện (in_progress)</option>
                  <option value="partial">Hoàn thành một phần (partial)</option>
                </select>
              </label>
              <label>
                Tiến độ (0–99%; dùng nút Hoàn thành để xác nhận 100%)
                <input
                  name="progress_percent"
                  type="number"
                  min={0}
                  max={99}
                  step={1}
                  required
                  value={progressInput}
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    const next = Number.isFinite(parsed)
                      ? Math.min(99, Math.max(0, Math.round(parsed)))
                      : 0;
                    setProgressInput(next);
                    if (next > 0 && statusInput === 'pending') {
                      setStatusInput('in_progress');
                    }
                  }}
                />
              </label>
            </>
          )}
          <label>
            Tiêu đề công việc
            <input
              name="title"
              type="text"
              required
              maxLength={500}
              placeholder="Hoàn thành báo cáo đồ án trước 17:00 ngày mai."
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
            />
          </label>
          <label>
            Mô tả chi tiết
            <textarea
              name="description"
              rows={3}
              maxLength={4000}
              placeholder="Ghi chú thêm về yêu cầu hoặc tài liệu liên quan…"
              value={descriptionInput}
              onChange={(e) => setDescriptionInput(e.target.value)}
            />
          </label>
          <label>
            Thời hạn hoàn thành
            <input
              name="due_at"
              type="datetime-local"
              value={dueAtInput}
              onChange={(e) => setDueAtInput(e.target.value)}
            />
          </label>
          <label>
            Công việc cha (tùy chọn)
            {eligibleParentTasks.length > 0 ? (
              <select
                name="parent_task_id"
                value={parentTaskIdInput}
                onChange={(e) => setParentTaskIdInput(e.target.value)}
              >
                <option value="">Không có công việc cha (công việc gốc)</option>
                {eligibleParentTasks.map((pt) => (
                  <option key={pt.id} value={pt.id}>
                    {pt.title} (#{pt.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                name="parent_task_id"
                type="text"
                inputMode="numeric"
                placeholder="Mã công việc cha BIGINT (tùy chọn)…"
                value={parentTaskIdInput}
                onChange={(e) => setParentTaskIdInput(e.target.value)}
              />
            )}
          </label>
          <label>
            Gắn với sự kiện lịch cá nhân (tùy chọn)
            {events.length > 0 ? (
              <select
                name="event_id"
                value={eventIdInput}
                onChange={(e) => setEventIdInput(e.target.value)}
              >
                <option value="">Không gắn sự kiện</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} (#{ev.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                name="event_id"
                type="text"
                inputMode="numeric"
                placeholder="Mã sự kiện BIGINT (tùy chọn)…"
                value={eventIdInput}
                onChange={(e) => setEventIdInput(e.target.value)}
              />
            )}
          </label>
          <label>
            Mức độ ưu tiên (theo quy tắc hệ thống)
            <select
              name="priority"
              value={priorityInput}
              onChange={(e) => setPriorityInput(e.target.value)}
            >
              <option value="">Theo mặc định của Backend</option>
              {priorityOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Gắn với kế hoạch cá nhân (tùy chọn)
            {plans.length > 0 ? (
              <select
                name="plan_id"
                value={planIdInput}
                onChange={(e) => setPlanIdInput(e.target.value)}
              >
                <option value="">Không gắn kế hoạch</option>
                {plans.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.title} (#{pl.id})
                  </option>
                ))}
              </select>
            ) : (
              <input
                name="plan_id"
                type="text"
                inputMode="numeric"
                placeholder="Mã kế hoạch BIGINT (tùy chọn)…"
                value={planIdInput}
                onChange={(e) => setPlanIdInput(e.target.value)}
              />
            )}
          </label>
          <label>
            Thuộc buổi thứ (tùy chọn)
            <input
              name="session_number"
              type="number"
              min={1}
              max={10000}
              step={1}
              placeholder="Ví dụ: 3"
              value={sessionNumberInput}
              onChange={(e) => setSessionNumberInput(e.target.value)}
            />
          </label>
          <Notice error={formError} />
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={formBusy}
              onClick={() => {
                setFormMode(null);
                setEditingTask(null);
              }}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={formBusy}>
              {formBusy ? 'Đang chờ Backend…' : 'Lưu công việc'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog: Change Task Priority (PA-11) */}
      <Dialog
        open={priorityTask !== null}
        busy={priorityBusy}
        onOpenChange={(open) => {
          if (!open && !priorityBusy) setPriorityTask(null);
        }}
        title="Cập nhật mức độ ưu tiên công việc"
        description={
          priorityTask
            ? `Giữ nguyên toàn bộ thông tin công việc "${priorityTask.title}" và cập nhật mức ưu tiên qua Backend.`
            : undefined
        }
      >
        <form className="form-stack" onSubmit={handlePrioritySubmit}>
          <label>
            Mức độ ưu tiên mới
            <select
              name="priority"
              required
              value={nextPriorityValue}
              onChange={(e) => setNextPriorityValue(e.target.value)}
            >
              <option value="">Chọn mức ưu tiên…</option>
              {priorityOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <Notice error={priorityError} />
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={priorityBusy}
              onClick={() => setPriorityTask(null)}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={priorityBusy}>
              {priorityBusy ? 'Đang cập nhật…' : 'Xác nhận đổi ưu tiên'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog: Cancel Task (PA-10) */}
      <Dialog
        open={cancelTask !== null}
        busy={confirmBusy}
        onOpenChange={(open) => {
          if (!open && !confirmBusy) setCancelTask(null);
        }}
        title="Hủy công việc cá nhân"
        description={
          cancelTask ? `Gửi yêu cầu hủy công việc "${cancelTask.title}" tới Backend.` : undefined
        }
      >
        <form className="form-stack" onSubmit={handleCancelConfirm}>
          <label>
            Lý do hủy (tùy chọn)
            <input
              name="reason"
              type="text"
              maxLength={500}
              placeholder="Nhập lý do hủy công việc…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </label>
          <Notice error={confirmError} />
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={confirmBusy}
              onClick={() => setCancelTask(null)}
            >
              Đóng
            </Button>
            <Button type="submit" disabled={confirmBusy}>
              {confirmBusy ? 'Đang chờ Backend…' : 'Xác nhận hủy công việc'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog: Delete Task (PA-10) */}
      <Dialog
        open={deleteTask !== null}
        busy={confirmBusy}
        onOpenChange={(open) => {
          if (!open && !confirmBusy) setDeleteTask(null);
        }}
        title="Xóa công việc cá nhân"
        description={
          deleteTask
            ? `Thao tác này sẽ xóa công việc "${deleteTask.title}" trên Backend khi được hỗ trợ.`
            : undefined
        }
      >
        <form className="form-stack" onSubmit={handleDeleteConfirm}>
          <Notice error={confirmError} />
          <label className="check-label">
            <input
              type="checkbox"
              required
              checked={deleteConfirmed}
              onChange={(e) => setDeleteConfirmed(e.target.checked)}
            />
            Tôi xác nhận xóa công việc cá nhân này.
          </label>
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={confirmBusy}
              onClick={() => setDeleteTask(null)}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={confirmBusy || !deleteConfirmed}
            >
              {confirmBusy ? 'Đang chờ Backend…' : 'Xác nhận xóa'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Dialog: Create Multi-Session Plan (PA-12) */}
      <Dialog
        open={planDialogOpen}
        busy={planFormBusy || planDraftBusy}
        onOpenChange={(open) => {
          if (!open && !planFormBusy && !planDraftBusy) setPlanDialogOpen(false);
        }}
        title="Tạo kế hoạch cá nhân nhiều buổi"
        description="Hệ thống khởi tạo kế hoạch trong personal_plans và các buổi tương ứng trong personal_tasks."
      >
        <form className="form-stack" onSubmit={handleCreatePlanSubmit}>
          <label>
            Tiêu đề kế hoạch
            <input
              name="plan_title"
              type="text"
              required
              maxLength={255}
              placeholder="Ví dụ: Kế hoạch luyện tập & hoàn thiện đồ án 10 buổi"
              value={planTitleInput}
              onChange={(e) => setPlanTitleInput(e.target.value)}
            />
          </label>
          <label>
            Mục tiêu kế hoạch
            <input
              name="plan_goal"
              required
              disabled={planFormBusy || planDraftBusy}
              type="text"
              maxLength={500}
              placeholder="Ví dụ: Hoàn thành 100% các mốc kiểm thử và tài liệu"
              value={planGoalInput}
              onChange={(e) => setPlanGoalInput(e.target.value)}
            />
          </label>
          <label>
            Mô tả kế hoạch
            <textarea
              name="plan_description"
              rows={3}
              maxLength={4000}
              placeholder="Mô tả mục tiêu và lộ trình thực hiện…"
              value={planDescInput}
              onChange={(e) => setPlanDescInput(e.target.value)}
            />
          </label>
          <label>
            Tổng số buổi
            <input
              name="total_sessions"
              type="number"
              required
              min={1}
              max={365}
              step={1}
              value={planSteps.length ? String(planSteps.length) : planTotalSessionsInput}
              readOnly={planSteps.length > 0}
              onChange={(e) => setPlanTotalSessionsInput(e.target.value)}
            />
          </label>
          <label>
            Ngày bắt đầu (tùy chọn)
            <input
              name="start_date"
              type="date"
              value={planStartDateInput}
              onChange={(e) => setPlanStartDateInput(e.target.value)}
            />
          </label>
          <label>
            Ngày kết thúc dự kiến (tùy chọn)
            <input
              name="end_date"
              type="date"
              value={planEndDateInput}
              onChange={(e) => setPlanEndDateInput(e.target.value)}
            />
          </label>
          <PlanDraftEditor
            goal={planGoalInput} steps={planSteps} onChange={(steps) => { setPlanSteps(steps); if (steps.length) setPlanTotalSessionsInput(String(steps.length)); }}
            disabled={planFormBusy} onBusyChange={setPlanDraftBusy}
          />
          <label>
            <input type="checkbox" required checked={planConfirmed}
              disabled={planFormBusy || planDraftBusy}
              onChange={(e) => setConfirmedPlanRevision(e.target.checked ? planRevision : '')} />
            Tôi đã xem mục tiêu và các bước, xác nhận lưu kế hoạch này.
          </label>
          <Notice error={planFormError} />
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={planFormBusy || planDraftBusy}
              onClick={() => setPlanDialogOpen(false)}
            >
              Hủy
            </Button>
            <Button type="submit" disabled={planFormBusy || planDraftBusy}>
              {planFormBusy ? 'Đang chờ Backend…' : 'Lưu kế hoạch'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function PersonalAssistantExtensions() {
  const [activeTab, setActiveTab] = useState<'events' | 'reminders' | 'memories'>('events');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const eventsState = useResource('personalEvents', { page: '1', limit: '20' });
  const remindersState = useResource('personalReminders', { page: '1', limit: '20' });
  const [memoryPage, setMemoryPage] = useState(1);
  const [memorySearch, setMemorySearch] = useState('');
  const memoriesState = useResource('personalMemories', { page: String(memoryPage), limit: '20', search: memorySearch });

  // Event modal
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evLocation, setEvLocation] = useState('');
  const [evStart, setEvStart] = useState('');
  const [evEnd, setEvEnd] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [evBusy, setEvBusy] = useState(false);
  const [evError, setEvError] = useState('');
  // Reminder modal
  const [remDialogOpen, setRemDialogOpen] = useState(false);
  const [remMessage, setRemMessage] = useState('');
  const [remAt, setRemAt] = useState('');
  const [remChannel, setRemChannel] = useState<'VOICE' | 'WEB' | 'BOTH'>('VOICE');
  const [remBusy, setRemBusy] = useState(false);
  const [remError, setRemError] = useState('');
  // Memory modal
  const [memDialogOpen, setMemDialogOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<PersonalMemory | null>(null);
  const [memKey, setMemKey] = useState('');
  const [memValue, setMemValue] = useState('');
  const [memCategory, setMemCategory] = useState('');
  const [memBusy, setMemBusy] = useState(false);
  const [memError, setMemError] = useState('');
  const [memConsent, setMemConsent] = useState(false);

  let events: PersonalEvent[] = [];
  if (!eventsState.loading && !eventsState.error && eventsState.data !== undefined) {
    try { events = parsePersonalEvents(eventsState.data); } catch {}
  }
  let reminders: PersonalReminder[] = [];
  if (!remindersState.loading && !remindersState.error && remindersState.data !== undefined) {
    try { reminders = parsePersonalReminders(remindersState.data); } catch {}
  }
  let memories: PersonalMemory[] = [];
  if (!memoriesState.loading && !memoriesState.error && memoriesState.data !== undefined) {
    try { memories = parsePersonalMemories(memoriesState.data); } catch {}
  }

  async function handleCreateEvent(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEvError('');
    setNotice('');
    try {
      const startIso = normalizeDueAtInput(evStart);
      if (!startIso) throw new Error('Vui lòng chọn thời gian bắt đầu hợp lệ.');
      const endIso = normalizeDueAtInput(evEnd);
      const body = validatePersonalAssistantBody('personalEventCreate', {
        title: evTitle,
        start_at: startIso,
        ...(endIso ? { end_at: endIso } : {}),
        ...(evLocation.trim() ? { location: evLocation.trim() } : {}),
        ...(evDesc.trim() ? { description: evDesc.trim() } : {}),
      });
      setEvBusy(true);
      await api('personalEventCreate', { body });
      setEventDialogOpen(false);
      setEvTitle(''); setEvLocation(''); setEvStart(''); setEvEnd(''); setEvDesc('');
      setNotice('Đã tạo sự kiện lịch biểu mới.');
      eventsState.reload();
    } catch (err) {
      setEvError((err as Error).message);
    } finally {
      setEvBusy(false);
    }
  }

  async function handleDeleteEvent(id: string) {
    setBusyId(`ev-${id}`); setError(''); setNotice('');
    try {
      await api('personalEventDelete', { params: { id } });
      setNotice('Đã xóa sự kiện.');
      eventsState.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateReminder(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRemError(''); setNotice('');
    try {
      const remindIso = normalizeDueAtInput(remAt);
      if (!remindIso) throw new Error('Vui lòng chọn thời gian nhắc hợp lệ.');
      const body = validatePersonalAssistantBody('personalReminderCreate', {
        message: remMessage,
        remind_at: remindIso,
        channel: remChannel,
      });
      setRemBusy(true);
      await api('personalReminderCreate', { body });
      setRemDialogOpen(false);
      setRemMessage(''); setRemAt('');
      setNotice('\u0110\u00e3 t\u1ea1o l\u1eddi nh\u1eafc m\u1edbi.');
      remindersState.reload();
    } catch (err) {
      setRemError((err as Error).message);
    } finally {
      setRemBusy(false);
    }
  }

  async function handleAckReminder(id: string) {
    setBusyId(`rem-${id}`); setError(''); setNotice('');
    try {
      await api('personalReminderAcknowledge', { params: { id }, body: {} });
      setNotice('Đã xác nhận hoàn tất lời nhắc.');
      remindersState.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDeleteReminder(id: string) {
    setBusyId(`rem-${id}`); setError(''); setNotice('');
    try {
      await api('personalReminderDelete', { params: { id } });
      setNotice('Đã xóa lời nhắc.');
      remindersState.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreateMemory(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMemError(''); setNotice('');
    try {
      const operation = editingMemory ? 'personalMemoryUpdate' : 'personalMemoryCreate';
      const body = validatePersonalAssistantBody(operation, {
        consent: memConsent,
        ...(editingMemory?.revision ? { expected_revision: editingMemory.revision } : {}),
        memory_key: memKey,
        memory_value: memValue,
        category: memCategory.trim() || null,
      });
      setMemBusy(true);
      await api(operation, { body, ...(editingMemory ? { params: { id: editingMemory.id } } : {}) });
      setMemDialogOpen(false);
      setMemConsent(false);
      setMemKey(''); setMemValue(''); setMemCategory('');
      setNotice('Đã lưu ghi nhớ cá nhân.');
      memoriesState.reload();
    } catch (err) {
      setMemError((err as Error).message);
      if (err instanceof ApiError && err.status === 409) memoriesState.reload();
    } finally {
      setMemBusy(false);
    }
  }

  async function handleDeleteMemory(id: string) {
    if (!window.confirm('Xóa vĩnh viễn ghi nhớ này?')) return;
    setBusyId(`mem-${id}`); setError(''); setNotice('');
    try {
      await api('personalMemoryDelete', { params: { id } });
      setNotice('Đã xóa ghi nhớ cá nhân.');
      memoriesState.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel
      className="ud-pa-extensions"
      title="Lịch biểu, Nhắc việc & Ghi nhớ cá nhân"
      description="Quản lý lịch cá nhân, lời nhắc và những thông tin bạn đồng ý ghi nhớ."
      actions={
        <div className="ud-pa-header-actions">
          <Button
            variant={activeTab === 'events' ? 'default' : 'outline'}
            type="button"
            onClick={() => setActiveTab('events')}
          >
            <Calendar size={15} aria-hidden="true" />
            Sự kiện ({events.length})
          </Button>
          <Button
            variant={activeTab === 'reminders' ? 'default' : 'outline'}
            type="button"
            onClick={() => setActiveTab('reminders')}
          >
            <Bell size={15} aria-hidden="true" />
            Nhắc việc ({reminders.length})
          </Button>
          <Button
            variant={activeTab === 'memories' ? 'default' : 'outline'}
            type="button"
            onClick={() => setActiveTab('memories')}
          >
            <Brain size={15} aria-hidden="true" />
            Ghi nhớ ({memories.length})
          </Button>
        </div>
      }
    >
      <Notice error={error} success={notice} />

      {activeTab === 'events' && (
        <>
          <div className="toolbar" style={{ marginBottom: '12px' }}>
            <Button type="button" onClick={() => { setEvError(''); setEventDialogOpen(true); }}>
              <Plus size={15} aria-hidden="true" /> Thêm sự kiện
            </Button>
            <Button variant="ghost" type="button" onClick={eventsState.reload}>
              <RefreshCw size={15} aria-hidden="true" /> Tải lại
            </Button>
          </div>
          <ResourceState state={eventsState}>
            {events.length === 0 ? (
              <p className="muted">Chưa có sự kiện nào trong lịch biểu cá nhân.</p>
            ) : (
              <div className="table-scroll">
                <table aria-label="Danh sách sự kiện cá nhân">
                  <thead>
                    <tr>
                      <th>Sự kiện</th>
                      <th>Địa điểm</th>
                      <th>Bắt đầu</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id}>
                        <td>
                          <strong>{ev.title}</strong>
                          {ev.has_conflict && (
                            <div className="muted" style={{ color: '#d97706' }}>
                              Trùng lịch với sự kiện #{ev.conflicting_event_ids.join(', #')}
                            </div>
                          )}
                        </td>
                        <td>{ev.location ?? '—'}</td>
                        <td>{date(ev.start_at)}</td>
                        <td><Status>{ev.status}</Status></td>
                        <td>
                          <Button
                            variant="destructive"
                            type="button"
                            disabled={busyId === `ev-${ev.id}`}
                            onClick={() => handleDeleteEvent(ev.id)}
                          >
                            <Trash2 size={14} aria-hidden="true" /> Xóa
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ResourceState>
        </>
      )}

      {activeTab === 'reminders' && (
        <>
          <div className="toolbar" style={{ marginBottom: '12px' }}>
            <Button type="button" onClick={() => { setRemError(''); setRemDialogOpen(true); }}>
              <Plus size={15} aria-hidden="true" /> Tạo nhắc việc
            </Button>
            <Button variant="ghost" type="button" onClick={remindersState.reload}>
              <RefreshCw size={15} aria-hidden="true" /> Tải lại
            </Button>
          </div>
          <ResourceState state={remindersState}>
            {reminders.length === 0 ? (
              <p className="muted">Chưa có lời nhắc nào.</p>
            ) : (
              <div className="table-scroll">
                <table aria-label="Danh sách nhắc việc cá nhân">
                  <thead>
                    <tr>
                      <th>Nội dung nhắc</th>
                      <th>Thời điểm</th>
                      <th>Kênh</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reminders.map((rem) => (
                      <tr key={rem.id}>
                        <td>
                          <strong>{rem.message}</strong>
                          {rem.deliveries.length > 0 && (
                            <div className="muted">
                              Lịch sử gửi: {rem.deliveries[0].status} ({rem.deliveries[0].channel})
                            </div>
                          )}
                        </td>
                        <td>{date(rem.remind_at)}</td>
                        <td>{rem.channel}</td>
                        <td><Status>{rem.status}</Status></td>
                        <td>
                          <div className="row-actions">
                            {rem.status !== 'acknowledged' && rem.status !== 'cancelled' && (
                              <Button
                                variant="outline"
                                type="button"
                                disabled={busyId === `rem-${rem.id}`}
                                onClick={() => handleAckReminder(rem.id)}
                              >
                                <CheckCircle2 size={14} aria-hidden="true" /> Đã nhận
                              </Button>
                            )}
                            <Button
                              variant="destructive"
                              type="button"
                              disabled={busyId === `rem-${rem.id}`}
                              onClick={() => handleDeleteReminder(rem.id)}
                            >
                              <Trash2 size={14} aria-hidden="true" /> Xóa
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ResourceState>
        </>
      )}

      {activeTab === 'memories' && (
        <>
          <div className="toolbar" style={{ marginBottom: '12px' }}>
            <Button type="button" onClick={() => { setEditingMemory(null); setMemKey(''); setMemValue(''); setMemCategory(''); setMemConsent(false); setMemError(''); setMemDialogOpen(true); }}>
              <Plus size={15} aria-hidden="true" /> Lưu ghi nhớ
            </Button>
            <Button variant="ghost" type="button" onClick={memoriesState.reload}>
              <RefreshCw size={15} aria-hidden="true" /> Tải lại
            </Button>
          </div>
          <label>Tìm thông tin đã ghi nhớ
            <input value={memorySearch} maxLength={200} onChange={(e) => { setMemorySearch(e.target.value); setMemoryPage(1); }} />
          </label>
          <ResourceState state={memoriesState}>
            {memories.length === 0 ? (
              <p className="muted">Chưa có ghi nhớ cá nhân nào được lưu.</p>
            ) : (
              <div className="table-scroll">
                <table aria-label="Danh sách ghi nhớ cá nhân">
                  <thead>
                    <tr>
                      <th>Khóa</th>
                      <th>Nội dung</th>
                      <th>Nhóm</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memories.map((mem) => (
                      <tr key={mem.id}>
                        <td><strong>{mem.memory_key}</strong></td>
                        <td>{mem.memory_value}</td>
                        <td>{mem.category ?? '—'}</td>
                        <td>
                          <Button type="button" variant="outline" onClick={() => {
                            setEditingMemory(mem); setMemKey(mem.memory_key); setMemValue(mem.memory_value);
                            setMemCategory(mem.category ?? ''); setMemConsent(false); setMemError(''); setMemDialogOpen(true);
                          }}>Chỉnh sửa</Button>
                          <Button
                            variant="destructive"
                            type="button"
                            disabled={busyId === `mem-${mem.id}`}
                            onClick={() => handleDeleteMemory(mem.id)}
                          >
                            <Trash2 size={14} aria-hidden="true" /> Xóa
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ResourceState>
          <Pagination data={memoriesState.data} page={memoryPage} setPage={setMemoryPage} />
        </>
      )}

      <Dialog
        open={eventDialogOpen}
        busy={evBusy}
        onOpenChange={(o) => { if (!o && !evBusy) setEventDialogOpen(false); }}
        title='Thêm sự kiện lịch biểu'
      >
        <form className="form-stack" onSubmit={handleCreateEvent}>
          <label>
            Tiêu đề sự kiện
            <input required maxLength={255} value={evTitle} onChange={(e) => setEvTitle(e.target.value)} />
          </label>
          <label>
            Địa điểm (tùy chọn)
            <input maxLength={255} value={evLocation} onChange={(e) => setEvLocation(e.target.value)} />
          </label>
          <label>
            Thời gian bắt đầu
            <input type="datetime-local" required value={evStart} onChange={(e) => setEvStart(e.target.value)} />
          </label>
          <label>
            Thời gian kết thúc (tùy chọn)
            <input type="datetime-local" value={evEnd} onChange={(e) => setEvEnd(e.target.value)} />
          </label>
          <label>
            Mô tả (tùy chọn)
            <textarea rows={2} maxLength={4000} value={evDesc} onChange={(e) => setEvDesc(e.target.value)} />
          </label>
          <Notice error={evError} />
          <div className="form-actions">
            <Button type="button" variant="outline" disabled={evBusy} onClick={() => setEventDialogOpen(false)}>Hủy</Button>
            <Button type="submit" disabled={evBusy}>{evBusy ? 'Đang lưu…' : 'Lưu sự kiện'}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={remDialogOpen}
        busy={remBusy}
        onOpenChange={(o) => { if (!o && !remBusy) setRemDialogOpen(false); }}
        title="Tạo lời nhắc mới"
      >
        <form className="form-stack" onSubmit={handleCreateReminder}>
          <label>
            Nội dung nhắc việc
            <input required maxLength={500} value={remMessage} onChange={(e) => setRemMessage(e.target.value)} />
          </label>
          <label>
            Thời điểm nhắc
            <input type="datetime-local" required value={remAt} onChange={(e) => setRemAt(e.target.value)} />
          </label>
          <label>
            Kênh gửi nhắc
            <select aria-label="Kênh gửi nhắc" value={remChannel} onChange={(e) => setRemChannel(e.target.value as 'VOICE' | 'WEB' | 'BOTH')}>
              <option value="VOICE">VOICE (Robot)</option>
              <option value="WEB">WEB</option>
              <option value="BOTH">BOTH</option>
            </select>
          </label>
          <Notice error={remError} />
          <div className="form-actions">
            <Button type="button" variant="outline" disabled={remBusy} onClick={() => setRemDialogOpen(false)}>Hủy</Button>
            <Button type="submit" disabled={remBusy}>{remBusy ? 'Đang lưu…' : 'Lưu lời nhắc'}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={memDialogOpen}
        busy={memBusy}
        onOpenChange={(o) => { if (!o && !memBusy) setMemDialogOpen(false); }}
        title={editingMemory ? "Cập nhật ghi nhớ cá nhân" : "Lưu ghi nhớ cá nhân"}
      >
        <form className="form-stack" onSubmit={handleCreateMemory}>
          <label>
            Khóa ghi nhớ (memory_key)
            <input required maxLength={120} placeholder="vd: preferred_study_time" value={memKey} onChange={(e) => setMemKey(e.target.value)} />
          </label>
          <label>
            Nội dung ghi nhớ
            <textarea required rows={3} maxLength={4000} value={memValue} onChange={(e) => setMemValue(e.target.value)} />
          </label>
          <label>
            Nhóm (tùy chọn)
            <input maxLength={60} placeholder="vd: habit, preference" value={memCategory} onChange={(e) => setMemCategory(e.target.value)} />
          </label>
          <Notice error={memError} />
          <label><input type="checkbox" required checked={memConsent} onChange={(e) => setMemConsent(e.target.checked)} />Tôi đồng ý lưu thông tin này vào bộ nhớ cá nhân, kể cả thay thế thông tin cùng khóa.</label>
          <div className="form-actions">
            <Button type="button" variant="outline" disabled={memBusy} onClick={() => setMemDialogOpen(false)}>Hủy</Button>
            <Button type="submit" disabled={memBusy}>{memBusy ? 'Đang lưu…' : 'Lưu ghi nhớ'}</Button>
          </div>
        </form>
      </Dialog>
    </Panel>
  );
}
