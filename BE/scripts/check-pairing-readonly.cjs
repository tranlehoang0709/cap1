// Metadata/query smoke only: no fixtures, no DML, no schema changes.
require('reflect-metadata');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const mysql=require('mysql2/promise');
const {parse}=require('dotenv');
const {PairingRepository}=require('../dist/modules/pairing/pairing.repository');
const {PairingListDto}=require('../dist/modules/pairing/dto/pairing.dto');
async function main(){
  const env={...parse(fs.readFileSync('.env')),...process.env};
  const pool=mysql.createPool({host:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USER,password:env.DB_PASSWORD,
    database:env.DB_NAME,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,connectTimeout:5000,connectionLimit:2});
  try{
    const repo=new PairingRepository(pool);
    for(const table of ['device_pairing_codes','device_pairing_requests','device_assignments','device_assignment_history',
      'device_unlink_operations','device_reset_jobs','audit_logs']){
      const [rows]=await pool.query(`SHOW COLUMNS FROM \`${table}\``);
      console.log(table,rows.map(r=>r.Field).join(','));
    }
    for(const scope of [undefined,'9223372036854775807']){
      const result=await repo.list(PairingListDto.parse({status:'pending',limit:'2'}),scope);
      assert.ok(result.items.every(r=>scope===undefined||r.userId===scope));
      for(const row of result.items)assert.ok(!('pairingCodeId' in row));
      console.log('List query passed:',scope===undefined?'Admin':'User',JSON.stringify(result.pagination));
    }
    // Existing schema has no fixtures. Locking reads still validate real SQL syntax.
    await repo.withTransaction(async tx=>{
      await tx.findCodeByHash('0'.repeat(64));await tx.lockCode('9223372036854775807');
      await tx.findDeviceById('9223372036854775807');await tx.findRequest('9223372036854775807',true);
      await tx.getActiveAssignment('9223372036854775807');
      await tx.hasPendingRequest('9223372036854775807','9223372036854775807');
      await tx.hasAnyPending('9223372036854775807');
      await tx.resetAllowsPairing('9223372036854775807',new Date());
    });
    console.log('PASS: live metadata, scoped list and locking-read SQL; no DML executed.');
  }finally{await pool.end();}
}
main().catch(error=>{console.error('Pairing read-only check failed:',error.code||error.name);process.exitCode=1;});
