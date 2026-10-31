import { Inject, Injectable } from '@nestjs/common';
import { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { DeviceQueryDto } from './dto/device-query.dto';

const columns = `CAST(d.id AS CHAR) AS id, d.device_uid AS deviceUid,
  d.display_name AS displayName, d.lifecycle_status AS lifecycleStatus,
  d.connection_status AS connectionStatus, d.last_seen_at AS lastSeenAt,
  CAST(u.id AS CHAR) AS ownerId, u.display_name AS ownerDisplayName`;
const joins = `FROM devices d
  LEFT JOIN device_assignments a ON a.device_id = d.id
  LEFT JOIN users u ON u.id = a.user_id`;

@Injectable()
export class DevicesRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async list(query: DeviceQueryDto) {
    const conditions: string[] = [];
    const values: string[] = [];
    if (query.connectionStatus !== undefined) {
      conditions.push('d.connection_status = ?');
      values.push(query.connectionStatus);
    }
    if (query.search) {
      conditions.push("(d.device_uid LIKE ? ESCAPE '!' OR d.display_name LIKE ? ESCAPE '!')");
      const pattern = `%${query.search.replace(/[!%_]/g, '!$&')}%`;
      values.push(pattern, pattern);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // A read-only consistent snapshot keeps count and page aligned during pairing changes.
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const [counts] = await connection.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM devices d ${where}`, values,
      );
      // Integers are validated/bounded by the DTO; values supplied by callers remain bound.
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT ${columns} ${joins} ${where} ORDER BY d.id ASC
         LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`, values,
      );
      await connection.commit();
      return { items: rows.map((row) => this.toDevice(row)),
        pagination: { page: query.page, limit: query.limit, total: Number(counts[0].total) } };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async findById(id: string) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT ${columns}, d.hardware_model AS hardwareModel,
        CAST(d.current_firmware_id AS CHAR) AS currentFirmwareId,
        d.created_at AS createdAt, d.updated_at AS updatedAt,
        CAST(a.device_id AS CHAR) AS assignmentDeviceId,
        CAST(a.user_id AS CHAR) AS assignmentUserId,
        CAST(a.pairing_request_id AS CHAR) AS pairingRequestId,
        CAST(a.assigned_by AS CHAR) AS assignedBy, a.assigned_at AS assignedAt
       ${joins} WHERE d.id = ? LIMIT 1`, [id],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...this.toDevice(row), hardwareModel: row.hardwareModel,
      currentFirmwareId: row.currentFirmwareId, createdAt: row.createdAt, updatedAt: row.updatedAt,
      currentAssignment: row.assignmentDeviceId === null ? null : {
        deviceId: row.assignmentDeviceId, userId: row.assignmentUserId,
        pairingRequestId: row.pairingRequestId, assignedBy: row.assignedBy, assignedAt: row.assignedAt,
      } };
  }

  private toDevice(row: RowDataPacket) {
    return { id: row.id, deviceUid: row.deviceUid, displayName: row.displayName,
      lifecycleStatus: row.lifecycleStatus, connectionStatus: row.connectionStatus,
      lastSeenAt: row.lastSeenAt,
      owner: row.ownerId === null ? null : { id: row.ownerId, displayName: row.ownerDisplayName } };
  }
}
