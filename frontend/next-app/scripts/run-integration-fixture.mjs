// Explicit test fixture: no connection to the configured/live Backend or database.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
const requests=[];
const identity=role=>({id:role==='ADMIN'?'1':'2',role,email:`${role.toLowerCase()}@example.invalid`,display_name:`Fixture ${role}`});
const robots=[{id:'1',display_name:'Fixture Robot',device_uid:'fixture-1',connection_status:'offline',lifecycle_status:'ADMIN_RECOVERY_REQUIRED'}];
let chatAttempt=0;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
 const reply=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/__fixture/requests')return reply(requests);
 requests.push({method:req.method,path:url.pathname,query:Object.fromEntries(url.searchParams),body});
 if(url.pathname==='/auth/login'){chatAttempt=0;const role=body.email==='admin@example.invalid'?'ADMIN':'USER';return reply({access_token:role,refresh_token:'fixture-refresh',token_type:'Bearer',expires_in:3600});}
 const role=req.headers.authorization==='Bearer ADMIN'?'ADMIN':'USER';
 if(url.pathname==='/auth/me'||url.pathname==='/users/me')return reply(identity(role));
 if(url.pathname==='/ai/providers')return reply([{id:'1',code:'LOCAL',is_enabled:true}]);
 if(url.pathname==='/ai/profile')return reply({assistant_name:'Fixture Assistant'});
 if(url.pathname==='/web-chat/messages'){
  if(body.content==='retry fixture'&&chatAttempt++===0)return reply({message:'Fixture chat failure'},503);
  return reply({content:`Fixture reply: ${body.content}`,conversation_id:'7',usage:{input_tokens:1,output_tokens:2}});
 }
 if(url.pathname==='/devices'||url.pathname==='/devices/admin/all')return reply({items:robots,total:1});
 if(url.pathname==='/devices/pairing-requests'&&req.method==='POST')return reply({success:true,status:'PENDING'});
 if(url.pathname==='/devices/pairing-requests/mine'||url.pathname==='/devices/admin/pairing-requests')return reply({items:[{id:'3',device_id:'1',user_id:'2',status:'PENDING'}],total:1});
 if(url.pathname==='/devices/admin/1/pairing-codes')return reply({pairing_code:'a'.repeat(32),expires_at:'2026-11-12T23:00:00Z'});
 if(url.pathname==='/admin/devices/1/recovery')return reply({backups:[]});
 if(url.pathname==='/admin/devices/1/reset-status')return reply({status:'ADMIN_RECOVERY_REQUIRED',challenge:'hidden',hash:'hidden'});
 if(url.pathname==='/admin/system-settings')return reply([{setting_key:'platform.default_locale',setting_value:'"vi"'},{setting_key:'recovery.reset.1.challenge',setting_value:'{"hash":"hidden"}'}]);
 if(url.pathname.startsWith('/admin/system-settings/')&&req.method==='PUT')return reply({success:true});
 if(url.pathname==='/admin/dashboard')return reply({users:2,devices:1,online_devices:0,conversations:0});
 if(url.pathname==='/usage')return reply({items:[],total:0});
 return reply({items:[],total:0});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
console.log(`TEST FIXTURE ONLY: ${origin}; no live business data`);
const args=process.argv.slice(2);
const child=spawn(process.execPath,['scripts/run-browser-tests.mjs',...(args.length?args:['e2e/business-ux.spec.ts','--project=desktop']),'--workers=1'],{stdio:'inherit',env:{...process.env,AIVA_BACKEND_URL:origin,AIVA_FIXTURE_ORIGIN:origin,AIVA_COOKIE_SECURE:'false',AIVA_CHAT_PROVIDER_ID:'1',AIVA_PUBLIC_ORIGIN:''}});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>new Promise(resolve=>server.close(resolve)));
process.exit(code??1);
