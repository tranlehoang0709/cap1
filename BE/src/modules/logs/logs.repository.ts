import { Inject, Injectable } from '@nestjs/common';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';

@Injectable()
export class LogsRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async ingest(d: Record<string, unknown>) {
    const [r] = await this.pool.query<ResultSetHeader>(
      'INSERT INTO system_logs(instance_id,device_id,severity,component,event_code,message,occurred_at) VALUES(?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))',
      [d.instance_id ?? null, d.device_id ?? null, d.severity, d.component, d.event_code ?? null, d.message ?? null, d.occurred_at ?? null],
    );
    return { id: String(r.insertId) };
  }

  async system(page: number, limit: number, severity?: string, component?: string) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (severity) { where.push('severity=?'); params.push(severity); }
    if (component) { where.push('component=?'); params.push(component); }
    const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [n] = await this.pool.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM system_logs${clause}`, params);
    const [rows] = await this.pool.query<RowDataPacket[]>(`SELECT id,instance_id,device_id,severity,component,event_code,message,occurred_at FROM system_logs${clause} ORDER BY occurred_at DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
    return { items: rows, total: Number(n[0]?.total ?? 0) };
  }

  async audit(page: number, limit: number) {
    const [n] = await this.pool.query<RowDataPacket[]>('SELECT COUNT(*) total FROM audit_logs');
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT id,actor_user_id,action,entity_type,entity_id,metadata,occurred_at FROM audit_logs ORDER BY occurred_at DESC LIMIT ? OFFSET ?', [limit, (page - 1) * limit]);
    return { items: rows, total: Number(n[0]?.total ?? 0) };
  }
}
