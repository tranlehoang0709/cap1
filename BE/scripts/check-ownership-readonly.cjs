// Run from BE after build. No fixtures, UPDATE, INSERT or DDL.
require('reflect-metadata');
const fs=require('node:fs');const mysql=require('mysql2/promise');const {parse}=require('dotenv');
const {OwnershipRepository}=require('../dist/modules/devices/ownership.repository');
async function main(){
  const e={...parse(fs.readFileSync('.env')),...process.env};
  const pool=mysql.createPool({host:e.DB_HOST,port:Number(e.DB_PORT),user:e.DB_USER,password:e.DB_PASSWORD,
    database:e.DB_NAME,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true,connectTimeout:5000});
  try{
    const repository=new OwnershipRepository(pool);const id='9223372036854775807';
    const devices=await repository.getUserDevices(id);const dashboard=await repository.canAccessDashboard(id);
    console.log('Scoped list/dashboard SQL passed:',JSON.stringify({total:devices.length,allowed:dashboard}));
    await repository.withTransaction(async tx=>{
      await tx.findDeviceIdByUid('__ownership_readonly_probe__');
      await tx.devices.findDeviceById(id);await tx.devices.getActiveAssignment(id);
      await tx.verifyDeviceOwnership(id,id);await tx.validateDeviceCredential(id,'0'.repeat(64));
    });
    console.log('PASS: live Ownership SELECT/locking SQL, no DML executed.');
  }finally{await pool.end();}
}
main().catch(error=>{console.error('Ownership read-only check failed:',error.code||error.name);process.exitCode=1;});
