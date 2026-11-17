"""Gemma structured understanding followed by deterministic proposal guards."""
from datetime import date, datetime, timedelta
import re
import time
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.core.llm_config import LLMSettings
from app.models.llm import ConversationKey, LLMRequest, ProviderDelta, ProviderDone
from app.personal_assistant.prompt import system_prompt
from app.personal_assistant.memory_understanding import guard_memory, prepare_memory
from app.personal_assistant.schema import Analysis, Interpretation, generation_schema
from app.services.audio_context import AudioContext


class UnderstandingError(Exception):
    pass


def quoted_span(value, source):
    """Recover verbatim casing or separated words; never manufacture evidence."""
    if value in source:
        return value
    match = re.search(re.escape(value), source, flags=re.IGNORECASE)
    if match:
        return match.group()
    words = value.split()
    if len(words) > 1:
        pattern = r'[\s\S]{0,200}?'.join(r'(?<!\w)' + re.escape(word) + r'(?!\w)' for word in words)
        match = re.search(pattern, source, flags=re.IGNORECASE)
        if match:
            return match.group()
    raise UnderstandingError('ungrounded_time')


def absolute_date(raw):
    """Normalize fully specified calendar dates without timezone conversion."""
    values = set()
    patterns = (
        (r'(?<![\d/-])(\d{1,2})/(\d{1,2})/(\d{4})(?![\d/-])', False),
        (r'(?<![\d/-])(\d{4})-(\d{2})-(\d{2})(?![\d/-])', True),
    )
    for pattern, iso in patterns:
        for match in re.finditer(pattern, raw):
            parts = tuple(map(int, match.groups()))
            year, month, day = parts if iso else parts[::-1]
            try:
                values.add(date(year, month, day).isoformat())
            except ValueError:
                raise UnderstandingError('invalid_calendar_date') from None
    if len(values) > 1:
        raise UnderstandingError('ambiguous_calendar_date')
    return next(iter(values), None)


def guard(interpretation, raw_input, reference_time, timezone, model, *, resolve_dates=True):
    """Never upgrade an interpretation into an executed business operation."""
    for op in interpretation.operations:
        e = op.entities
        if op.source_text not in raw_input:
            raise UnderstandingError('ungrounded_source')
        prepare_memory(op)
        for temporal in (e.start, e.end, e.deadline):
            if temporal is None:
                continue
            temporal.raw = quoted_span(temporal.raw, op.source_text)
            if not resolve_dates:
                continue
            day = reference_time.date()
            normalized = temporal.raw.lower()
            explicit_date = absolute_date(normalized)
            if explicit_date is not None:
                temporal.date = explicit_date
            elif 'ngày mai' in normalized:
                temporal.date = (day + timedelta(days=1)).isoformat()
            elif 'hôm nay' in normalized:
                temporal.date = day.isoformat()
            else:
                match = re.search(r'(thứ\s+(hai|ba|tư|năm|sáu|bảy)|chủ nhật)\s+tuần sau', normalized)
                if match:
                    weekdays = {'hai': 0, 'ba': 1, 'tư': 2, 'năm': 3, 'sáu': 4, 'bảy': 5}
                    weekday = weekdays.get(match.group(2), 6)
                    temporal.date = (day + timedelta(days=7 - day.weekday() + weekday)).isoformat()
        missing = list(op.missing_fields)
        questions = list(op.questions)
        if op.action == 'create' and op.feature in ('PA-01', 'PA-02', 'PA-06', 'PA-10'):
            missing, questions = [], []

        def require(name, present, question):
            if not present and name not in missing:
                missing.append(name)
                questions.append(question)

        if op.action == 'create':
            if op.feature in ('PA-01', 'PA-06', 'PA-10'):
                require('title', e.title, 'Bạn muốn đặt tên là gì?')
            if op.feature == 'PA-01':
                require('start.date', e.start and e.start.date, 'Bạn muốn tạo lịch ngày nào?')
                require('start.time', e.start and e.start.time, 'Bạn muốn bắt đầu lúc mấy giờ?')
                require('end.time_or_duration', (e.end and e.end.time) or e.duration_minutes,
                        'Bạn muốn kết thúc lúc mấy giờ hoặc kéo dài bao lâu?')
            if op.feature == 'PA-02':
                require('content', e.content or e.title or op.depends_on, 'Bạn muốn nhắc việc gì?')
                require('reminder_time', (e.start and e.start.date and e.start.time) or
                        (e.reminder_offset_minutes is not None and op.depends_on),
                        'Bạn muốn được nhắc khi nào?')
            if op.feature == 'PA-10':
                require('deadline', e.deadline and e.deadline.date, 'Deadline của công việc là ngày nào?')
            if op.feature == 'PA-06':
                for name, value, question in (
                    ('goal', e.goal, 'Mục tiêu kế hoạch là gì?'),
                    ('start.date', e.start and e.start.date, 'Kế hoạch bắt đầu ngày nào?'),
                    ('end.date', e.end and e.end.date, 'Kế hoạch kết thúc ngày nào?'),
                    ('sessions_per_week', e.sessions_per_week, 'Bạn muốn bao nhiêu buổi mỗi tuần?'),
                    ('duration_minutes', e.duration_minutes, 'Mỗi buổi kéo dài bao lâu?')):
                    require(name, value, question)
        if op.feature != 'PA-05' and op.action in ('update', 'delete', 'cancel', 'set_status'):
            require('target_query', e.target_query, 'Bạn muốn thao tác với mục nào?')
            if op.target_resolution == 'not_needed':
                op.target_resolution = 'lookup_required'
        if op.target_resolution == 'selection_required':
            questions.append('Bạn muốn chọn mục nào trong các mục phù hợp?')
        if op.feature in ('PA-09', 'PA-23'):
            op.state = 'unsupported'
            op.constraints.append('capability_only_no_backend_api')
        if op.feature == 'PA-04' or op.action != 'query':
            op.confirmation_required = True
            if not op.confirmation_prompt:
                op.confirmation_prompt = 'Bạn có đồng ý với yêu cầu: ' + op.source_text.rstrip(' .?!') + '?'
        if op.feature == 'PA-06' and not e.reschedule_requested:
            op.constraints.append('preserve_existing_schedule')
        if op.feature == 'PA-01':
            op.constraints.extend(['check_conflicts_in_backend', 'never_overwrite_existing_events'])
        if op.feature == 'PA-12':
            op.constraints.append('derive_progress_from_completed_sessions_only')
        if op.feature == 'PA-05':
            op.confirmation_required = False
            op.confirmation_prompt = None
            op.constraints.extend(['personalization_read_only', 'no_business_authority_change'])
        op.missing_fields = missing
        op.questions = questions
        op.constraints = list(dict.fromkeys(op.constraints))
        if op.state != 'unsupported':
            op.state = ('missing_information' if missing else 'awaiting_selection'
                        if op.target_resolution == 'selection_required' else
                        'awaiting_confirmation' if op.confirmation_required else 'proposed')
        guard_memory(op)
    return Analysis(**interpretation.model_dump(), raw_input=raw_input,
                    reference_time=reference_time, timezone=timezone, model=model)


class IntentUnderstanding:
    def __init__(self, adapter, *, timeout_seconds=300, max_output_tokens=2048):
        self.adapter = adapter
        self.timeout_seconds = timeout_seconds
        self.max_output_tokens = max_output_tokens

    async def analyze(self, content, *, key: ConversationKey, history=(),
                      timezone='Asia/Bangkok', reference_time=None, context=None,
                      supersedes_pending=False):
        zone = ZoneInfo(timezone)
        now = reference_time or datetime.now(zone)
        if now.utcoffset() is None:
            raise UnderstandingError('reference_time_requires_timezone')
        now = now.astimezone(zone)
        context = context or AudioContext(deadline=time.monotonic() + self.timeout_seconds)
        model = await context.run(self.adapter.discover_model)
        prompt = system_prompt(now, timezone)
        if supersedes_pending:
            prompt += ('\nYêu cầu hội thoại trước đã đóng và chưa thực thi. Cụm bỏ/hủy yêu cầu trước '
                       'chỉ nói về proposal cũ, không phải hủy dữ liệu Backend. Chỉ trích xuất '
                       'nghiệp vụ mới được nêu rõ; không tạo thao tác hủy proposal thành Backend API.')
        request = LLMRequest(key, uuid4().hex, content, prompt, history,
                             LLMSettings(_env_file=None, model=model,
                                         max_output_tokens=self.max_output_tokens,
                                         max_output_chars=32000))
        answer = await self.structured(request, context, generation_schema())
        try:
            interpretation = Interpretation.model_validate_json(answer)
            return guard(interpretation, content, now, timezone, model)
        except (ValueError, TypeError) as error:
            raise UnderstandingError('invalid_interpretation') from error

    async def structured(self, request, context, schema):
        """Shared bounded Gemma JSON transport for understanding and dialogue turns."""
        answer = ''
        done = None
        async for event in self.adapter.stream(request, context,
                response_schema=schema):
            if isinstance(event, ProviderDelta):
                answer += event.text
                if len(answer) > 32000:
                    raise UnderstandingError('output_limit')
            elif isinstance(event, ProviderDone):
                done = event
        if done is None or not done.complete:
            raise UnderstandingError('incomplete_output')
        return answer
