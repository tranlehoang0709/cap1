// Explicit isolated-only runner. Never alters the working database/schema.
const fs=require('node:fs');const path=require('node:path');const {randomBytes}=require('node:crypto');
const mysql=require('mysql2/promise');const {parse}=require('dotenv');const {spawnSync}=require('node:child_process');
const file=path.resolve('.env.test.connection.json');
async function main(){
 if(process.argv.includes('--prepare-isolated')){
  if(fs.existsSync(file))throw new Error('TEST_CONNECTION_ALREADY_EXISTS');
  const env=parse(fs.readFileSync('.env'));
  const connection={host:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USER,password:env.DB_PASSWORD,connectTimeout:5000};
  const name='aiva_iot_test_d2s215_'+randomBytes(6).toString('hex');
  const admin=await mysql.createConnection(connection);
  try{await admin.query('CREATE DATABASE `'+name+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');}finally{await admin.end();}
  let sql=fs.readFileSync('src/database/AIVA_IoT_V1_5_CREATE_MYSQL.sql','utf8');
  sql=sql.replace(/^CREATE DATABASE IF NOT EXISTS `aiva_iot`[^\n]*\n/m,'').replace(/^USE `aiva_iot`;\r?\n/m,'');
  if(/\bCREATE DATABASE|^USE\s/im.test(sql))throw new Error('UNEXPECTED_SCHEMA_DIRECTIVE');
  const target={...connection,database:name};
  const c=await mysql.createConnection({...target,multipleStatements:true});
  try{
   const [[row]]=await c.query('SELECT DATABASE() AS name');
   if(row.name!==name||!/^aiva_iot_test_d2s215_[a-f0-9]+$/.test(row.name))throw new Error('WRONG_SCHEMA');
   await c.query(sql);
   await c.query(fs.readFileSync('src/database/migrations/20261030_quota_admission.sql','utf8'));
  }finally{await c.end();}
  fs.writeFileSync(file,JSON.stringify(target),{flag:'wx',mode:0o600});
  console.log('Prepared isolated test schema:',name,'(working schema unchanged).');
 }
 if(!fs.existsSync(file))throw new Error('ISOLATED_CONNECTION_MISSING');
 const target=JSON.parse(fs.readFileSync(file));
 if(!/^aiva_iot_test_d2s215_[a-f0-9]+$/.test(target.database||''))throw new Error('WRONG_SCHEMA');
 const result=spawnSync(process.execPath,[require.resolve('jest/bin/jest'),'--config','jest.live-mysql.config.cjs','--runInBand'],
  {stdio:'inherit',env:{...process.env,MYSQL_INTEGRATION_TESTS:'true'}});
 process.exitCode=result.status??1;
}
main().catch(error=>{console.log('Isolated MySQL BLOCKED/FAIL:',error.code||error.message||error.name);process.exitCode=2;});
