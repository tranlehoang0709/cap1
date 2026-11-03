// Read-only schema probe. Does not bootstrap the app, seed users, run migrations,
// create tables, write rows, or print connection credentials.
const path = require('node:path');
require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
const {createPool} = require('mysql2/promise');
const {QuotasRepository} = require('../dist/modules/quotas/quotas.repository');
async function main() {
  if (process.env.DB_NAME !== 'aiva_iot' && !(process.env.MYSQL_INTEGRATION_TESTS === 'true' && /^aiva_iot_test(?:_[a-z0-9_]+)?$/.test(process.env.DB_NAME ?? ''))) {
    console.log('BLOCKED DATABASE_CONFIGURATION_REQUIRED'); process.exitCode=1; return;
  }
  const pool=createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT??3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,
    database:process.env.DB_NAME,connectTimeout:3000,connectionLimit:1,timezone:'Z',supportBigNumbers:true,bigNumberStrings:true});
  try {await new QuotasRepository(pool).assertSchema();console.log('PASS QUOTA_SCHEMA_READY (read-only)');}
  catch(error) {console.log(error?.getStatus?.()===409?'BLOCKED QUOTA_SCHEMA_NOT_READY':'BLOCKED DATABASE_UNAVAILABLE');process.exitCode=1;}
  finally {await pool.end();}
}
main().catch(()=>{console.log('BLOCKED READINESS_UNAVAILABLE');process.exitCode=1;});
