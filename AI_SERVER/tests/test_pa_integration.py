"""H-07 component integration with real unavailable boundaries, no success double."""
import asyncio
from datetime import datetime

from app.personal_assistant.personalization import memory_handoff
from app.personal_assistant.schema import Analysis
from app.personal_assistant.tool_boundary import TrustedToolContext
from app.personal_assistant.tool_planning import plan_tools
from app.personal_assistant.tool_registry import TOOLS
from app.personal_assistant.workflow import WorkflowOrchestrator

RAW = 'Tạo lịch học và nhắc trước 30 phút. Tôi thích cà phê.'


def analysis(action='propose'):
    return Analysis(scope='pa', raw_input=RAW, timezone='Asia/Bangkok', model='unit-intent-fixture',
        reference_time=datetime.fromisoformat('2026-11-15T10:00:00+07:00'), operations=[
            dict(id='op1', intent='tạo lịch', feature='PA-01', action='create', source_text='Tạo lịch học',
                 entities={'title': 'học', 'start': {'raw': 'Tạo lịch học', 'date': '2026-11-16', 'time': '17:00'},
                           'end': {'raw': 'Tạo lịch học', 'date': '2026-11-16', 'time': '19:00'}}),
            dict(id='op2', intent='nhắc', feature='PA-02', action='create', source_text='nhắc trước 30 phút',
                 entities={'reminder_offset_minutes': 30}, depends_on=['op1']),
            dict(id='op3', intent='sở thích', feature='PA-04', action=action, source_text='Tôi thích cà phê.',
                 entities={'content': 'thích cà phê'})])


def context():
    return TrustedToolContext('h07-test', 'h07-session', 'h07-correlation',
        allowed_tools=frozenset(TOOLS), satisfied_preconditions=frozenset({('op3', 'sensitive_data_checked')}))


def test_combined_plan_has_no_available_write_and_all_steps_are_blocked():
    async def run():
        parsed, ctx = analysis(), context()
        plan = plan_tools(parsed, ctx)
        assert [item.tool_id for item in plan.calls] == ['event.create', 'reminder.create']
        assert [item.tool_id for item in plan.proposals] == ['memory.propose']
        assert plan.calls[1].depends_on == ['op1']
        assert memory_handoff(parsed)[0] == 'PROPOSED'
        wf = await WorkflowOrchestrator().create(plan, ctx)
        assert wf.state == 'BLOCKED'
        assert all(step.state == 'BLOCKED' for step in wf.steps)
        assert not any(step.result and step.result.executed for step in wf.steps)
    asyncio.run(run())


def test_refusing_storage_preserves_schedule_plan_without_unsupported_business_action():
    parsed = analysis('cancel')
    plan = plan_tools(parsed, context())
    assert memory_handoff(parsed)[0] == 'DECLINED'
    assert [item.tool_id for item in plan.calls] == ['event.create', 'reminder.create']
    assert plan.unsupported_operations == {}
    assert plan.deferred_operations == {'op3': 'MEMORY_STORAGE_DECLINED'}
