"""Authorized one-shot PA-08 dataset actions. Credentials are environment-only."""
import asyncio, json, os, time
from types import SimpleNamespace
from uuid import uuid4
import httpx
from app.personal_assistant.backend_schedule import BackendScheduleAdapter
from app.personal_assistant.tool_boundary import TrustedToolContext
from app.services.audio_context import AudioContext
from app.services.calendar_voice import CalendarVoiceWorkflow
from app.services.live_local import handle_local_voice_transcript

BACKEND='http://127.0.0.1:3000'; USER='2'; DEVICE='3'
def ctx(): return AudioContext(deadline=time.monotonic()+60)

async def login():
    password=os.environ.pop('AIVA_PA08_PASSWORD',None)
    async with httpx.AsyncClient(timeout=10,trust_env=False) as c:
        r=await c.post(BACKEND+'/auth/login',json={'email':'tranlehoang205@gmail.com','password':password})
    if r.status_code != 200: raise RuntimeError(f'login HTTP {r.status_code}')
    return r.json()['access_token']

class Session:
    def __init__(self,token,sid): self.token=token; self.key=SimpleNamespace(user_id=USER,device_id=DEVICE,session_id=sid); self.delegation_token=None
    async def calendar_delegation(self,scope,_context):
        async with httpx.AsyncClient(timeout=10,trust_env=False) as c:
            r=await c.post(BACKEND+'/auth/tool-delegations',headers={'Authorization':'Bearer '+self.token},json={'scope':scope,'session_id':self.key.session_id,'device_id':DEVICE})
        if r.status_code != 200: raise RuntimeError(f'delegation HTTP {r.status_code}')
        return r.json()['delegation_token']

async def calendar(token):
    session=Session(token,'pa08-data-'+uuid4().hex); session.delegation_token=await session.calendar_delegation('schedule.query',ctx())
    adapter=BackendScheduleAdapter(BACKEND,os.environ['AI_SERVER_BACKEND_TOOL_SERVICE_TOKEN'],delegation_provider=session.calendar_delegation)
    return session,adapter,CalendarVoiceWorkflow(schedule_query_only=False)

async def create_event(token):
    session,adapter,wf=await calendar(token); text=os.environ['PA08_EVENT_INPUT']
    proposal=await handle_local_voice_transcript(session,text,ctx(),adapter,wf,session.key.session_id)
    created=await handle_local_voice_transcript(session,'Đồng ý, tạo lịch đi.',ctx(),adapter,wf,session.key.session_id)
    trusted=TrustedToolContext(USER,session.key.session_id,session.key.session_id,device_id=DEVICE,dialogue_ready=True)
    result=await adapter.execute('event.query',SimpleNamespace(from_iso=os.environ['PA08_FROM'],to_iso=os.environ['PA08_TO']),trusted,operation_id=wf._operation_id(),request_context=ctx())
    matches=[x for x in (result.data or {}).get('items',[]) if x.get('title')==os.environ['PA08_TITLE']]
    if created!='Đã tạo lịch thành công.' or len(matches)!=1: raise RuntimeError(f'event create failed: {proposal} / {created} / matches={len(matches)}')
    print(json.dumps({'proposal':proposal,'actual':created,'event_id':str(matches[0]['id']),'http':adapter.http_trace},ensure_ascii=False))

async def delete_event(token):
    session,adapter,wf=await calendar(token); event_id=os.environ['PA08_EVENT_ID']
    trusted=TrustedToolContext(USER,session.key.session_id,session.key.session_id,device_id=DEVICE,dialogue_ready=True)
    payload={'operation':'delete','event_id':event_id,'idempotency_key':'pa08-cleanup-'+uuid4().hex}
    prepared=await adapter.prepare_confirmation('delete',payload,trusted,ctx()); confirmed=await adapter.confirm_confirmation(prepared['pending_id'],payload,trusted,ctx())
    result=await adapter.execute('event.delete',{**payload,'confirmed':True,'confirmation_proof':confirmed['confirmation_proof']},trusted,operation_id=wf._operation_id(),request_context=ctx())
    if result.status!='SUCCESS': raise RuntimeError(f'event delete failed: {result.status}')
    print(json.dumps({'event_id':event_id,'status':result.status,'http':adapter.http_trace},ensure_ascii=False))

async def create_tasks(token):
    specs=[('Hoàn thiện báo cáo PA-08','2026-11-21T20:00:00+07:00'),('Chuẩn bị demo Xiaozhi','2026-11-22T11:00:00+07:00'),('Rà soát tài liệu cũ','2026-11-20T18:00:00+07:00'),('Gửi biên bản họp','2026-11-21T17:00:00+07:00'),('Kiểm tra danh sách thiết bị',None)]
    made=[]
    async with httpx.AsyncClient(timeout=10,trust_env=False) as c:
        for title,due in specs:
            body={'title':title,'priority':'MEDIUM'}
            if due: body['due_at']=due
            r=await c.post(BACKEND+'/user/tasks',headers={'Authorization':'Bearer '+token},json=body)
            if r.status_code != 201: raise RuntimeError(f'task create {title} HTTP {r.status_code}: {r.text[:200]}')
            made.append({'id':str(r.json()['id']),'title':title,'create_http':r.status_code})
        completed=await c.post(BACKEND+f"/user/tasks/{made[3]['id']}/complete",headers={'Authorization':'Bearer '+token},json={})
        if completed.status_code != 200: raise RuntimeError(f'task complete HTTP {completed.status_code}: {completed.text[:200]}')
        made[3]['complete_http']=completed.status_code
    print(json.dumps({'tasks':made},ensure_ascii=False))

async def delete_tasks(token):
    ids=[x for x in os.environ['PA08_TASK_IDS'].split(',') if x]; results=[]
    async with httpx.AsyncClient(timeout=10,trust_env=False) as c:
        for task_id in ids:
            r=await c.delete(BACKEND+f'/user/tasks/{task_id}',headers={'Authorization':'Bearer '+token})
            results.append({'id':task_id,'http':r.status_code})
            if r.status_code != 200: raise RuntimeError(f'task delete {task_id} HTTP {r.status_code}: {r.text[:200]}')
    print(json.dumps({'deleted_tasks':results},ensure_ascii=False))

async def main():
    token=await login(); action=os.environ['PA08_ACTION']
    await {'create_event':create_event,'delete_event':delete_event,'create_tasks':create_tasks,'delete_tasks':delete_tasks}[action](token)
if __name__=='__main__': asyncio.run(main())
