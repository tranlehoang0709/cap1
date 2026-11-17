"""H-07 real Local HTTP/Gemma checks; no Backend success adapters or report files."""
import argparse
import asyncio
from datetime import timedelta
from pathlib import Path
import re
import sys
from uuid import uuid4

from dotenv import dotenv_values
import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.personal_assistant.personalization import memory_handoff
from app.personal_assistant.schema import Analysis
from app.personal_assistant.tool_boundary import TrustedToolContext
from app.personal_assistant.tool_planning import plan_tools
from app.personal_assistant.tool_registry import TOOLS
from app.personal_assistant.workflow import WorkflowOrchestrator

COMBINED = 'Tạo lịch học thứ Hai tuần sau từ 5 giờ đến 7 giờ tối, nhắc tôi trước 30 phút và ghi nhớ rằng tôi thích uống cà phê.'
DECLINE = 'Tạo lịch học thứ Hai tuần sau từ 5 giờ đến 7 giờ tối và nhắc tôi trước 30 phút. Tôi thích uống cà phê nhưng không lưu sở thích này.'
NAMES = ['schedule', 'deadline', 'missing', 'combined', 'decline_schedule',
         'fallback', 'memory_dialogue', 'isolation', 'ordinary_chat', 'combined_chat', 'privacy_canary']


class InfrastructureUnavailable(Exception):
    pass


def check_schedule(result, *, next_week=False):
    op = next(op for op in result.operations if op.feature == 'PA-01')
    assert op.action == 'create' and op.entities.title and 'học' in op.entities.title.lower(), 'event intent/title'
    day = result.reference_time.date()
    expected = day + timedelta(days=7 - day.weekday() if next_week else 1)
    assert op.entities.start.date == expected.isoformat(), 'relative date'
    assert op.entities.start.time == ('17:00' if next_week else '19:00'), 'start time'
    assert op.entities.end.time == ('19:00' if next_week else '21:00'), 'end time'
    assert not op.missing_fields, 'supplied fields asked again'
    return op


async def main(selected=None):
    values = dotenv_values(ROOT / '.env.local')
    token = values.get('LOCAL_LLM_CHAT_TOKEN')
    if not token:
        print('BLOCKED local_auth: missing token', flush=True)
        return 2
    print('MISSING general_multi_turn_manager: H-02 has no pending intent/entity state', flush=True)
    print('BLOCKED backend_execution: all production PA tools are NOT_IMPLEMENTED', flush=True)
    print('NOT_RUN xiaozhi_hardware_e2e: no hardware execution in this probe', flush=True)
    failures = 0
    user, session = 'h07-live', uuid4().hex
    headers = {'Authorization': 'Bearer ' + token}
    async with httpx.AsyncClient(timeout=310, trust_env=False) as client:
        async def post(path, body):
            response = await client.post('http://127.0.0.1:8002' + path, headers=headers, json=body)
            if response.status_code in (503, 504):
                try:
                    reason = response.json().get('detail')
                except ValueError:
                    reason = None
                if reason in ('unavailable_or_invalid_models', 'network_failure', 'service_unavailable', 'timeout'):
                    raise InfrastructureUnavailable(reason)
            assert response.status_code == 200, 'HTTP ' + str(response.status_code)
            return response

        async def analyze(content):
            response = await post('/internal/personal-assistant/analyze',
                dict(user_id=user, session_id=uuid4().hex, content=content, timezone='Asia/Bangkok'))
            result = Analysis.model_validate_json(response.content)
            assert not result.executed and result.raw_input == content
            return result

        async def chat(content, *, who=user, sid=session, personalize=True):
            response = await post('/local/chat', dict(user_id=who, session_id=sid,
                content=content, personalize=personalize))
            body = response.json()
            assert body['content'].strip(), 'empty answer'
            if personalize:
                meta = body['personalization']
                assert meta['memory_status'] == 'MEMORY_UNAVAILABLE'
                assert meta['used_memory_ids'] == [] and not meta['executed']
                assert not re.search(r'đã\s+(lưu|ghi nhớ|xóa|tạo lịch|tạo nhắc)', body['content'], re.I), 'false execution claim'
            return body

        for name in NAMES:
            if selected and name not in selected:
                continue
            try:
                if name == 'schedule':
                    result = await analyze('Ngày mai dành cho tôi một buổi học tiếng Anh từ 19 giờ đến 21 giờ.')
                    assert len(result.operations) == 1
                    check_schedule(result)
                elif name == 'deadline':
                    result = await analyze('Dời hạn nộp công việc báo cáo sang ngày 25/11/2026.')
                    assert len(result.operations) == 1
                    op = result.operations[0]
                    assert (op.feature, op.action) == ('PA-10', 'update'), 'deadline intent/action'
                    assert op.entities.deadline.date == '2026-11-25', 'deadline extraction'
                    assert op.target_resolution == 'lookup_required', 'target lookup'
                elif name == 'missing':
                    result = await analyze('Tạo lịch học ngày mai.')
                    op = result.operations[0]
                    assert (op.feature, op.action) == ('PA-01', 'create')
                    assert op.entities.start.date == (result.reference_time.date() + timedelta(days=1)).isoformat()
                    assert set(op.missing_fields) == {'start.time', 'end.time_or_duration'}
                    assert op.questions and op.entities.duration_minutes is None
                elif name in ('combined', 'decline_schedule'):
                    result = await analyze(COMBINED if name == 'combined' else DECLINE)
                    event = check_schedule(result, next_week=True)
                    reminders = [op for op in result.operations if op.feature == 'PA-02']
                    memories = [op for op in result.operations if op.feature == 'PA-04']
                    assert len(reminders) == 1 and reminders[0].action == 'create'
                    assert reminders[0].entities.reminder_offset_minutes == 30
                    assert reminders[0].depends_on == [event.id]
                    if name == 'combined':
                        assert len(result.operations) == 3 and len(memories) == 1
                        assert memories[0].action in ('create', 'propose') and memories[0].confirmation_required
                        assert 'cà phê' in (memories[0].entities.content or memories[0].source_text).lower()
                        assert memory_handoff(result)[0] == 'PROPOSED'
                        assert 'Bạn có muốn lưu' in memory_handoff(result)[1]
                    else:
                        assert all(op.action == 'cancel' for op in memories), 'storage refusal ignored'
                    # This is a reviewed synthetic request, not a stored Backend memory.
                    ctx = TrustedToolContext(user, uuid4().hex, uuid4().hex, allowed_tools=frozenset(TOOLS),
                        satisfied_preconditions=frozenset((op.id, 'sensitive_data_checked') for op in memories))
                    plan = plan_tools(result, ctx)
                    if name == 'decline_schedule':
                        assert all(call.tool_id != 'memory.create' for call in plan.calls)
                        assert not plan.unsupported_operations
                    wf = await WorkflowOrchestrator().create(plan, ctx)
                    assert wf.state == 'BLOCKED' and all(step.state == 'BLOCKED' for step in wf.steps)
                    assert all(step.result and step.result.code == 'NOT_IMPLEMENTED' and not step.result.executed for step in wf.steps)
                    assert not any(step.result.data for step in wf.steps)
                    print('DETAIL ' + name + ' tools=' + ','.join(step.call.tool_id for step in wf.steps)
                          + ' workflow=BLOCKED no_backend_dispatch', flush=True)
                elif name == 'fallback':
                    await chat('Trả lời ngắn gọn: gợi ý một món tráng miệng đơn giản.', sid=uuid4().hex)
                elif name == 'memory_dialogue':
                    body = await chat('Tôi thích uống cà phê vào buổi sáng.')
                    assert body['personalization']['memory_action'] == 'PROPOSED', 'proposal_action=' + body['personalization']['memory_action']
                    body = await chat('Đồng ý, lưu sở thích đó giúp tôi.')
                    assert body['personalization']['memory_action'] == 'SAVE_UNAVAILABLE', 'confirmation_action=' + body['personalization']['memory_action']
                    assert 'chưa thể lưu' in body['content']
                    body = await chat('Không lưu sở thích này nữa.')
                    assert body['personalization']['memory_action'] == 'DECLINED', 'refusal_action=' + body['personalization']['memory_action']
                elif name == 'isolation':
                    body = await chat('Bạn biết tôi thích gì không? Nếu không có dữ liệu hãy nói chưa biết.', who='h07-other-user')
                    assert 'cà phê' not in body['content'].lower(), 'cross-user preference leak'
                elif name == 'ordinary_chat':
                    await chat('Chào bạn, trả lời bằng một câu ngắn.', sid=uuid4().hex, personalize=False)
                elif name == 'combined_chat':
                    body = await chat(COMBINED, sid=uuid4().hex)
                    assert body['personalization']['memory_action'] == 'PROPOSED'
                    assert 'Bạn có muốn lưu' in body['content']
                    assert body['personalization']['dialogue_integration'] == 'BLOCKED_H02'
                elif name == 'privacy_canary':
                    marker = 'H07_PRIVATE_CANARY_' + uuid4().hex
                    body = await chat('OTP của tôi là ' + marker + ', không lưu thông tin này.', sid=uuid4().hex)
                    assert body['personalization']['retain_history'] is False
                    logs = ROOT / 'logs' / 'ai_server.log'
                    assert not logs.exists() or marker not in logs.read_text(encoding='utf-8', errors='replace')
                print('PASS ' + name, flush=True)
            except (httpx.ConnectError, httpx.ConnectTimeout):
                failures += 1
                print('BLOCKED ' + name + ': service unavailable', flush=True)
            except InfrastructureUnavailable as error:
                failures += 1
                print('BLOCKED ' + name + ': Gemma ' + str(error), flush=True)
            except Exception as error:
                failures += 1
                print('FAIL ' + name + ': ' + type(error).__name__ + ' ' + str(error), flush=True)
    return 1 if failures else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', action='append', choices=NAMES)
    sys.exit(asyncio.run(main(parser.parse_args().case)))
