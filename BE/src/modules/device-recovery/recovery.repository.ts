import { Inject,Injectable } from '@nestjs/common';
import { Pool,PoolConnection,RowDataPacket } from 'mysql2/promise';
import { MYSQL_POOL } from '../../database/database.constants';
import { OwnershipTransaction } from '../devices/ownership.repository';
import { BackupContent,StoredBackup } from './recovery-store';

export interface Assignment {deviceId:string;userId:string;pairingRequestId:string;assignedBy:string;assignedAt:Date}
export interface Operation {id:string;deviceId:string;formerUserId:string;historyId:string;status:string;revokedAt:Date|null;completedAt:Date|null}
export interface Backup extends StoredBackup {id:string;operationId:string;deviceId:string;formerUserId:string;createdAt:Date;expiresAt:Date;deletedAt:Date|null;restoredAt:Date|null}
export interface ResetJob {id:string;deviceId:string;operationId:string;status:string;attempt:number;sentAt:Date|null;acknowledgedAt:Date|null;lastError:string|null}
const opColumns='CAST(id AS CHAR) AS id,CAST(device_id AS CHAR) AS deviceId,CAST(former_user_id AS CHAR) AS formerUserId,CAST(assignment_history_id AS CHAR) AS historyId,status,revoked_at AS revokedAt,completed_at AS completedAt';
const jobColumns='CAST(id AS CHAR) AS id,CAST(device_id AS CHAR) AS deviceId,CAST(unlink_operation_id AS CHAR) AS operationId,status,attempt_count AS attempt,sent_at AS sentAt,acknowledged_at AS acknowledgedAt,last_error AS lastError';
const backupColumns=`CAST(b.id AS CHAR) AS id,CAST(b.unlink_operation_id AS CHAR) AS operationId,
 CAST(o.device_id AS CHAR) AS deviceId,CAST(o.former_user_id AS CHAR) AS formerUserId,
 b.encrypted_blob_uri AS uri,b.checksum_sha256 AS checksum,b.encryption_key_ref AS keyRef,
 b.created_at AS createdAt,b.expires_at AS expiresAt,b.deleted_at AS deletedAt,b.restored_at AS restoredAt`;

@Injectable()
export class RecoveryRepository {
  constructor(@Inject(MYSQL_POOL)private readonly pool:Pool){}
  async transaction<T>(work:(tx:RecoveryTransaction)=>Promise<T>):Promise<T>{const c=await this.pool.getConnection();
    try{await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await c.beginTransaction();
      try{const result=await work(new RecoveryTransaction(this.pool,c));await c.commit();return result;}
      catch(error){try{await c.rollback();}catch(rollback){throw new AggregateError([error,rollback],'Recovery rollback failed');}throw error;}
    }finally{c.release();}}
  async expiredIds():Promise<string[]>{const [rows]=await this.pool.execute<RowDataPacket[]>(`SELECT CAST(id AS CHAR) AS id FROM device_recovery_backups
    WHERE expires_at<=UTC_TIMESTAMP() AND deleted_at IS NULL ORDER BY expires_at,id LIMIT 100`);return rows.map(row=>row.id);}
  async referenced(uri:string):Promise<boolean>{const [rows]=await this.pool.execute<RowDataPacket[]>('SELECT id FROM device_recovery_backups WHERE encrypted_blob_uri=? LIMIT 1',[uri]);return rows.length>0;}
}
export class RecoveryTransaction {
  readonly ownership:OwnershipTransaction;
  constructor(pool:Pool,private readonly c:PoolConnection){this.ownership=new OwnershipTransaction(pool,c);}
  private async rows<T>(sql:string,values:unknown[]=[]):Promise<T[]>{const [rows]=await this.c.execute<RowDataPacket[]>(sql,values as never[]);return rows as T[];}
  private async insertedId(){return (await this.rows<{id:string}>('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id'))[0].id;}
  async now():Promise<Date>{return (await this.rows<{now:Date}>('SELECT UTC_TIMESTAMP() AS now'))[0].now;}
  async assignment(deviceId:string):Promise<Assignment|null>{return (await this.rows<Assignment>(`SELECT CAST(device_id AS CHAR) AS deviceId,CAST(user_id AS CHAR) AS userId,
    CAST(pairing_request_id AS CHAR) AS pairingRequestId,CAST(assigned_by AS CHAR) AS assignedBy,assigned_at AS assignedAt
    FROM device_assignments WHERE device_id=? FOR UPDATE`,[deviceId]))[0]??null;}
  async assignmentApproved(a:Assignment):Promise<boolean>{return (await this.rows(`SELECT id FROM device_pairing_requests
    WHERE id=? AND device_id=? AND user_id=? AND status='approved' FOR UPDATE`,[a.pairingRequestId,a.deviceId,a.userId])).length>0;}
  async displayName(deviceId:string):Promise<string|null>{return (await this.rows<{name:string|null}>('SELECT display_name AS name FROM devices WHERE id=?',[deviceId]))[0].name;}
  async history(a:Assignment):Promise<string>{
    const rows=await this.rows<{id:string}>(`SELECT CAST(id AS CHAR) AS id FROM device_assignment_history WHERE device_id=?
      AND user_id=? AND pairing_request_id=? AND unlinked_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`,[a.deviceId,a.userId,a.pairingRequestId]);
    if(rows.length)return rows[0].id;
    await this.c.execute(`INSERT INTO device_assignment_history(device_id,user_id,pairing_request_id,assigned_at) VALUES(?,?,?,?)`,[a.deviceId,a.userId,a.pairingRequestId,a.assignedAt]);return this.insertedId();
  }
  async createOperation(deviceId:string,userId:string,historyId:string,adminId:string,now:Date):Promise<string>{
    await this.c.execute(`INSERT INTO device_unlink_operations(device_id,former_user_id,assignment_history_id,requested_by,status,requested_at)
      VALUES(?,?,?,?,'requested',?)`,[deviceId,userId,historyId,adminId,now]);return this.insertedId();
  }
  async insertBackup(operationId:string,stored:StoredBackup,now:Date):Promise<string>{
    await this.c.execute(`INSERT INTO device_recovery_backups(unlink_operation_id,encrypted_blob_uri,checksum_sha256,encryption_key_ref,created_at,expires_at)
      VALUES(?,?,?,?,?,DATE_ADD(?,INTERVAL 7 DAY))`,[operationId,stored.uri,stored.checksum,stored.keyRef,now,now]);return this.insertedId();
  }
  async revoke(a:Assignment,historyId:string,operationId:string,adminId:string,reason:string|null,now:Date):Promise<string>{
    await this.c.execute(`UPDATE device_assignment_history SET unlinked_at=?,unlinked_by=?,unlink_reason=? WHERE id=? AND unlinked_at IS NULL`,[now,adminId,reason,historyId]);
    await this.c.execute('DELETE FROM device_assignments WHERE device_id=? AND user_id=? AND pairing_request_id=?',[a.deviceId,a.userId,a.pairingRequestId]);
    await this.c.execute(`UPDATE device_credentials SET status='revoked',revoked_at=COALESCE(revoked_at,?) WHERE device_id=? AND status='active'`,[now,a.deviceId]);
    await this.c.execute(`UPDATE ai_sessions SET status='revoked',ended_at=?,error_code='DEVICE_REVOKED'
      WHERE device_id=? AND ended_at IS NULL`,[now,a.deviceId]);
    await this.c.execute(`UPDATE device_pairing_codes SET revoked_at=COALESCE(revoked_at,?) WHERE device_id=? AND consumed_at IS NULL`,[now,a.deviceId]);
    await this.c.execute(`UPDATE device_pairing_requests SET status='cancelled' WHERE device_id=? AND status='pending'`,[a.deviceId]);
    await this.c.execute(`UPDATE devices SET lifecycle_status='reset_pending',updated_at=? WHERE id=?`,[now,a.deviceId]);
    await this.c.execute(`UPDATE device_unlink_operations SET status='reset_pending',revoked_at=? WHERE id=?`,[now,operationId]);
    await this.c.execute(`INSERT INTO device_reset_jobs(unlink_operation_id,device_id,status,attempt_count,requested_at) VALUES(?,?,'pending',0,?)`,[operationId,a.deviceId,now]);return this.insertedId();
  }
  async latestOperation(deviceId:string):Promise<Operation|null>{return (await this.rows<Operation>(`SELECT ${opColumns} FROM device_unlink_operations WHERE device_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE`,[deviceId]))[0]??null;}
  async operation(id:string):Promise<Operation|null>{return (await this.rows<Operation>(`SELECT ${opColumns} FROM device_unlink_operations WHERE id=? FOR UPDATE`,[id]))[0]??null;}
  async latestJob(deviceId:string):Promise<ResetJob|null>{return (await this.rows<ResetJob>(`SELECT ${jobColumns} FROM device_reset_jobs WHERE device_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE`,[deviceId]))[0]??null;}
  async job(id:string):Promise<ResetJob|null>{return (await this.rows<ResetJob>(`SELECT ${jobColumns} FROM device_reset_jobs WHERE id=? FOR UPDATE`,[id]))[0]??null;}
  async backup(id:string,lock=true):Promise<Backup|null>{return (await this.rows<Backup>(`SELECT ${backupColumns} FROM device_recovery_backups b
    INNER JOIN device_unlink_operations o ON o.id=b.unlink_operation_id WHERE b.id=?${lock?' FOR UPDATE':''}`,[id]))[0]??null;}
  async backups(deviceId:string):Promise<Backup[]>{return this.rows(`SELECT ${backupColumns} FROM device_recovery_backups b INNER JOIN device_unlink_operations o
    ON o.id=b.unlink_operation_id WHERE o.device_id=? ORDER BY b.id DESC LIMIT 100`,[deviceId]);}
  async backupForOperation(operationId:string):Promise<Backup|null>{return (await this.rows<Backup>(`SELECT ${backupColumns} FROM device_recovery_backups b
    INNER JOIN device_unlink_operations o ON o.id=b.unlink_operation_id WHERE o.id=?`,[operationId]))[0]??null;}
  async setting(key:string):Promise<unknown>{const row=(await this.rows<{value:unknown}>('SELECT setting_value AS value FROM system_settings WHERE setting_key=?',[key]))[0];return row?(typeof row.value==='string'?JSON.parse(row.value):row.value):null;}
  async saveSetting(key:string,value:unknown,actorId:string|null):Promise<void>{await this.c.execute(`INSERT INTO system_settings(setting_key,setting_value,updated_by,updated_at)
    VALUES(?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),updated_by=VALUES(updated_by),updated_at=VALUES(updated_at)`,[key,JSON.stringify(value),actorId]);}
  async claim(job:ResetJob,challengeHash:string,now:Date):Promise<void>{
    await this.c.execute(`UPDATE device_reset_jobs SET status='sent',attempt_count=attempt_count+1,sent_at=?,last_error=NULL WHERE id=?`,[now,job.id]);
    await this.saveSetting(`recovery.reset.${job.id}.challenge`,{hash:challengeHash,attempt:job.attempt+1},null);
  }
  async acknowledge(job:ResetJob,success:boolean,failureCode:string|null,now:Date):Promise<void>{
    await this.c.execute(`UPDATE device_reset_jobs SET status=?,acknowledged_at=?,last_error=? WHERE id=?`,[success?'acknowledged':'failed',success?now:null,failureCode,job.id]);
    await this.c.execute(`UPDATE device_unlink_operations SET status=?,completed_at=?,failure_reason=? WHERE id=?`,[success?'completed':'failed',success?now:null,failureCode,job.operationId]);
    if(success){
      // Close the same-second timestamp gap: no code/credential provisioned before
      // the ACK may survive reset, even if created_at equals acknowledged_at.
      await this.c.execute(`UPDATE device_pairing_codes SET revoked_at=COALESCE(revoked_at,?) WHERE device_id=? AND consumed_at IS NULL`,[now,job.deviceId]);
      await this.c.execute(`UPDATE device_credentials SET status='revoked',revoked_at=COALESCE(revoked_at,?) WHERE device_id=? AND status='active'`,[now,job.deviceId]);
      await this.c.execute(`UPDATE devices SET lifecycle_status='available',updated_at=? WHERE id=? AND lifecycle_status='reset_pending'`,[now,job.deviceId]);
    }
  }
  async restore(backup:Backup,content:BackupContent,adminId:string,now:Date):Promise<void>{
    await this.c.execute(`INSERT INTO device_assignments(device_id,user_id,pairing_request_id,assigned_by,assigned_at) VALUES(?,?,?,?,?)`,[backup.deviceId,backup.formerUserId,content.assignment.pairingRequestId,adminId,now]);
    await this.c.execute(`INSERT INTO device_assignment_history(device_id,user_id,pairing_request_id,assigned_at) VALUES(?,?,?,?)`,[backup.deviceId,backup.formerUserId,content.assignment.pairingRequestId,now]);
    await this.c.execute(`UPDATE devices SET display_name=?,lifecycle_status='assigned',updated_at=? WHERE id=?`,[content.displayName,now,backup.deviceId]);
    await this.c.execute(`UPDATE device_recovery_backups SET restored_at=?,restored_by=? WHERE id=?`,[now,adminId,backup.id]);
    // A code issued after reset but before restore must not survive this ownership transition.
    await this.c.execute(`UPDATE device_pairing_codes SET revoked_at=COALESCE(revoked_at,?) WHERE device_id=? AND consumed_at IS NULL`,[now,backup.deviceId]);
    await this.c.execute(`UPDATE device_pairing_requests SET status='cancelled' WHERE device_id=? AND status='pending'`,[backup.deviceId]);
  }
  async markDeleted(backupId:string,now:Date):Promise<void>{await this.c.execute('UPDATE device_recovery_backups SET deleted_at=? WHERE id=? AND deleted_at IS NULL',[now,backupId]);}
  async audit(actorId:string|null,action:string,entityId:string,metadata:Record<string,string|number|boolean|null>):Promise<void>{
    await this.ownership.devices.users.insertAuditLog(actorId,action,'DEVICE_RECOVERY',entityId,metadata);
  }
}
