/** Private interactive operator helper. No token capture, direct verification SQL or password reset. */
const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
const {createRequire}=require('node:module');const req=createRequire(path.resolve(__dirname,'../package.json'));
const configPath=path.resolve(__dirname,'../.env');
let helperStage='interactive-tty';
function status(state){const target=process.env.AIVA_E2E_HELPER_STATUS_PATH;if(target)fs.writeFileSync(target,JSON.stringify({stage:helperStage,state,stdinTTY:!!process.stdin.isTTY,stdoutTTY:!!process.stdout.isTTY}));}
async function main(){
  status('starting');
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Run only in a private interactive terminal; redirected input/output is refused.');
  helperStage='local-config';status('checking');
  const env=req('dotenv').parse(fs.readFileSync(configPath));
  if(env.NODE_ENV!=='development'||env.DB_NAME!=='aiva_iot'||!['localhost','127.0.0.1','::1'].includes(env.DB_HOST))throw Error('Local development configuration required.');
  helperStage='mysql-connection';status('checking');
  const c=await req('mysql2/promise').createConnection({host:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,connectTimeout:5000});
  async function account(){await c.query('SET SESSION TRANSACTION READ ONLY');await c.beginTransaction();try{const[rows]=await c.query(`SELECT u.email,u.status,u.email_verified_at,COUNT(r.code) AS role_count,MAX(r.code) AS role FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.id=2 GROUP BY u.id,u.email,u.status,u.email_verified_at`);const a=rows[0];if(!a||a.status!=='active'||Number(a.role_count)!==1||a.role!=='USER')throw Error('Existing User ID 2 is not eligible.');return a;}finally{await c.rollback();}}
  const rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const ask=question=>new Promise(resolve=>rl.question(question,resolve));
  try{
    helperStage='account-eligibility';status('checking');
    let a=await account();
    if(!a.email_verified_at){
      helperStage='official-resend';status('checking');
      const response=await fetch('http://127.0.0.1:3000/auth/resend-verification',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:a.email}),signal:AbortSignal.timeout(10000)});
      if(response.status!==202)throw Error('Resend unavailable/rate-limited. Check the private Backend console configuration; do not retry automatically.');
      helperStage='owner-verification';status('waiting');
      await ask('Open the verification link shown ONLY in the private Backend console, click Verify in Frontend, then press Enter here. ');
      a=await account();if(!a.email_verified_at)throw Error('Email still unverified. No credential file changed.');
    }
    helperStage='owner-password-entry';status('waiting');
    let muted=false;const original=rl._writeToOutput.bind(rl);rl._writeToOutput=text=>{if(!muted)original(text)};
    process.stdout.write('Existing User ID 2 password (hidden; no reset): ');muted=true;
    const password=await ask('');muted=false;process.stdout.write('\n');rl._writeToOutput=original;
    if(!password||password.includes('\n')||password.includes('\r'))throw Error('Password was not supplied in supported form.');
    helperStage='save-approved-local-credentials';status('writing');
    const additions={AIVA_E2E_USER_EMAIL:a.email,AIVA_E2E_USER_PASSWORD:password};
    const lines=Object.entries(additions).map(([k,v])=>k+'='+JSON.stringify(v));
    const round=req('dotenv').parse(lines.join('\n'));if(Object.entries(additions).some(([k,v])=>round[k]!==v))throw Error('Value cannot be serialized safely; configure locally instead.');
    const prior=fs.readFileSync(configPath,'utf8');const cleaned=prior.split(/\r?\n/).filter(line=>!/^\s*(?:export\s+)?AIVA_E2E_USER_(EMAIL|PASSWORD)\s*=/.test(line));
    if(fs.readFileSync(configPath,'utf8')!==prior)throw Error('Configuration changed concurrently; nothing written.');
    fs.writeFileSync(configPath,cleaned.join('\n').replace(/\n*$/,'\n')+lines.join('\n')+'\n',{mode:0o600});
    helperStage='ready';status('complete');
    console.log('User verified. E2E credentials saved locally; no secret displayed. Tell the integration task: User test ready.');
  }finally{rl.close();await c.end();}
}
main().catch(()=>{status('failed');console.error('ACCOUNT ACTION REQUIRED at '+helperStage+': preparation did not complete. No account was created or password reset.');process.exitCode=1});
