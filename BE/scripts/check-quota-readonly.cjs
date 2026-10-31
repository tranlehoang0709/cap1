// Metadata only on the existing DB. Never applies the prepared migration or inserts data.
require('reflect-metadata');
const mysql=require('mysql2/promise');const fs=require('node:fs');const {parse}=require('dotenv');
const {QuotasRepository}=require('../dist/modules/quotas/quotas.repository');
async function main(){const e={...parse(fs.readFileSync('.env')),...process.env};
 const pool=mysql.createPool({host:e.DB_HOST,port:Number(e.DB_PORT),user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,connectTimeout:5000});
 try{await new QuotasRepository(pool).assertSchema();console.log('PASS: quota schema is ready; only metadata queries executed.');}
 catch(error){if(error.message==='QUOTA_SCHEMA_NOT_READY'){
   console.log('BLOCKED: prepared quota migration has not been applied; schema unchanged, no quota writes executed.');process.exitCode=2;
 }else throw error;}finally{await pool.end();}}
main().catch(error=>{console.error('Quota readiness check failed:',error.code||error.name);process.exitCode=1;});
