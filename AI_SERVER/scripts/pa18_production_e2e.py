"""Authorized PA-18 dataset actions and read-only conversational E2E."""
import asyncio,json,os,time
from types import SimpleNamespace
from uuid import uuid4
import httpx
from app.personal_assistant.backend_schedule import BackendScheduleAdapter
from app.services.audio_context import AudioContext
from app.services.calendar_voice import CalendarVoiceWorkflow
from app.services.live_local import handle_local_voice_transcript

B='http://127.0.0.1:3000'; U='2'; D='3'
def ctx(): return AudioContext(deadline=time.monotonic()+60)
async def login():
 p=os.environ.pop('AIVA_PA18_PASSWORD',None)
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
 specs=[('Hoàn thành kiểm thử PA-18','2026-11-21T09:00:00+07:00'),('Viết báo cáo tổng kết ngày','2026-11-21T20:00:00+07:00'),('Rà soát lỗi tồn đọng','2026-11-20T18:00:00+07:00'),('Chuẩn bị báo cáo tuần','2026-11-22T11:00:00+07:00'),('Hoàn thành tài liệu tháng','2026-11-15T12:00:00+07:00')]
 made=[]
 async with httpx.AsyncClient(timeout=10,trust_env=False) as c:
  for title,due in specs:
   r=await c.post(B+'/user/tasks',headers={'Authorization':'Bearer '+t},json={'title':title,'due_at':due,'priority':'MEDIUM'})
   if r.status_code!=201:raise RuntimeError(f'create {title} HTTP {r.status_code}: {r.text[:200]}')
   made.append({'id':str(r.json()['id']),'title':title,'http':r.status_code})
  for i in (0,4):
   r=await c.post(B+f"/user/tasks/{made[i]['id']}/complete",headers={'Authorization':'Bearer '+t},json={})
   if r.status_code!=200:raise RuntimeError(f'complete HTTP {r.status_code}')
   made[i]['complete_http']=r.status_code
 print(json.dumps({'tasks':made},ensure_ascii=False))
async def cleanup(t):
 out=[]
 async with httpx.AsyncClient(timeout=10,trust_env=False) as c:
  for i in os.environ['PA18_IDS'].split(','):
   r=await c.delete(B+'/user/tasks/'+i,headers={'Authorization':'Bearer '+t});out.append({'id':i,'http':r.status_code})
   if r.status_code!=200:raise RuntimeError(f'delete {i} HTTP {r.status_code}: {r.text[:200]}')
 print(json.dumps({'deleted':out}))
async def make(t,sid,service):
 s=S(t,sid);s.delegation_token=await s.calendar_delegation('schedule.query',ctx());a=BackendScheduleAdapter(B,service,delegation_provider=s.calendar_delegation);return s,a,CalendarVoiceWorkflow(schedule_query_only=True)
async def ask(s,a,w,text):
 n=len(a.http_trace);answer=await handle_local_voice_transcript(s,text,ctx(),a,w,s.key.session_id);return {'input':text,'actual':answer,'http':a.http_trace[n:]}
async def test(t):
 service=os.environ['AI_SERVER_BACKEND_TOOL_SERVICE_TOKEN'];s,a,w=await make(t,'pa18-a-'+uuid4().hex,service)
 q=['Báo cáo công việc của tôi hôm nay.','Tổng kết công việc của tôi tuần này.','Báo cáo tiến độ của tôi trong tháng này.','Những công việc nào tôi chưa hoàn thành trong tuần này?','Tôi đã hoàn thành bao nhiêu công việc trong tháng này?']
 results=[await ask(s,a,w,x) for x in q];s2,a2,w2=await make(t,'pa18-b-'+uuid4().hex,service);cross=await ask(s2,a2,w2,q[1]);print(json.dumps({'session_a':s.key.session_id,'session_b':s2.key.session_id,'results':results,'cross':cross},ensure_ascii=False))
async def main():
 t=await login();action=os.environ['PA18_ACTION'];await {'create':create,'cleanup':cleanup,'test':test}[action](t)
if __name__=='__main__':asyncio.run(main())
