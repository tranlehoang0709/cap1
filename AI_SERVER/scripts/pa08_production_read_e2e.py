"""Read-only PA-08 E2E through the shared Xiaozhi transcript workflow."""
import asyncio, json, os, time
from types import SimpleNamespace
from uuid import uuid4
import httpx

from app.personal_assistant.backend_schedule import BackendScheduleAdapter
from app.services.audio_context import AudioContext
from app.services.calendar_voice import CalendarVoiceWorkflow
from app.services.live_local import handle_local_voice_transcript

BACKEND='http://127.0.0.1:3000'; USER_ID='2'; DEVICE_ID='3'

def context(): return AudioContext(deadline=time.monotonic()+60)

class Session:
    def __init__(self, token, sid):
        self.token=token; self.key=SimpleNamespace(user_id=USER_ID,device_id=DEVICE_ID,session_id=sid)
        self.delegation_token=None
    async def calendar_delegation(self, scope, _context):
        async with httpx.AsyncClient(timeout=10,trust_env=False) as client:
            response=await client.post(BACKEND+'/auth/tool-delegations',
                headers={'Authorization':'Bearer '+self.token},
                json={'scope':scope,'session_id':self.key.session_id,'device_id':DEVICE_ID})
        if response.status_code != 200: raise RuntimeError(f'delegation HTTP {response.status_code}')
        return response.json()['delegation_token']

async def login():
    password=os.environ.pop('AIVA_PA08_PASSWORD',None)
    async with httpx.AsyncClient(timeout=10,trust_env=False) as client:
        response=await client.post(BACKEND+'/auth/login',json={'email':'tranlehoang205@gmail.com','password':password})
    if response.status_code != 200: raise RuntimeError(f'login HTTP {response.status_code}')
    return response.json()['access_token']

async def make(token, sid, service):
    session=Session(token,sid); session.delegation_token=await session.calendar_delegation('schedule.query',context())
    adapter=BackendScheduleAdapter(BACKEND,service,delegation_provider=session.calendar_delegation)
    return session,adapter,CalendarVoiceWorkflow(schedule_query_only=True)

async def ask(session,adapter,workflow,text):
    before=len(adapter.http_trace)
    reply=await handle_local_voice_transcript(session,text,context(),adapter,workflow,session.key.session_id)
    return {'input':text,'actual':reply,'http':adapter.http_trace[before:]}

async def main():
    token=await login(); service=os.environ.get('AI_SERVER_BACKEND_TOOL_SERVICE_TOKEN','')
    session_a,adapter_a,workflow_a=await make(token,'pa08-session-a-'+uuid4().hex,service)
    inputs=['Hôm nay tôi có lịch gì?','Hôm nay tôi có công việc gì?',
        'Ngày mai tôi có những gì cần làm?','Tôi có công việc nào quá hạn không?',
        'Tôi còn công việc nào chưa hoàn thành?',
        'Ngày 22/11/2026 tôi có lịch gì?']
    results=[await ask(session_a,adapter_a,workflow_a,text) for text in inputs]
    session_b,adapter_b,workflow_b=await make(token,'pa08-session-b-'+uuid4().hex,service)
    cross=[await ask(session_b,adapter_b,workflow_b,inputs[0]),
           await ask(session_b,adapter_b,workflow_b,inputs[2])]
    print(json.dumps({'session_a':session_a.key.session_id,'session_b':session_b.key.session_id,
        'results':results,'cross_session':cross},ensure_ascii=False))

if __name__=='__main__': asyncio.run(main())
