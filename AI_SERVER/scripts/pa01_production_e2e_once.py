"""One-shot, authorized PA-01 production test. Never stores credentials."""
import asyncio
import json
import os
import time
from types import SimpleNamespace
from uuid import uuid4

import httpx

from app.personal_assistant.backend_schedule import BackendScheduleAdapter
from app.personal_assistant.tool_boundary import TrustedToolContext
from app.services.audio_context import AudioContext
from app.services.calendar_voice import CalendarVoiceWorkflow
from app.services.live_local import handle_local_voice_transcript

BACKEND = "http://127.0.0.1:3000"
USER_ID, DEVICE_ID = "2", "3"


class RealSession:
    def __init__(self, access_token: str, session_id: str):
        self.access_token = access_token
        self.key = SimpleNamespace(user_id=USER_ID, device_id=DEVICE_ID, session_id=session_id)
        self.delegation_token = None

    async def calendar_delegation(self, scope, _context):
        async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
            response = await client.post(BACKEND + "/auth/tool-delegations",
                headers={"Authorization": "Bearer " + self.access_token},
                json={"scope": scope, "session_id": self.key.session_id,
                      "device_id": DEVICE_ID})
        if response.status_code != 200:
            raise RuntimeError(f"delegation {scope} HTTP {response.status_code}")
        return response.json()["delegation_token"]


def context():
    return AudioContext(deadline=time.monotonic() + 60)


async def login():
    password = os.environ.pop("AIVA_PA01_PASSWORD", None)
    if not password:
        raise RuntimeError("test password unavailable")
    async with httpx.AsyncClient(timeout=10, trust_env=False) as client:
        response = await client.post(BACKEND + "/auth/login", json={
            "email": "tranlehoang205@gmail.com", "password": password})
    if response.status_code != 200:
        raise RuntimeError(f"login HTTP {response.status_code}")
    return response.status_code, response.json()["access_token"]


async def main():
    login_status, access_token = await login()
    service_token = os.environ.get("AI_SERVER_BACKEND_TOOL_SERVICE_TOKEN", "")
    if not service_token:
        raise RuntimeError("tool service token unavailable")
    session_a = RealSession(access_token, "pa01-prod-session-a-" + uuid4().hex)
    session_a.delegation_token = await session_a.calendar_delegation("schedule.query", context())
    adapter_a = BackendScheduleAdapter(BACKEND, service_token,
        delegation_provider=session_a.calendar_delegation)
    workflow_a = CalendarVoiceWorkflow(schedule_query_only=False)

    first = "Tạo lịch học tiếng Anh ngày 22 tháng 11 năm 2026 từ 8 giờ đến 10 giờ sáng."
    confirmation = "Đồng ý, tạo lịch đi."
    proposal = await handle_local_voice_transcript(session_a, first, context(), adapter_a,
        workflow_a, session_a.key.session_id)
    draft_debug = dict(next(iter(workflow_a._drafts.values()))) if workflow_a._drafts else None
    created = await handle_local_voice_transcript(session_a, confirmation, context(), adapter_a,
        workflow_a, session_a.key.session_id)
    query_text = "Ngày 22 tháng 11 năm 2026 tôi có lịch gì?"
    same = await handle_local_voice_transcript(session_a, query_text, context(), adapter_a,
        workflow_a, session_a.key.session_id)

    session_b = RealSession(access_token, "pa01-prod-session-b-" + uuid4().hex)
    session_b.delegation_token = await session_b.calendar_delegation("schedule.query", context())
    adapter_b = BackendScheduleAdapter(BACKEND, service_token,
        delegation_provider=session_b.calendar_delegation)
    workflow_b = CalendarVoiceWorkflow(schedule_query_only=False)
    cross = await handle_local_voice_transcript(session_b, query_text, context(), adapter_b,
        workflow_b, session_b.key.session_id)

    trusted = TrustedToolContext(USER_ID, session_a.key.session_id, session_a.key.session_id,
        device_id=DEVICE_ID, dialogue_ready=True)
    rows = await adapter_a.execute("event.query", SimpleNamespace(
        from_iso="2026-11-22T00:00:00+07:00", to_iso="2026-11-23T00:00:00+07:00"),
        trusted, operation_id=workflow_a._operation_id(), request_context=context())
    matches = [item for item in rows.data.get("items", [])
               if item.get("title") == "Học tiếng Anh"] if rows.status == "SUCCESS" else []
    if len(matches) != 1:
        print(json.dumps({"proposal_response": proposal, "draft": draft_debug, "create_response": created,
            "same_session_response": same, "cross_session_response": cross,
            "adapter_trace": adapter_a.http_trace, "query_status": rows.status,
            "query_data": rows.data, "errors": adapter_a.error_trace}, ensure_ascii=False))
        raise RuntimeError(f"expected exactly one test event, found {len(matches)}")
    event_id = str(matches[0]["id"])

    delete_payload = {"operation": "delete", "event_id": event_id,
                      "idempotency_key": "cleanup-" + uuid4().hex}
    prepared = await adapter_a.prepare_confirmation("delete", delete_payload, trusted, context())
    if not prepared:
        raise RuntimeError("cleanup prepare failed")
    confirmed = await adapter_a.confirm_confirmation(prepared["pending_id"], delete_payload,
        trusted, context())
    if not confirmed:
        raise RuntimeError("cleanup confirm failed")
    delete_args = {**delete_payload, "confirmed": True,
                   "confirmation_proof": confirmed["confirmation_proof"]}
    deleted = await adapter_a.execute("event.delete", delete_args, trusted,
        operation_id=workflow_a._operation_id(), request_context=context())
    print(json.dumps({
        "login_http": login_status,
        "session_a": session_a.key.session_id,
        "session_b": session_b.key.session_id,
        "create_input": first,
        "confirmation_input": confirmation,
        "proposal_response": proposal,
        "create_response": created,
        "query_input": query_text,
        "same_session_response": same,
        "cross_session_response": cross,
        "event_id": event_id,
        "create_and_query_http": adapter_a.http_trace[:-3],
        "cross_query_http": adapter_b.http_trace,
        "cleanup_http": adapter_a.http_trace[-3:],
        "cleanup_status": deleted.status,
    }, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
