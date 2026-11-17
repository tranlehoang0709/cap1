// Explicit test fixture: no connection to the configured/live Backend or database.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
const requests=[];
const identity=role=>({id:role==='ADMIN'?'1':'2',role,email:`${role.toLowerCase()}@example.invalid`,display_name:`Fixture ${role}`});
const robots=[{id:'1',display_name:'Fixture Robot',device_uid:'fixture-1',connection_status:'offline',lifecycle_status:'ADMIN_RECOVERY_REQUIRED'}];
let chatAttempt=0;
let nextTaskId=101;
let fixtureTasks=[
 {id:'100',user_id:'2',title:'Chuẩn bị tài liệu tổng quan đồ án',description:'Tài liệu chương 1',status:'completed',priority:'MEDIUM',due_at:'2026-11-10T10:00:00.000Z',completed_at:'2026-11-10T09:00:00.000Z',plan_id:'10',plan_title:'Kế hoạch đồ án 10 buổi',session_number:1,updated_at:'2026-11-10T09:00:00.000Z'}
];
let fixturePlans=[
 {
  id:'10',
  user_id:'2',
  title:'Kế hoạch đồ án 10 buổi',
  description:'Lộ trình thực hiện đồ án tốt nghiệp 10 buổi',
  status:'active',
  total_sessions:10,
  completed_sessions:3,
  remaining_sessions:7,
  progress_percent:30,
  updated_at:'2026-11-14T08:00:00.000Z',
  sessions:[
   {id:'1',session_number:1,title:'Buổi 1: Khởi động',status:'completed',completed_at:'2026-11-01T10:00:00.000Z'},
   {id:'2',session_number:2,title:'Buổi 2: Phân tích yêu cầu',status:'completed',completed_at:'2026-11-03T10:00:00.000Z'},
   {id:'3',session_number:3,title:'Buổi 3: Thiết kế kiến trúc',status:'completed',completed_at:'2026-11-05T10:00:00.000Z'},
   {id:'4',session_number:4,title:'Buổi 4: Hoàn thiện báo cáo',status:'in_progress',progress_percent:60}
  ]
 }
];
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
 if(url.pathname==='/user/tasks'&&req.method==='GET'){
  let items=[...fixtureTasks];
  const qSearch=(url.searchParams.get('search')||'').toLowerCase();
  const qStatus=url.searchParams.get('status')||'';
  const qPriority=url.searchParams.get('priority')||'';
  const qPlanId=url.searchParams.get('plan_id')||'';
  if(qSearch)items=items.filter(t=>t.title.toLowerCase().includes(qSearch));
  if(qStatus)items=items.filter(t=>t.status===qStatus);
  if(qPriority)items=items.filter(t=>t.priority===qPriority);
  if(qPlanId)items=items.filter(t=>t.plan_id===qPlanId);
  return reply({items,total:items.length,allowed_priorities:['HIGH','MEDIUM','LOW']});
 }
 if(url.pathname==='/user/tasks'&&req.method==='POST'){
  const created={
   id:String(nextTaskId++),
   user_id:'2',
   title:body.title,
   description:body.description??null,
   due_at:body.due_at??null,
   priority:body.priority??'MEDIUM',
   status:'pending',
   plan_id:body.plan_id??null,
   plan_title:body.plan_id==='10'?'Kế hoạch đồ án 10 buổi':null,
   session_number:body.session_number??null,
   updated_at:new Date().toISOString()
  };
  fixtureTasks=[created,...fixtureTasks];
  return reply(created,201);
 }
 const taskMatch=url.pathname.match(/^\/user\/tasks\/(\d+)(?:\/(priority|complete|cancel))?$/);
 if(taskMatch){
  const taskId=taskMatch[1],subAction=taskMatch[2];
  const idx=fixtureTasks.findIndex(t=>t.id===taskId);
  if(idx===-1)return reply({message:'Không tìm thấy công việc.'},404);
  const current=fixtureTasks[idx];
  if(req.method==='GET'&&!subAction)return reply(current);
  if(req.method==='PATCH'&&subAction==='priority'){
   if(!['HIGH','MEDIUM','LOW'].includes(body.priority))return reply({message:'Mức độ ưu tiên không hợp lệ trên Backend.'},400);
   const updated={...current,...body,priority:body.priority,updated_at:new Date().toISOString()};
   fixtureTasks[idx]=updated;
   return reply(updated);
  }
  if(req.method==='PATCH'&&!subAction){
   const updated={...current,...body,updated_at:new Date().toISOString()};
   fixtureTasks[idx]=updated;
   return reply(updated);
  }
  if(req.method==='POST'&&subAction==='complete'){
   const updated={...current,status:'completed',completed_at:new Date().toISOString(),updated_at:new Date().toISOString()};
   fixtureTasks[idx]=updated;
   return reply(updated);
  }
  if(req.method==='POST'&&subAction==='cancel'){
   const updated={...current,status:'cancelled',cancelled_at:new Date().toISOString(),updated_at:new Date().toISOString()};
   fixtureTasks[idx]=updated;
   return reply(updated);
  }
  if(req.method==='DELETE'&&!subAction){
   fixtureTasks.splice(idx,1);
   return reply({success:true});
  }
 }
 if(url.pathname==='/user/plans'&&req.method==='GET'){
  return reply({items:fixturePlans,total:fixturePlans.length});
 }
 const sessionMatch=url.pathname.match(/^\/user\/plans\/(\d+)\/sessions\/(\d+)\/complete$/);
 if(sessionMatch&&req.method==='POST'){
  const planId=sessionMatch[1],sessionId=sessionMatch[2];
  const plan=fixturePlans.find(p=>p.id===planId);
  if(!plan)return reply({message:'Không tìm thấy kế hoạch.'},404);
  const sess=plan.sessions.find(s=>s.id===sessionId);
  if(!sess)return reply({message:'Không tìm thấy buổi.'},404);
  sess.status='completed';
  sess.completed_at=new Date().toISOString();
  plan.completed_sessions=plan.sessions.filter(s=>s.status==='completed').length;
  plan.remaining_sessions=Math.max(0,plan.total_sessions-plan.completed_sessions);
  plan.progress_percent=Math.round((plan.completed_sessions/plan.total_sessions)*100);
  return reply(plan);
 }
 return reply({items:[],total:0});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
console.log(`TEST FIXTURE ONLY: ${origin}; no live business data`);
const args=process.argv.slice(2);
const child=spawn(process.execPath,['scripts/run-browser-tests.mjs',...(args.length?args:['e2e/business-ux.spec.ts','--project=desktop']),'--workers=1'],{stdio:'inherit',env:{...process.env,AIVA_BACKEND_URL:origin,AIVA_FIXTURE_ORIGIN:origin,AIVA_COOKIE_SECURE:'false',AIVA_CHAT_PROVIDER_ID:'1',AIVA_PUBLIC_ORIGIN:''}});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);}).finally(()=>new Promise(resolve=>server.close(resolve)));
process.exit(code??1);
