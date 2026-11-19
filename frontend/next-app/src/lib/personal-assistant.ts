import { z } from 'zod';
import { object, rows, type Row } from './contracts';
import type { Operation } from './operations';

export const DEFAULT_TASK_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export const ALLOWED_TASK_SORT_MODES = ['default', 'priority_desc', 'priority_asc'] as const;
export type TaskSortMode = (typeof ALLOWED_TASK_SORT_MODES)[number];

const bigintId = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);

const isoDateTimeString = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Thời hạn (due_at) phải là ngày giờ hợp lệ.',
  });

/**
 * Explicit BFF allowlist for Personal Assistant PA-10, PA-11, and PA-12 operations.
 * Kept in a dedicated registry and resolved by resolveOperation() so existing
 * OpenAPI audit scripts can inspect either baseline operations or PA operations.
 */
export const personalAssistantOperations: Record<string, Operation> = {
  personalTasks: {
    method: 'GET',
    role: 'USER',
    path: '/user/tasks',
    query: ['page', 'limit', 'search', 'status', 'priority', 'sort_by', 'plan_id', 'parent_task_id'],
  },
  personalTaskDetail: {
    method: 'GET',
    role: 'USER',
    path: '/user/tasks/:id',
  },
  personalTaskCreate: {
    method: 'POST',
    role: 'USER',
    path: '/user/tasks',
    fields: ['title', 'description', 'due_at', 'priority', 'plan_id', 'event_id', 'parent_task_id', 'session_number'],
  },
  personalTaskUpdate: {
    method: 'PATCH',
    role: 'USER',
    path: '/user/tasks/:id',
    fields: [
      'title',
      'description',
      'due_at',
      'priority',
      'plan_id',
      'session_number',
      'expected_updated_at',
      'status',
      'progress_percent',
      'event_id',
      'parent_task_id',
    ],
  },
  personalTaskPriority: {
    method: 'PATCH',
    role: 'USER',
    path: '/user/tasks/:id/priority',
    fields: [
      'priority',
      'expected_updated_at',
      'title',
      'description',
      'due_at',
      'plan_id',
      'session_number',
    ],
  },
  personalTaskComplete: {
    method: 'POST',
    role: 'USER',
    path: '/user/tasks/:id/complete',
    fields: ['expected_updated_at'],
  },
  personalTaskReopen: {
    method: 'POST',
    role: 'USER',
    path: '/user/tasks/:id/reopen',
    fields: ['status', 'progress_percent', 'expected_updated_at'],
  },
  personalTaskCancel: {
    method: 'POST',
    role: 'USER',
    path: '/user/tasks/:id/cancel',
    fields: ['reason', 'expected_updated_at'],
  },
  personalTaskDelete: {
    method: 'DELETE',
    role: 'USER',
    path: '/user/tasks/:id',
  },
  personalTaskResolve: {
    method: 'POST',
    role: 'USER',
    path: '/user/tasks/resolve',
    fields: ['reference'],
  },
  personalPlans: {
    method: 'GET',
    role: 'USER',
    path: '/user/plans',
    query: ['page', 'limit', 'status'],
  },
  personalPlanDetail: {
    method: 'GET',
    role: 'USER',
    path: '/user/plans/:id',
  },
  personalPlanCreate: {
    method: 'POST',
    role: 'USER',
    path: '/user/plans',
    fields: ['title', 'description', 'goal', 'total_sessions', 'start_date', 'end_date', 'sessions', 'confirmed'],
  },
  personalPlanSessionComplete: {
    method: 'POST',
    role: 'USER',
    path: '/user/plans/:id/sessions/:sessionId/complete',
    fields: ['expected_updated_at'],
  },
  personalEvents: {
    method: 'GET',
    role: 'USER',
    path: '/user/events',
    query: ['page', 'limit', 'search', 'status', 'plan_id', 'from', 'to'],
  },
  personalEventDetail: {
    method: 'GET',
    role: 'USER',
    path: '/user/events/:id',
  },
  personalEventCreate: {
    method: 'POST',
    role: 'USER',
    path: '/user/events',
    fields: ['title', 'description', 'location', 'start_at', 'end_at', 'plan_id'],
  },
  personalEventUpdate: {
    method: 'PATCH',
    role: 'USER',
    path: '/user/events/:id',
    fields: ['title', 'description', 'location', 'start_at', 'end_at', 'status', 'plan_id'],
  },
  personalEventDelete: {
    method: 'DELETE',
    role: 'USER',
    path: '/user/events/:id',
  },
  personalReminders: {
    method: 'GET',
    role: 'USER',
    path: '/user/reminders',
    query: ['page', 'limit', 'status', 'channel', 'task_id', 'event_id'],
  },
  personalReminderDetail: {
    method: 'GET',
    role: 'USER',
    path: '/user/reminders/:id',
  },
  personalReminderCreate: {
    method: 'POST',
    role: 'USER',
    path: '/user/reminders',
    fields: ['message', 'remind_at', 'channel', 'task_id', 'event_id', 'device_id'],
  },
  personalReminderUpdate: {
    method: 'PATCH',
    role: 'USER',
    path: '/user/reminders/:id',
    fields: ['message', 'remind_at', 'channel', 'status', 'task_id', 'event_id'],
  },
  personalReminderAcknowledge: {
    method: 'POST',
    role: 'USER',
    path: '/user/reminders/:id/acknowledge',
    fields: ['device_id', 'channel'],
  },
  personalReminderDelete: {
    method: 'DELETE',
    role: 'USER',
    path: '/user/reminders/:id',
  },
  personalMemories: {
    method: 'GET',
    role: 'USER',
    path: '/user/memories',
    query: ['page', 'limit', 'search', 'category'],
  },
  personalMemoryDetail: {
    method: 'GET',
    role: 'USER',
    path: '/user/memories/:id',
  },
  personalMemoryCreate: {
    method: 'POST',
    role: 'USER',
    path: '/user/memories',
    fields: ['consent', 'memory_key', 'memory_value', 'category', 'confidence', 'source_conversation_id'],
  },
  personalMemoryUpdate: {
    method: 'PATCH',
    role: 'USER',
    path: '/user/memories/:id',
    fields: ['consent', 'memory_key', 'memory_value', 'category', 'confidence', 'expected_revision'],
  },
  personalMemoryDelete: {
    method: 'DELETE',
    role: 'USER',
    path: '/user/memories/:id',
  },
};

export type PersonalTask = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  progress_percent: number;
  aggregated_progress_percent: number | null;
  effective_progress_percent: number;
  active_subtask_count: number;
  due_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  plan_id: string | null;
  plan_title: string | null;
  event_id: string | null;
  event_title: string | null;
  parent_task_id: string | null;
  parent_task_title: string | null;
  session_number: number | null;
  subtask_count: number;
  subtasks?: PersonalTask[];
  can_cancel: boolean;
  can_delete: boolean;
  created_at: string | null;
  updated_at: string | null;
  raw: Row;
};

export type TaskListMeta = {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
};

export type HierarchicalTaskItem = {
  task: PersonalTask;
  depth: number;
  hasDetachedParent: boolean;
};

export type PersonalPlanSession = {
  id: string;
  session_number: number;
  title: string;
  status: string;
  progress_percent: number;
  completed_at: string | null;
  updated_at: string | null;
  is_completed: boolean;
  is_partial: boolean;
};

export type PersonalPlanProgress = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  completed_sessions: number;
  total_sessions: number;
  remaining_sessions: number;
  progress_percent: number;
  sessions: PersonalPlanSession[];
  updated_at: string | null;
};

export type TaskProgressSummary = {
  completed_tasks: number;
  pending_tasks: number;
  cancelled_tasks: number;
  total_tasks: number;
  completion_percent: number;
};

export type PersonalEvent = {
  id: string;
  plan_id: string | null;
  plan_title: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  status: string;
  has_conflict: boolean;
  conflicting_event_ids: string[];
};

export type ReminderDelivery = {
  id: string;
  reminder_id: string;
  device_id: string | null;
  channel: string;
  status: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
  error_message: string | null;
};

export type PersonalReminder = {
  id: string;
  task_id: string | null;
  task_title: string | null;
  event_id: string | null;
  event_title: string | null;
  remind_at: string;
  message: string;
  channel: string;
  status: string;
  deliveries: ReminderDelivery[];
};

export type PersonalMemory = {
  revision: string | null;
  id: string;
  memory_key: string;
  memory_value: string;
  category: string | null;
  confidence: number | null;
  source_conversation_id: string | null;
  updated_at: string | null;
};

const createTaskSchema = z
  .object({
    event_id: bigintId.nullable().optional(),
    parent_task_id: bigintId.nullable().optional(),
    title: z.string().trim().min(1, 'Tiêu đề công việc không được để trống.').max(500),
    description: z.string().trim().max(4000).optional(),
    due_at: isoDateTimeString.optional(),
    priority: z.string().trim().min(1).max(64).optional(),
    plan_id: bigintId.optional(),
    session_number: z.number().int().min(1).max(10000).optional(),
  })
  .strict();

const updateTaskSchema = z
  .object({
    event_id: bigintId.nullable().optional(),
    parent_task_id: bigintId.nullable().optional(),
    status: z.enum(['pending', 'in_progress', 'partial']).optional(),
    progress_percent: z.number().int().min(0).max(99).optional(),
    title: z.string().trim().min(1, 'Tiêu đề công việc không được để trống.').max(500).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    due_at: isoDateTimeString.nullable().optional(),
    priority: z.string().trim().min(1).max(64).optional(),
    plan_id: bigintId.nullable().optional(),
    session_number: z.number().int().min(1).max(10000).nullable().optional(),
    expected_updated_at: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
  .refine(
    (val) =>
      val.event_id !== undefined ||
      val.parent_task_id !== undefined ||
      val.status !== undefined ||
      val.progress_percent !== undefined ||
      val.title !== undefined ||
      val.description !== undefined ||
      val.due_at !== undefined ||
      val.priority !== undefined ||
      val.plan_id !== undefined ||
      val.session_number !== undefined,
    { message: 'Cần ít nhất một thông tin cập nhật công việc.' }
  );

const updatePrioritySchema = z
  .object({
    priority: z.string().trim().min(1, 'Mức độ ưu tiên không được để trống.').max(64),
    expected_updated_at: z.string().trim().min(1).max(64).optional(),
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    due_at: isoDateTimeString.nullable().optional(),
    plan_id: bigintId.nullable().optional(),
    session_number: z.number().int().min(1).max(10000).nullable().optional(),
  })
  .strict();

const completeActionSchema = z
  .object({
    expected_updated_at: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const reopenTaskSchema = z
  .object({
    status: z.enum(['pending', 'in_progress']).optional(),
    progress_percent: z.number().int().min(0).max(99).optional(),
    expected_updated_at: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const cancelTaskSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
    expected_updated_at: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

const createPlanSchema = z
  .object({
    confirmed: z.boolean().optional(),
    sessions: z.array(z.object({
      session_number: z.number().int().min(1).max(365).optional(),
      title: z.string().trim().min(1).max(500),
      description: z.string().trim().max(4000).nullable().optional(),
      due_at: isoDateTimeString.nullable().optional(),
      priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
    }).strict()).max(365).optional(),
    title: z.string().trim().min(1, 'Tiêu đề kế hoạch không được để trống.').max(255),
    description: z.string().trim().max(4000).optional(),
    goal: z.string().trim().max(500).optional(),
    total_sessions: z.number().int().min(1).max(365),
    start_date: z.string().trim().max(32).optional(),
    end_date: z.string().trim().max(32).optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.sessions === undefined) return;
    if (plan.confirmed !== true) context.addIssue({ code: 'custom', message: 'Cần xác nhận kế hoạch trước khi lưu.' });
    if (!plan.goal?.trim()) context.addIssue({ code: 'custom', message: 'Mục tiêu không được để trống.' });
    if (plan.sessions.length !== plan.total_sessions || !plan.sessions.length) {
      context.addIssue({ code: 'custom', message: 'Số bước phải khớp tổng số buổi và lớn hơn 0.' });
    }
    const numbers = plan.sessions.map((step, index) => step.session_number ?? index + 1);
    if (new Set(numbers).size !== numbers.length || numbers.some(number => number > plan.total_sessions)) {
      context.addIssue({ code: 'custom', message: 'Số thứ tự bước không hợp lệ hoặc bị trùng.' });
    }
  });

const createEventSchema = z
  .object({
    title: z.string().trim().min(1, 'Tiêu đề sự kiện không được để trống.').max(255),
    description: z.string().trim().max(4000).nullable().optional(),
    location: z.string().trim().max(255).nullable().optional(),
    start_at: isoDateTimeString,
    end_at: isoDateTimeString.nullable().optional(),
    plan_id: bigintId.nullable().optional(),
  })
  .strict();

const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    location: z.string().trim().max(255).nullable().optional(),
    start_at: isoDateTimeString.optional(),
    end_at: isoDateTimeString.nullable().optional(),
    status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
    plan_id: bigintId.nullable().optional(),
  })
  .strict();

const createReminderSchema = z
  .object({
    message: z.string().trim().min(1, 'Nội dung nhắc việc không được để trống.').max(500),
    remind_at: isoDateTimeString,
    channel: z.enum(['VOICE', 'WEB', 'BOTH']).optional(),
    task_id: bigintId.nullable().optional(),
    event_id: bigintId.nullable().optional(),
    device_id: bigintId.nullable().optional(),
  })
  .strict();

const updateReminderSchema = z
  .object({
    message: z.string().trim().min(1).max(500).optional(),
    remind_at: isoDateTimeString.optional(),
    channel: z.enum(['VOICE', 'WEB', 'BOTH']).optional(),
    status: z.enum(['pending', 'delivered', 'acknowledged', 'cancelled']).optional(),
    task_id: bigintId.nullable().optional(),
    event_id: bigintId.nullable().optional(),
  })
  .strict();

const acknowledgeReminderSchema = z
  .object({
    device_id: bigintId.nullable().optional(),
    channel: z.enum(['VOICE', 'WEB', 'BOTH']).optional(),
  })
  .strict();

const createMemorySchema = z
  .object({
    consent: z.literal(true, { error: 'Cần đồng ý lưu ghi nhớ cá nhân.' }),
    memory_key: z.string().trim().min(1, 'Khóa ghi nhớ không được để trống.').max(120),
    memory_value: z.string().trim().min(1, 'Nội dung ghi nhớ không được để trống.').max(4000),
    category: z.string().trim().max(60).nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    source_conversation_id: bigintId.nullable().optional(),
  })
  .strict();

const updateMemorySchema = z
  .object({
    expected_revision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    consent: z.literal(true, { error: 'Cần đồng ý lưu ghi nhớ cá nhân.' }),
    memory_key: z.string().trim().min(1).max(120).optional(),
    memory_value: z.string().trim().min(1).max(4000).optional(),
    category: z.string().trim().max(60).nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

export function validatePersonalAssistantBody(
  operation: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  if (operation === 'personalTaskCreate') {
    return createTaskSchema.parse(body);
  }
  if (operation === 'personalTaskUpdate') {
    return updateTaskSchema.parse(body);
  }
  if (operation === 'personalTaskPriority') {
    return updatePrioritySchema.parse(body);
  }
  if (operation === 'personalTaskComplete' || operation === 'personalPlanSessionComplete') {
    return completeActionSchema.parse(body);
  }
  if (operation === 'personalTaskReopen') {
    return reopenTaskSchema.parse(body);
  }
  if (operation === 'personalTaskCancel') {
    return cancelTaskSchema.parse(body);
  }
  if (operation === 'personalPlanCreate') {
    return createPlanSchema.parse(body);
  }
  if (operation === 'personalEventCreate') {
    return createEventSchema.parse(body);
  }
  if (operation === 'personalEventUpdate') {
    return updateEventSchema.parse(body);
  }
  if (operation === 'personalReminderCreate') {
    return createReminderSchema.parse(body);
  }
  if (operation === 'personalReminderUpdate') {
    return updateReminderSchema.parse(body);
  }
  if (operation === 'personalReminderAcknowledge') {
    return acknowledgeReminderSchema.parse(body);
  }
  if (operation === 'personalMemoryCreate') {
    return createMemorySchema.parse(body);
  }
  if (operation === 'personalMemoryUpdate') {
    return updateMemorySchema.parse(body);
  }
  return body;
}

export function normalizeDueAtInput(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Thời hạn không hợp lệ. Vui lòng kiểm tra lại ngày giờ.');
  }
  return parsed.toISOString();
}

export function isTaskCompleted(status: unknown): boolean {
  return typeof status === 'string' && status.trim().toLowerCase() === 'completed';
}

export function isTaskCancelled(status: unknown): boolean {
  return (
    typeof status === 'string' &&
    /^(cancelled|canceled)$/i.test(status.trim())
  );
}

/**
 * PA-12 rule: Partially completed sessions ('in_progress', 'partial', 'partially_completed', etc.)
 * must NEVER be automatically marked or counted as completed.
 */
export function isSessionCompleted(session: Row): boolean {
  const status = typeof session.status === 'string' ? session.status.trim().toLowerCase() : '';
  return status === 'completed';
}

export function isSessionPartial(session: Row): boolean {
  const status = typeof session.status === 'string' ? session.status.trim().toLowerCase() : '';
  if (status === 'completed') return false;
  if (/^(partial|partially_completed|in_progress)$/i.test(status)) return true;
  const progress = Number(session.progress_percent ?? session.progressPercent ?? 0);
  return Number.isFinite(progress) && progress > 0 && progress < 100;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

export function parsePersonalTask(row: Row): PersonalTask {
  const id = String(row.id ?? row.task_id ?? '');
  const title = strOrNull(row.title ?? row.name) ?? 'Công việc chưa đặt tên';
  const description = strOrNull(row.description ?? row.note ?? row.details);
  const status = strOrNull(row.status) ?? 'pending';
  const priority = strOrNull(row.priority ?? row.priority_level ?? row.priorityLevel);
  const dueAt = strOrNull(row.due_at ?? row.dueAt ?? row.deadline);
  const completedAt = strOrNull(row.completed_at ?? row.completedAt);
  const cancelledAt = strOrNull(row.cancelled_at ?? row.cancelledAt);
  const planObj =
    row.plan && typeof row.plan === 'object' && !Array.isArray(row.plan)
      ? (row.plan as Row)
      : undefined;
  const planId =
    row.plan_id !== undefined && row.plan_id !== null
      ? String(row.plan_id)
      : row.planId !== undefined && row.planId !== null
        ? String(row.planId)
        : planObj?.id !== undefined && planObj?.id !== null
          ? String(planObj.id)
          : null;
  const planTitle =
    strOrNull(row.plan_title ?? row.planTitle) ??
    (planObj ? strOrNull(planObj.title ?? planObj.name) : null);
  const eventId =
    row.event_id !== undefined && row.event_id !== null
      ? String(row.event_id)
      : row.eventId !== undefined && row.eventId !== null
        ? String(row.eventId)
        : null;
  const eventTitle = strOrNull(row.event_title ?? row.eventTitle);
  const parentTaskId =
    row.parent_task_id !== undefined && row.parent_task_id !== null
      ? String(row.parent_task_id)
      : row.parentTaskId !== undefined && row.parentTaskId !== null
        ? String(row.parentTaskId)
        : null;
  const parentTaskTitle = strOrNull(row.parent_task_title ?? row.parentTaskTitle);
  const sessionNumber = numOrNull(row.session_number ?? row.sessionNumber);
  const completed = isTaskCompleted(status);
  const cancelled = isTaskCancelled(status);
  const rawProgress = numOrNull(row.progress_percent ?? row.progressPercent);
  const progressPercent =
    rawProgress !== null ? Math.min(100, Math.max(0, rawProgress)) : completed ? 100 : 0;
  const parsedSubtasks = Array.isArray(row.subtasks)
    ? (row.subtasks as unknown[])
        .filter((item): item is Row => !!item && typeof item === 'object' && !Array.isArray(item))
        .map(parsePersonalTask)
    : undefined;
  const subtaskCount =
    numOrNull(row.subtask_count ?? row.subtaskCount) ?? (parsedSubtasks ? parsedSubtasks.length : 0);
  const rawAggregated = row.aggregated_progress_percent ?? row.aggregatedProgressPercent;
  const parsedAggregated = numOrNull(rawAggregated);
  const aggregatedProgressPercent =
    rawAggregated === null || rawAggregated === undefined || parsedAggregated === null
      ? null
      : Math.min(100, Math.max(0, parsedAggregated));
  const activeSubtaskCount =
    numOrNull(row.active_subtask_count ?? row.activeSubtaskCount) ??
    (parsedSubtasks ? parsedSubtasks.filter((s) => !isTaskCancelled(s.status)).length : 0);
  const effectiveProgressPercent =
    aggregatedProgressPercent !== null ? aggregatedProgressPercent : progressPercent;
  const canCancel =
    typeof row.can_cancel === 'boolean'
      ? row.can_cancel
      : typeof row.canCancel === 'boolean'
        ? row.canCancel
        : !completed && !cancelled;
  const canDelete =
    typeof row.can_delete === 'boolean'
      ? row.can_delete
      : typeof row.canDelete === 'boolean'
        ? row.canDelete
        : true;

  return {
    id,
    title,
    description,
    status,
    priority,
    progress_percent: progressPercent,
    aggregated_progress_percent: aggregatedProgressPercent,
    effective_progress_percent: effectiveProgressPercent,
    active_subtask_count: activeSubtaskCount,
    due_at: dueAt,
    completed_at: completedAt,
    cancelled_at: cancelledAt,
    plan_id: planId,
    plan_title: planTitle,
    event_id: eventId,
    event_title: eventTitle,
    parent_task_id: parentTaskId,
    parent_task_title: parentTaskTitle,
    session_number: sessionNumber,
    subtask_count: subtaskCount,
    ...(parsedSubtasks ? { subtasks: parsedSubtasks } : {}),
    can_cancel: canCancel,
    can_delete: canDelete,
    created_at: strOrNull(row.created_at ?? row.createdAt),
    updated_at: strOrNull(row.updated_at ?? row.updatedAt),
    raw: row,
  };
}

export function getDisplayTaskProgress(
  task: Pick<PersonalTask, 'progress_percent' | 'aggregated_progress_percent'>
): number {
  return task.aggregated_progress_percent !== null &&
    task.aggregated_progress_percent !== undefined
    ? task.aggregated_progress_percent
    : task.progress_percent;
}

/**
 * PA-10 & PA-11: Preserves exact Backend ordering. Does not invent client-side priority sorting.
 */
export function parsePersonalTasks(data: unknown): PersonalTask[] {
  if (data === null || data === undefined) return [];
  const rawRows = rows(data);
  return rawRows.map(parsePersonalTask);
}

export function parseTaskListMeta(data: unknown, fallbackCount = 0): TaskListMeta {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const page = Math.max(1, numOrNull(obj.page) ?? 1);
    const limit = Math.max(1, numOrNull(obj.limit) ?? 20);
    const total = Math.max(0, numOrNull(obj.total) ?? fallbackCount);
    const totalPages = Math.max(
      1,
      numOrNull(obj.total_pages ?? obj.totalPages) ?? Math.ceil(total / limit)
    );
    return { page, limit, total, total_pages: totalPages };
  }
  return {
    page: 1,
    limit: 20,
    total: fallbackCount,
    total_pages: Math.max(1, Math.ceil(fallbackCount / 20)),
  };
}

/**
 * Organizes tasks into a deterministic parent -> child hierarchy while preserving
 * the authoritative Backend order among siblings and never hiding orphaned children.
 */
export function organizeTasksForDisplay(tasks: PersonalTask[]): HierarchicalTaskItem[] {
  const byId = new Map<string, PersonalTask>();
  for (const t of tasks) {
    byId.set(t.id, t);
  }
  const childrenByParent = new Map<string, PersonalTask[]>();
  const roots: PersonalTask[] = [];

  for (const t of tasks) {
    if (t.parent_task_id && t.parent_task_id !== t.id && byId.has(t.parent_task_id)) {
      const bucket = childrenByParent.get(t.parent_task_id) ?? [];
      bucket.push(t);
      childrenByParent.set(t.parent_task_id, bucket);
    } else {
      roots.push(t);
    }
  }

  const ordered: HierarchicalTaskItem[] = [];
  const visited = new Set<string>();

  function visit(task: PersonalTask, depth: number, hasDetachedParent: boolean) {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    ordered.push({ task, depth, hasDetachedParent });
    const children = childrenByParent.get(task.id) ?? [];
    for (const child of children) {
      visit(child, Math.min(depth + 1, 4), false);
    }
  }

  for (const root of roots) {
    visit(root, 0, Boolean(root.parent_task_id && !byId.has(root.parent_task_id)));
  }
  for (const t of tasks) {
    if (!visited.has(t.id)) {
      visit(t, 0, Boolean(t.parent_task_id));
    }
  }
  return ordered;
}

/**
 * Extracts authoritative priority values from Backend metadata or existing Backend task records
 * without inventing unconfirmed priority levels.
 */
export function extractAvailablePriorities(
  data: unknown,
  tasks: PersonalTask[] = []
): string[] {
  const result: string[] = [];
  const pushUnique = (value: unknown) => {
    if (typeof value === 'string' && value.trim() && !result.includes(value.trim())) {
      result.push(value.trim());
    }
  };

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const meta =
      obj.meta && typeof obj.meta === 'object' && !Array.isArray(obj.meta)
        ? (obj.meta as Record<string, unknown>)
        : undefined;
    const candidates = [
      obj.allowed_priorities,
      obj.allowedPriorities,
      obj.available_priorities,
      obj.priority_levels,
      meta?.allowed_priorities,
      meta?.allowedPriorities,
    ];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        candidate.forEach(pushUnique);
      }
    }
  }

  for (const task of tasks) {
    if (Array.isArray(task.raw.allowed_priorities)) {
      (task.raw.allowed_priorities as unknown[]).forEach(pushUnique);
    }
    pushUnique(task.priority);
  }

  return result;
}

/**
 * PA-11: Builds a priority update payload that preserves all existing task fields
 * so updating priority never loses task information, and validates against allowed priorities.
 */
export function buildPriorityUpdatePayload(
  task: PersonalTask,
  nextPriority: string,
  allowedPriorities: string[] = []
): Record<string, unknown> {
  const trimmed = nextPriority.trim();
  if (!trimmed) {
    throw new Error('Mức độ ưu tiên không được để trống.');
  }
  if (allowedPriorities.length > 0 && !allowedPriorities.includes(trimmed)) {
    throw new Error(
      `Mức độ ưu tiên "${trimmed}" không hợp lệ theo quy tắc hệ thống (${allowedPriorities.join(', ')}).`
    );
  }
  const payload: Record<string, unknown> = {
    priority: trimmed,
    title: task.title,
    description: task.description,
    due_at: task.due_at,
    plan_id: task.plan_id,
    session_number: task.session_number,
  };
  if (task.updated_at) {
    payload.expected_updated_at = task.updated_at;
  }
  return validatePersonalAssistantBody('personalTaskPriority', payload);
}

/**
 * PA-12: Computes completed vs. pending task summary from authoritative Backend data.
 * Partially completed or in-progress tasks remain pending until Backend confirms status === 'completed'.
 */
export function computeTaskProgressSummary(
  data: unknown,
  tasks: PersonalTask[]
): TaskProgressSummary {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const summaryObj =
      obj.summary && typeof obj.summary === 'object' && !Array.isArray(obj.summary)
        ? (obj.summary as Record<string, unknown>)
        : obj;
    const completed = numOrNull(summaryObj.completed_tasks ?? summaryObj.completedTasks);
    const pending = numOrNull(summaryObj.pending_tasks ?? summaryObj.pendingTasks);
    const cancelled = numOrNull(summaryObj.cancelled_tasks ?? summaryObj.cancelledTasks) ?? 0;
    const total = numOrNull(summaryObj.total_tasks ?? summaryObj.totalTasks);

    if (completed !== null && pending !== null) {
      const effectiveTotal = total !== null ? total : completed + pending + cancelled;
      const activeTotal = completed + pending;
      const percent = activeTotal > 0 ? Math.round((completed / activeTotal) * 100) : 0;
      return {
        completed_tasks: completed,
        pending_tasks: pending,
        cancelled_tasks: cancelled,
        total_tasks: effectiveTotal,
        completion_percent: percent,
      };
    }
  }

  let completed = 0;
  let pending = 0;
  let cancelled = 0;
  for (const t of tasks) {
    if (isTaskCompleted(t.status)) {
      completed += 1;
    } else if (isTaskCancelled(t.status)) {
      cancelled += 1;
    } else {
      pending += 1;
    }
  }
  const activeTotal = completed + pending;
  const percent = activeTotal > 0 ? Math.round((completed / activeTotal) * 100) : 0;
  return {
    completed_tasks: completed,
    pending_tasks: pending,
    cancelled_tasks: cancelled,
    total_tasks: tasks.length,
    completion_percent: percent,
  };
}

/**
 * PA-12: Parses a multi-session personal plan and calculates session progress strictly
 * from authoritative Backend data. Partially completed sessions are NEVER counted as completed.
 */
export function parsePersonalPlan(row: Row): PersonalPlanProgress {
  const id = String(row.id ?? row.plan_id ?? '');
  const title = strOrNull(row.title ?? row.name) ?? 'Kế hoạch cá nhân';
  const description = strOrNull(row.description ?? row.note);
  const status = strOrNull(row.status) ?? 'active';

  const rawSessions = Array.isArray(row.sessions)
    ? (row.sessions as unknown[]).filter(
        (s): s is Row => !!s && typeof s === 'object' && !Array.isArray(s)
      )
    : [];

  const sessions: PersonalPlanSession[] = rawSessions.map((s, idx) => {
    const completed = isSessionCompleted(s);
    const partial = isSessionPartial(s);
    const sessionProgress = numOrNull(s.progress_percent ?? s.progressPercent);
    return {
      id: String(s.id ?? s.session_id ?? idx + 1),
      session_number: numOrNull(s.session_number ?? s.sessionNumber) ?? idx + 1,
      title: strOrNull(s.title ?? s.name) ?? `Buổi ${idx + 1}`,
      status: strOrNull(s.status) ?? 'pending',
      progress_percent:
        sessionProgress !== null
          ? Math.min(100, Math.max(0, Math.round(sessionProgress)))
          : completed
            ? 100
            : 0,
      completed_at: strOrNull(s.completed_at ?? s.completedAt),
      updated_at: strOrNull(s.updated_at ?? s.updatedAt),
      is_completed: completed,
      is_partial: partial,
    };
  });

  const completedFromSessions = sessions.filter((s) => s.is_completed).length;
  const explicitTotal = numOrNull(row.total_sessions ?? row.totalSessions);
  const explicitCompleted = numOrNull(row.completed_sessions ?? row.completedSessions);

  const totalSessions = Math.max(0, explicitTotal ?? sessions.length);
  const completedSessions = Math.min(
    totalSessions,
    Math.max(
      0,
      sessions.length > 0 && explicitCompleted === null
        ? completedFromSessions
        : explicitCompleted ?? completedFromSessions
    )
  );

  const explicitRemaining = numOrNull(row.remaining_sessions ?? row.remainingSessions);
  const remainingSessions =
    explicitRemaining !== null
      ? Math.max(0, explicitRemaining)
      : Math.max(0, totalSessions - completedSessions);

  const explicitPercent = numOrNull(row.progress_percent ?? row.progressPercent);
  const progressPercent =
    explicitPercent !== null
      ? Math.min(100, Math.max(0, explicitPercent))
      : totalSessions > 0
        ? Math.round((completedSessions / totalSessions) * 100)
        : 0;

  return {
    id,
    title,
    description,
    status,
    completed_sessions: completedSessions,
    total_sessions: totalSessions,
    remaining_sessions: remainingSessions,
    progress_percent: progressPercent,
    sessions,
    updated_at: strOrNull(row.updated_at ?? row.updatedAt),
  };
}

export function parsePersonalPlans(data: unknown): PersonalPlanProgress[] {
  if (data === null || data === undefined) return [];
  if (
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Array.isArray((data as Record<string, unknown>).plans)
  ) {
    return rows((data as Record<string, unknown>).plans).map(parsePersonalPlan);
  }
  const rawRows = rows(data);
  return rawRows.map(parsePersonalPlan);
}

/**
 * Formats multi-session plan progress matching the PA-12 specification:
 * - Completed: 3/10 sessions.
 * - Progress: 30%.
 * - Remaining: 7 sessions.
 */
export function formatPlanProgressSummary(plan: Pick<
  PersonalPlanProgress,
  'completed_sessions' | 'total_sessions' | 'remaining_sessions' | 'progress_percent'
>) {
  return {
    completedText: `Completed: ${plan.completed_sessions}/${plan.total_sessions} sessions.`,
    progressText: `Progress: ${plan.progress_percent}%.`,
    remainingText: `Remaining: ${plan.remaining_sessions} sessions.`,
    viCompletedText: `Hoàn thành: ${plan.completed_sessions}/${plan.total_sessions} buổi`,
    viProgressText: `Tiến độ: ${plan.progress_percent}%`,
    viRemainingText: `Còn lại: ${plan.remaining_sessions} buổi`,
  };
}

export function isMissingBackendEndpointError(error?: string): boolean {
  if (!error) return false;
  return /cannot (get|post|patch|put|delete)|not found|404|chưa hỗ trợ|chưa được triển khai/i.test(
    error
  );
}

export function isPriorityConflictOrInvalidError(error?: string): boolean {
  if (!error) return false;
  return /conflict|409|400|422|không hợp lệ|xung đột|đã thay đổi|invalid priority/i.test(error);
}

export function extractTaskDetailRecord(data: unknown): PersonalTask | null {
  if (!data) return null;
  try {
    const obj = object(data);
    if (obj.task && typeof obj.task === 'object' && !Array.isArray(obj.task)) {
      return parsePersonalTask(obj.task as Row);
    }
    return parsePersonalTask(obj);
  } catch {
    return null;
  }
}

export function parsePersonalEvents(data: unknown): PersonalEvent[] {
  if (data === null || data === undefined) return [];
  return rows(data).map((row) => ({
    id: String(row.id),
    plan_id: row.plan_id === null || row.plan_id === undefined ? null : String(row.plan_id),
    plan_title: typeof row.plan_title === 'string' ? row.plan_title : null,
    title: String(row.title ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    location: typeof row.location === 'string' ? row.location : null,
    start_at: String(row.start_at ?? ''),
    end_at: typeof row.end_at === 'string' ? row.end_at : null,
    status: String(row.status ?? 'scheduled'),
    has_conflict: Boolean(row.has_conflict),
    conflicting_event_ids: Array.isArray(row.conflicting_event_ids)
      ? row.conflicting_event_ids.map(String)
      : [],
  }));
}

export function parsePersonalReminders(data: unknown): PersonalReminder[] {
  if (data === null || data === undefined) return [];
  return rows(data).map((row) => ({
    id: String(row.id),
    task_id: row.task_id === null || row.task_id === undefined ? null : String(row.task_id),
    task_title: typeof row.task_title === 'string' ? row.task_title : null,
    event_id: row.event_id === null || row.event_id === undefined ? null : String(row.event_id),
    event_title: typeof row.event_title === 'string' ? row.event_title : null,
    remind_at: String(row.remind_at ?? ''),
    message: String(row.message ?? ''),
    channel: String(row.channel ?? 'VOICE'),
    status: String(row.status ?? 'pending'),
    deliveries: Array.isArray(row.deliveries)
      ? (row.deliveries as Row[]).map((d) => ({
          id: String(d.id),
          reminder_id: String(d.reminder_id ?? row.id),
          device_id: d.device_id === null || d.device_id === undefined ? null : String(d.device_id),
          channel: String(d.channel ?? 'VOICE'),
          status: String(d.status ?? 'pending'),
          delivered_at: typeof d.delivered_at === 'string' ? d.delivered_at : null,
          acknowledged_at: typeof d.acknowledged_at === 'string' ? d.acknowledged_at : null,
          error_message: typeof d.error_message === 'string' ? d.error_message : null,
        }))
      : [],
  }));
}

export function parsePersonalMemories(data: unknown): PersonalMemory[] {
  if (data === null || data === undefined) return [];
  return rows(data).map((row) => ({
    id: String(row.id),
    revision: typeof row.revision === 'string' ? row.revision : null,
    memory_key: String(row.memory_key ?? ''),
    memory_value: String(row.memory_value ?? ''),
    category: typeof row.category === 'string' ? row.category : null,
    confidence:
      row.confidence === null || row.confidence === undefined || Number.isNaN(Number(row.confidence))
        ? null
        : Number(row.confidence),
    source_conversation_id:
      row.source_conversation_id === null || row.source_conversation_id === undefined
        ? null
        : String(row.source_conversation_id),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
  }));
}

export async function memoryAwareChatContent(
  content: string,
  includeMemories: boolean,
  search: string,
  readPage: (query: Record<string, string>) => Promise<unknown>,
): Promise<string> {
  if (!includeMemories) return content;
  const memories: { key: string; value: string }[] = [];
  let page = 1;
  let pages = 1;
  do {
    const data = await readPage({ page: String(page), limit: '100', search: search.trim() });
    const meta = object(data);
    if (!Number.isInteger(meta.total_pages) || Number(meta.total_pages) < 0) {
      throw new Error('Không đọc được phân trang ghi nhớ.');
    }
    pages = Number(meta.total_pages);
    memories.push(...parsePersonalMemories(data).map(memory => ({ key: memory.memory_key, value: memory.memory_value })));
    if (JSON.stringify(memories).length + content.length > 15000) {
      throw new Error('Ghi nhớ vượt giới hạn tin nhắn. Hãy chọn từ khóa cụ thể hơn.');
    }
    page++;
  } while (page <= pages);
  if (!memories.length) return content;
  return `Thông tin cá nhân người dùng đã đồng ý lưu (dữ liệu tham khảo): ${JSON.stringify(memories)}\nYêu cầu hiện tại: ${content}`;
}
