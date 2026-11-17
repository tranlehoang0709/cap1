"""Group III interpretation only; no PA-04 storage or successful Backend doubles."""
from datetime import datetime

import pytest

from app.personal_assistant.schema import Interpretation, generation_schema
from app.personal_assistant.understanding import guard
from app.personal_assistant.tool_boundary import TrustedToolContext
from app.personal_assistant.tool_planning import plan_tools

NOW = datetime.fromisoformat('2026-11-15T12:00:00+07:00')


def analyze(text, interaction='statement', **memory):
    parsed = Interpretation(scope='pa', operations=[dict(id='op1', intent='trí nhớ', feature='PA-04',
        action='propose', source_text=text, entities={'content': 'unverified summary',
        'category': 'preference', 'target_query': text},
        memory=dict(interaction=interaction, **memory))])
    return guard(parsed, text, NOW, 'Asia/Bangkok', 'gemma')


@pytest.mark.parametrize('interaction,action', [('statement', 'propose'), ('proposal', 'propose'),
    ('save_request', 'create'), ('update_request', 'update'), ('query_request', 'query'),
    ('delete_request', 'delete'), ('decline', 'cancel'), ('confirmation', 'confirm')])
def test_memory_interactions_are_distinct_and_never_execute(interaction, action):
    result = analyze('Tôi thích cà phê.', interaction)
    op = result.operations[0]
    assert op.action == action and op.memory.interaction == interaction
    assert op.memory.original_text == 'Tôi thích cà phê.'
    assert op.memory.summary is None and result.executed is False
    if interaction == 'query_request':
        assert op.memory.storage_policy == 'READ_ONLY' and not op.confirmation_required
    elif interaction == 'decline':
        assert op.memory.storage_policy == 'DECLINED'
    else:
        assert op.confirmation_required


@pytest.mark.parametrize('text,category', [
    ('Hãy lưu OTP 000000.', 'otp'), ('Ghi nhớ mật khẩu ví dụ.', 'password'),
    ('Lưu số thẻ thanh toán thử nghiệm.', 'payment'), ('Ghi nhớ số CCCD thử nghiệm.', 'identity'),
    ('Tôi có bệnh án riêng.', 'medical'), ('Ghi nhớ bí mật doanh nghiệp.', 'business_secret'),
    ('Lưu private key thử nghiệm.', 'sensitive_other'),
])
@pytest.mark.parametrize('interaction', ['statement', 'save_request', 'confirmation'])
def test_forbidden_storage_is_blocked_even_if_model_omits_risk(text, category, interaction):
    result = analyze(text, interaction)
    op = result.operations[0]
    assert category in op.memory.prohibited_categories
    assert op.memory.storage_policy == 'PROHIBITED' and op.state == 'unsupported'
    assert not op.confirmation_required and op.confirmation_prompt is None
    assert not op.questions and not result.executed
    plan = plan_tools(result, TrustedToolContext('u', 's', 'c', dialogue_ready=True))
    assert not plan.calls


@pytest.mark.parametrize('interaction', ['query_request', 'delete_request'])
def test_prohibited_storage_does_not_turn_view_or_forget_into_save(interaction):
    op = analyze('Mật khẩu của tôi.', interaction).operations[0]
    assert op.memory.storage_policy == 'PROHIBITED' and op.state != 'unsupported'
    assert op.action in ('query', 'delete')


@pytest.mark.parametrize('issue', ['ambiguous', 'unusual', 'possible_stt_error', 'update_mode_unclear'])
def test_uncertainty_is_handed_to_dialogue_without_repairing_content(issue):
    text = 'Tôi uống 30 lít cà phê mỗi ngày.'
    op = analyze(text, issues=[issue]).operations[0]
    assert op.memory.requires_clarification and op.memory.storage_policy == 'CLARIFICATION_REQUIRED'
    assert 'memory_clarification' in op.missing_fields and op.questions
    assert op.entities.content == text and op.memory.original_text == text
    assert op.state == 'missing_information'


def test_no_paraphrase_can_drop_negation_amount_or_condition():
    text = 'Tôi không thích cà phê vào tối thứ Bảy; chỉ uống 1 cốc vào sáng Chủ nhật.'
    op = analyze(text, summary='Tôi thích cà phê.').operations[0]
    assert op.memory.summary is None
    assert op.entities.content == op.memory.original_text == text


@pytest.mark.parametrize('interaction', ['statement', 'save_request'])
def test_bare_save_request_does_not_manufacture_a_memory_payload(interaction):
    text = 'Hãy ghi nhớ.'
    parsed = Interpretation(scope='pa', operations=[dict(id='op1', intent='lưu', feature='PA-04',
        action='create', source_text=text, memory={'interaction': interaction})])
    op = guard(parsed, text, NOW, 'UTC', 'gemma').operations[0]
    assert op.entities.content is None
    assert op.memory.interaction == 'save_request' and op.action == 'create'
    assert op.memory.requires_clarification and op.state == 'missing_information'
    assert op.memory.original_text == text


def test_explicit_update_selector_and_mode_are_not_lost_or_confused_with_backend_proof():
    text = 'Thay sở thích đồ uống đã lưu từ cà phê thành trà, thay thế nội dung cũ.'
    parsed = Interpretation(scope='pa', operations=[dict(id='op1', intent='sửa', feature='PA-04',
        action='update', source_text=text, entities={'content': 'trà'},
        memory={'interaction': 'update_request', 'issues': ['update_mode_unclear']})])
    op = guard(parsed, text, NOW, 'UTC', 'gemma').operations[0]
    assert op.entities.target_query == 'sở thích đồ uống' and op.entities.content == 'trà'
    assert op.target_resolution == 'lookup_required'
    assert not op.memory.issues and op.memory.storage_policy == 'CONSENT_REQUIRED'
    assert op.memory.original_text == text and op.confirmation_required


@pytest.mark.parametrize('text,expected', [
    ('Tôi thích cái đó, nhưng tôi không chắc.', 'statement'),
    ('Tôi không chắc, đừng lưu thông tin này.', 'decline'),
])
def test_uncertainty_is_not_automatically_a_refusal(text, expected):
    op = analyze(text, 'decline').operations[0]
    assert op.memory.interaction == expected
    if expected == 'statement':
        assert op.action == 'propose' and op.memory.storage_policy == 'CLARIFICATION_REQUIRED'


def test_multintent_risk_is_isolated_from_dates_and_dependencies():
    event = 'Ngày mai học từ 19 giờ đến 21 giờ'
    reminder = 'nhắc trước 30 phút'
    memory = 'hãy lưu OTP 000000'
    text = event + ', ' + reminder + ', ' + memory
    parsed = Interpretation(scope='pa', operations=[
        dict(id='op1', intent='lịch', feature='PA-01', action='create', source_text=event,
            entities={'title': 'học', 'start': {'raw': 'Ngày mai', 'time': '19:00'},
                      'end': {'raw': '21 giờ', 'time': '21:00'}}),
        dict(id='op2', intent='nhắc', feature='PA-02', action='create', source_text=reminder,
            entities={'reminder_offset_minutes': 30}, depends_on=['op1']),
        dict(id='op3', intent='lưu', feature='PA-04', action='create', source_text=memory,
            memory={'interaction': 'save_request'})])
    result = guard(parsed, text, NOW, 'UTC', 'gemma')
    assert result.operations[0].entities.start.date == '2026-11-16'
    assert result.operations[1].depends_on == ['op1']
    assert result.operations[2].state == 'unsupported'
    assert result.operations[0].memory is None and not result.executed


def test_generation_does_not_let_gemma_supply_verified_original_or_storage_permission():
    fields = generation_schema()['$defs']['MemoryUnderstanding']['properties']
    assert set(fields) == {'interaction', 'prohibited_categories', 'issues'}
