// Localhost probe: no schema changes, seed data, credential values or JWT output.
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({path:path.join(__dirname,'../.env'),quiet:true});
const base='http://127.0.0.1:3000';
async function main(){
 const results=[];
 async function call(label,route,method='GET',body,token){
  try{
   const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
   const data=await r.json();
   results.push({label,route,status:r.status,code:data.reason??data.code??null});
   return {status:r.status,data};
  }catch{results.push({label,route,status:'NETWORK_FAILURE'});return {};}
 }
 await call('health','/health');
 await call('invalid JWT','/web-chat/messages','POST',{provider_id:'3',content:'Xin chao'},'invalid-token');
 for(const route of ['/internal/devices/authorize','/internal/ai/resolve-config','/internal/ai/authorize-request','/internal/ai/usage'])
  await call('invalid service token',route,'POST',{},'invalid-token');
 const credentials=[['Admin',process.env.ADMIN_EMAIL,process.env.ADMIN_PASSWORD],['User A',process.env.E2E_USER_A_EMAIL,process.env.E2E_USER_A_PASSWORD],['User B',process.env.E2E_USER_B_EMAIL,process.env.E2E_USER_B_PASSWORD]];
 for(const [role,email,password] of credentials){
  if(!email||!password){results.push({label:role,status:'BLOCKED_ACCOUNT_NOT_CONFIGURED'});continue;}
  const login=await call(`${role} login`,'/auth/login','POST',{email,password});
  const token=login.data?.access_token;if(!token)continue;
  const me=await call(`${role} identity`,'/auth/me','GET',undefined,token);
  results.push({label:role,identity:me.data?.id,role:me.data?.role});
  for(const route of ['/ai/profile','/ai/providers','/api-keys','/quotas','/conversations'])await call(role,route,'GET',undefined,token);
  await call(`${role} chat`,'/web-chat/messages','POST',{provider_id:'3',content:'Tra loi ngan: 1 + 1 bang may?'},token);
  await call(`${role} admin read`,'/admin/quotas','GET',undefined,token);
  if(login.data?.refresh_token)await call(`${role} logout`,'/auth/logout','POST',{refresh_token:login.data.refresh_token},token);
 }
 fs.writeFileSync(path.join(__dirname,'../docs/d2-s2-12-live-results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
}
main().catch(()=>{console.log('BLOCKED LOCAL_PROBE_FAILED');process.exitCode=1;});
