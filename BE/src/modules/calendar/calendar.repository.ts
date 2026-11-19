import { Inject, Injectable } from '@nestjs/common';
import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';

export interface CalendarEventRow extends RowDataPacket {
  id: string; user_id: string; title: string; description: string | null; starts_at: Date; ends_at: Date;
  timezone: string; recurrence_rule: string | null; created_at: Date; updated_at: Date;
}
export interface ReminderRow extends RowDataPacket {
  id: string; user_id: string; calendar_event_id: string | null; device_id: string | null; message: string;
  remind_at: Date; timezone: string; status: string; attempt_count: number; next_attempt_at: Date | null;
  acknowledged_at: Date | null; last_error: string | null; created_at: Date; updated_at: Date;
}

@Injectable()
export class CalendarRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async overlaps(userId: string, startsAt: Date, endsAt: Date, excludeId?: string): Promise<boolean> {
    const values = excludeId ? [userId, endsAt, startsAt, excludeId] : [userId, endsAt, startsAt];
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM personal_events WHERE user_id = ? AND start_at < ? AND end_at > ?${excludeId ? ' AND id <> ?' : ''} LIMIT 1`, values as never[],
    );
    return rows.length > 0;
  }

  async listEvents(userId: string, from?: Date, to?: Date): Promise<CalendarEventRow[]> {
    const clauses = ['user_id = ?']; const values: unknown[] = [userId];
    if (from) { clauses.push('end_at > ?'); values.push(from); }
    if (to) { clauses.push('start_at < ?'); values.push(to); }
    const [rows] = await this.pool.execute<CalendarEventRow[]>(`SELECT id,user_id,title,description,start_at AS starts_at,end_at AS ends_at,timezone,recurrence_rule,created_at,updated_at FROM personal_events WHERE ${clauses.join(' AND ')} AND deleted_at IS NULL ORDER BY start_at ASC, id ASC`, values as never[]);
    return rows;
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

  async createReminder(userId: string, data: Record<string, unknown>, deliveryKey: string): Promise<string> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
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
    const [rows] = await this.pool.execute<ReminderRow[]>(`SELECT r.id,r.user_id,r.event_id AS calendar_event_id,d.device_id,r.title AS message,r.remind_at,r.timezone,d.status,d.attempt_count,d.next_retry_at AS next_attempt_at,d.acknowledged_at,d.last_error,r.created_at,r.updated_at FROM personal_reminders r JOIN reminder_deliveries d ON d.reminder_id=r.id WHERE r.user_id = ?${status ? ' AND d.status = ?' : ''} ORDER BY r.remind_at ASC, r.id ASC`, status ? [userId, status] : [userId]);
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
        `SELECT r.id,r.user_id,r.event_id AS calendar_event_id,d.device_id,r.title AS message,r.remind_at,r.timezone,d.status,d.attempt_count,d.next_retry_at AS next_attempt_at,d.acknowledged_at,d.last_error,r.created_at,r.updated_at FROM personal_reminders r JOIN reminder_deliveries d ON d.reminder_id=r.id WHERE d.status IN ('pending','failed') AND r.remind_at <= CURRENT_TIMESTAMP AND (d.next_retry_at IS NULL OR d.next_retry_at <= CURRENT_TIMESTAMP)
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
      await this.pool.execute(`UPDATE reminder_deliveries SET status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP,last_error=NULL WHERE reminder_id=? AND status IN ('queued','sent')`, [id]);
    } else {
      await this.pool.execute(`UPDATE reminder_deliveries SET status='failed',last_error=?,next_retry_at=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE) WHERE reminder_id=? AND status IN ('queued','sent')`, [failureCode ?? 'DELIVERY_FAILED', id]);
    }
  }
}
