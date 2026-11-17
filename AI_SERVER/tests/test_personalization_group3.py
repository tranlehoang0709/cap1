"""PA-05 additions; synthetic scoped reads/ACKs, never evidence of live PA-04."""
import asyncio
import httpx
from datetime import datetime, timedelta, timezone

import pytest

from app.core.runtime_config import LocalLLMSettings
from app.models.llm import ConversationKey, Message, ProviderDelta, ProviderDone
from app.personal_assistant.personalization import PersonalizationEngine, PersonalizedAssistant, memory_handoff
from app.personal_assistant.personalization_policy import PersonalizationSettings
from app.personal_assistant.workflow import WorkflowOrchestrator
from .test_personalization import Reader, Gemma, context, record, parsed, scope, QUERY, reply
from .test_pa_memory_workflow import engine, analysis, ctx, consent


@pytest.mark.parametrize('data', ['OTP 123456', 'Mật khẩu 123456', 'Số tài khoản ngân hàng 123456',
    'CCCD 123456', 'Bệnh án 123456', 'Bí mật doanh nghiệp 123456', 'API key 123456'])
def test_all_group3_prohibited_data_filtered_before_review_or_generation(data):
    result, model = asyncio.run(reply(reader=Reader([record(content=data)])))
    assert not result.metadata['used_memory_ids']
    assert all(data not in request.transcript for request, _ in model.requests)


@pytest.mark.parametrize('updated', [None, '2026-11-01T12:00:00+00:00', '2026-11-16T12:00:00+00:00'])
def test_configured_age_missing_old_or_future_timestamp_requires_restatement(updated):
    async def run():
        now = datetime.fromisoformat('2026-11-15T12:00:00+00:00')
        engine = PersonalizationEngine(Reader([record(content='OLD_PRIVATE_MARKER', updated_at=updated)]),
            settings=PersonalizationSettings(max_age_seconds=3600), now=lambda: now)
        selection = await engine.prepare(QUERY, context(), parsed(), scope())
        assert selection.status == 'MEMORY_CLARIFICATION_REQUIRED' and not selection.records
        assert 'OLD_PRIVATE_MARKER' not in str(selection.questions)
    asyncio.run(run())


def test_no_default_age_is_invented_and_real_categories_group_selected_records():
    async def run():
        engine = PersonalizationEngine(Reader([record(), record(id='habit', category='habit', content='đi bộ buổi sáng')]),
            settings=PersonalizationSettings(max_age_seconds=None))
        selection = await engine.prepare(QUERY, context(), parsed(), scope())
        assert selection.groups() == {'preference': ['memory-1'], 'habit': ['habit']}
    asyncio.run(run())


def test_no_backend_read_permission_means_reader_not_called():
    from dataclasses import replace
    async def run():
        reader = Reader([record()])
        result = await PersonalizationEngine(reader).prepare(QUERY,
            replace(context(), allowed_tools=frozenset()), parsed(), scope())
        assert result.status == 'MEMORY_UNAVAILABLE' and not reader.calls
    asyncio.run(run())


def test_expired_and_uncertain_memory_asks_without_reintroducing_value():
    async def run():
        for row in (record(content='EXPIRED_SECRET_MARKER', expires_at='2020-01-01T00:00:00+00:00'),
                    record(content='Hình như tôi thích trà')):
            result, model = await reply(reader=Reader([row]))
            assert result.metadata['memory_status'] == 'MEMORY_CLARIFICATION_REQUIRED'
            assert result.metadata['used_memory_ids'] == []
            assert 'EXPIRED_SECRET_MARKER' not in result.text
            assert all(row.content not in request.transcript for request, _ in model.requests)
    asyncio.run(run())


def test_semantic_conflict_review_cannot_use_either_side_before_clarification():
    class ConflictGemma(Gemma):
        async def stream(self, request, request_context, *, response_schema=None, enable_thinking=None):
            if response_schema and 'decision' in response_schema.get('properties', {}):
                self.requests.append((request, True))
                yield ProviderDelta('{"decision":"clarify"}')
                yield ProviderDone(True, 'completed')
                return
            async for event in super().stream(request, request_context, response_schema=response_schema, enable_thinking=enable_thinking):
                yield event
    result, model = asyncio.run(reply(ConflictGemma(), Reader([record(content='tôi thích cà phê'),
        record(id='opposite', content='tôi không thích cà phê')])))
    assert result.metadata['memory_status'] == 'MEMORY_CLARIFICATION_REQUIRED'
    assert not result.metadata['used_memory_ids']
    assert 'cà phê' not in result.text


@pytest.mark.parametrize('action', ['create', 'update', 'delete'])
def test_ack_formatter_reports_exact_verified_change_and_prepares_no_delivery(monkeypatch, action):
    async def run():
        service, adapter = engine(monkeypatch)
        wf = await service.sync_memory(analysis(action, content=None if action == 'delete' else 'Tôi thích uống trà',
            query='đồ uống' if action != 'create' else None), ctx())
        if action != 'create':
            wf = await service.run(wf.id, ctx())
            wf = await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1', record_ids=['m1'],
                mode='replace' if action == 'update' else None)
        before = PersonalizedAssistant.workflow_reply(wf, ctx())
        assert not before['executed'] and not before['notification']['prepared']
        wf = await consent(service, wf)
        wf = await service.run(wf.id, ctx())
        result = PersonalizedAssistant.workflow_reply(wf, ctx())
        assert result['executed'] and result['notification']['prepared']
        assert ('thích cà phê 1' if action == 'delete' else 'Tôi thích uống trà') in result['content']
        assert all(not channel['sent'] for channel in result['delivery'].values())
        assert PersonalizedAssistant.workflow_reply(wf, ctx())['notification']['event_id'] == result['notification']['event_id']
        with pytest.raises(PermissionError):
            PersonalizedAssistant.workflow_reply(wf, context())
    asyncio.run(run())


def test_missing_ack_never_claims_change_or_notification(monkeypatch):
    async def run():
        service, _ = engine(monkeypatch, ack=False)
        wf = await service.sync_memory(analysis(), ctx())
        wf = await consent(service, wf)
        wf = await service.run(wf.id, ctx())
        result = PersonalizedAssistant.workflow_reply(wf, ctx())
        assert not result['executed'] and not result['notification']['prepared']
        assert 'Đã lưu' not in result['content']
    asyncio.run(run())


def test_update_and_delete_personalized_dialogue_keep_workflow_and_scope_unconfirmed():
    async def run():
        service = PersonalizedAssistant(Gemma(feature='PA-04', action='update',
            entities={'content': 'thích trà', 'target_query': 'đồ uống'}), LocalLLMSettings(),
            PersonalizationEngine(Reader(unavailable=True)), workflows=WorkflowOrchestrator())
        first = await service.reply('Sửa trí nhớ đồ uống thành thích trà', context=context(),
            key=ConversationKey('user-a', 'session', 'text'), history=(), request_context=scope())
        assert first.pending and 'bổ sung' in first.text and 'thay thế' in first.text
        assert first.metadata['workflow_status'] == 'BLOCKED'
        assert not first.metadata['executed']
    asyncio.run(run())


def test_local_chat_update_followup_uses_session_pending_without_execution(monkeypatch):
    from .test_pa_dialogue import ScriptedGemma
    monkeypatch.setenv('AI_RUNTIME', 'local')
    monkeypatch.setenv('LOCAL_LLM_CHAT_TOKEN', 'P' * 43)
    from app.main import create_app
    app = create_app()
    source = 'Sửa trí nhớ đồ uống thành thích trà'
    app.state.local_llm = ScriptedGemma(dict(scope='pa', operations=[dict(id='op1', intent='sửa trí nhớ',
        feature='PA-04', action='update', source_text=source, entities={'content': 'thích trà', 'target_query': 'đồ uống'})]),
        {'kind': 'confirm'}, {'kind': 'confirm'}, {'kind': 'reject'})
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                headers={'Authorization': 'Bearer ' + 'P' * 43}) as client:
            bodies = []
            for text in (source, 'Thay thế nội dung cũ', 'Đúng rồi', 'Không đồng ý'):
                r = await client.post('/local/chat', json=dict(user_id='u', session_id='s', personalize=True, content=text))
                assert r.status_code == 200, r.text
                bodies.append(r.json())
            metadata = [b['personalization'] for b in bodies]
            assert metadata[0]['workflow_id'] == metadata[2]['workflow_id']
            assert metadata[2]['workflow_status'] == 'BLOCKED'
            assert metadata[3]['memory_action'] == 'DECLINED'
            assert all(not m['executed'] for m in metadata)
            assert not app.state.pa_analysis_sessions._items
    asyncio.run(run())


@pytest.mark.parametrize('answer,expected', [('Đồng ý lưu thói quen đó', 'SAVE_UNAVAILABLE'),
    ('Không lưu thói quen này nữa', 'DECLINED')])
def test_exact_consent_or_decline_survives_model_classifying_as_ordinary_chat(answer, expected):
    history = (Message('user', 'Mỗi sáng tôi đi bộ'),
        Message('assistant', 'Bạn có muốn lưu thông tin “Mỗi sáng tôi đi bộ” không? Hiện chưa có dữ liệu nào được lưu.'))
    result, _ = asyncio.run(reply(Gemma(), Reader(unavailable=True), content=answer, history=history))
    assert result.metadata['memory_action'] == expected and not result.metadata['executed']


def test_unrelated_or_ungrounded_assistant_proposal_does_not_supply_consent():
    history = (Message('user', 'Chào bạn'), Message('assistant', 'Bạn có muốn lưu thông tin “private-other” không?'))
    result, _ = asyncio.run(reply(Gemma(), Reader(unavailable=True), content='Đồng ý lưu thông tin đó', history=history))
    assert result.metadata['memory_action'] == 'NONE'


@pytest.mark.parametrize('decision,status', [('blocked', 'MEMORY_EMPTY'), ('invalid', 'MEMORY_CLARIFICATION_REQUIRED')])
def test_prohibited_semantics_or_failed_review_cannot_reach_answer_prompt(decision, status):
    class ReviewGemma(Gemma):
        async def stream(self, request, request_context, *, response_schema=None, enable_thinking=None):
            if response_schema and 'decision' in response_schema.get('properties', {}):
                self.requests.append((request, True))
                yield ProviderDelta('{"decision":"' + decision + '"}')
                yield ProviderDone(True, 'completed')
                return
            async for event in super().stream(request, request_context, response_schema=response_schema, enable_thinking=enable_thinking):
                yield event
    result, model = asyncio.run(reply(ReviewGemma(), Reader([record(content='REVIEW_MARKER')])) )
    assert result.metadata['memory_status'] == status and not result.metadata['used_memory_ids']
    assert all('REVIEW_MARKER' not in request.transcript for request, structured in model.requests if not structured)


def test_partial_delete_ack_reports_only_changed_item_and_never_claims_group_complete(monkeypatch):
    async def run():
        service, _ = engine(monkeypatch, fail_at=3)
        wf = await service.sync_memory(analysis('delete', content=None, query='đồ uống'), ctx())
        wf = await service.run(wf.id, ctx())
        wf = await service.select_memory(wf.id, ctx(), revision=wf.revision, operation_id='op1', record_ids=['m1', 'm2'])
        wf = await consent(service, wf)
        wf = await service.run(wf.id, ctx())
        result = PersonalizedAssistant.workflow_reply(wf, ctx())
        assert result['executed'] and not result['complete']
        assert 'thích cà phê 1' in result['content'] and 'thích cà phê 2' not in result['content']
        assert 'chưa được Backend xác nhận' in result['content']
        assert all(not channel['sent'] for channel in result['delivery'].values())
    asyncio.run(run())


def test_generated_answer_cannot_claim_notification_or_voice_delivery():
    result, _ = asyncio.run(reply(Gemma(answer='Tôi đã gửi thông báo Website và đã thông báo qua giọng nói.')))
    assert 'chưa thực hiện' in result.text
    assert all(not channel['sent'] for channel in result.metadata['delivery'].values())


def test_policy_accepts_full_chat_input_budget_without_memory_content_limit_error():
    from app.personal_assistant.personalization_policy import prohibited
    assert not prohibited('a' * 16000)
    assert prohibited('a' * 8000 + ' OTP 123456')
