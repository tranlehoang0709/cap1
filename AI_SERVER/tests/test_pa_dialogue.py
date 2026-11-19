"""Dialogue integration with scripted Gemma output and real unavailable workflow core."""
import asyncio
from datetime import datetime
import json
import time

import httpx
import pytest

from app.models.llm import ConversationKey, LLMError, ProviderDelta, ProviderDone
from app.personal_assistant.dialogue import DialogueManager
from app.personal_assistant.schema import Interpretation
from app.personal_assistant.understanding import IntentUnderstanding, guard
from app.personal_assistant.workflow import WorkflowOrchestrator
from app.services.audio_context import AudioContext
from app.services.local_chat import LocalChatSessions

NOW = datetime.fromisoformat('2026-11-15T12:00:00+07:00')
KEY = ConversationKey('u', 's', 'pa-analysis')
INITIAL = 'Tạo lịch học tiếng Anh ngày mai.'


def initial(extra=False):
    ops = [dict(id='op1', intent='tạo lịch', feature='PA-01', action='create', source_text=INITIAL,
                entities={'title': 'học tiếng Anh', 'start': {'raw': 'ngày mai'}})]
    if extra:
        ops.append(dict(id='op2', intent='nhắc', feature='PA-02', action='create',
            source_text=INITIAL, entities={'reminder_offset_minutes': 30}, depends_on=['op1']))
    return dict(scope='pa', operations=ops)


class ScriptedGemma:
    def __init__(self, *answers):
        self.answers = list(answers)
        self.requests = []

    async def discover_model(self):
        return 'gemma'

    async def stream(self, request, context, *, response_schema=None):
        self.requests.append(request)
        assert response_schema
        yield ProviderDelta(json.dumps(self.answers.pop(0), ensure_ascii=False))
        yield ProviderDone(True, 'completed')


def manager(*answers):
    return DialogueManager(IntentUnderstanding(ScriptedGemma(*answers)), WorkflowOrchestrator())


async def turn(service, content, pending=None, key=KEY, timezone='Asia/Bangkok'):
    return await service.turn(content, key=key, timezone=timezone, pending=pending,
        context=AudioContext(deadline=time.monotonic() + 30))


def hours(start='19:00', end='21:00', kind='supplement'):
    return dict(kind=kind, operation_id='op1', entities={
        'start': {'raw': '7 giờ', 'time': start}, 'end': {'raw': '9 giờ tối', 'time': end}})


def test_two_turns_correction_confirmation_repeat_and_cancel():
    async def run():
        service = manager(initial(True), hours(),
            dict(kind='correct', operation_id='op1', entities={'start': {'raw': '8 giờ tối', 'time': '20:00'}}),
            dict(kind='confirm'), dict(kind='confirm'), dict(kind='cancel'))
        first = await turn(service, INITIAL)
        assert first.status == 'MISSING_INFORMATION' and first.workflow_id is None
        day = first.analysis.operations[0].entities.start.date
        second = await turn(service, 'Từ 7 giờ đến 9 giờ tối.', first)
        event, reminder = second.analysis.operations
        assert event.entities.title == 'học tiếng Anh' and event.entities.start.date == day
        assert (event.entities.start.time, event.entities.end.time) == ('19:00', '21:00')
        assert not event.missing_fields and reminder.depends_on == ['op1']
        assert second.status == 'AWAITING_CONFIRMATION'
        assert '19:00' in second.questions[0] and 'PA-01' not in second.questions[0]
        assert second.workflow_status == 'BLOCKED' and second.workflow_code == 'NOT_IMPLEMENTED'
        wf_id = second.workflow_id
        third = await turn(service, 'Đổi thành 8 giờ tối.', second)
        assert third.workflow_id == wf_id and third.workflow_revision == second.workflow_revision + 1
        assert third.analysis.operations[0].entities.start.time == '20:00'
        assert third.analysis.operations[0].entities.end.time == '21:00'
        fourth = await turn(service, 'Đúng rồi.', third)
        assert fourth.confirmation == 'CONFIRMED' and fourth.status == 'READY_FOR_EXECUTION'
        repeat = await turn(service, 'Đúng rồi.', fourth)
        assert repeat.workflow_id == wf_id and repeat.revision == fourth.revision
        assert len(service.orchestrator.store._entries) == 1
        wf = await service.orchestrator.store.get(wf_id, service._context(repeat, KEY))
        assert wf.state == 'BLOCKED' and not any(s.result and s.result.executed for s in wf.steps)
        assert all(s.attempts == 0 for s in wf.steps)
        cancelled = await turn(service, 'Hủy đi.', repeat)
        assert cancelled.status == 'CANCELLED' and cancelled.workflow_status == 'CANCELLED'
        assert cancelled.correlation_id == first.correlation_id
    asyncio.run(run())


def test_implicit_conflict_requires_clarification_and_invalid_interval_blocks():
    async def run():
        service = manager(initial(), hours(),
            dict(kind='supplement', operation_id='op1', entities={'start': {'raw': '10 giờ tối', 'time': '22:00'}}),
            dict(kind='confirm'))
        first = await turn(service, INITIAL)
        second = await turn(service, 'Từ 7 giờ đến 9 giờ tối.', first)
        conflict = await turn(service, '10 giờ tối.', second)
        assert conflict.status == 'AWAITING_CLARIFICATION'
        assert conflict.analysis.operations[0].entities.start.time == '19:00'
        assert conflict.candidate.operations[0].entities.start.time == '22:00'
        accepted = await turn(service, 'Đúng rồi.', conflict)
        assert accepted.status == 'MISSING_INFORMATION' and accepted.confirmation == 'UNCONFIRMED'
        assert 'valid_time_range' in accepted.analysis.operations[0].missing_fields
        assert accepted.workflow_status == 'BLOCKED'
    asyncio.run(run())


def test_new_request_cancels_old_workflow_and_rejection_cancels_pending():
    async def run():
        service = manager(initial(), hours(), dict(kind='new'), initial(), dict(kind='reject'))
        first = await turn(service, INITIAL)
        second = await turn(service, 'Từ 7 giờ đến 9 giờ tối.', first)
        new = await turn(service, INITIAL, second)
        assert new.correlation_id != second.correlation_id and new.workflow_id is None
        old = await service.orchestrator.store.get(second.workflow_id, service._context(second, KEY))
        assert old.state == 'CANCELLED'
        rejected = await turn(service, 'Không đồng ý.', new)
        assert rejected.status == 'CANCELLED' and rejected.confirmation == 'DECLINED'
    asyncio.run(run())


def test_new_request_after_cancel_does_not_reuse_terminal_intent():
    async def run():
        fresh = initial()
        fresh['operations'][0]['entities']['title'] = 'tập yoga'
        fresh['operations'][0]['source_text'] = 'Bỏ yêu cầu trước. Tạo lịch tập yoga ngày mai.'
        service = manager(initial(), {'kind': 'cancel'}, fresh, {'kind': 'reject'}, {'scope': 'out_of_scope'})
        state = await turn(service, INITIAL)
        cancelled = await turn(service, 'Hủy đi.', state)
        new = await turn(service, fresh['operations'][0]['source_text'], cancelled)
        assert new.analysis.operations[0].entities.title == 'tập yoga'
        assert new.correlation_id != cancelled.correlation_id
        assert new.status == 'MISSING_INFORMATION'
        rejected = await turn(service, 'Không đồng ý.', new)
        repeat = await turn(service, 'Đúng rồi.', rejected)
        assert repeat.status == 'CANCELLED' and repeat.correlation_id == rejected.correlation_id
    asyncio.run(run())


def test_patch_only_touches_selected_intent_and_unknown_target_asks():
    async def run():
        service = manager(initial(True), dict(kind='supplement', operation_id='op2',
            entities={'reminder_offset_minutes': 15}),
            dict(kind='supplement', operation_id='op9', entities={'title': 'wrong'}))
        first = await turn(service, INITIAL)
        second = await turn(service, 'Nhắc trước 15 phút.', first)
        assert second.status == 'AWAITING_CLARIFICATION'  # 30 -> 15 is an implicit conflict
        assert second.candidate.operations[0] == first.analysis.operations[0]
        third = await turn(service, 'Đổi tên.', first)
        assert third.status == 'AWAITING_CLARIFICATION'
        assert third.analysis.operations[0].entities.title == 'học tiếng Anh'
    asyncio.run(run())


def test_session_ttl_capacity_busy_and_owner_isolation(monkeypatch):
    async def run():
        now = [0.0]
        monkeypatch.setattr('app.services.local_chat.time.monotonic', lambda: now[0])
        sessions = LocalChatSessions(max_sessions=2, max_turns=20, max_history_chars=32000, ttl_seconds=10)
        service = manager(initial())
        state = await turn(service, INITIAL)
        await sessions.claim('u', 's')
        await sessions.save_pending('u', 's', state)
        now[0] = 20
        assert await sessions.cleanup() == 0  # Never expire an in-flight owner.
        with pytest.raises(LLMError, match='session_busy'):
            await sessions.claim('u', 's')
        await sessions.finish('u', 's', INITIAL, None)
        await sessions.claim('other', 's')
        assert await sessions.pending('other', 's') is None
        with pytest.raises(LLMError, match='overloaded'):
            await sessions.claim('u', 'other')
        own = await sessions.pending('u', 's')
        own.analysis.operations[0].entities.title = 'changed'
        assert (await sessions.pending('u', 's')).analysis.operations[0].entities.title == 'học tiếng Anh'
        await sessions.finish('other', 's', '', None)
        now[0] = 31
        assert await sessions.cleanup() == 2
        await sessions.claim('u', 's')
        assert await sessions.pending('u', 's') is None
    asyncio.run(run())


def test_workflow_ownership_and_timezone_change_fail_closed():
    async def run():
        service = manager(initial(), hours())
        state = await turn(service, INITIAL)
        state = await turn(service, 'Từ 7 giờ đến 9 giờ tối.', state)
        with pytest.raises(PermissionError):
            await service.orchestrator.store.get(state.workflow_id,
                service._context(state, ConversationKey('other', 's', 'pa-analysis')))
        with pytest.raises(ValueError, match='TIMEZONE_MISMATCH'):
            await turn(service, 'Đúng rồi.', state, timezone='UTC')
        with pytest.raises(PermissionError, match='owner'):
            await turn(service, 'Đúng rồi.', state, key=ConversationKey('other', 's', 'pa-analysis'))
    asyncio.run(run())


def test_endpoint_pending_state_no_backend_and_concurrent_requests(monkeypatch):
    monkeypatch.setenv('AI_RUNTIME', 'local')
    monkeypatch.setenv('LOCAL_LLM_CHAT_TOKEN', 'P' * 43)
    from app.main import create_app
    app = create_app()
    app.state.local_llm = ScriptedGemma(initial(), hours(), dict(kind='confirm'), dict(kind='confirm'))

    class ForbiddenBackend:
        def __getattr__(self, name):
            raise AssertionError('No Backend access is permitted')
    app.state.backend_client = ForbiddenBackend()

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as c:
            h = {'Authorization': 'Bearer ' + 'P' * 43}
            body = dict(user_id='u', session_id='s')
            path = '/internal/personal-assistant/analyze'
            assert (await c.post(path, json={**body, 'content': INITIAL})).status_code == 401
            responses = []
            for text in (INITIAL, 'Từ 7 giờ đến 9 giờ tối.', 'Đúng rồi.', 'Đúng rồi.'):
                r = await c.post(path, headers=h, json={**body, 'content': text})
                assert r.status_code == 200, r.text
                assert r.json()['executed'] is False
                responses.append(r.json())
            assert responses[1]['dialogue']['workflow_id'] == responses[3]['dialogue']['workflow_id']
            assert responses[3]['dialogue']['workflow_code'] == 'NOT_IMPLEMENTED'
            stale = await c.post(path, headers=h, json={**body, 'content': 'Đúng rồi.', 'expected_revision': 1})
            assert stale.status_code == 409 and stale.json()['detail'] == 'STALE_DIALOGUE_REVISION'
            await app.state.pa_analysis_sessions.claim('u', 's')
            busy = await c.post(path, headers=h, json={**body, 'content': 'Đúng rồi.'})
            assert busy.status_code == 409 and busy.json()['detail'] == 'session_busy'
    asyncio.run(run())


def test_relative_dates_remain_anchored_and_resource_budget_is_enforced():
    async def run():
        service = manager(hours())
        original = guard(Interpretation.model_validate(initial()), INITIAL,
                         NOW, 'Asia/Bangkok', 'gemma')
        from app.personal_assistant.dialogue import DialogueState
        pending = DialogueState(analysis=original, owner_ref=service._owner(KEY))
        state = await turn(service, 'Từ 7 giờ đến 9 giờ tối.', pending)
        assert state.analysis.operations[0].entities.start.date == '2026-11-16'
        state.turns = service.max_turns
        with pytest.raises(LLMError, match='context_limit'):
            await turn(service, 'Đúng rồi.', state)
        store = LocalChatSessions(max_sessions=1, max_turns=20, max_history_chars=20, ttl_seconds=10)
        await store.claim('u', 's')
        with pytest.raises(LLMError, match='context_limit'):
            await store.save_pending('u', 's', state)
    asyncio.run(run())


def memory_request(action, content=None, target=None):
    text = 'Sửa trí nhớ sở thích đồ uống' if action == 'update' else 'Xóa trí nhớ sở thích đồ uống'
    return text, dict(scope='pa', operations=[dict(id='op1', intent='trí nhớ', feature='PA-04',
        action=action, source_text=text, entities={k: v for k, v in
        {'content': content, 'target_query': target}.items() if v})])


def test_memory_update_mode_and_unverified_before_cannot_be_confirmed():
    async def run():
        text, analysis = memory_request('update', 'thích uống trà', 'sở thích đồ uống')
        service = manager(analysis, dict(kind='confirm'),  # Real Gemma may call a mode choice confirmation.
                          dict(kind='confirm'), dict(kind='reject'))
        first = await turn(service, text)
        assert 'thay thế hay bổ sung' in first.questions[0]
        second = await turn(service, 'Bổ sung', first)
        assert second.memory_modes == {'op1': 'append'}
        assert first.workflow_id and second.workflow_id == first.workflow_id
        assert second.workflow_revision > first.workflow_revision
        assert 'Trước: chưa xác minh' in second.questions[0] and 'thích uống trà' in second.questions[0]
        assert second.workflow_code == 'MEMORY_LOOKUP_NOT_IMPLEMENTED'
        third = await turn(service, 'Đúng rồi', second)
        assert third.confirmation == 'UNCONFIRMED' and third.workflow_id == first.workflow_id
        assert (await turn(service, 'Không đồng ý', third)).status == 'CANCELLED'
    asyncio.run(run())


def test_explicit_memory_replace_then_append_preserves_evidence_and_workflow():
    async def run():
        text = 'Thay thế trí nhớ sở thích đồ uống đã lưu thành tôi thích uống trà.'
        _, analysis = memory_request('update', 'tôi thích uống trà', 'sở thích đồ uống')
        analysis['operations'][0]['source_text'] = text
        service = manager(analysis, dict(kind='reject', operation_id='op1',
            entities={'content': 'thông tin đó'}), dict(kind='confirm'))
        first = await turn(service, text)
        assert first.memory_modes == {'op1': 'replace'}
        assert 'Sau dự kiến (replace)' in first.questions[0]
        second = await turn(service, 'Không, tôi muốn bổ sung thông tin đó, không thay thế.', first)
        assert second.memory_modes == {'op1': 'append'}
        assert second.analysis.operations == first.analysis.operations
        assert second.revision == first.revision + 1
        assert second.workflow_id == first.workflow_id
        assert second.correlation_id == first.correlation_id
        assert second.workflow_revision == first.workflow_revision + 1
        assert second.confirmation == 'UNCONFIRMED'
        assert 'Sau dự kiến (append): tôi thích uống trà' in second.questions[0]
        third = await turn(service, 'Đúng rồi.', second)
        assert third.workflow_id == second.workflow_id
        assert third.confirmation == 'UNCONFIRMED'
        assert third.workflow_status == 'BLOCKED'
        assert third.workflow_code == 'MEMORY_LOOKUP_NOT_IMPLEMENTED'
        assert not third.analysis.executed
    asyncio.run(run())


def test_memory_delete_requires_target_and_verified_readback():
    async def run():
        text, analysis = memory_request('delete')
        service = manager(analysis, dict(kind='supplement', operation_id='op1',
            entities={'target_query': 'sở thích đồ uống'}), dict(kind='confirm'))
        first = await turn(service, text)
        assert 'nhóm chủ đề' in first.questions[0]
        second = await turn(service, 'sở thích đồ uống', first)
        assert '(xóa)' in second.questions[0]
        third = await turn(service, 'Đúng rồi', second)
        assert third.confirmation == 'UNCONFIRMED'
        assert third.workflow_status == 'BLOCKED'
    asyncio.run(run())


def test_uncertain_important_data_requires_restatement_not_yes():
    async def run():
        text = 'Hình như tạo lịch học ngày mai'
        analysis = initial()
        analysis['operations'][0]['source_text'] = text
        service = manager(analysis, dict(kind='confirm'), hours())
        first = await turn(service, text)
        assert first.uncertain and first.status == 'AWAITING_CLARIFICATION'
        second = await turn(service, 'Đúng rồi', first)
        assert second.confirmation == 'UNCONFIRMED' and second.workflow_id is None
        third = await turn(service, 'Từ 7 giờ đến 9 giờ tối.', second)
        assert third.status == 'AWAITING_CONFIRMATION' and not third.uncertain
    asyncio.run(run())


def test_bare_twelve_hour_time_does_not_trust_model_evening_guess():
    async def run():
        text = 'Tạo lịch học ngày mai từ 7 giờ đến 9 giờ'
        analysis = initial()
        op = analysis['operations'][0]
        op['source_text'] = text
        op['entities'].update(start={'raw': 'ngày mai từ 7 giờ', 'time': '19:00'},
                              end={'raw': '9 giờ', 'time': '21:00'})
        state = await turn(manager(analysis), text)
        assert state.status == 'AWAITING_CLARIFICATION'
        assert 'sáng hay chiều/tối' in state.questions[0]
        assert state.workflow_id is None
    asyncio.run(run())
