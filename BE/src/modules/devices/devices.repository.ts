import { Inject, Injectable, Optional } from '@nestjs/common';
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { DeviceRecord, PairingRequestRecord } from './devices.types';

@Injectable()
export class DevicesRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool, @Optional() private readonly connection?: PoolConnection) {}
  private get db(): Pool | PoolConnection { return this.connection ?? this.pool; }

  async transaction<T>(work: (repository: DevicesRepository) => Promise<T>): Promise<T> {
    if (this.connection) return work(this);
    const connection = await this.pool.getConnection();
    try { await connection.beginTransaction(); const result = await work(new DevicesRepository(this.pool, connection)); await connection.commit(); return result; }
    catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
  }

  async createDevice(uid: string, name: string | null, model: string | null): Promise<DeviceRecord> {
    const [result] = await this.db.execute<ResultSetHeader>(
      `INSERT INTO devices (device_uid, display_name, hardware_model, lifecycle_status, connection_status, created_at, updated_at)
       VALUES (?, ?, ?, 'available', 'offline', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [uid, name, model],
    );
    const device = await this.findById(String(result.insertId));
    if (!device) throw new Error('Device was not created');
    return device;
  }

  async findById(id: string, forUpdate = false): Promise<DeviceRecord | null> {
    const [rows] = await this.db.execute<DeviceRow[]>(`${deviceSelect} WHERE d.id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async findOwnedByUser(id: string, userId: string, forUpdate = false): Promise<DeviceRecord | null> {
    const [rows] = await this.db.execute<DeviceRow[]>(
      `${deviceSelect} INNER JOIN device_assignments da ON da.device_id = d.id WHERE d.id = ? AND da.user_id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id, userId],
    );
    return rows[0] ? toDevice(rows[0]) : null;
  }

  async listDevices(userId: string | null, page: number, limit: number): Promise<{ items: DeviceRecord[]; total: number }> {
    const join = userId ? 'INNER JOIN device_assignments da ON da.device_id = d.id' : '';
    const where = userId ? 'WHERE da.user_id = ?' : '';
    const values = userId ? [userId] : [];
    const [count] = await this.db.execute<CountRow[]>(`SELECT COUNT(*) total FROM devices d ${join} ${where}`, values);
    const [rows] = await this.db.execute<DeviceRow[]>(
      `${deviceSelect} ${join} ${where} ORDER BY d.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, (page - 1) * limit],
    );
    return { items: rows.map(toDevice), total: Number(count[0]?.total ?? 0) };
  }

  async updateName(id: string, name: string): Promise<DeviceRecord> {
    await this.db.execute('UPDATE devices SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [name, id]);
    const device = await this.findById(id); if (!device) throw new Error('Device missing after update'); return device;
  }

  async createPairingCode(deviceId: string, hash: string, expiresAt: Date): Promise<void> {
    await this.db.execute('UPDATE device_pairing_codes SET revoked_at = UTC_TIMESTAMP() WHERE device_id = ? AND consumed_at IS NULL AND revoked_at IS NULL', [deviceId]);
    await this.db.execute(
      'INSERT INTO device_pairing_codes (device_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())', [deviceId, hash, expiresAt],
    );
  }

  async consumePairingCode(hash: string): Promise<{ id: string; device_id: string } | null> {
    const [rows] = await this.db.execute<PairingCodeRow[]>(
      `SELECT id, device_id FROM device_pairing_codes WHERE code_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL
       AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE`, [hash],
    );
    if (!rows[0]) return null;
    await this.db.execute('UPDATE device_pairing_codes SET consumed_at = UTC_TIMESTAMP() WHERE id = ?', [rows[0].id]);
    return { id: String(rows[0].id), device_id: String(rows[0].device_id) };
  }

  async createPairingRequest(deviceId: string, userId: string, codeId: string): Promise<PairingRequestRecord> {
    const [result] = await this.db.execute<ResultSetHeader>(
      `INSERT INTO device_pairing_requests (device_id, user_id, pairing_code_id, status, created_at)
       VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)`, [deviceId, userId, codeId],
    );
    const request = await this.findRequestById(String(result.insertId));
    if (!request) throw new Error('Pairing request was not created'); return request;
  }

  async findRequestById(id: string, forUpdate = false): Promise<PairingRequestRecord | null> {
    const [rows] = await this.db.execute<RequestRow[]>(
      `SELECT id, device_id, user_id, status, reviewed_by, reviewed_at, review_note, created_at
       FROM device_pairing_requests WHERE id = ? LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`, [id],
    );
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async listRequests(userId: string | null, page: number, limit: number): Promise<{ items: PairingRequestRecord[]; total: number }> {
    const where = userId ? 'WHERE user_id = ?' : '';
    const values = userId ? [userId] : [];
    const [count] = await this.db.execute<CountRow[]>(`SELECT COUNT(*) total FROM device_pairing_requests ${where}`, values);
    const [rows] = await this.db.execute<RequestRow[]>(
      `SELECT id, device_id, user_id, status, reviewed_by, reviewed_at, review_note, created_at
       FROM device_pairing_requests ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...values, limit, (page - 1) * limit],
    );
    return { items: rows.map(toRequest), total: Number(count[0]?.total ?? 0) };
  }

  async approveRequest(request: PairingRequestRecord, adminId: string, note: string | null): Promise<void> {
    await this.db.execute(
      `UPDATE device_pairing_requests SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ?`,
      [adminId, note, request.id],
    );
    await this.db.execute(
      `INSERT INTO device_assignments (device_id, user_id, pairing_request_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [request.device_id, request.user_id, request.id, adminId],
    );
    await this.db.execute(
      `INSERT INTO device_assignment_history (device_id, user_id, pairing_request_id, assigned_at) VALUES (?, ?, ?, UTC_TIMESTAMP())`,
      [request.device_id, request.user_id, request.id],
    );
    await this.db.execute(`UPDATE devices SET lifecycle_status = 'assigned', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [request.device_id]);
  }

  async rejectRequest(id: string, adminId: string, note: string | null): Promise<void> {
    await this.db.execute(`UPDATE device_pairing_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_note = ? WHERE id = ?`, [adminId, note, id]);
  }

  async unlink(device: DeviceRecord, userId: string): Promise<void> {
    const [history] = await this.db.execute<HistoryRow[]>(
      `SELECT id FROM device_assignment_history WHERE device_id = ? AND user_id = ? AND unlinked_at IS NULL ORDER BY assigned_at DESC LIMIT 1 FOR UPDATE`, [device.id, userId],
    );
    if (!history[0]) throw new Error('Current assignment history is missing');
    await this.db.execute('DELETE FROM device_assignments WHERE device_id = ? AND user_id = ?', [device.id, userId]);
    await this.db.execute('UPDATE device_assignment_history SET unlinked_at = CURRENT_TIMESTAMP, unlinked_by = ?, unlink_reason = ? WHERE id = ?', [userId, 'User requested unlink', history[0].id]);
    await this.db.execute(`UPDATE device_credentials SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE device_id = ? AND status = 'active'`, [device.id]);
    await this.db.execute(`UPDATE devices SET lifecycle_status = 'available', connection_status = 'offline', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [device.id]);
  }

  async issueCredential(deviceId: string, hash: string): Promise<void> {
    await this.db.execute(`UPDATE device_credentials SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP WHERE device_id = ? AND status = 'active'`, [deviceId]);
    await this.db.execute('INSERT INTO device_credentials (device_id, credential_hash, status, created_at) VALUES (?, ?, \'active\', CURRENT_TIMESTAMP)', [deviceId, hash]);
  }

  async findCredential(hash: string): Promise<{ device_id: string; device_uid: string } | null> {
    const [rows] = await this.db.execute<CredentialRow[]>(
      `SELECT dc.device_id, d.device_uid FROM device_credentials dc INNER JOIN devices d ON d.id = dc.device_id
       WHERE dc.credential_hash = ? AND dc.status = 'active' AND dc.revoked_at IS NULL AND (dc.expires_at IS NULL OR dc.expires_at > CURRENT_TIMESTAMP) LIMIT 1`, [hash],
    );
    return rows[0] ? { device_id: String(rows[0].device_id), device_uid: rows[0].device_uid } : null;
  }

  async recordHeartbeat(deviceId: string, battery: number | null, rssi: number | null, heap: string | null): Promise<DeviceRecord> {
    await this.db.execute(
      `INSERT INTO device_telemetry (device_id, event_type, wifi_rssi, free_heap_bytes, battery_percent, recorded_at)
       VALUES (?, 'heartbeat', ?, ?, ?, UTC_TIMESTAMP())`, [deviceId, rssi, heap, battery],
    );
    await this.db.execute(`UPDATE devices SET connection_status = 'online', last_seen_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?`, [deviceId]);
    const device = await this.findById(deviceId); if (!device) throw new Error('Device missing after heartbeat'); return device;
  }

  async audit(actorId: string | null, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.db.execute(`INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, occurred_at) VALUES (?, ?, 'DEVICE', ?, ?, CURRENT_TIMESTAMP)`, [actorId, action, entityId, JSON.stringify(metadata)]);
  }
}

const deviceSelect = `SELECT d.id, d.device_uid, d.display_name, d.hardware_model, d.lifecycle_status, d.connection_status, d.last_seen_at, d.created_at, d.updated_at,
  (SELECT dt.battery_percent FROM device_telemetry dt WHERE dt.device_id = d.id AND dt.battery_percent IS NOT NULL ORDER BY dt.recorded_at DESC LIMIT 1) battery_percent,
  (SELECT dt.wifi_rssi FROM device_telemetry dt WHERE dt.device_id = d.id AND dt.wifi_rssi IS NOT NULL ORDER BY dt.recorded_at DESC LIMIT 1) wifi_rssi FROM devices d`;
const toDevice = (r: DeviceRow): DeviceRecord => ({ ...r, id: String(r.id), battery_percent: r.battery_percent === null ? null : Number(r.battery_percent), wifi_rssi: r.wifi_rssi === null ? null : Number(r.wifi_rssi) });
const toRequest = (r: RequestRow): PairingRequestRecord => ({ ...r, id: String(r.id), device_id: String(r.device_id), user_id: String(r.user_id), reviewed_by: r.reviewed_by === null ? null : String(r.reviewed_by) });
interface DeviceRow extends RowDataPacket { id: string; device_uid: string; display_name: string | null; hardware_model: string | null; lifecycle_status: DeviceRecord['lifecycle_status']; connection_status: DeviceRecord['connection_status']; last_seen_at: Date | null; battery_percent: number | null; wifi_rssi: number | null; created_at: Date; updated_at: Date; }
interface RequestRow extends RowDataPacket { id: string; device_id: string; user_id: string; status: PairingRequestRecord['status']; reviewed_by: string | null; reviewed_at: Date | null; review_note: string | null; created_at: Date; }
interface PairingCodeRow extends RowDataPacket { id: string; device_id: string }
interface CredentialRow extends RowDataPacket { device_id: string; device_uid: string }
interface HistoryRow extends RowDataPacket { id: string }
interface CountRow extends RowDataPacket { total: string | number }
