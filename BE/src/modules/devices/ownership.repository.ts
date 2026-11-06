import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { PairingTransaction } from '../pairing/pairing.repository';
import { HeartbeatEvent } from '../monitoring/dto/heartbeat.dto';

const ownedFrom=`FROM device_assignments a
  INNER JOIN devices d ON d.id=a.device_id
  INNER JOIN device_pairing_requests p ON p.id=a.pairing_request_id
    AND p.device_id=a.device_id AND p.user_id=a.user_id`;
// Ownership is current, approved, in a usable lifecycle; connection_status is intentionally absent.
const valid=`p.status='approved' AND d.lifecycle_status='assigned'
  AND NOT EXISTS (SELECT 1 FROM device_unlink_operations x WHERE x.device_id=d.id
    AND (x.status<>'completed' OR x.revoked_at IS NULL OR x.completed_at IS NULL))
  AND NOT EXISTS (SELECT 1 FROM device_reset_jobs j WHERE j.device_id=d.id
    AND j.id=(SELECT MAX(j2.id) FROM device_reset_jobs j2 WHERE j2.device_id=d.id)
    AND (j.status<>'acknowledged' OR j.acknowledged_at IS NULL))`;
const publicColumns=`CAST(d.id AS CHAR) AS id,d.device_uid AS deviceUid,
  d.display_name AS displayName,d.connection_status AS connectionStatus`;

export interface OwnedDevice {id:string;deviceUid:string;displayName:string|null;connectionStatus:string}

@Injectable()
export class OwnershipRepository {
  constructor(@Inject(MYSQL_POOL) private readonly pool:Pool) {}
  async getUserDevices(userId:string):Promise<OwnedDevice[]> {
    const [rows]=await this.pool.execute<(OwnedDevice & RowDataPacket)[]>(
      `SELECT ${publicColumns} ${ownedFrom} WHERE a.user_id=? AND ${valid} ORDER BY d.id ASC`,[userId]);
    return rows.map(row=>({id:row.id,deviceUid:row.deviceUid,displayName:row.displayName,connectionStatus:row.connectionStatus}));
  }
  async canAccessDashboard(userId:string):Promise<boolean> {
    const [rows]=await this.pool.execute<RowDataPacket[]>(
      `SELECT d.id ${ownedFrom} WHERE a.user_id=? AND ${valid} LIMIT 1`,[userId]);
    return rows.length>0;
  }
  async withTransaction<T>(work:(tx:OwnershipTransaction)=>Promise<T>):Promise<T> {
    const connection=await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await connection.beginTransaction();
      try {
        const result=await work(new OwnershipTransaction(this.pool,connection));
        await connection.commit();return result;
      } catch(error) {
        try {await connection.rollback();}
        catch(rollbackError){throw new AggregateError([error,rollbackError],'Ownership rollback failed');}
        throw error;
      }
    } finally {connection.release();}
  }
}

export class OwnershipTransaction {
  readonly devices:PairingTransaction;
  constructor(pool:Pool,private readonly connection:PoolConnection) {
    // Reuse Prompt 2's parent-device, assignment and user locks on this connection.
    this.devices=new PairingTransaction(pool,connection);
  }
  async findDeviceIdByUid(uid:string):Promise<string|null> {
    const [rows]=await this.connection.execute<RowDataPacket[]>(
      'SELECT CAST(id AS CHAR) AS id FROM devices WHERE device_uid=? LIMIT 1',[uid]);
    return rows[0]?.id ?? null;
  }
  async verifyDeviceOwnership(userId:string,deviceId:string):Promise<OwnedDevice|null> {
    const [rows]=await this.connection.execute<(OwnedDevice & RowDataPacket)[]>(
      `SELECT ${publicColumns} ${ownedFrom} WHERE a.user_id=? AND d.id=? AND ${valid} LIMIT 1`,[userId,deviceId]);
    const row=rows[0];
    return row ? {id:row.id,deviceUid:row.deviceUid,displayName:row.displayName,connectionStatus:row.connectionStatus} : null;
  }
  async renameUserDevice(deviceId:string,userId:string,name:string):Promise<void> {
    // A second owner predicate protects against alternate writers; the device row is locked.
    await this.connection.execute(`UPDATE devices d INNER JOIN device_assignments a ON a.device_id=d.id
      SET d.display_name=?,d.updated_at=UTC_TIMESTAMP() WHERE d.id=? AND a.user_id=?`,[name,deviceId,userId]);
  }
  async activeHistoryId(userId:string,deviceId:string):Promise<string|null> {
    const [rows]=await this.connection.execute<RowDataPacket[]>(`SELECT CAST(h.id AS CHAR) AS id
      FROM device_assignment_history h JOIN device_assignments a ON a.device_id=h.device_id
      AND a.user_id=h.user_id AND a.pairing_request_id=h.pairing_request_id AND a.assigned_at=h.assigned_at
      WHERE h.device_id=? AND h.user_id=? AND h.unlinked_at IS NULL ORDER BY h.id DESC FOR UPDATE`,[deviceId,userId]);
    return rows.length===1 ? rows[0].id : null;
  }
  async validateDeviceCredential(deviceId:string,hash:string):Promise<boolean> {
    const [rows]=await this.connection.execute<RowDataPacket[]>(`SELECT id FROM device_credentials
      WHERE credential_hash=? AND device_id=? AND status='active' AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP()) LIMIT 1 FOR UPDATE`,[hash,deviceId]);
    return rows.length>0;
  }
  async now():Promise<Date>{
    const [rows]=await this.connection.query<RowDataPacket[]>('SELECT UTC_TIMESTAMP() AS now');
    return rows[0].now as Date;
  }
  async presence(deviceId:string):Promise<Date|null>{
    const [rows]=await this.connection.execute<RowDataPacket[]>(
      'SELECT last_seen_at AS lastSeenAt FROM devices WHERE id=? FOR UPDATE',[deviceId]);
    return (rows[0]?.lastSeenAt as Date|null|undefined)??null;
  }
  async recordHeartbeat(deviceId:string,observedAt:Date,telemetry:HeartbeatEvent['telemetry']):Promise<void>{
    const [updated]=await this.connection.execute<ResultSetHeader>(
      `UPDATE devices SET connection_status='online',last_seen_at=?,updated_at=UTC_TIMESTAMP()
       WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<?)`,[observedAt,deviceId,observedAt]);
    if(updated.affectedRows!==1)throw new ConflictException('HEARTBEAT_CONFLICT');
    if(!telemetry)return;
    await this.connection.execute(`INSERT INTO device_telemetry
      (device_id,event_type,wifi_rssi,free_heap_bytes,battery_percent,payload,recorded_at)
      VALUES (?,'heartbeat',?,?,?,?,?,?)`,[deviceId,telemetry.wifiRssi,telemetry.freeHeapBytes,
        telemetry.batteryPercent,telemetry.payload?JSON.stringify(telemetry.payload):null,observedAt]);
  }
}
