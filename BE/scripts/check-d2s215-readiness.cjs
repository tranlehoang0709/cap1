// Read-only readiness probe. Never prints secrets, email or conversation content.
require('dotenv').config({quiet:true});
const mysql=require('mysql2/promise');
(async()=>{
 let c;
 try {
  c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,
   password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectTimeout:4000});
  const [cols]=await c.query("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='usage_records' AND COLUMN_NAME IN ('request_id','request_fingerprint','quota_policy_id','reserved_tokens','report_due_at','report_fingerprint','finalized_at')");
  console.log('Quota schema columns:',cols.length,'/ 7');
  const [rows]=await c.query("SELECT COUNT(*) AS ready FROM api_credentials k JOIN ai_providers p ON p.id=k.provider_id JOIN users u ON u.id=k.owner_user_id WHERE p.code='GEMINI' AND p.is_enabled=1 AND k.is_active=1 AND k.revoked_at IS NULL AND u.status='active' AND u.email_verified_at IS NOT NULL");
  console.log('Active verified-user Gemini credentials:',rows[0].ready);
  const [models]=await c.query("SELECT COUNT(*) AS ready FROM ai_models m JOIN ai_providers p ON p.id=m.provider_id WHERE p.code='GEMINI' AND m.is_enabled=1 AND m.capability='llm'");
  console.log('Enabled Gemini LLM models:',models[0].ready);
  for(const name of ['AI_CONFIG_CONTRACT_APPROVED','AI_QUOTA_CONTRACT_APPROVED']) console.log(name,process.env[name]==='true');
  if(cols.length!==7||!Number(rows[0].ready)||!Number(models[0].ready)||
    process.env.AI_CONFIG_CONTRACT_APPROVED!=='true'||process.env.AI_QUOTA_CONTRACT_APPROVED!=='true')process.exitCode=2;
 } catch(e){ console.log('Readiness blocked:',e.code||e.name);process.exitCode=2; }
 finally {if(c)await c.end();}
})();
