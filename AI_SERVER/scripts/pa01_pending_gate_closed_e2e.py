"""Authenticated two-turn PA-01 tests with the production Calendar gate closed."""
import asyncio, json, os, time
from types import SimpleNamespace
from uuid import uuid4
import httpx
from app.personal_assistant.backend_schedule import BackendScheduleAdapter
from app.services.audio_context import AudioContext
from app.services.calendar_voice import CalendarVoiceWorkflow
from app.services.live_local import handle_local_voice_transcript

BACKEND = "http://127.0.0.1:3000"
USER_ID, DEVICE_ID = "2", "3"

def context(): return AudioContext(deadline=time.monotonic() + 60)

async def login():
    password = os.environ.pop("AIVA_PA01_PASSWORD", None)
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        response = await client.post(BACKEND + "/auth/login", json={"email": "tranlehoang205@gmail.com", "password": password})
    if response.status_code != 200: raise RuntimeError(f"login HTTP {response.status_code}")
    return response.json()["access_token"]

class Session:
    def __init__(self, token, session_id):
        self.token = token
        self.key = SimpleNamespace(user_id=USER_ID, device_id=DEVICE_ID, session_id=session_id)
        self.delegation_token = None
    async def calendar_delegation(self, scope, _context):
        async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
            response = await client.post(BACKEND + "/auth/tool-delegations", headers={"Authorization": "Bearer " + self.token}, json={"scope": scope, "session_id": self.key.session_id, "device_id": DEVICE_ID})
        if response.status_code != 200: raise RuntimeError(f"delegation HTTP {response.status_code}")
        return response.json()["delegation_token"]

async def make(token, session_id):
    session = Session(token, session_id)
    session.delegation_token = await session.calendar_delegation("schedule.query", context())
    adapter = BackendScheduleAdapter(BACKEND, os.environ["AI_SERVER_BACKEND_TOOL_SERVICE_TOKEN"], delegation_provider=session.calendar_delegation)
    return session, adapter

async def say(session, adapter, workflow, text):
    return await handle_local_voice_transcript(session, text, context(), adapter, workflow, session.key.session_id)

async def main():
    token = await login()
    request = "Tạo lịch học tiếng Anh ngày mai từ 1 giờ chiều đến 3 giờ chiều."
    output = {}
    session, adapter = await make(token, "pa01-confirm-" + uuid4().hex)
    workflow = CalendarVoiceWorkflow(schedule_query_only=False)
    output["proposal"] = await say(session, adapter, workflow, request)
    output["pending_before_confirm"] = dict(next(iter(workflow._drafts.values())))
    output["confirm"] = await say(session, adapter, workflow, "Đồng ý tạo lịch")
    output["confirm_http"] = adapter.http_trace
    exact_session, exact_adapter = await make(token, "pa01-exact-" + uuid4().hex)
    exact_workflow = CalendarVoiceWorkflow(schedule_query_only=False)
    await say(exact_session, exact_adapter, exact_workflow, request)
    output["exact_confirm"] = await say(exact_session, exact_adapter, exact_workflow, "Đồng ý.")
    refuse_session, refuse_adapter = await make(token, "pa01-refuse-" + uuid4().hex)
    refuse_workflow = CalendarVoiceWorkflow(schedule_query_only=False)
    await say(refuse_session, refuse_adapter, refuse_workflow, request)
    output["refuse"] = await say(refuse_session, refuse_adapter, refuse_workflow, "Không đồng ý")
    output["refuse_pending"] = len(refuse_workflow._drafts)
    change_session, change_adapter = await make(token, "pa01-change-" + uuid4().hex)
    change_workflow = CalendarVoiceWorkflow(schedule_query_only=False)
    await say(change_session, change_adapter, change_workflow, request)
    output["change"] = await say(change_session, change_adapter, change_workflow, "Đổi sang 2 giờ chiều")
    output["changed_pending"] = dict(next(iter(change_workflow._drafts.values())))
    output["change_confirm"] = await say(change_session, change_adapter, change_workflow, "Đúng rồi")
    output["change_http"] = change_adapter.http_trace
    shared_workflow = CalendarVoiceWorkflow(schedule_query_only=False)
    session_a, adapter_a = await make(token, "pa01-isolate-a-" + uuid4().hex)
    session_b, adapter_b = await make(token, "pa01-isolate-b-" + uuid4().hex)
    await say(session_a, adapter_a, shared_workflow, request)
    output["other_session_confirm"] = await say(session_b, adapter_b, shared_workflow, "Đồng ý")
    output["isolation_http"] = adapter_b.http_trace
    output["session_a_pending"] = len(shared_workflow._drafts)
    print(json.dumps(output, ensure_ascii=False))

if __name__ == "__main__": asyncio.run(main())
