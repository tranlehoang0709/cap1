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
    const extra = excludeId ? ' AND id <> ?' : '';
    const values = excludeId ? [userId, endsAt, startsAt, excludeId] : [userId, endsAt, startsAt];
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM calendar_events WHERE user_id = ? AND starts_at < ? AND ends_at > ?${extra} LIMIT 1`, values as never[],
    );
    return rows.length > 0;
  }

  async listEvents(userId: string, from?: Date, to?: Date): Promise<CalendarEventRow[]> {
    const clauses = ['user_id = ?']; const values: unknown[] = [userId];
    if (from) { clauses.push('ends_at > ?'); values.push(from); }
    if (to) { clauses.push('starts_at < ?'); values.push(to); }
    const [rows] = await this.pool.execute<CalendarEventRow[]>(`SELECT * FROM calendar_events WHERE ${clauses.join(' AND ')} ORDER BY starts_at ASC, id ASC`, values as never[]);
    return rows;
  }

  async findEvent(userId: string, id: string): Promise<CalendarEventRow | null> {
    const [rows] = await this.pool.execute<CalendarEventRow[]>('SELECT * FROM calendar_events WHERE user_id = ? AND id = ? LIMIT 1', [userId, id]);
    return rows[0] ?? null;
  }

  async createEvent(userId: string, data: Record<string, unknown>): Promise<string> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO calendar_events (user_id,title,description,starts_at,ends_at,timezone,recurrence_rule,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [userId, data.title, data.description ?? null, data.starts_at, data.ends_at, data.timezone ?? 'UTC', data.recurrence_rule ?? null] as never[],
    );
    return String(result.insertId);
  }

  async updateEvent(userId: string, id: string, data: Record<string, unknown>): Promise<void> {
    await this.pool.execute(
      `UPDATE calendar_events SET title=?,description=?,starts_at=?,ends_at=?,timezone=?,recurrence_rule=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?`,
      [data.title, data.description ?? null, data.starts_at, data.ends_at, data.timezone ?? 'UTC', data.recurrence_rule ?? null, userId, id] as never[],
    );
  }

  async deleteEvent(userId: string, id: string): Promise<void> {
    await this.pool.execute('DELETE FROM calendar_events WHERE user_id = ? AND id = ?', [userId, id]);
  }

  async ownsDevice(userId: string, deviceId: string): Promise<boolean> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT 1 FROM device_assignments WHERE user_id = ? AND device_id = ? LIMIT 1`,
      [userId, deviceId],
    );
    return rows.length > 0;
  }

  async createReminder(userId: string, data: Record<string, unknown>, deliveryKey: string): Promise<string> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO reminders (user_id,calendar_event_id,device_id,message,remind_at,timezone,status,attempt_count,next_attempt_at,delivery_key,created_at,updated_at)
       VALUES (?,?,?,?,? ,?,'pending',0,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
      [userId, data.calendar_event_id ?? null, data.device_id ?? null, data.message, data.remind_at, data.timezone ?? 'UTC', data.remind_at, deliveryKey] as never[],
    );
    return String(result.insertId);
  }

  async listReminders(userId: string, status?: string): Promise<ReminderRow[]> {
    const [rows] = await this.pool.execute<ReminderRow[]>(`SELECT * FROM reminders WHERE user_id = ?${status ? ' AND status = ?' : ''} ORDER BY remind_at ASC, id ASC`, status ? [userId, status] : [userId]);
    return rows;
  }

  async findReminder(id: string): Promise<ReminderRow | null> {
    const [rows] = await this.pool.execute<ReminderRow[]>('SELECT * FROM reminders WHERE id = ? LIMIT 1', [id]);
    return rows[0] ?? null;
  }

  async claimDue(limit: number): Promise<ReminderRow[]> {
    const [rows] = await this.pool.execute<ReminderRow[]>(
      `SELECT * FROM reminders WHERE status IN ('pending','failed') AND remind_at <= CURRENT_TIMESTAMP AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
       ORDER BY remind_at ASC, id ASC LIMIT ?`, [limit],
    );
    for (const row of rows) await this.pool.execute(`UPDATE reminders SET status='queued',attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','failed')`, [row.id]);
    return rows;
  }

  async acknowledge(id: string, result: 'delivered' | 'failed', failureCode?: string): Promise<void> {
    if (result === 'delivered') {
      await this.pool.execute(`UPDATE reminders SET status='acknowledged',acknowledged_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','sent')`, [id]);
    } else {
      await this.pool.execute(`UPDATE reminders SET status='failed',last_error=?,next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE),updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','sent')`, [failureCode ?? 'DELIVERY_FAILED', id]);
    }
  }
}
