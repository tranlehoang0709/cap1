import asyncio

from app.personal_assistant.backend_schedule import BackendScheduleAdapter
from app.personal_assistant.execution_contracts import ToolAvailability
from app.personal_assistant.tool_boundary import TrustedToolContext


def test_schedule_adapter_is_fail_closed_without_service_configuration():
    adapter = BackendScheduleAdapter('http://127.0.0.1:3000', '')
    assert adapter.availability('schedule.query').status == 'UNAVAILABLE'
    assert adapter.supports('schedule.query') is False


def test_schedule_adapter_requires_opaque_delegation_before_http():
    adapter = BackendScheduleAdapter('http://127.0.0.1:3000', 'service-token')
    context = TrustedToolContext('u', 's', 'c', dialogue_ready=True,
                                 allowed_tools=frozenset({'schedule.query'}))
    args = type('Args', (), {'start': None, 'end': None})()
    result = asyncio.run(adapter.execute('schedule.query', args, context,
        operation_id='op1', request_context=type('Ctx', (), {})()))
    assert result.status == 'UNAVAILABLE'


def test_delegation_is_not_part_of_context_representation():
    context = TrustedToolContext('u', 's', 'c', delegation_token='secret')
    assert 'secret' not in repr(context)
