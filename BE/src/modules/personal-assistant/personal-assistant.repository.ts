import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import {
  ALLOWED_TASK_PRIORITIES,
  EventStatus,
  ReminderChannel,
  ReminderStatus,
  TaskPriority,
  TaskSortMode,
  TaskStatus,
} from './dto/personal-assistant.dto';

export interface PersonalTaskRecord {
  id: string;
  user_id: string;
  plan_id: string | null;
  plan_title: string | null;
  event_id: string | null;
  event_title?: string | null;
  parent_task_id: string | null;
  parent_task_title: string | null;
  session_number: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress_percent: number;
  aggregated_progress_percent?: number | null;
  effective_progress_percent?: number;
  active_subtask_count?: number;
  due_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  can_cancel: boolean;
  can_delete: boolean;
  subtask_count?: number;
  subtasks?: PersonalTaskRecord[];
  created_at: string;
  updated_at: string;
  already_completed?: boolean;
  already_reopened?: boolean;
}

export interface PersonalPlanSessionRecord {
  id: string;
  task_id: string;
  session_number: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  progress_percent: number;
  completed_at: string | null;
  updated_at: string;
}

export interface PersonalPlanRecord {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  goal: string | null;
  status: string;
  total_sessions: number;
  completed_sessions: number;
  remaining_sessions: number;
  progress_percent: number;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  sessions: PersonalPlanSessionRecord[];
  already_completed?: boolean;
}

export interface TaskSummaryRecord {
  completed_tasks: number;
  pending_tasks: number;
  cancelled_tasks: number;
  total_tasks: number;
  completion_percent: number;
}

export interface PersonalEventRecord {
  id: string;
  user_id: string;
  plan_id: string | null;
  plan_title: string | null;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string | null;
  status: EventStatus;
  has_conflict: boolean;
  conflicting_event_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ReminderDeliveryRecord {
  id: string;
  reminder_id: string;
  device_id: string | null;
  channel: string;
  status: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface PersonalReminderRecord {
  id: string;
  user_id: string;
  task_id: string | null;
  task_title: string | null;
  event_id: string | null;
  event_title: string | null;
  remind_at: string;
  message: string;
  channel: ReminderChannel;
  status: ReminderStatus;
  deliveries: ReminderDeliveryRecord[];
  created_at: string;
  updated_at: string;
}

export interface PersonalMemoryRecord {
  revision: string;
  id: string;
  user_id: string;
  memory_key: string;
  memory_value: string;
  category: string | null;
  confidence: number | null;
  source_conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function dateOnlyOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

const TASK_SUBTASK_METRICS_SELECT = `
  (SELECT COUNT(*) FROM personal_tasks st WHERE st.parent_task_id = t.id AND st.user_id = t.user_id AND st.deleted_at IS NULL) AS subtask_count,
  (SELECT COUNT(*) FROM personal_tasks st WHERE st.parent_task_id = t.id AND st.user_id = t.user_id AND st.deleted_at IS NULL AND st.status <> 'cancelled') AS active_subtask_count,
  (SELECT AVG(st.progress_percent) FROM personal_tasks st WHERE st.parent_task_id = t.id AND st.user_id = t.user_id AND st.deleted_at IS NULL AND st.status <> 'cancelled') AS aggregated_progress_percent
`;

function mapTaskRow(row: RowDataPacket): PersonalTaskRecord {
  const status = String(row.status ?? 'pending') as TaskStatus;
  const completed = status === 'completed';
  const cancelled = status === 'cancelled';
  const ownProgress = Number(row.progress_percent ?? (completed ? 100 : 0));
  const rawAgg = row.aggregated_progress_percent;
  const aggregatedProgressPercent =
    rawAgg === undefined || rawAgg === null
      ? null
      : Math.min(100, Math.max(0, Math.round(Number(rawAgg))));
  const effectiveProgressPercent =
    aggregatedProgressPercent !== null ? aggregatedProgressPercent : ownProgress;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    plan_id: row.plan_id === null || row.plan_id === undefined ? null : String(row.plan_id),
    plan_title: row.plan_title ? String(row.plan_title) : null,
    event_id: row.event_id === null || row.event_id === undefined ? null : String(row.event_id),
    event_title: row.event_title ? String(row.event_title) : null,
    parent_task_id:
      row.parent_task_id === null || row.parent_task_id === undefined
        ? null
        : String(row.parent_task_id),
    parent_task_title: row.parent_task_title ? String(row.parent_task_title) : null,
    session_number:
      row.session_number === null || row.session_number === undefined
        ? null
        : Number(row.session_number),
    title: String(row.title),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    status,
    priority: (ALLOWED_TASK_PRIORITIES.includes(row.priority) ? row.priority : 'MEDIUM') as TaskPriority,
    progress_percent: ownProgress,
    aggregated_progress_percent: aggregatedProgressPercent,
    effective_progress_percent: effectiveProgressPercent,
    ...(row.active_subtask_count !== undefined && row.active_subtask_count !== null
      ? { active_subtask_count: Number(row.active_subtask_count) }
      : {}),
    due_at: isoOrNull(row.due_at),
    completed_at: isoOrNull(row.completed_at),
    cancelled_at: isoOrNull(row.cancelled_at),
    cancel_reason:
      row.cancel_reason === null || row.cancel_reason === undefined
        ? null
        : String(row.cancel_reason),
    can_cancel: !completed && !cancelled,
    can_delete: true,
    ...(row.subtask_count !== undefined && row.subtask_count !== null
      ? { subtask_count: Number(row.subtask_count) }
      : {}),
    created_at: isoOrNull(row.created_at) ?? new Date(0).toISOString(),
    updated_at: isoOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

@Injectable()
export class PersonalAssistantRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async withTransaction<T>(work: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async findTaskByIdRaw(
    taskId: string,
    conn?: PoolConnection,
    forUpdate = false
  ): Promise<(PersonalTaskRecord & { deleted_at: string | null }) | null> {
    const executor = conn ?? this.pool;
    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT t.*, p.title AS plan_title, pt.title AS parent_task_title, ev.title AS event_title,
              ${TASK_SUBTASK_METRICS_SELECT}
       FROM personal_tasks t
       LEFT JOIN personal_plans p ON p.id = t.plan_id AND p.deleted_at IS NULL
       LEFT JOIN personal_tasks pt ON pt.id = t.parent_task_id AND pt.deleted_at IS NULL
       LEFT JOIN personal_events ev ON ev.id = t.event_id AND ev.deleted_at IS NULL
       WHERE t.id = ?
       LIMIT 1${lockClause}`,
      [taskId]
    );
    if (!rows[0]) return null;
    return {
      ...mapTaskRow(rows[0]),
      deleted_at: isoOrNull(rows[0].deleted_at),
    };
  }

  async findSubtasksByParentId(
    userId: string,
    parentTaskId: string,
    conn?: PoolConnection
  ): Promise<PersonalTaskRecord[]> {
    const executor = conn ?? this.pool;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT t.*, p.title AS plan_title, pt.title AS parent_task_title, ev.title AS event_title,
              ${TASK_SUBTASK_METRICS_SELECT}
       FROM personal_tasks t
       LEFT JOIN personal_plans p ON p.id = t.plan_id AND p.deleted_at IS NULL
       LEFT JOIN personal_tasks pt ON pt.id = t.parent_task_id AND pt.deleted_at IS NULL
       LEFT JOIN personal_events ev ON ev.id = t.event_id AND ev.deleted_at IS NULL
       WHERE t.parent_task_id = ? AND t.user_id = ? AND t.deleted_at IS NULL
       ORDER BY
         CASE t.status WHEN 'cancelled' THEN 3 WHEN 'completed' THEN 2 ELSE 1 END ASC,
         CASE t.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END ASC,
         t.due_at IS NULL ASC,
         t.due_at ASC,
         t.id DESC`,
      [parentTaskId, userId]
    );
    return rows.map(mapTaskRow);
  }

  async listTasks(
    userId: string,
    filters: {
      page: number;
      limit: number;
      search?: string;
      status?: string;
      priority?: string;
      plan_id?: string;
      parent_task_id?: string;
      sort_by?: TaskSortMode;
    }
  ): Promise<{
    items: PersonalTaskRecord[];
    total: number;
    summary: TaskSummaryRecord;
  }> {
    const where: string[] = ['t.user_id = ?', 't.deleted_at IS NULL'];
    const params: (string | number)[] = [userId];

    if (filters.search?.trim()) {
      where.push('(t.title LIKE ? OR t.description LIKE ?)');
      const like = `%${filters.search.trim()}%`;
      params.push(like, like);
    }
    if (filters.status?.trim()) {
      where.push('t.status = ?');
      params.push(filters.status.trim());
    }
    if (filters.priority?.trim()) {
      where.push('t.priority = ?');
      params.push(filters.priority.trim());
    }
    if (filters.plan_id?.trim()) {
      where.push('t.plan_id = ?');
      params.push(filters.plan_id.trim());
    }
    if (filters.parent_task_id?.trim()) {
      where.push('t.parent_task_id = ?');
      params.push(filters.parent_task_id.trim());
    }

    const whereSql = where.join(' AND ');
    const offset = (filters.page - 1) * filters.limit;

    const orderBySql =
      filters.sort_by === 'priority_desc'
        ? `CASE t.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END ASC,
           CASE t.status WHEN 'cancelled' THEN 3 WHEN 'completed' THEN 2 ELSE 1 END ASC,
           t.due_at IS NULL ASC,
           t.due_at ASC,
           t.id DESC`
        : filters.sort_by === 'priority_asc'
          ? `CASE t.priority WHEN 'LOW' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'HIGH' THEN 3 ELSE 4 END ASC,
             CASE t.status WHEN 'cancelled' THEN 3 WHEN 'completed' THEN 2 ELSE 1 END ASC,
             t.due_at IS NULL ASC,
             t.due_at ASC,
             t.id DESC`
          : `CASE t.status WHEN 'cancelled' THEN 3 WHEN 'completed' THEN 2 ELSE 1 END ASC,
             CASE t.priority WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END ASC,
             t.due_at IS NULL ASC,
             t.due_at ASC,
             t.id DESC`;

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM personal_tasks t WHERE ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT t.*, p.title AS plan_title, pt.title AS parent_task_title, ev.title AS event_title,
              ${TASK_SUBTASK_METRICS_SELECT}
       FROM personal_tasks t
       LEFT JOIN personal_plans p ON p.id = t.plan_id AND p.deleted_at IS NULL
       LEFT JOIN personal_tasks pt ON pt.id = t.parent_task_id AND pt.deleted_at IS NULL
       LEFT JOIN personal_events ev ON ev.id = t.event_id AND ev.deleted_at IS NULL
       WHERE ${whereSql}
       ORDER BY ${orderBySql}
       LIMIT ? OFFSET ?`,
      [...params, filters.limit, offset]
    );

    const summary = await this.getUserTaskSummary(userId);
    return {
      items: rows.map(mapTaskRow),
      total,
      summary,
    };
  }

  async getUserTaskSummary(userId: string, conn?: PoolConnection): Promise<TaskSummaryRecord> {
    const executor = conn ?? this.pool;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_tasks,
         COALESCE(SUM(CASE WHEN status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END), 0) AS pending_tasks,
         COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_tasks,
         COUNT(*) AS total_tasks
       FROM personal_tasks
       WHERE user_id = ? AND deleted_at IS NULL`,
      [userId]
    );
    const completed = Number(rows[0]?.completed_tasks ?? 0);
    const pending = Number(rows[0]?.pending_tasks ?? 0);
    const cancelled = Number(rows[0]?.cancelled_tasks ?? 0);
    const total = Number(rows[0]?.total_tasks ?? 0);
    const activeTotal = completed + pending;
    const completionPercent = activeTotal > 0 ? Math.round((completed / activeTotal) * 100) : 0;

    return {
      completed_tasks: completed,
      pending_tasks: pending,
      cancelled_tasks: cancelled,
      total_tasks: total,
      completion_percent: completionPercent,
    };
  }

  async listIncompleteTasks(userId: string, page: number, limit: number) {
    const where = "t.user_id = ? AND t.deleted_at IS NULL AND t.status IN ('pending', 'in_progress', 'partial')";
    const [counts] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM personal_tasks t WHERE ${where}`, [userId]
    );
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT t.*, p.title AS plan_title, ev.title AS event_title
       FROM personal_tasks t
       LEFT JOIN personal_plans p ON p.id = t.plan_id AND p.deleted_at IS NULL
       LEFT JOIN personal_events ev ON ev.id = t.event_id AND ev.deleted_at IS NULL
       WHERE ${where}
       ORDER BY t.due_at IS NULL, t.due_at, t.id DESC LIMIT ? OFFSET ?`,
      [userId, limit, (page - 1) * limit]
    );
    return { items: rows.map(mapTaskRow), total: Number(counts[0]?.total ?? 0) };
  }

  async getMissedPlanSessions(userId: string, now: Date, conn?: PoolConnection) {
    const [rows] = await (conn ?? this.pool).execute<RowDataPacket[]>(
      `SELECT t.id, t.plan_id, t.session_number, t.status, t.due_at
       FROM personal_tasks t
       JOIN personal_plans p ON p.id = t.plan_id AND p.user_id = t.user_id AND p.deleted_at IS NULL
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.session_number IS NOT NULL
         AND t.due_at < ?
       ORDER BY t.plan_id, t.session_number, t.id`, [userId, now]
    );
    const warnings: { plan_id: string; consecutive_missed_sessions: number; first_missed_task_id: string }[] = [];
    let planId = '', streak = 0, lastSession = 0, firstTaskId = '';
    const flush = () => {
      if (streak >= 3) warnings.push({ plan_id: planId, consecutive_missed_sessions: streak, first_missed_task_id: firstTaskId });
    };
    for (const row of rows) {
      const currentPlan = String(row.plan_id);
      if (currentPlan !== planId) { flush(); planId = currentPlan; streak = 0; lastSession = 0; }
      const session = Number(row.session_number);
      const missed = ['pending', 'in_progress', 'partial'].includes(String(row.status));
      if (!missed || session !== lastSession + 1) { streak = 0; firstTaskId = ''; }
      if (missed) { if (streak === 0) firstTaskId = String(row.id); streak += 1; }
      lastSession = session;
    }
    flush();
    return warnings;
  }

  async getTaskReport(userId: string, start: Date, end: Date) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total_tasks,
              COALESCE(SUM(status = 'completed' AND completed_at < ?), 0) AS completed_tasks,
              COALESCE(SUM(status <> 'completed' OR completed_at >= ? OR completed_at IS NULL), 0) AS incomplete_tasks
       FROM personal_tasks
       WHERE user_id = ? AND deleted_at IS NULL AND status <> 'cancelled'
         AND due_at >= ? AND due_at < ?`, [end, end, userId, start, end]
    );
    const total = Number(rows[0]?.total_tasks ?? 0);
    const completed = Number(rows[0]?.completed_tasks ?? 0);
    return { total_tasks: total, completed_tasks: completed,
      incomplete_tasks: Number(rows[0]?.incomplete_tasks ?? 0),
      completion_percent: total ? Math.round(completed * 100 / total) : 0 };
  }

  async getTaskDeadlines(userId: string, now: Date) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT t.*, p.title AS plan_title, ev.title AS event_title
       FROM personal_tasks t
       LEFT JOIN personal_plans p ON p.id = t.plan_id AND p.deleted_at IS NULL
       LEFT JOIN personal_events ev ON ev.id = t.event_id AND ev.deleted_at IS NULL
       WHERE t.user_id = ? AND t.deleted_at IS NULL
         AND t.status IN ('pending', 'in_progress', 'partial') AND t.due_at IS NOT NULL
         AND t.due_at < DATE_ADD(?, INTERVAL 3 DAY)
       ORDER BY t.due_at, t.id`, [userId, now]
    );
    return rows.map((row) => ({ ...mapTaskRow(row), deadline_state:
      new Date(row.due_at).getTime() < now.getTime() ? 'overdue' :
      new Date(row.due_at).getTime() < now.getTime() + 86400000 ? 'within_1_day' : 'within_3_days' }));
  }

  async sweepTaskAlerts(now: Date): Promise<void> {
    const [users] = await this.pool.execute<RowDataPacket[]>(
      `SELECT DISTINCT user_id FROM personal_tasks WHERE deleted_at IS NULL AND due_at IS NOT NULL
       UNION
       SELECT DISTINCT user_id FROM personal_reminders
       WHERE status = 'pending'
         AND (message LIKE '%[PA-22:%' OR message LIKE '%[PA-15:%')`
    );
    for (const user of users) {
      const userId = String(user.user_id);
      await this.withTransaction(async (conn) => {
        // Serializes reminder creation across Backend instances without changing the schema.
        const [owners] = await conn.execute<RowDataPacket[]>(
          `SELECT id FROM users WHERE id = ? FOR UPDATE`, [userId]
        );
        if (!owners[0]) return;
        const [tasks] = await conn.execute<RowDataPacket[]>(
          `SELECT id, title, due_at FROM personal_tasks
           WHERE user_id = ? AND deleted_at IS NULL
             AND status IN ('pending', 'in_progress', 'partial') AND due_at IS NOT NULL
             AND due_at <= DATE_ADD(?, INTERVAL 3 DAY)`, [userId, now]
        );
        const missedPlans = await this.getMissedPlanSessions(userId, now, conn);
        const activeMisses = new Set(missedPlans.map(item => item.first_missed_task_id));
        const [oldAlerts] = await conn.execute<RowDataPacket[]>(
          `SELECT r.id, r.task_id, r.message, t.status, t.deleted_at, t.due_at
           FROM personal_reminders r LEFT JOIN personal_tasks t ON t.id = r.task_id
           WHERE r.user_id = ? AND r.status = 'pending'
             AND (r.message LIKE '%[PA-22:%' OR r.message LIKE '%[PA-15:%')`, [userId]
        );
        for (const alert of oldAlerts) {
          const message = String(alert.message);
          const active = !alert.deleted_at && ['pending', 'in_progress', 'partial'].includes(String(alert.status));
          const dueMatches = alert.due_at && message.endsWith(`:${new Date(alert.due_at).toISOString()}]`);
          const keep = active && (message.includes('[PA-15:')
            ? activeMisses.has(String(alert.task_id)) : Boolean(dueMatches));
          if (!keep) {
            await conn.execute(`UPDATE personal_reminders SET status = 'cancelled', updated_at = UTC_TIMESTAMP() WHERE id = ?`, [alert.id]);
            await conn.execute(`UPDATE reminder_deliveries SET status = 'cancelled' WHERE reminder_id = ? AND status = 'pending'`, [alert.id]);
          }
        }
        for (const task of tasks) {
          const due = new Date(task.due_at);
          const remaining = due.getTime() - now.getTime();
          const stage = remaining <= 0 ? 'overdue' : remaining <= 86400000 ? '1d' : '3d';
          const message = `Task ${String(task.title).slice(0, 180)}: ${stage} [PA-22:${stage}:${due.toISOString()}]`;
          await this.insertTaskAlertIfAbsent(conn, userId, String(task.id), message, now);
        }
        for (const missed of missedPlans) {
          const message = `Plan ${missed.plan_id}: 3 consecutive sessions missed [PA-15:${missed.first_missed_task_id}]`;
          await this.insertTaskAlertIfAbsent(conn, userId, missed.first_missed_task_id, message, now);
        }
      });
    }
  }

  private async insertTaskAlertIfAbsent(conn: PoolConnection, userId: string, taskId: string,
    message: string, now: Date): Promise<void> {
    const [existing] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM personal_reminders WHERE user_id = ? AND task_id = ? AND message = ? LIMIT 1`,
      [userId, taskId, message]
    );
    if (!existing[0]) await this.insertReminder(conn, {
      user_id: userId, task_id: taskId, event_id: null, remind_at: now,
      message, channel: 'WEB',
    });
  }

  async findPlanByIdRaw(
    planId: string,
    conn?: PoolConnection,
    forUpdate = false
  ): Promise<RowDataPacket | null> {
    const executor = conn ?? this.pool;
    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT * FROM personal_plans WHERE id = ? LIMIT 1${lockClause}`,
      [planId]
    );
    return rows[0] ?? null;
  }

  async findSessionTaskByPlanAndNumber(
    planId: string,
    sessionNumber: number,
    conn?: PoolConnection,
    forUpdate = false
  ): Promise<PersonalTaskRecord | null> {
    const executor = conn ?? this.pool;
    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT t.*, p.title AS plan_title
       FROM personal_tasks t
       LEFT JOIN personal_plans p ON p.id = t.plan_id AND p.deleted_at IS NULL
       WHERE t.plan_id = ? AND t.session_number = ? AND t.deleted_at IS NULL
       ORDER BY t.id ASC
       LIMIT 1${lockClause}`,
      [planId, sessionNumber]
    );
    return rows[0] ? mapTaskRow(rows[0]) : null;
  }

  async insertTask(
    conn: PoolConnection,
    input: {
      user_id: string;
      plan_id: string | null;
      session_number: number | null;
      title: string;
      description: string | null;
      status: TaskStatus;
      priority: TaskPriority;
      progress_percent: number;
      due_at: Date | null;
      completed_at?: Date | null;
      event_id?: string | null;
      parent_task_id?: string | null;
    }
  ): Promise<PersonalTaskRecord> {
    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO personal_tasks
        (user_id, plan_id, session_number, title, description, status, priority, progress_percent, due_at, completed_at, event_id, parent_task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        input.user_id,
        input.plan_id,
        input.session_number,
        input.title,
        input.description,
        input.status,
        input.priority,
        input.progress_percent,
        input.due_at,
        input.completed_at ?? null,
        input.event_id ?? null,
        input.parent_task_id ?? null,
      ]
    );
    const created = await this.findTaskByIdRaw(String(res.insertId), conn);
    if (!created) throw new Error('Created task could not be reloaded');
    const { deleted_at: _deleted, ...publicTask } = created;
    void _deleted;
    return publicTask;
  }

  async updateTaskFields(
    conn: PoolConnection,
    taskId: string,
    fields: {
      event_id: string | null;
      parent_task_id: string | null;
      title: string;
      description: string | null;
      due_at: Date | null;
      priority: TaskPriority;
      status: TaskStatus;
      progress_percent: number;
      plan_id: string | null;
      session_number: number | null;
    }
  ): Promise<PersonalTaskRecord> {
    await conn.execute(
      `UPDATE personal_tasks
       SET title = ?,
           description = ?,
           due_at = ?,
           priority = ?,
           status = ?,
           progress_percent = ?,
           plan_id = ?,
           session_number = ?,
           event_id = ?,
           parent_task_id = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [
        fields.title,
        fields.description,
        fields.due_at,
        fields.priority,
        fields.status,
        fields.progress_percent,
        fields.plan_id,
        fields.session_number,
        fields.event_id ?? null,
        fields.parent_task_id ?? null,
        taskId,
      ]
    );
    const updated = await this.findTaskByIdRaw(taskId, conn);
    if (!updated) throw new Error('Updated task could not be reloaded');
    const { deleted_at: _deleted, ...publicTask } = updated;
    void _deleted;
    return publicTask;
  }

  async updateTaskPriorityOnly(
    conn: PoolConnection,
    taskId: string,
    priority: TaskPriority
  ): Promise<PersonalTaskRecord> {
    await conn.execute(
      `UPDATE personal_tasks
       SET priority = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [priority, taskId]
    );
    const updated = await this.findTaskByIdRaw(taskId, conn);
    if (!updated) throw new Error('Updated task could not be reloaded');
    const { deleted_at: _deleted, ...publicTask } = updated;
    void _deleted;
    return publicTask;
  }

  async markTaskCompleted(conn: PoolConnection, taskId: string): Promise<PersonalTaskRecord> {
    await conn.execute(
      `UPDATE personal_tasks
       SET status = 'completed',
           progress_percent = 100,
           completed_at = COALESCE(completed_at, UTC_TIMESTAMP()),
           updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [taskId]
    );
    const updated = await this.findTaskByIdRaw(taskId, conn);
    if (!updated) throw new Error('Completed task could not be reloaded');
    const { deleted_at: _deleted, ...publicTask } = updated;
    void _deleted;
    return publicTask;
  }

  async markTaskReopened(
    conn: PoolConnection,
    taskId: string,
    status: 'pending' | 'in_progress',
    progressPercent: number
  ): Promise<PersonalTaskRecord> {
    await conn.execute(
      `UPDATE personal_tasks
       SET status = ?,
           progress_percent = ?,
           completed_at = NULL,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [status, progressPercent, taskId]
    );
    const updated = await this.findTaskByIdRaw(taskId, conn);
    if (!updated) throw new Error('Reopened task could not be reloaded');
    const { deleted_at: _deleted, ...publicTask } = updated;
    void _deleted;
    return publicTask;
  }

  async detachSubtasksOnParentDelete(
    conn: PoolConnection,
    userId: string,
    parentTaskId: string
  ): Promise<void> {
    await conn.execute(
      `UPDATE personal_tasks
       SET parent_task_id = NULL, updated_at = UTC_TIMESTAMP()
       WHERE parent_task_id = ? AND user_id = ? AND deleted_at IS NULL`,
      [parentTaskId, userId]
    );
  }

  async markTaskCancelled(
    conn: PoolConnection,
    taskId: string,
    reason: string | null
  ): Promise<PersonalTaskRecord> {
    await conn.execute(
      `UPDATE personal_tasks
       SET status = 'cancelled',
           cancelled_at = COALESCE(cancelled_at, UTC_TIMESTAMP()),
           cancel_reason = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [reason, taskId]
    );
    const updated = await this.findTaskByIdRaw(taskId, conn);
    if (!updated) throw new Error('Cancelled task could not be reloaded');
    const { deleted_at: _deleted, ...publicTask } = updated;
    void _deleted;
    return publicTask;
  }

  async softDeleteTask(conn: PoolConnection, taskId: string): Promise<void> {
    await conn.execute(
      `UPDATE personal_tasks
       SET deleted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted_at IS NULL`,
      [taskId]
    );
  }

  async findTasksByTitleReference(
    userId: string,
    reference: string
  ): Promise<PersonalTaskRecord[]> {
    const trimmed = reference.trim();
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT t.*, p.title AS plan_title, pt.title AS parent_task_title, ev.title AS event_title,
              ${TASK_SUBTASK_METRICS_SELECT}
       FROM personal_tasks t
       LEFT JOIN personal_plans p ON p.id = t.plan_id AND p.deleted_at IS NULL
       LEFT JOIN personal_tasks pt ON pt.id = t.parent_task_id AND pt.deleted_at IS NULL
       LEFT JOIN personal_events ev ON ev.id = t.event_id AND ev.deleted_at IS NULL
       WHERE t.user_id = ?
         AND t.deleted_at IS NULL
         AND t.status != 'cancelled'
         AND t.title LIKE ?
       ORDER BY
         CASE WHEN LOWER(t.title) = LOWER(?) THEN 0 ELSE 1 END ASC,
         t.id DESC
       LIMIT 10`,
      [userId, `%${trimmed}%`, trimmed]
    );
    return rows.map(mapTaskRow);
  }

  async buildPlanRecord(
    planRow: RowDataPacket,
    conn?: PoolConnection
  ): Promise<PersonalPlanRecord> {
    const executor = conn ?? this.pool;
    const planId = String(planRow.id);
    const declaredSessions = Math.max(1, Number(planRow.total_sessions ?? 1));

    const [taskRows] = await executor.execute<RowDataPacket[]>(
      `SELECT *
       FROM personal_tasks
       WHERE plan_id = ? AND user_id = ?
       ORDER BY COALESCE(session_number, 999999) ASC, id ASC`,
      [planId, String(planRow.user_id)]
    );

    const originalNumbers = new Set(taskRows
      .map(row => Number(row.session_number))
      .filter(number => Number.isInteger(number) && number >= 1 && number <= declaredSessions));
    const activeRows = taskRows.filter(row => !row.deleted_at);
    const sessionKey = (row: RowDataPacket) => row.session_number === null || row.session_number === undefined
      ? `task:${row.id}` : `session:${row.session_number}`;
    // Fully seeded plans use their current steps, including later additions/deletions.
    // Older plans with virtual, not-yet-materialized sessions retain their declared count.
    const totalSessions = originalNumbers.size === declaredSessions
      ? new Set(activeRows.map(sessionKey)).size : declaredSessions;
    const sessions: PersonalPlanSessionRecord[] = activeRows.map((r, idx) => {
      const status = String(r.status ?? 'pending') as TaskStatus;
      const completed = status === 'completed';
      return {
        id: String(r.id),
        task_id: String(r.id),
        session_number:
          r.session_number !== null && r.session_number !== undefined
            ? Number(r.session_number)
            : idx + 1,
        title: String(r.title),
        description: r.description === null || r.description === undefined ? null : String(r.description),
        status,
        priority: (ALLOWED_TASK_PRIORITIES.includes(r.priority) ? r.priority : 'MEDIUM') as TaskPriority,
        progress_percent: Number(r.progress_percent ?? (completed ? 100 : 0)),
        completed_at: isoOrNull(r.completed_at),
        updated_at: isoOrNull(r.updated_at) ?? new Date(0).toISOString(),
      };
    });

    // Authoritative PA-12 rule:
    // Only sessions with status === 'completed' count as completed.
    // Partial progress ('in_progress' / 'partial' / progress_percent < 100) NEVER counts as completed.
    // Distinct session keys prevent duplicate completion of the same session number from counting twice.
    const completedSessionKeys = new Set<string>();
    for (const row of activeRows) {
      if (row.status === 'completed') completedSessionKeys.add(sessionKey(row));
    }

    const completedSessions = Math.min(totalSessions, completedSessionKeys.size);
    const remainingSessions = Math.max(0, totalSessions - completedSessions);
    const progressPercent =
      totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

    return {
      id: planId,
      user_id: String(planRow.user_id),
      title: String(planRow.title),
      description:
        planRow.description === null || planRow.description === undefined
          ? null
          : String(planRow.description),
      goal: planRow.goal === null || planRow.goal === undefined ? null : String(planRow.goal),
      status: String(planRow.status ?? 'active'),
      total_sessions: totalSessions,
      completed_sessions: completedSessions,
      remaining_sessions: remainingSessions,
      progress_percent: progressPercent,
      start_date: dateOnlyOrNull(planRow.start_date),
      end_date: dateOnlyOrNull(planRow.end_date),
      created_at: isoOrNull(planRow.created_at) ?? new Date(0).toISOString(),
      updated_at: isoOrNull(planRow.updated_at) ?? new Date(0).toISOString(),
      sessions,
    };
  }

  async listPlans(
    userId: string,
    filters: { page: number; limit: number; status?: string }
  ): Promise<{ items: PersonalPlanRecord[]; total: number }> {
    const where: string[] = ['user_id = ?', 'deleted_at IS NULL'];
    const params: (string | number)[] = [userId];
    if (filters.status?.trim()) {
      where.push('status = ?');
      params.push(filters.status.trim());
    }
    const whereSql = where.join(' AND ');
    const offset = (filters.page - 1) * filters.limit;

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM personal_plans WHERE ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [planRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT *
       FROM personal_plans
       WHERE ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.limit, offset]
    );

    const items: PersonalPlanRecord[] = [];
    for (const row of planRows) {
      items.push(await this.buildPlanRecord(row));
    }
    return { items, total };
  }

  async insertPlan(
    conn: PoolConnection,
    input: {
      user_id: string;
      title: string;
      description: string | null;
      goal: string | null;
      total_sessions: number;
      start_date: string | null;
      end_date: string | null;
    }
  ): Promise<string> {
    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO personal_plans
        (user_id, title, description, goal, total_sessions, status, start_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        input.user_id,
        input.title,
        input.description,
        input.goal,
        input.total_sessions,
        input.start_date,
        input.end_date,
      ]
    );
    return String(res.insertId);
  }

  async syncPlanCompletionStatus(conn: PoolConnection, planId: string): Promise<void> {
    const planRow = await this.findPlanByIdRaw(planId, conn, true);
    if (!planRow || planRow.deleted_at) return;
    const plan = await this.buildPlanRecord(planRow, conn);
    const targetStatus =
      plan.completed_sessions >= plan.total_sessions && plan.total_sessions > 0
        ? 'completed'
        : plan.status === 'completed'
          ? 'active'
          : plan.status;
    if (targetStatus !== plan.status) {
      await conn.execute(
        `UPDATE personal_plans SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
        [targetStatus, planId]
      );
    } else {
      await conn.execute(
        `UPDATE personal_plans SET updated_at = UTC_TIMESTAMP() WHERE id = ?`,
        [planId]
      );
    }
  }

  // =========================================================================
  // Personal schedule events.
  // =========================================================================

  private mapEventRow(row: RowDataPacket, conflictingIds: string[] = []): PersonalEventRecord {
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      plan_id: row.plan_id === null || row.plan_id === undefined ? null : String(row.plan_id),
      plan_title: row.plan_title ? String(row.plan_title) : null,
      title: String(row.title),
      description:
        row.description === null || row.description === undefined ? null : String(row.description),
      location:
        row.location === null || row.location === undefined ? null : String(row.location),
      start_at: isoOrNull(row.start_at) ?? new Date(0).toISOString(),
      end_at: isoOrNull(row.end_at),
      status: String(row.status ?? 'scheduled') as EventStatus,
      has_conflict: conflictingIds.length > 0,
      conflicting_event_ids: conflictingIds,
      created_at: isoOrNull(row.created_at) ?? new Date(0).toISOString(),
      updated_at: isoOrNull(row.updated_at) ?? new Date(0).toISOString(),
    };
  }

  async findConflictingEventIds(
    userId: string,
    startAt: Date,
    endAt: Date | null,
    excludeEventId?: string,
    conn?: PoolConnection
  ): Promise<string[]> {
    const executor = conn ?? this.pool;
    const effectiveEnd = endAt ?? new Date(startAt.getTime() + 60 * 60 * 1000);
    const params: (string | Date)[] = [userId, effectiveEnd, startAt];
    let excludeSql = '';
    if (excludeEventId) {
      excludeSql = ' AND id != ?';
      params.push(excludeEventId);
    }
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT id
       FROM personal_events
       WHERE user_id = ?
         AND deleted_at IS NULL
         AND status = 'scheduled'
         AND start_at < ?
         AND COALESCE(end_at, DATE_ADD(start_at, INTERVAL 1 HOUR)) > ?${excludeSql}
       ORDER BY start_at ASC`,
      params
    );
    return rows.map((r) => String(r.id));
  }

  async findEventByIdRaw(
    eventId: string,
    conn?: PoolConnection,
    forUpdate = false
  ): Promise<PersonalEventRecord | null> {
    const executor = conn ?? this.pool;
    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT e.*, p.title AS plan_title
       FROM personal_events e
       LEFT JOIN personal_plans p ON p.id = e.plan_id AND p.deleted_at IS NULL
       WHERE e.id = ? AND e.deleted_at IS NULL
       LIMIT 1${lockClause}`,
      [eventId]
    );
    if (!rows[0]) return null;
    const startAt = new Date(rows[0].start_at);
    const endAt = rows[0].end_at ? new Date(rows[0].end_at) : null;
    const conflicts =
      String(rows[0].status) === 'scheduled'
        ? await this.findConflictingEventIds(
            String(rows[0].user_id),
            startAt,
            endAt,
            String(rows[0].id),
            conn
          )
        : [];
    return this.mapEventRow(rows[0], conflicts);
  }

  async listEvents(
    userId: string,
    filters: {
      page: number;
      limit: number;
      search?: string;
      status?: string;
      plan_id?: string;
      from?: Date | null;
      to?: Date | null;
    }
  ): Promise<{ items: PersonalEventRecord[]; total: number }> {
    const where: string[] = ['e.user_id = ?', 'e.deleted_at IS NULL'];
    const params: (string | number | Date)[] = [userId];

    if (filters.search?.trim()) {
      where.push('(e.title LIKE ? OR e.description LIKE ? OR e.location LIKE ?)');
      const like = `%${filters.search.trim()}%`;
      params.push(like, like, like);
    }
    if (filters.status?.trim()) {
      where.push('e.status = ?');
      params.push(filters.status.trim());
    }
    if (filters.plan_id?.trim()) {
      where.push('e.plan_id = ?');
      params.push(filters.plan_id.trim());
    }
    if (filters.from) {
      where.push('e.start_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      where.push('e.start_at <= ?');
      params.push(filters.to);
    }

    const whereSql = where.join(' AND ');
    const offset = (filters.page - 1) * filters.limit;

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM personal_events e WHERE ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT e.*, p.title AS plan_title
       FROM personal_events e
       LEFT JOIN personal_plans p ON p.id = e.plan_id AND p.deleted_at IS NULL
       WHERE ${whereSql}
       ORDER BY
         CASE e.status WHEN 'scheduled' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END ASC,
         e.start_at ASC,
         e.id DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.limit, offset]
    );

    const items: PersonalEventRecord[] = [];
    for (const row of rows) {
      const startAt = new Date(row.start_at);
      const endAt = row.end_at ? new Date(row.end_at) : null;
      const conflicts =
        String(row.status) === 'scheduled'
          ? await this.findConflictingEventIds(userId, startAt, endAt, String(row.id))
          : [];
      items.push(this.mapEventRow(row, conflicts));
    }

    return { items, total };
  }

  async insertEvent(
    conn: PoolConnection,
    input: {
      user_id: string;
      plan_id: string | null;
      title: string;
      description: string | null;
      location: string | null;
      start_at: Date;
      end_at: Date | null;
    }
  ): Promise<PersonalEventRecord> {
    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO personal_events
        (user_id, plan_id, title, description, location, start_at, end_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        input.user_id,
        input.plan_id,
        input.title,
        input.description,
        input.location,
        input.start_at,
        input.end_at,
      ]
    );
    const created = await this.findEventByIdRaw(String(res.insertId), conn);
    if (!created) throw new Error('Created event could not be reloaded');
    return created;
  }

  async updateEventFields(
    conn: PoolConnection,
    eventId: string,
    fields: {
      title: string;
      description: string | null;
      location: string | null;
      start_at: Date;
      end_at: Date | null;
      status: EventStatus;
      plan_id: string | null;
    }
  ): Promise<PersonalEventRecord> {
    await conn.execute(
      `UPDATE personal_events
       SET title = ?,
           description = ?,
           location = ?,
           start_at = ?,
           end_at = ?,
           status = ?,
           plan_id = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        fields.title,
        fields.description,
        fields.location,
        fields.start_at,
        fields.end_at,
        fields.status,
        fields.plan_id,
        eventId,
      ]
    );
    const updated = await this.findEventByIdRaw(eventId, conn);
    if (!updated) throw new Error('Updated event could not be reloaded');
    return updated;
  }

  async deleteEventById(conn: PoolConnection, eventId: string): Promise<void> {
    await conn.execute(`DELETE FROM personal_events WHERE id = ?`, [eventId]);
  }

  // =========================================================================
  // Reminders and delivery history.
  // =========================================================================

  private mapDeliveryRow(row: RowDataPacket): ReminderDeliveryRecord {
    return {
      id: String(row.id),
      reminder_id: String(row.reminder_id),
      device_id: row.device_id === null || row.device_id === undefined ? null : String(row.device_id),
      channel: String(row.channel ?? 'VOICE'),
      status: String(row.status ?? 'pending'),
      delivered_at: isoOrNull(row.delivered_at),
      acknowledged_at: isoOrNull(row.acknowledged_at),
      error_message:
        row.error_message === null || row.error_message === undefined
          ? null
          : String(row.error_message),
      created_at: isoOrNull(row.created_at) ?? new Date(0).toISOString(),
    };
  }

  private mapReminderRow(
    row: RowDataPacket,
    deliveries: ReminderDeliveryRecord[] = []
  ): PersonalReminderRecord {
    return {
      id: String(row.id),
      user_id: String(row.user_id),
      task_id: row.task_id === null || row.task_id === undefined ? null : String(row.task_id),
      task_title: row.task_title ? String(row.task_title) : null,
      event_id: row.event_id === null || row.event_id === undefined ? null : String(row.event_id),
      event_title: row.event_title ? String(row.event_title) : null,
      remind_at: isoOrNull(row.remind_at) ?? new Date(0).toISOString(),
      message: String(row.message),
      channel: String(row.channel ?? 'VOICE') as ReminderChannel,
      status: String(row.status ?? 'pending') as ReminderStatus,
      deliveries,
      created_at: isoOrNull(row.created_at) ?? new Date(0).toISOString(),
      updated_at: isoOrNull(row.updated_at) ?? new Date(0).toISOString(),
    };
  }

  async listDeliveriesForReminder(
    reminderId: string,
    conn?: PoolConnection
  ): Promise<ReminderDeliveryRecord[]> {
    const executor = conn ?? this.pool;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT * FROM reminder_deliveries WHERE reminder_id = ? ORDER BY id DESC`,
      [reminderId]
    );
    return rows.map((r) => this.mapDeliveryRow(r));
  }

  async findReminderByIdRaw(
    reminderId: string,
    conn?: PoolConnection,
    forUpdate = false
  ): Promise<PersonalReminderRecord | null> {
    const executor = conn ?? this.pool;
    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT r.*, t.title AS task_title, e.title AS event_title
       FROM personal_reminders r
       LEFT JOIN personal_tasks t ON t.id = r.task_id AND t.deleted_at IS NULL
       LEFT JOIN personal_events e ON e.id = r.event_id AND e.deleted_at IS NULL
       WHERE r.id = ?
       LIMIT 1${lockClause}`,
      [reminderId]
    );
    if (!rows[0]) return null;
    const deliveries = await this.listDeliveriesForReminder(String(rows[0].id), conn);
    return this.mapReminderRow(rows[0], deliveries);
  }

  async listReminders(
    userId: string,
    filters: {
      page: number;
      limit: number;
      status?: string;
      channel?: string;
      task_id?: string;
      event_id?: string;
    }
  ): Promise<{ items: PersonalReminderRecord[]; total: number }> {
    const where: string[] = ['r.user_id = ?'];
    const params: (string | number)[] = [userId];

    if (filters.status?.trim()) {
      where.push('r.status = ?');
      params.push(filters.status.trim());
    }
    if (filters.channel?.trim()) {
      where.push('r.channel = ?');
      params.push(filters.channel.trim());
    }
    if (filters.task_id?.trim()) {
      where.push('r.task_id = ?');
      params.push(filters.task_id.trim());
    }
    if (filters.event_id?.trim()) {
      where.push('r.event_id = ?');
      params.push(filters.event_id.trim());
    }

    const whereSql = where.join(' AND ');
    const offset = (filters.page - 1) * filters.limit;

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM personal_reminders r WHERE ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT r.*, t.title AS task_title, e.title AS event_title
       FROM personal_reminders r
       LEFT JOIN personal_tasks t ON t.id = r.task_id AND t.deleted_at IS NULL
       LEFT JOIN personal_events e ON e.id = r.event_id AND e.deleted_at IS NULL
       WHERE ${whereSql}
       ORDER BY
         CASE r.status WHEN 'pending' THEN 1 WHEN 'delivered' THEN 2 WHEN 'acknowledged' THEN 3 ELSE 4 END ASC,
         r.remind_at ASC,
         r.id DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.limit, offset]
    );

    const items: PersonalReminderRecord[] = [];
    for (const row of rows) {
      const deliveries = await this.listDeliveriesForReminder(String(row.id));
      items.push(this.mapReminderRow(row, deliveries));
    }

    return { items, total };
  }

  async insertReminder(
    conn: PoolConnection,
    input: {
      user_id: string;
      task_id: string | null;
      event_id: string | null;
      remind_at: Date;
      message: string;
      channel: ReminderChannel;
      device_id?: string | null;
    }
  ): Promise<PersonalReminderRecord> {
    const [res] = await conn.execute<ResultSetHeader>(
      `INSERT INTO personal_reminders
        (user_id, task_id, event_id, remind_at, message, channel, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        input.user_id,
        input.task_id,
        input.event_id,
        input.remind_at,
        input.message,
        input.channel,
      ]
    );
    const reminderId = String(res.insertId);
    await conn.execute(
      `INSERT INTO reminder_deliveries
        (reminder_id, device_id, channel, status, created_at)
       VALUES (?, ?, ?, 'pending', UTC_TIMESTAMP())`,
      [reminderId, input.device_id ?? null, input.channel]
    );
    const created = await this.findReminderByIdRaw(reminderId, conn);
    if (!created) throw new Error('Created reminder could not be reloaded');
    return created;
  }

  async updateReminderFields(
    conn: PoolConnection,
    reminderId: string,
    fields: {
      message: string;
      remind_at: Date;
      channel: ReminderChannel;
      status: ReminderStatus;
      task_id: string | null;
      event_id: string | null;
    }
  ): Promise<PersonalReminderRecord> {
    await conn.execute(
      `UPDATE personal_reminders
       SET message = ?,
           remind_at = ?,
           channel = ?,
           status = ?,
           task_id = ?,
           event_id = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [
        fields.message,
        fields.remind_at,
        fields.channel,
        fields.status,
        fields.task_id,
        fields.event_id,
        reminderId,
      ]
    );
    const updated = await this.findReminderByIdRaw(reminderId, conn);
    if (!updated) throw new Error('Updated reminder could not be reloaded');
    return updated;
  }

  async acknowledgeReminder(
    conn: PoolConnection,
    reminderId: string,
    channel: string,
    deviceId: string | null
  ): Promise<PersonalReminderRecord> {
    await conn.execute(
      `UPDATE personal_reminders
       SET status = 'acknowledged', updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [reminderId]
    );
    const [existing] = await conn.execute<RowDataPacket[]>(
      `SELECT id FROM reminder_deliveries WHERE reminder_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [reminderId]
    );
    if (existing[0]) {
      await conn.execute(
        `UPDATE reminder_deliveries
         SET status = 'acknowledged',
             device_id = COALESCE(?, device_id),
             delivered_at = COALESCE(delivered_at, UTC_TIMESTAMP()),
             acknowledged_at = COALESCE(acknowledged_at, UTC_TIMESTAMP())
         WHERE id = ?`,
        [deviceId, existing[0].id]
      );
    } else {
      await conn.execute(
        `INSERT INTO reminder_deliveries
          (reminder_id, device_id, channel, status, delivered_at, acknowledged_at, created_at)
         VALUES (?, ?, ?, 'acknowledged', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [reminderId, deviceId, channel]
      );
    }
    const updated = await this.findReminderByIdRaw(reminderId, conn);
    if (!updated) throw new Error('Acknowledged reminder could not be reloaded');
    return updated;
  }

  async deleteReminderById(conn: PoolConnection, reminderId: string): Promise<void> {
    await conn.execute(`DELETE FROM reminder_deliveries WHERE reminder_id = ?`, [reminderId]);
    await conn.execute(`DELETE FROM personal_reminders WHERE id = ?`, [reminderId]);
  }

  // =========================================================================
  // Personal memories.
  // =========================================================================

  private mapMemoryRow(row: RowDataPacket): PersonalMemoryRecord {
    const record = {
      id: String(row.id),
      user_id: String(row.user_id),
      memory_key: String(row.memory_key),
      memory_value: String(row.memory_value),
      category:
        row.category === null || row.category === undefined ? null : String(row.category),
      confidence:
        row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      source_conversation_id:
        row.source_conversation_id === null || row.source_conversation_id === undefined
          ? null
          : String(row.source_conversation_id),
      created_at: isoOrNull(row.created_at) ?? new Date(0).toISOString(),
      updated_at: isoOrNull(row.updated_at) ?? new Date(0).toISOString(),
    };
    return { ...record, revision: createHash('sha256').update(JSON.stringify(record)).digest('hex') };
  }

  async findMemoryByIdRaw(
    memoryId: string,
    conn?: PoolConnection,
    forUpdate = false
  ): Promise<PersonalMemoryRecord | null> {
    const executor = conn ?? this.pool;
    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT * FROM personal_memories WHERE id = ? LIMIT 1${lockClause}`,
      [memoryId]
    );
    return rows[0] ? this.mapMemoryRow(rows[0]) : null;
  }

  async findMemoryByKey(
    userId: string,
    memoryKey: string,
    conn?: PoolConnection,
    forUpdate = false
  ): Promise<PersonalMemoryRecord | null> {
    const executor = conn ?? this.pool;
    const lockClause = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT * FROM personal_memories WHERE user_id = ? AND memory_key = ? LIMIT 1${lockClause}`,
      [userId, memoryKey]
    );
    return rows[0] ? this.mapMemoryRow(rows[0]) : null;
  }

  async listMemories(
    userId: string,
    filters: {
      page: number;
      limit: number;
      search?: string;
      category?: string;
    }
  ): Promise<{ items: PersonalMemoryRecord[]; total: number }> {
    const where: string[] = ['user_id = ?'];
    const params: (string | number)[] = [userId];

    if (filters.search?.trim()) {
      where.push('(memory_key LIKE ? OR memory_value LIKE ?)');
      const like = `%${filters.search.trim()}%`;
      params.push(like, like);
    }
    if (filters.category?.trim()) {
      where.push('category = ?');
      params.push(filters.category.trim());
    }

    const whereSql = where.join(' AND ');
    const offset = (filters.page - 1) * filters.limit;

    const [countRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM personal_memories WHERE ${whereSql}`,
      params
    );
    const total = Number(countRows[0]?.total ?? 0);

    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT *
       FROM personal_memories
       WHERE ${whereSql}
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.limit, offset]
    );

    return { items: rows.map((r) => this.mapMemoryRow(r)), total };
  }

  async upsertMemory(
    conn: PoolConnection,
    input: {
      user_id: string;
      memory_key: string;
      memory_value: string;
      category: string | null;
      confidence: number | null;
      source_conversation_id: string | null;
    }
  ): Promise<PersonalMemoryRecord> {
    await conn.execute(
      `INSERT INTO personal_memories
        (user_id, memory_key, memory_value, category, confidence, source_conversation_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
        memory_value = VALUES(memory_value),
        category = COALESCE(VALUES(category), category),
        confidence = COALESCE(VALUES(confidence), confidence),
        source_conversation_id = COALESCE(VALUES(source_conversation_id), source_conversation_id),
        updated_at = UTC_TIMESTAMP()`,
      [
        input.user_id,
        input.memory_key,
        input.memory_value,
        input.category,
        input.confidence,
        input.source_conversation_id,
      ]
    );
    const saved = await this.findMemoryByKey(input.user_id, input.memory_key, conn);
    if (!saved) throw new Error('Saved memory could not be reloaded');
    return saved;
  }

  async updateMemoryFields(
    conn: PoolConnection,
    memoryId: string,
    fields: {
      memory_key: string;
      memory_value: string;
      category: string | null;
      confidence: number | null;
    }
  ): Promise<PersonalMemoryRecord> {
    await conn.execute(
      `UPDATE personal_memories
       SET memory_key = ?,
           memory_value = ?,
           category = ?,
           confidence = ?,
           updated_at = UTC_TIMESTAMP()
       WHERE id = ?`,
      [fields.memory_key, fields.memory_value, fields.category, fields.confidence, memoryId]
    );
    const updated = await this.findMemoryByIdRaw(memoryId, conn);
    if (!updated) throw new Error('Updated memory could not be reloaded');
    return updated;
  }

  async deleteMemoryById(conn: PoolConnection, memoryId: string): Promise<void> {
    await conn.execute(`DELETE FROM personal_memories WHERE id = ?`, [memoryId]);
  }

  async verifyUserDeviceOwnership(
    userId: string,
    deviceId: string,
    conn?: PoolConnection
  ): Promise<boolean> {
    const executor = conn ?? this.pool;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT device_id FROM device_assignments WHERE user_id = ? AND device_id = ? LIMIT 1`,
      [userId, deviceId]
    );
    return Boolean(rows[0]);
  }

  async verifyUserConversationOwnership(
    userId: string,
    conversationId: string,
    conn?: PoolConnection
  ): Promise<boolean> {
    const executor = conn ?? this.pool;
    const [rows] = await executor.execute<RowDataPacket[]>(
      `SELECT id FROM conversations WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`,
      [conversationId, userId]
    );
    return Boolean(rows[0]);
  }
}
