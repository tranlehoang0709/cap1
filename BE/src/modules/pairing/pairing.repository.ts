import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { UsersRepository } from '../users/users.repository';
import { PairingListDto } from './dto/pairing.dto';
import { ActiveAssignment, PairingCode, PairingDevice, PairingRequest } from './pairing.types';

const requestColumns = `CAST(id AS CHAR) AS id, CAST(device_id AS CHAR) AS deviceId,
  CAST(user_id AS CHAR) AS userId, CAST(pairing_code_id AS CHAR) AS pairingCodeId,
  status, review_note AS reviewNote, CAST(reviewed_by AS CHAR) AS reviewedBy,
  reviewed_at AS reviewedAt, created_at AS createdAt`;

@Injectable()
export class PairingRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async withTransaction<T>(work: (tx: PairingTransaction) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      // Locking reads plus READ COMMITTED avoid stale snapshots after waiting on a device.
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();
      try {
        const result = await work(new PairingTransaction(this.pool, connection));
        await connection.commit();
        return result;
      } catch (error) {
        try { await connection.rollback(); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Pairing rollback failed'); }
        throw error;
      }
    } finally { connection.release(); }
  }

  async list(query: PairingListDto, userId?: string) {
    const conditions: string[] = [];
    const values: string[] = [];
    if (userId !== undefined) { conditions.push('user_id = ?'); values.push(userId); }
    if (query.status !== undefined) { conditions.push('status = ?'); values.push(query.status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const [counts] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM device_pairing_requests ${where}`, values);
      const [rows] = await connection.execute<(PairingRequest & RowDataPacket)[]>(
        `SELECT ${requestColumns} FROM device_pairing_requests ${where}
         ORDER BY id DESC LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`, values);
      await connection.commit();
      // Explicit public projection: code IDs/hashes are never part of the contract.
      return {items: rows.map(row => ({id:row.id, deviceId:row.deviceId, userId:row.userId,
        status:row.status.toUpperCase(), reviewNote:row.reviewNote, reviewedBy:row.reviewedBy,
        reviewedAt:row.reviewedAt, createdAt:row.createdAt})),
      pagination:{page:query.page, limit:query.limit, total:Number(counts[0].total)}};
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
}

/** All methods use the same connection. Parent device is always locked before child rows. */
export class PairingTransaction {
  readonly users: UsersRepository;
  constructor(pool: Pool, private readonly connection: PoolConnection) {
    this.users = new UsersRepository(pool, connection);
  }

  private async rows<T>(sql: string, values: unknown[] = []): Promise<T[]> {
    const [rows] = await this.connection.execute<RowDataPacket[]>(sql, values as never[]);
    return rows as T[];
  }

  async findCodeByHash(hash: string): Promise<PairingCode | null> {
    return (await this.rows<PairingCode>(`SELECT CAST(id AS CHAR) AS id,
      CAST(device_id AS CHAR) AS deviceId, created_at AS createdAt,
      (expires_at > UTC_TIMESTAMP() AND consumed_at IS NULL AND revoked_at IS NULL) AS usable
      FROM device_pairing_codes WHERE code_hash = ? LIMIT 1`, [hash]))[0] ?? null;
  }

  async lockCode(id: string): Promise<PairingCode | null> {
    return (await this.rows<PairingCode>(`SELECT CAST(id AS CHAR) AS id,
      CAST(device_id AS CHAR) AS deviceId, created_at AS createdAt,
      (expires_at > UTC_TIMESTAMP() AND consumed_at IS NULL AND revoked_at IS NULL) AS usable
      FROM device_pairing_codes WHERE id = ? FOR UPDATE`, [id]))[0] ?? null;
  }

  async findRequest(id: string, lock = false): Promise<PairingRequest | null> {
    return (await this.rows<PairingRequest>(`SELECT ${requestColumns}
      FROM device_pairing_requests WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]))[0] ?? null;
  }

  async findDeviceById(id: string): Promise<PairingDevice | null> {
    return (await this.rows<PairingDevice>(`SELECT CAST(id AS CHAR) AS id,
      lifecycle_status AS lifecycleStatus FROM devices WHERE id = ? FOR UPDATE`, [id]))[0] ?? null;
  }

  async getActiveAssignment(id: string): Promise<ActiveAssignment | null> {
    return (await this.rows<ActiveAssignment>(`SELECT CAST(device_id AS CHAR) AS deviceId,
      CAST(user_id AS CHAR) AS userId FROM device_assignments WHERE device_id = ? FOR UPDATE`, [id]))[0] ?? null;
  }

  async hasPendingRequest(deviceId: string, userId: string): Promise<boolean> {
    return (await this.rows(`SELECT id FROM device_pairing_requests
      WHERE device_id = ? AND user_id = ? AND status = 'pending' LIMIT 1 FOR UPDATE`, [deviceId,userId])).length > 0;
  }

  async resetAllowsPairing(deviceId: string, codeCreatedAt: Date): Promise<boolean> {
    // Fail closed for any incomplete unlink. Latest reset attempt must acknowledge
    // the matching operation; an old reset for a different unlink is insufficient.
    const blocked = await this.rows(`SELECT id FROM device_unlink_operations
      WHERE device_id = ? AND (status <> 'completed' OR revoked_at IS NULL OR completed_at IS NULL)
      LIMIT 1 FOR UPDATE`, [deviceId]);
    if (blocked.length) return false;
    const operations = await this.rows<{id:string; historyId:string; revokedAt:Date}>(`SELECT CAST(id AS CHAR) AS id,
      CAST(assignment_history_id AS CHAR) AS historyId, revoked_at AS revokedAt FROM device_unlink_operations WHERE device_id = ?
      ORDER BY id DESC LIMIT 1 FOR UPDATE`, [deviceId]);
    const operation = operations[0];
    const histories = await this.rows<{id:string; unlinkedAt:Date | null}>(`SELECT CAST(id AS CHAR) AS id, unlinked_at AS unlinkedAt
      FROM device_assignment_history WHERE device_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`, [deviceId]);
    // An orphan open history or historical ownership without an unlink/reset is unsafe.
    if (histories.length && (histories[0].unlinkedAt === null || !operation)) return false;
    if (operation && (!histories.length || operation.historyId !== histories[0].id)) return false;
    const jobs = await this.rows<{unlinkId:string; status:string; acknowledgedAt:Date | null}>(
      `SELECT CAST(unlink_operation_id AS CHAR) AS unlinkId, status, acknowledged_at AS acknowledgedAt
       FROM device_reset_jobs WHERE device_id = ? ORDER BY id DESC LIMIT 1 FOR UPDATE`, [deviceId]);
    const job = jobs[0];
    if (!operation) return !job;
    if (!job || job.unlinkId !== operation.id || job.status !== 'acknowledged' || !job.acknowledgedAt) return false;
    const acknowledgedAt = job.acknowledgedAt.getTime();
    return acknowledgedAt >= operation.revokedAt.getTime()
      && (!histories.length || acknowledgedAt >= histories[0].unlinkedAt!.getTime())
      && codeCreatedAt.getTime() >= acknowledgedAt;
  }

  async createRequest(deviceId: string, userId: string, codeId: string): Promise<string> {
    await this.connection.execute(`INSERT INTO device_pairing_requests
      (device_id,user_id,pairing_code_id,status,created_at) VALUES (?,?,?,'pending',UTC_TIMESTAMP())`,
    [deviceId,userId,codeId]);
    // LAST_INSERT_ID is read as CHAR to preserve the full signed BIGINT range.
    return (await this.rows<{id:string}>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0].id;
  }

  async setLifecycle(deviceId: string, status: 'available' | 'pending_approval' | 'assigned'): Promise<void> {
    await this.connection.execute('UPDATE devices SET lifecycle_status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [status,deviceId]);
  }

  async createAssignment(request: PairingRequest, adminId: string): Promise<void> {
    await this.connection.execute(`INSERT INTO device_assignments
      (device_id,user_id,pairing_request_id,assigned_by,assigned_at) VALUES (?,?,?,?,UTC_TIMESTAMP())`,
    [request.deviceId,request.userId,request.id,adminId]);
    // An open history row tracks the lifecycle that a later unlink will close.
    await this.connection.execute(`INSERT INTO device_assignment_history
      (device_id,user_id,pairing_request_id,assigned_at)
      SELECT device_id,user_id,pairing_request_id,assigned_at FROM device_assignments WHERE device_id = ?`, [request.deviceId]);
  }

  async reviewRequest(id: string, status: 'approved' | 'rejected', adminId: string, note: string | null): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(`UPDATE device_pairing_requests
      SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), review_note = ?
      WHERE id = ? AND status = 'pending'`, [status,adminId,note,id]);
    if (result.affectedRows !== 1) throw Object.assign(new Error('Request changed concurrently'), {code:'PAIRING_CONFLICT'});
  }

  async consumeCode(id: string): Promise<void> {
    const [result] = await this.connection.execute<ResultSetHeader>(`UPDATE device_pairing_codes
      SET consumed_at = UTC_TIMESTAMP() WHERE id = ? AND consumed_at IS NULL
      AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()`, [id]);
    if (result.affectedRows !== 1) throw Object.assign(new Error('Code changed concurrently'), {code:'PAIRING_CONFLICT'});
  }

  async writePairingAudit(adminId: string, request: PairingRequest, status: 'approved' | 'rejected', note: string | null): Promise<void> {
    await this.users.insertAuditLog(adminId, `DEVICE_PAIRING_${status.toUpperCase()}`, 'DEVICE_PAIRING_REQUEST', request.id,
      {deviceId:request.deviceId,userId:request.userId,reviewNote:note});
  }

  async writePairingRequestAudit(userId:string,requestId:string,deviceId:string):Promise<void>{
    await this.users.insertAuditLog(userId,'DEVICE_PAIRING_REQUESTED','DEVICE_PAIRING_REQUEST',requestId,{deviceId,userId});
  }

  async hasAnyPending(deviceId: string): Promise<boolean> {
    return (await this.rows(`SELECT id FROM device_pairing_requests
      WHERE device_id = ? AND status = 'pending' LIMIT 1 FOR UPDATE`, [deviceId])).length > 0;
  }
}
