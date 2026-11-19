import asyncio
from datetime import datetime
import json
import time

import httpx
import pytest
from pydantic import ValidationError

from app.models.llm import ConversationKey, ProviderDelta, ProviderDone
from app.personal_assistant.schema import Interpretation
from app.personal_assistant.understanding import IntentUnderstanding, UnderstandingError, guard

NOW = datetime.fromisoformat('2026-11-14T23:30:00+07:00')
TOKEN = 'P' * 43


def operation(feature='PA-01', action='create', **kwargs):
    value = dict(id='op1', intent='test', feature=feature, action=action, source_text='ngày mai')
    value.update(kwargs)
    return value


def guarded(ops, raw='ngày mai', scope='pa'):
    return guard(Interpretation(scope=scope, operations=ops), raw, NOW, 'Asia/Bangkok', 'gemma')


def test_missing_fields_and_no_execution():
    result = guarded([operation(entities={'title': 'Học', 'start': {'raw': 'ngày mai'}})])
    op = result.operations[0]
    assert op.entities.start.date == '2026-11-15'
    assert set(op.missing_fields) == {'start.time', 'end.time_or_duration'}
    assert op.state == 'missing_information'
    assert result.executed is False and result.mode == 'analysis_only'


@pytest.mark.parametrize('raw,expected', [
    ('ngày 20/11/2026', '2026-11-20'),
    ('ngày 20/11/2026.', '2026-11-20'),
    ('2026-11-20', '2026-11-20'),
    ('ngày 29/2/2028', '2028-02-29'),
])
def test_absolute_date_preserves_calendar_and_time_in_utc(raw, expected):
    result = guard(Interpretation(scope='pa', operations=[operation(source_text=raw,
        entities={'title': 'Họp', 'start': {'raw': raw, 'time': '08:00'},
                  'end': {'raw': raw, 'time': '09:00'}})]), raw,
        NOW, 'UTC', 'gemma')
    op = result.operations[0]
    assert op.entities.start.date == op.entities.end.date == expected
    assert op.entities.start.time == '08:00' and op.entities.end.time == '09:00'
    assert result.timezone == 'UTC' and not op.missing_fields
    assert result.executed is False


@pytest.mark.parametrize('raw', ['31/11/2026', '29/02/2026', '20/13/2026',
                                  '2026-02-30', '20/11/2026 và 21/11/2026'])
def test_invalid_or_ambiguous_absolute_date_is_not_guessed(raw):
    with pytest.raises(UnderstandingError):
        guarded([operation(source_text=raw, entities={'start': {'raw': raw}})], raw=raw)


def test_does_not_ask_again_for_supplied_fields():
    result = guarded([operation(entities={'title': 'Học',
        'start': {'raw': 'ngày mai', 'time': '19:00'}, 'duration_minutes': 60},
        missing_fields=['title', 'duration_minutes'], questions=['Tên gì?', 'Bao lâu?'])])
    assert result.operations[0].missing_fields == []
    assert result.operations[0].questions == []


def test_three_intents_dependencies_and_isolation():
    ops = [operation(entities={'title': 'Học', 'start': {'raw': 'ngày mai', 'time': '17:00'},
                               'duration_minutes': 120}),
           dict(operation('PA-02', entities={'reminder_offset_minutes': 30}, depends_on=['op1']), id='op2'),
           dict(operation('PA-04', 'propose', entities={'content': 'ăn kem'}), id='op3')]
    result = guarded(ops)
    assert result.operations[1].depends_on == ['op1']
    assert result.operations[1].entities.title is None
    assert result.operations[2].depends_on == []
    assert result.operations[2].confirmation_required
    assert not result.operations[0].missing_fields


@pytest.mark.parametrize('dependencies', [['op1'], ['op2'], ['unknown']])
def test_reject_self_forward_and_unknown_dependencies(dependencies):
    with pytest.raises(ValidationError):
        Interpretation(scope='pa', operations=[operation(depends_on=dependencies)])


def test_reject_duplicate_ids():
    with pytest.raises(ValidationError):
        Interpretation(scope='pa', operations=[operation(), operation()])


@pytest.mark.parametrize('feature,field', [('PA-10', 'deadline'), ('PA-06', 'goal'), ('PA-02', 'reminder_time')])
def test_required_business_fields(feature, field):
    assert field in guarded([operation(feature)]).operations[0].missing_fields


def test_plan_end_change_does_not_reschedule():
    op = guarded([operation('PA-06', 'update', entities={'target_query': 'kế hoạch học',
                  'end': {'raw': 'ngày mai'}})]).operations[0]
    assert 'preserve_existing_schedule' in op.constraints
    assert op.entities.reschedule_requested is False
    assert op.target_resolution == 'lookup_required'


def test_selection_is_never_resolved_by_model():
    op = guarded([operation('PA-10', 'delete', target_resolution='selection_required',
                            entities={'target_query': 'báo cáo'})]).operations[0]
    assert op.state == 'awaiting_selection'
    assert op.confirmation_required


@pytest.mark.parametrize('feature', ['PA-09', 'PA-23'])
def test_capabilities_have_no_backend_execution(feature):
    assert guarded([operation(feature)]).operations[0].state == 'unsupported'


def test_pa05_personalizes_current_turn_without_business_confirmation():
    op = guarded([operation('PA-05', 'update', entities={'content': 'ngày mai'})]).operations[0]
    assert op.state == 'proposed' and not op.confirmation_required
    assert op.target_resolution == 'not_needed'
    assert 'personalization_read_only' in op.constraints


def test_today_and_next_monday():
    result = guarded([operation(source_text='thứ Hai tuần sau, hôm nay', entities={'start': {'raw': 'thứ Hai tuần sau'},
        'deadline': {'raw': 'hôm nay'}})], raw='thứ Hai tuần sau, hôm nay')
    assert result.operations[0].entities.start.date == '2026-11-16'
    assert result.operations[0].entities.deadline.date == '2026-11-14'


def test_query_does_not_create_reminder():
    result = guarded([operation('PA-08', 'query')])
    assert len(result.operations) == 1
    assert not result.operations[0].confirmation_required
    assert result.operations[0].state == 'proposed'


def test_out_of_scope_and_ambiguous():
    for scope in ('out_of_scope', 'ambiguous'):
        assert not guarded([], scope=scope).operations


def test_strict_values_and_execution_claim_rejected():
    with pytest.raises(ValidationError):
        Interpretation(scope='pa', operations=[operation(confirmation_required='yes')])
    with pytest.raises(ValidationError):
        Interpretation.model_validate({'scope': 'out_of_scope', 'executed': True})


@pytest.mark.parametrize('bad', [dict(entities={'target_id': 'fake'}),
                               dict(action='execute'), dict(feature='PA-99'),
                               dict(entities={'start': {'raw': 'ngày mai', 'date': '2026-02-30'}})])
def test_reject_invalid_schema(bad):
    op = operation()
    op.update(bad)
    with pytest.raises(ValidationError):
        Interpretation(scope='pa', operations=[op])


def test_reject_ungrounded_source_and_time():
    with pytest.raises(UnderstandingError):
        guarded([operation(source_text='bịa')])
    with pytest.raises(UnderstandingError):
        guarded([operation(entities={'start': {'raw': 'hôm nay'}})])


def test_temporal_evidence_recovers_verbatim_span_without_inventing_words():
    raw = 'Ngày mai tạo lịch học từ 19 giờ đến 21 giờ.'
    result = guarded([operation(source_text=raw, entities={'title': 'học',
        'start': {'raw': 'ngày mai 19 giờ', 'time': '19:00'},
        'end': {'raw': '21 giờ', 'time': '21:00'}})], raw=raw)
    assert result.operations[0].entities.start.raw == 'Ngày mai tạo lịch học từ 19 giờ'
    assert result.operations[0].entities.start.date == '2026-11-15'
    assert result.operations[0].missing_fields == []


def test_generation_schema_keeps_entity_title_and_excludes_server_fields():
    from app.personal_assistant.schema import generation_schema
    schema = generation_schema()
    assert 'title' in schema['$defs']['Entities']['properties']
    assert 'missing_fields' not in schema['$defs']['Operation']['properties']


class Adapter:
    def __init__(self, answer=None, complete=True):
        self.answer = answer or json.dumps({'scope': 'pa', 'operations': [operation('PA-08', 'query')]})
        self.complete = complete
        self.requests = []

    async def discover_model(self):
        return 'gemma'

    async def stream(self, request, context, *, response_schema=None):
        self.requests.append(request)
        if 'kind' in response_schema['properties'] and self.answer != '{}':
            yield ProviderDelta(json.dumps({'kind': 'new'}))
        else:
            yield ProviderDelta(self.answer)
        yield ProviderDone(self.complete, 'completed' if self.complete else 'token_limit')


@pytest.mark.parametrize('answer,complete', [('not json', True), ('{}', True), (None, False)])
def test_invalid_or_truncated_model_output_fails_closed(answer, complete):
    async def run():
        with pytest.raises(UnderstandingError):
            await IntentUnderstanding(Adapter(answer, complete)).analyze('ngày mai',
                key=ConversationKey('u', 's', 'pa'), reference_time=NOW)
    asyncio.run(run())


def test_reference_clock_uses_session_timezone_across_midnight():
    async def run():
        answer = json.dumps({'scope': 'pa', 'operations': [operation(
            entities={'title': 'học', 'start': {'raw': 'ngày mai', 'time': '19:00'}})]})
        service = IntentUnderstanding(Adapter(answer))
        instant = datetime.fromisoformat('2026-11-14T18:30:00+00:00')
        dates = []
        for zone in ('Asia/Bangkok', 'America/Los_Angeles'):
            result = await service.analyze('ngày mai', key=ConversationKey('u', zone, 'pa'),
                timezone=zone, reference_time=instant)
            dates.append(result.operations[0].entities.start.date)
        assert dates == ['2026-11-16', '2026-11-15']
    asyncio.run(run())


def test_endpoint_auth_isolation_cleanup_and_no_backend(monkeypatch):
    monkeypatch.setenv('AI_RUNTIME', 'local')
    monkeypatch.setenv('LOCAL_LLM_CHAT_TOKEN', TOKEN)
    from app.main import create_app
    app = create_app()
    adapter = Adapter(json.dumps({'scope': 'pa', 'operations': [operation()]}))
    app.state.local_llm = adapter

    class ForbiddenBackend:
        def __getattr__(self, name):
            raise AssertionError('PA must not access Backend')
    app.state.backend_client = ForbiddenBackend()

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            path = '/internal/personal-assistant/analyze'
            payload = dict(user_id='u', session_id='s', content='ngày mai')
            assert (await client.post(path, json=payload)).status_code == 401
            headers = {'Authorization': 'Bearer ' + TOKEN}
            for user, session in [('u', 's'), ('u', 'other'), ('other', 's'), ('u', 's')]:
                payload.update(user_id=user, session_id=session)
                response = await client.post(path, json=payload, headers=headers)
                assert response.status_code == 200, response.text
                assert response.json()['executed'] is False
                assert response.headers['cache-control'] == 'no-store'
            payload['timezone'] = 'bad/zone'
            assert (await client.post(path, json=payload, headers=headers)).status_code == 400
            payload['timezone'] = 'Asia/Bangkok'
            adapter.answer = '{}'
            assert (await client.post(path, json=payload, headers=headers)).status_code == 502
            adapter.answer = json.dumps({'scope': 'out_of_scope'})
            assert (await client.post(path, json=payload, headers=headers)).status_code == 200
    asyncio.run(run())
    assert not adapter.requests[0].history
    assert any(r.history for r in adapter.requests)
    assert len({r.key for r in adapter.requests}) == 3
    assert not app.state.local_chat_sessions._items


def test_structured_adapter_budget_is_local_to_analysis():
    from pydantic import SecretStr
    from app.clients.local.llama import LlamaServerAdapter
    from app.core.runtime_config import LocalLLMSettings
    from app.core.llm_config import LLMSettings
    from app.models.llm import LLMRequest
    from app.services.audio_context import AudioContext

    bodies = []

    def respond(request):
        if request.url.path.endswith('/models'):
            return httpx.Response(200, json={'data': [{'id': 'gemma'}]})
        bodies.append(json.loads(request.content))
        return httpx.Response(200, content=(
            'data: {"choices":[{"delta":{"content":"{}"},"finish_reason":"stop"}]}\n\n'
            'data: [DONE]\n\n'))

    async def run():
        adapter = LlamaServerAdapter(LocalLLMSettings(api_key=SecretStr('test'), max_output_tokens=256))
        adapter._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        req = LLMRequest(ConversationKey('u', 's', 'pa'), 't', 'hello', 'test', (),
                         LLMSettings(model='gemma', max_output_tokens=2048))
        try:
            for kwargs in ({'response_schema': Interpretation.model_json_schema()}, {}, {'enable_thinking': False}):
                async for _ in adapter.stream(req, AudioContext(deadline=time.monotonic() + 5), **kwargs):
                    pass
        finally:
            await adapter.aclose()
    asyncio.run(run())
    assert bodies[0]['max_tokens'] == 2048
    assert bodies[0]['chat_template_kwargs'] == {'enable_thinking': False}
    assert bodies[0]['temperature'] == 0
    assert bodies[0]['response_format']['json_schema']['schema']['properties']['operations']
    assert bodies[1]['max_tokens'] == 256
    assert 'response_format' not in bodies[1] and 'chat_template_kwargs' not in bodies[1]
    assert 'temperature' not in bodies[1]
    assert bodies[2]['max_tokens'] == 256 and 'response_format' not in bodies[2]
    assert bodies[2]['chat_template_kwargs'] == {'enable_thinking': False}
