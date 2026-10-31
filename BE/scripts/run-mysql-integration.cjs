// Opt-in runner. Does not provision schema, change grants or fall back to .env.
const fs=require('node:fs');const {parse}=require('dotenv');const {spawnSync}=require('node:child_process');
const mysql=require('mysql2/promise');
async function main(){
 const quota=process.argv.includes('--quota');
 if(!fs.existsSync('.env.test')){console.error('BLOCKED: .env.test is missing; no isolated MySQL integration test was run.');process.exitCode=2;return;}
 const env={...parse(fs.readFileSync('.env.test')),...process.env};
 if(env.MYSQL_INTEGRATION_TESTS!=='true'||!/^aiva_iot_test(?:_[a-z0-9_]+)?$/.test(env.DB_NAME||'')){
  console.error('BLOCKED: explicit MYSQL_INTEGRATION_TESTS=true and isolated DB_NAME required; aiva_iot is forbidden.');process.exitCode=2;return;}
 if(!env.DB_HOST||!env.DB_USER||!env.DB_PORT||env.DB_PASSWORD===undefined){console.error('BLOCKED: incomplete isolated connection configuration.');process.exitCode=2;return;}
 let connection;try{
  connection=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectTimeout:5000});
  const [rows]=await connection.query('SELECT DATABASE() AS name');if(rows[0].name!==env.DB_NAME)throw new Error('WRONG_SCHEMA');
  const [tables]=await connection.query(`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()`);
  for(const table of ['users','roles','user_roles','devices','device_assignments','device_pairing_codes','device_pairing_requests','device_credentials',
    'device_assignment_history','device_unlink_operations','device_reset_jobs','device_recovery_backups','device_telemetry','ai_profiles','ai_providers','ai_models','api_credentials','system_settings','audit_logs',
    ...(quota?['quota_policies','usage_records']:[])]){
    if(!tables.some(t=>t.name===table))throw new Error('MISSING_TABLES');}
  const [roles]=await connection.query("SELECT code FROM roles WHERE code IN ('ADMIN','USER')");
  const [providers]=await connection.query("SELECT code FROM ai_providers WHERE code IN ('LOCAL','OPENAI') AND is_enabled=1");
  if(roles.length!==2||providers.length!==2)throw new Error('MISSING_TEST_CATALOG');
  if(quota){
    const [columns]=await connection.query(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usage_records'`);
    if(['request_id','request_fingerprint','quota_policy_id','reserved_tokens','report_due_at','report_fingerprint','finalized_at'].some(name=>!columns.some(c=>c.name===name)))throw new Error('QUOTA_SCHEMA_NOT_READY');
  }
 }catch(error){const reason=['WRONG_SCHEMA','MISSING_TABLES','MISSING_TEST_CATALOG','QUOTA_SCHEMA_NOT_READY'].includes(error.message)?error.message:error.code||error.name;
  console.error('BLOCKED: isolated schema/catalog unavailable:',reason);process.exitCode=2;return;}
 finally{if(connection)await connection.end();}
 const result=spawnSync(process.execPath,[require.resolve('jest/bin/jest'),'--config',quota?'jest.quota-mysql.config.cjs':'jest.mysql.config.cjs','--runInBand'],{
  env:{...env,NODE_ENV:'test',HEARTBEAT_SWEEPER_ENABLED:'false'},stdio:'inherit'});
 process.exitCode=result.status??1;
}
main().catch(error=>{console.error('Integration preflight failed:',error.code||error.name);process.exitCode=2;});
