require('reflect-metadata');
const mysql=require('mysql2/promise');const fs=require('node:fs');const {parse}=require('dotenv');
const {RecoveryRepository}=require('../dist/modules/device-recovery/recovery.repository');
async function main(){const e={...parse(fs.readFileSync('.env')),...process.env};
 const pool=mysql.createPool({host:e.DB_HOST,port:Number(e.DB_PORT),user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,
  timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,connectTimeout:5000});
 try{for(const table of ['device_recovery_backups','device_reset_jobs','device_unlink_operations','device_assignment_history','ai_sessions']){
   const [rows]=await pool.query(`SHOW COLUMNS FROM \`${table}\``);console.log(table,rows.map(r=>r.Field).join(','));}
  const repository=new RecoveryRepository(pool);const id='9223372036854775807';
  await repository.transaction(async tx=>{await tx.now();await tx.assignment(id);await tx.latestOperation(id);await tx.operation(id);
   await tx.latestJob(id);await tx.job(id);await tx.backup(id);await tx.backups(id);await tx.backupForOperation(id);
   await tx.setting('recovery.reset.readonly.challenge');});
  console.log('Expired backup batch:',(await repository.expiredIds()).length);
  const c=await pool.getConnection();try{
   for(const sql of [
    `INSERT INTO device_recovery_backups(unlink_operation_id,encrypted_blob_uri,checksum_sha256,encryption_key_ref,created_at,expires_at) VALUES(?,?,?,?,?,DATE_ADD(?,INTERVAL 7 DAY))`,
    `UPDATE ai_sessions SET status='revoked',ended_at=?,error_code='DEVICE_REVOKED' WHERE device_id=? AND ended_at IS NULL`,
    `INSERT INTO device_assignments(device_id,user_id,pairing_request_id,assigned_by,assigned_at) VALUES(?,?,?,?,?)`,
    `UPDATE device_reset_jobs SET status=?,acknowledged_at=?,last_error=? WHERE id=?`,
    `UPDATE device_unlink_operations SET status=?,completed_at=?,failure_reason=? WHERE id=?`
   ]){await c.query('PREPARE recovery_probe FROM ?',[sql]);await c.query('DEALLOCATE PREPARE recovery_probe');}
  }finally{c.release();}
  console.log('PASS: live Recovery SELECT/locking reads and DML PREPARE; no writes, cleanup or fixtures executed.');
 }finally{await pool.end();}}
main().catch(error=>{console.error('Recovery check failed:',error.code||error.name);process.exitCode=1;});
