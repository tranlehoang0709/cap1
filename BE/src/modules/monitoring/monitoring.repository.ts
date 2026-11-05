import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { OwnershipTransaction } from '../devices/ownership.repository';
import { HeartbeatEvent } from './dto/heartbeat.dto';
import { MYSQL_POOL } from '../../database/database.constants';

@Injectable()
export class MonitoringRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}
  async transaction<T>(work: (tx: MonitoringTransaction) => Promise<T>): Promise<T> {
    const c = await this.pool.getConnection();
    try {
      await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await c.beginTransaction();
      try { const result = await work(new MonitoringTransaction(this.pool, c)); await c.commit(); return result; }
      catch (error) { await c.rollback(); throw error; }
    } finally { c.release(); }
  }
  async markExpiredDevicesOffline(timeout: number): Promise<number> {
    const [result] = await this.pool.execute<ResultSetHeader>(
      "UPDATE devices SET connection_status='offline',updated_at=UTC_TIMESTAMP() WHERE connection_status='online' AND (last_seen_at IS NULL OR last_seen_at<=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? SECOND))", [timeout]);
    return result.affectedRows;
  }
  async sweepStaleDevices(): Promise<number> {
    const [result] = await this.pool.query<any>("UPDATE devices SET connection_status='offline',updated_at=CURRENT_TIMESTAMP WHERE connection_status='online' AND last_seen_at < (CURRENT_TIMESTAMP - INTERVAL 120 SECOND)");
    return Number(result.affectedRows ?? 0);
  }
  async dashboard() {
    // A dashboard GET must not run a presence sweep or change device state.
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

/** Presence and credential/ownership checks share one connection and parent-device lock. */
export class MonitoringTransaction {
  readonly ownership: OwnershipTransaction;
  constructor(pool: Pool, private readonly c: PoolConnection) { this.ownership = new OwnershipTransaction(pool, c); }
  async presence(deviceId: string): Promise<{lastSeenAt: Date|null; now: Date}> {
    const [rows] = await this.c.execute<RowDataPacket[]>(
      'SELECT last_seen_at AS lastSeenAt,UTC_TIMESTAMP() AS now FROM devices WHERE id=? FOR UPDATE', [deviceId]);
    if (!rows[0]) throw new Error('Device presence row disappeared');
    return rows[0] as {lastSeenAt: Date|null; now: Date};
  }
  async updateDevicePresence(deviceId: string, observedAt: Date): Promise<void> {
    await this.c.execute("UPDATE devices SET last_seen_at=?,connection_status='online',updated_at=UTC_TIMESTAMP() WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<?)", [observedAt,deviceId,observedAt]);
  }
  async markDeviceOffline(deviceId: string, now: Date, timeout: number): Promise<void> {
    await this.c.execute("UPDATE devices SET connection_status='offline',updated_at=UTC_TIMESTAMP() WHERE id=? AND connection_status='online' AND (last_seen_at IS NULL OR last_seen_at<=?)", [deviceId,new Date(now.getTime()-timeout*1000)]);
  }
  async saveDeviceTelemetry(deviceId: string, event: HeartbeatEvent): Promise<void> {
    if (!event.telemetry) return;
    const t = event.telemetry;
    await this.c.execute("INSERT INTO device_telemetry(device_id,event_type,wifi_rssi,free_heap_bytes,battery_percent,payload,recorded_at) VALUES(?,'heartbeat',?,?,?,?,?)",
      [deviceId,t.wifiRssi,t.freeHeapBytes,t.batteryPercent,t.payload===null?null:JSON.stringify(t.payload),event.observedAt]);
  }
  async telemetry(deviceId: string): Promise<{wifiRssi:number|null; freeHeapBytes:string|null; batteryPercent:number|null}> {
    const [rows] = await this.c.execute<RowDataPacket[]>('SELECT wifi_rssi AS wifiRssi,CAST(free_heap_bytes AS CHAR) AS freeHeapBytes,battery_percent AS batteryPercent FROM device_telemetry WHERE device_id=? ORDER BY recorded_at DESC,id DESC LIMIT 1', [deviceId]);
    return rows[0] as {wifiRssi:number|null;freeHeapBytes:string|null;batteryPercent:number|null} ?? {wifiRssi:null,freeHeapBytes:null,batteryPercent:null};
  }
}
