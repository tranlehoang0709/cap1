import { Inject, Injectable } from '@nestjs/common';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';

@Injectable()
export class MonitoringRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}
  async dashboard() {
    await this.pool.query("UPDATE devices SET connection_status='offline' WHERE connection_status='online' AND last_seen_at < (CURRENT_TIMESTAMP - INTERVAL 120 SECOND)");
    const q = async (sql: string) => { const [r] = await this.pool.query<RowDataPacket[]>(sql); return Number(r[0]?.total ?? 0); };
    return { users: await q('SELECT COUNT(*) total FROM users'), devices: await q('SELECT COUNT(*) total FROM devices'), assigned_devices: await q("SELECT COUNT(*) total FROM devices WHERE lifecycle_status='assigned'"), online_devices: await q("SELECT COUNT(*) total FROM devices WHERE connection_status='online'"), conversations: await q('SELECT COUNT(*) total FROM conversations WHERE deleted_at IS NULL'), usage_today: await q('SELECT COUNT(*) total FROM usage_records WHERE occurred_at>=CURRENT_DATE'), generated_at: new Date().toISOString() };
  }
  async instances() { const [r] = await this.pool.query<RowDataPacket[]>('SELECT id,instance_code,status,last_healthcheck_at,started_at FROM ai_server_instances ORDER BY instance_code'); return r; }
  async heartbeat(d: Record<string, unknown>) {
    await this.pool.query('INSERT INTO ai_server_instances(instance_code,status,last_healthcheck_at,started_at) VALUES(?,?,CURRENT_TIMESTAMP,COALESCE(?,CURRENT_TIMESTAMP)) ON DUPLICATE KEY UPDATE status=VALUES(status),last_healthcheck_at=CURRENT_TIMESTAMP,started_at=COALESCE(started_at,VALUES(started_at))', [d.instance_code, d.status ?? 'online', d.started_at ?? null]);
    const [r] = await this.pool.query<RowDataPacket[]>('SELECT id,instance_code,status,last_healthcheck_at,started_at FROM ai_server_instances WHERE instance_code=?', [d.instance_code]);
    return r[0] ?? null;
  }
  async metrics(instanceId: string, d: Record<string, unknown>) {
    const [r] = await this.pool.query<ResultSetHeader>('INSERT INTO resource_metrics(instance_id,cpu_percent,memory_percent,gpu_percent,gpu_memory_percent,active_sessions,recorded_at) VALUES(?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP))', [instanceId, d.cpu_percent ?? null, d.memory_percent ?? null, d.gpu_percent ?? null, d.gpu_memory_percent ?? null, d.active_sessions ?? null, d.recorded_at ?? null]);
    return { id: String(r.insertId) };
  }
}
