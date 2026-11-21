import { Inject, Injectable } from '@nestjs/common';
import { recordReminderReceipt } from './reminder-receipt';
import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';

export interface CalendarEventRow extends RowDataPacket {
  id: string; user_id: string; title: string; description: string | null; starts_at: Date; ends_at: Date | null;
  timezone: string; recurrence_rule: string | null; created_at: Date; updated_at: Date;
}
export interface ReminderRow extends RowDataPacket {
  id: string; delivery_id?: string; user_id: string; calendar_event_id: string | null; device_id: string | null; message: string;
  remind_at: Date; timezone: string; status: string; attempt_count: number; next_attempt_at: Date | null;
  acknowledged_at: Date | null; last_error: string | null; created_at: Date; updated_at: Date;
}

@Injectable()
export class CalendarRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}
  async executeVoiceMutation(input: import('./voice-mutation').VoiceMutation) {
    return import('./voice-mutation').then(({ executeVoiceMutation }) => executeVoiceMutation(this.pool, input));
  }

  async overlaps(userId: string, startsAt: Date, endsAt: Date, excludeId?: string): Promise<boolean> {
    const values = excludeId ? [userId, endsAt, startsAt, excludeId] : [userId, endsAt, startsAt];
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM personal_events WHERE user_id = ? AND deleted_at IS NULL AND start_at < ? AND COALESCE(end_at, start_at) > ?${excludeId ? ' AND id <> ?' : ''} LIMIT 1`, values as never[],
    );
    return rows.length > 0;
  }

  async listEvents(userId: string, from?: Date, to?: Date): Promise<CalendarEventRow[]> {
    const clauses = ['user_id = ?']; const values: unknown[] = [userId];
    if (from) { clauses.push('(end_at > ? OR (end_at IS NULL AND start_at >= ?))'); values.push(from, from); }
    if (to) { clauses.push('start_at < ?'); values.push(to); }
    const [rows] = await this.pool.execute<CalendarEventRow[]>(`SELECT id,user_id,title,description,start_at AS starts_at,end_at AS ends_at,timezone,recurrence_rule,created_at,updated_at FROM personal_events WHERE ${clauses.join(' AND ')} AND deleted_at IS NULL ORDER BY start_at ASC, id ASC`, values as never[]);
    return rows;
  }

  async listAssistantTasks(userId: string, mode: 'date'|'overdue'|'incomplete', from?: Date, to?: Date) {
    const clauses = ['user_id = ?']; const values: unknown[] = [userId];
    if (mode === 'overdue') {
      clauses.push("status NOT IN ('completed','cancelled')", 'due_at IS NOT NULL', 'due_at < UTC_TIMESTAMP()');
    } else if (mode === 'incomplete') {
      clauses.push("status NOT IN ('completed','cancelled')");
    } else {
      clauses.push("status NOT IN ('completed','cancelled')");
      if (from) { clauses.push('due_at >= ?'); values.push(from); }
      if (to) { clauses.push('due_at < ?'); values.push(to); }
    }
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id,user_id,title,priority,status,progress_percent,due_at,completed_at
       FROM personal_tasks WHERE ${clauses.join(' AND ')} ORDER BY due_at IS NULL,due_at,id`, values as never[]);
    return rows;
  }

  async getAssistantTaskReport(userId: string, from: Date, to: Date) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id,user_id,title,priority,status,progress_percent,due_at,completed_at
       FROM personal_tasks WHERE user_id = ? AND due_at >= ? AND due_at < ?
       ORDER BY due_at,id`, [userId, from, to]);
    const items = rows.map(row => ({ ...row, id: String(row.id), user_id: String(row.user_id) }));
    const completed = rows.filter(row => String(row.status) === 'completed').length;
    const total = rows.length;
    return { items, total_tasks: total, completed_tasks: completed,
      incomplete_tasks: total - completed,
      completion_percent: total ? Math.round(completed * 100 / total) : 0 };
  }

  async listAssistantPlanProgress(userId: string) {
    const [plans] = await this.pool.execute<RowDataPacket[]>(
      `SELECT p.id,p.user_id,p.title,p.goal,p.description,p.status,p.start_at,p.target_end_at,
              COUNT(t.id) AS total_sessions,
              COALESCE(SUM(t.status = 'completed'),0) AS completed_sessions
       FROM personal_plans p LEFT JOIN personal_tasks t ON t.plan_id=p.id AND t.user_id=p.user_id
       WHERE p.user_id=? GROUP BY p.id ORDER BY p.id DESC`, [userId]);
    return plans.map(row => {
      const total=Number(row.total_sessions??0), completed=Number(row.completed_sessions??0);
      return { ...row, id:String(row.id), user_id:String(row.user_id), total_sessions:total,
        completed_sessions:completed, remaining_sessions:Math.max(0,total-completed),
        progress_percent:total?Math.round(completed*100/total):0 };
    });
  }

  async findEvent(userId: string, id: string): Promise<CalendarEventRow | null> {
    const [rows] = await this.pool.execute<CalendarEventRow[]>('SELECT id,user_id,title,description,start_at AS starts_at,end_at AS ends_at,timezone,recurrence_rule,created_at,updated_at FROM personal_events WHERE user_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1', [userId, id]);
    return rows[0] ?? null;
  }

  async createEvent(userId: string, data: Record<string, unknown>): Promise<string> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO personal_events (user_id,title,description,start_at,end_at,timezone,recurrence_rule,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [userId, data.title, data.description ?? null, data.starts_at, data.ends_at, data.timezone ?? 'UTC', data.recurrence_rule ?? null] as never[],
    );
    return String(result.insertId);
  }

  /**
   * Serialize calendar writes per user using the existing users row.  This
   * closes the check-then-insert race without adding a table or index.
   * Idempotency remains deliberately gated until a persistent key can be
   * stored in the fixed schema.
   */
  async createEventAtomic(userId: string, data: Record<string, unknown>): Promise<string> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT id FROM personal_events WHERE user_id = ? AND start_at < ? AND COALESCE(end_at, start_at) > ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
        [userId, data.ends_at, data.starts_at],
      );
      if (rows.length > 0) {
        const error = new Error('CALENDAR_CONFLICT');
        (error as Error & { code?: string }).code = 'CALENDAR_CONFLICT';
        throw error;
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO personal_events (user_id,title,description,start_at,end_at,timezone,recurrence_rule,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        [userId, data.title, data.description ?? null, data.starts_at, data.ends_at, data.timezone ?? 'UTC', data.recurrence_rule ?? null] as never[],
      );
      await connection.commit();
      return String(result.insertId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateEvent(userId: string, id: string, data: Record<string, unknown>): Promise<void> {
    await this.pool.execute(
      `UPDATE personal_events SET title=?,description=?,start_at=?,end_at=?,timezone=?,recurrence_rule=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=? AND deleted_at IS NULL`,
      [data.title, data.description ?? null, data.starts_at, data.ends_at, data.timezone ?? 'UTC', data.recurrence_rule ?? null, userId, id] as never[],
    );
  }

  async deleteEvent(userId: string, id: string): Promise<void> {
    await this.pool.execute('UPDATE personal_events SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id = ? AND id = ? AND deleted_at IS NULL', [userId, id]);
  }

  async ownsDevice(userId: string, deviceId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM device_assignments WHERE user_id = ? AND device_id = ? LIMIT 1`,
      [userId, deviceId],
    );
    return rows.length > 0;
  }

  async createReminder(userId: string, data: Record<string, unknown>, deliveryKey: string, legacyKey?: string): Promise<string> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      if (legacyKey) {
        const [existing] = await connection.execute<RowDataPacket[]>(
          'SELECT id FROM reminder_deliveries WHERE idempotency_key = ? LIMIT 1', [legacyKey]);
        if (existing.length) throw Object.assign(new Error('Equivalent reminder exists'), { code: 'REMINDER_DUPLICATE' });
      }
      const [result] = await connection.execute<ResultSetHeader>(
        `INSERT INTO personal_reminders (user_id,event_id,title,remind_at,timezone,response_behavior,repeat_policy,status,created_at,updated_at)
         VALUES (?,?,?, ?,?,'notify_only','none','scheduled',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        [userId, data.calendar_event_id ?? null, data.message, data.remind_at, data.timezone ?? 'UTC'] as never[],
      );
      await connection.execute(
        `INSERT INTO reminder_deliveries (reminder_id,device_id,delivery_channel,status,attempt_count,idempotency_key,created_at)
         VALUES (?,?,?,'pending',0,?,CURRENT_TIMESTAMP)`,
        [result.insertId, data.device_id ?? null, data.device_id ? 'VOICE' : 'WEB', deliveryKey] as never[],
      );
      await connection.commit();
      return String(result.insertId);
    } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async listReminders(userId: string, status?: string): Promise<ReminderRow[]> {
    const [rows] = await this.pool.execute<ReminderRow[]>(`SELECT r.id,d.id AS delivery_id,r.user_id,r.event_id AS calendar_event_id,d.device_id,r.title AS message,r.remind_at,r.timezone,d.status,d.attempt_count,d.next_retry_at AS next_attempt_at,d.acknowledged_at,d.last_error,r.created_at,r.updated_at FROM personal_reminders r JOIN reminder_deliveries d ON d.reminder_id=r.id WHERE r.user_id = ?${status ? ' AND d.status = ?' : ''} ORDER BY r.remind_at ASC, r.id ASC, d.id ASC`, status ? [userId, status] : [userId]);
    return rows;
  }

  async findReminder(id: string): Promise<ReminderRow | null> {
    const [rows] = await this.pool.execute<ReminderRow[]>('SELECT r.id,r.user_id,r.event_id AS calendar_event_id,d.device_id,r.title AS message,r.remind_at,r.timezone,d.status,d.attempt_count,d.next_retry_at AS next_attempt_at,d.acknowledged_at,d.last_error,r.created_at,r.updated_at FROM personal_reminders r JOIN reminder_deliveries d ON d.reminder_id=r.id WHERE r.id = ? LIMIT 1', [id]);
    return rows[0] ?? null;
  }

  async claimDue(limit: number): Promise<ReminderRow[]> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      // Lock eligible delivery rows before changing their state. A concurrent
      // worker waits for this transaction, then its locking read observes the
      // committed `queued` state and cannot claim the same delivery.
      const [rows] = await connection.execute<ReminderRow[]>(
        `SELECT r.id,r.user_id,r.event_id AS calendar_event_id,d.device_id,r.title AS message,r.remind_at,r.timezone,d.status,d.attempt_count,d.next_retry_at AS next_attempt_at,d.acknowledged_at,d.last_error,r.created_at,r.updated_at FROM personal_reminders r JOIN reminder_deliveries d ON d.reminder_id=r.id WHERE d.status IN ('pending','failed') AND r.remind_at <= UTC_TIMESTAMP() AND (d.next_retry_at IS NULL OR d.next_retry_at <= UTC_TIMESTAMP())
         ORDER BY r.remind_at ASC, r.id ASC LIMIT ? FOR UPDATE`, [limit],
      );
      for (const row of rows) {
        await connection.execute(
          `UPDATE reminder_deliveries SET status='queued',attempt_count=attempt_count+1 WHERE reminder_id=? AND status IN ('pending','failed')`,
          [row.id],
        );
      }
      await connection.commit();
      return rows;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async acknowledge(id: string, result: 'delivered' | 'failed', failureCode?: string): Promise<void> {
    if (result === 'delivered') {
      await this.pool.execute(`UPDATE reminder_deliveries SET status='delivered',delivered_at=COALESCE(delivered_at,UTC_TIMESTAMP()),last_error=NULL,next_retry_at=NULL WHERE reminder_id=? AND status IN ('queued','sent')`, [id]);
    } else {
      await this.pool.execute(`UPDATE reminder_deliveries SET status='failed',last_error=?,next_retry_at=DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) WHERE reminder_id=? AND status IN ('queued','sent')`, [failureCode ?? 'DELIVERY_FAILED', id]);
    }
  }

  async confirmReceipt(userId: string, reminderId: string, deliveryId: string) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await recordReminderReceipt(connection, userId, reminderId, deliveryId);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}
