"""Authorized PA-18 plan-progress dataset actions and conversational E2E."""
import asyncio,json,os,time
from types import SimpleNamespace
from uuid import uuid4
import httpx
from app.personal_assistant.backend_schedule import BackendScheduleAdapter
from app.services.audio_context import AudioContext
from app.services.calendar_voice import CalendarVoiceWorkflow
from app.services.live_local import handle_local_voice_transcript

B='http://127.0.0.1:3000';U='2';D='3'
def ctx():return AudioContext(deadline=time.monotonic()+60)
async def login():
 p=os.environ.pop('AIVA_PLAN_PASSWORD',None)
 async with httpx.AsyncClient(timeout=10,trust_env=False) as c:r=await c.post(B+'/auth/login',json={'email':'tranlehoang205@gmail.com','password':p})
 if r.status_code!=200:raise RuntimeError(f'login HTTP {r.status_code}')
 return r.json()['access_token']
class S:
 def __init__(self,t,s):self.t=t;self.key=SimpleNamespace(user_id=U,device_id=D,session_id=s);self.delegation_token=None
 async def calendar_delegation(self,scope,_):
  async with httpx.AsyncClient(timeout=10,trust_env=False) as c:r=await c.post(B+'/auth/tool-delegations',headers={'Authorization':'Bearer '+self.t},json={'scope':scope,'session_id':self.key.session_id,'device_id':D})
  if r.status_code!=200:raise RuntimeError(f'delegation HTTP {r.status_code}')
  return r.json()['delegation_token']
async def create(t):
 sessions=[{'session_number':i,'title':f'Học tiếng Anh — Buổi {i}','priority':'MEDIUM','due_at':f'2026-11-{i:02d}T19:00:00+07:00'} for i in range(1,11)]
 body={'confirmed':True,'title':'Kế hoạch học tiếng Anh tháng 11/2026','goal':'Hoàn thành 10 buổi học tiếng Anh','total_sessions':10,'start_date':'2026-11-01','end_date':'2026-11-30','sessions':sessions}
 async with httpx.AsyncClient(timeout=15,trust_env=False) as c:
  r=await c.post(B+'/user/plans',headers={'Authorization':'Bearer '+t},json=body)
  if r.status_code!=201:raise RuntimeError(f'plan create HTTP {r.status_code}: {r.text[:500]}')
  plan=r.json();ids=[str(x['task_id']) for x in plan['sessions']]
  completed=[]
  for task_id in ids[:3]:
   x=await c.post(B+f"/user/plans/{plan['id']}/sessions/{task_id}/complete",headers={'Authorization':'Bearer '+t},json={})
   if x.status_code!=200:raise RuntimeError(f'complete {task_id} HTTP {x.status_code}: {x.text[:300]}')
   completed.append({'task_id':task_id,'http':x.status_code})
  refreshed=await c.get(B+f"/user/plans/{plan['id']}",headers={'Authorization':'Bearer '+t})
  if refreshed.status_code!=200:raise RuntimeError(f'plan get HTTP {refreshed.status_code}')
 print(json.dumps({'create_http':r.status_code,'plan_id':str(plan['id']),'task_ids':ids,'completed':completed,'get_http':refreshed.status_code,'plan':refreshed.json()},ensure_ascii=False))
async def cleanup(t):
 plan_id=os.environ['PA18_PLAN_ID']
 async with httpx.AsyncClient(timeout=15,trust_env=False) as c:r=await c.delete(B+'/user/plans/'+plan_id,headers={'Authorization':'Bearer '+t})
 if r.status_code!=200:raise RuntimeError(f'cleanup HTTP {r.status_code}: {r.text[:500]}')
 print(json.dumps({'plan_id':plan_id,'delete_http':r.status_code,'response':r.json()}))
async def make(t,sid,service):
 s=S(t,sid);s.delegation_token=await s.calendar_delegation('schedule.query',ctx());a=BackendScheduleAdapter(B,service,delegation_provider=s.calendar_delegation);return s,a,CalendarVoiceWorkflow(schedule_query_only=True)
async def ask(s,a,w,text):
 n=len(a.http_trace);actual=await handle_local_voice_transcript(s,text,ctx(),a,w,s.key.session_id);return {'input':text,'actual':actual,'http':a.http_trace[n:]}
async def test(t):
 service=os.environ['AI_SERVER_BACKEND_TOOL_SERVICE_TOKEN'];s,a,w=await make(t,'pa18-plan-a-'+uuid4().hex,service)
 qs=['Kế hoạch học tiếng Anh của tôi tiến độ thế nào?','Tôi đã hoàn thành bao nhiêu buổi học tiếng Anh?','Tôi còn bao nhiêu buổi chưa hoàn thành?','Báo cáo tiến độ kế hoạch học tiếng Anh trong tháng này.']
 results=[await ask(s,a,w,q) for q in qs];s2,a2,w2=await make(t,'pa18-plan-b-'+uuid4().hex,service);cross=await ask(s2,a2,w2,qs[0]);print(json.dumps({'session_a':s.key.session_id,'session_b':s2.key.session_id,'results':results,'cross':cross},ensure_ascii=False))
async def main():
 t=await login();await {'create':create,'test':test,'cleanup':cleanup}[os.environ['PA18_PLAN_ACTION']](t)
if __name__=='__main__':asyncio.run(main())
