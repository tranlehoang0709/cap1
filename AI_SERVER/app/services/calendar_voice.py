"""Session-bound, non-persistent PA-01 voice draft workflow.

Calendar writes remain protected by the Backend gate; this state only holds a
short-lived proposal and never substitutes for Backend authorization.
"""
from datetime import datetime, timedelta
import re
import time
import unicodedata
from types import SimpleNamespace
from uuid import uuid4
from zoneinfo import ZoneInfo

class CalendarVoiceWorkflow:
    def __init__(self, ttl_seconds=300, now=None, clock=None, timezone='Asia/Ho_Chi_Minh',
                 *, schedule_query_only=False):
        self.ttl = ttl_seconds
        self._drafts = {}
        self._now = now or time.monotonic
        self._clock = clock or (lambda: datetime.now(ZoneInfo(timezone)))
        self.timezone = timezone
        self.schedule_query_only = schedule_query_only

    def _local_now(self):
        now = self._clock()
        zone = ZoneInfo(self.timezone)
        return now.astimezone(zone) if now.tzinfo else now.replace(tzinfo=zone)

    @staticmethod
    def _operation_id():
        return 'op' + str(uuid4().int)

    @staticmethod
    def _fold(text):
        """Normalize Vietnamese for intent routing without relying on one phrase."""
        normalized = unicodedata.normalize('NFD', str(text).casefold())
        return ' '.join(''.join(
            character for character in normalized
            if unicodedata.category(character) != 'Mn').replace('đ', 'd').split())

    @classmethod
    def _calendar_intent(cls, transcript):
        """Separate lookup questions from explicit calendar mutations."""
        text = cls._fold(transcript)
        schedule_noun = bool(re.search(r'\b(lich|lich trinh|su kien)\b', text))
        query = schedule_noun and any((
            re.search(r'\b(cho (toi|minh) xem|xem|kiem tra|liet ke|tim)\b.{0,50}\b(lich|su kien)\b', text),
            re.search(r'\b(toi|minh)?\s*co\s+lich\b.{0,50}\b(gi|nao|khong)\b', text),
            re.search(r'\b(lich|lich trinh|su kien)\b.{0,50}\b(gi|nao|bao gio|luc nao)\b', text),
            re.search(r'\b(hom nay|mai|ngay mai|sang mai|trua mai|chieu mai|toi mai)\b.{0,40}\bco\s+lich\b', text),
        ))
        if query:
            return 'query'
        create = any((
            re.search(r'\b(tao|them|dat|sap xep)\b.{0,30}\b(lich|su kien)\b', text),
            re.search(r'\b(len lich)\b', text),
            re.search(r'\b(muon|se|can)\s+(hoc|hop|tap|lam|di)\b', text),
            re.search(r'\b(hom nay|mai|ngay mai|ngay\s+\d{1,2}|luc\s+\d{1,2})\b.{0,70}\b(hoc|hop|tap|lam|di)\b', text),
        ))
        return 'create' if create else None

    async def query(self, transcript, context, adapter, request_context):
        folded = self._fold(transcript)
        period = re.search(r'\b(hôm nay|ngày mai|tuần này)\b', transcript, re.I)
        explicit = re.search(
            r'\bngày\s+(\d{1,2})(?:\s+tháng\s+|/)(\d{1,2})(?:(?:\s+năm\s+|/)(\d{4}))?\b',
            transcript, re.I)
        asks_plan = bool(re.search(r'\b(kế hoạch|bao nhiêu buổi|còn bao nhiêu buổi)\b', transcript, re.I))
        if asks_plan and re.search(r'\b(tiến độ|hoàn thành|còn|báo cáo)\b', transcript, re.I):
            if not context.delegation_token:
                return 'Phiên xác thực kế hoạch chưa sẵn sàng.'
            result = await adapter.execute('plan.query', SimpleNamespace(), context,
                operation_id=self._operation_id(), request_context=request_context)
            if result.status != 'SUCCESS': return 'Hiện không thể truy vấn tiến độ kế hoạch của bạn.'
            plans = (result.data or {}).get('plans', [])
            plan = next((p for p in plans if 'tiếng anh' in str(p.get('title','')).casefold()), None)
            if not plan: return 'Bạn chưa có kế hoạch học tiếng Anh.'
            title=str(plan.get('title') or 'Học tiếng Anh'); total=int(plan.get('total_sessions',0))
            completed=int(plan.get('completed_sessions',0)); remaining=int(plan.get('remaining_sessions',0))
            progress=int(plan.get('progress_percent',0))
            plan_label = title if title.casefold().startswith('kế hoạch ') else 'Kế hoạch ' + title
            if re.search(r'đã hoàn thành bao nhiêu buổi', transcript, re.I):
                return f"Bạn đã hoàn thành {completed} trên {total} buổi của {plan_label}."
            if re.search(r'còn bao nhiêu buổi', transcript, re.I):
                return f"Bạn còn {remaining} trên {total} buổi chưa hoàn thành trong {plan_label}."
            return (f"{plan_label}: {completed}/{total} buổi đã hoàn thành, "
                    f"còn {remaining} buổi, tiến độ {progress}%.")
        asks_report = bool(re.search(r'\b(báo cáo|tổng kết|đã hoàn thành bao nhiêu)\b', transcript, re.I))
        asks_week_incomplete = bool(re.search(r'chưa hoàn thành.*tuần này', transcript, re.I))
        if asks_report or asks_week_incomplete:
            if not context.delegation_token:
                return 'Phiên xác thực báo cáo chưa sẵn sàng.'
            start = self._local_now().replace(hour=0, minute=0, second=0, microsecond=0)
            label = 'hôm nay'
            if re.search(r'\btuần này\b', transcript, re.I):
                start -= timedelta(days=start.weekday()); end = start + timedelta(days=7); label = 'tuần này'
            elif re.search(r'\btháng này\b', transcript, re.I):
                start = start.replace(day=1)
                end = (start.replace(year=start.year + 1, month=1) if start.month == 12
                       else start.replace(month=start.month + 1)); label = 'tháng này'
            else:
                end = start + timedelta(days=1)
            result = await adapter.execute('report.query', SimpleNamespace(
                from_iso=start.isoformat(), to_iso=end.isoformat()), context,
                operation_id=self._operation_id(), request_context=request_context)
            if result.status != 'SUCCESS':
                return 'Hiện không thể tạo báo cáo công việc của bạn.'
            data = result.data or {}; items = data.get('items', [])
            if asks_week_incomplete:
                pending = [item for item in items if item.get('status') != 'completed']
                if not pending: return 'Bạn không có công việc chưa hoàn thành trong tuần này.'
                return 'Các công việc chưa hoàn thành trong tuần này: ' + ', '.join(
                    str(item.get('title') or 'không tên') for item in pending) + '.'
            if re.search(r'đã hoàn thành bao nhiêu', transcript, re.I):
                return f"Bạn đã hoàn thành {data.get('completed_tasks', 0)} công việc trong {label}."
            return (f"Báo cáo {label}: {data.get('total_tasks', 0)} công việc, "
                    f"{data.get('completed_tasks', 0)} đã hoàn thành, "
                    f"{data.get('incomplete_tasks', 0)} chưa hoàn thành, "
                    f"tiến độ {data.get('completion_percent', 0)}%.")
        asks_tasks = bool(re.search(r'\b(công việc|việc nào|những gì cần làm)\b', transcript, re.I))
        asks_overdue = bool(re.search(r'\bquá hạn\b', transcript, re.I))
        asks_incomplete = bool(re.search(r'\b(chưa hoàn thành|còn công việc)\b', transcript, re.I))
        combined = bool(re.search(r'\bnhững gì cần làm\b', transcript, re.I))
        if asks_tasks or asks_overdue or asks_incomplete:
            if not context.delegation_token:
                return 'Phiên xác thực công việc chưa sẵn sàng.'
            start = self._local_now().replace(hour=0, minute=0, second=0, microsecond=0)
            if period and period.group().casefold() == 'ngày mai':
                start += timedelta(days=1)
            end = start + timedelta(days=1)
            mode = 'overdue' if asks_overdue else 'incomplete' if asks_incomplete else 'date'
            arguments = SimpleNamespace(mode=mode,
                from_iso=None if mode != 'date' else start.isoformat(),
                to_iso=None if mode != 'date' else end.isoformat())
            result = await adapter.execute('assistant.query', arguments, context,
                operation_id=self._operation_id(), request_context=request_context)
            if result.status != 'SUCCESS':
                return 'Hiện không thể truy vấn lịch trình và công việc của bạn.'
            data = result.data or {}; tasks = data.get('tasks', []); events = data.get('events', [])
            if not tasks and (not combined or not events):
                if asks_overdue: return 'Bạn không có công việc quá hạn.'
                if asks_incomplete: return 'Bạn không còn công việc chưa hoàn thành.'
                if combined: return 'Ngày mai bạn không có lịch hoặc công việc cần làm.'
                return ('Ngày mai bạn không có công việc cần làm.' if period and
                        period.group().casefold() == 'ngày mai' else 'Hôm nay bạn không có công việc cần làm.')
            zone = ZoneInfo(self.timezone); parts = []
            if combined:
                for item in events:
                    try:
                        begins = datetime.fromisoformat(str(item['starts_at']).replace('Z', '+00:00')).astimezone(zone)
                        ends = datetime.fromisoformat(str(item['ends_at']).replace('Z', '+00:00')).astimezone(zone)
                        parts.append(f"Lịch {item.get('title') or 'không tên'}, {begins.strftime('%H:%M')}–{ends.strftime('%H:%M')}")
                    except (KeyError, TypeError, ValueError):
                        parts.append(f"Lịch {item.get('title') or 'không tên'}")
            for item in tasks:
                due = item.get('due_at'); suffix = ''
                try:
                    when = datetime.fromisoformat(str(due).replace('Z', '+00:00')).astimezone(zone)
                    suffix = f", hạn {when.strftime('%d/%m/%Y %H:%M')}"
                except (TypeError, ValueError): pass
                parts.append(f"Công việc {item.get('title') or 'không tên'}{suffix}")
            return '. '.join(parts) + '.'
        if self._calendar_intent(transcript) != 'query':
            return None
        # A clear lookup supersedes an unfinished create only for this exact
        # authenticated user/device/session. Saved Backend events are untouched.
        self._drafts.pop(self._key(context), None)
        if not context.delegation_token:
            return 'Phiên xác thực lịch chưa sẵn sàng.'
        start = self._local_now().replace(hour=0, minute=0, second=0, microsecond=0)
        match = period.group().casefold() if period else 'ngày cụ thể'
        day_part = None
        if re.search(r'\bchieu\s+(?:ngay\s+)?mai\b', folded):
            match, day_part = 'ngày mai', 'afternoon'
        elif re.search(r'\bsang\s+(?:ngay\s+)?mai\b', folded):
            match, day_part = 'ngày mai', 'morning'
        elif re.search(r'\btrua\s+(?:ngay\s+)?mai\b', folded):
            match, day_part = 'ngày mai', 'noon'
        elif re.search(r'\btoi\s+(?:ngay\s+)?mai\b', folded):
            match, day_part = 'ngày mai', 'evening'
        elif not period and re.search(r'\b(?:ngay\s+)?mai\b', folded):
            match = 'ngày mai'
        if explicit:
            year = int(explicit.group(3) or start.year)
            try:
                start = start.replace(year=year, month=int(explicit.group(2)), day=int(explicit.group(1)))
            except ValueError:
                return 'Ngày bạn hỏi không hợp lệ.'
        else:
            if match == 'ngày mai':
                start += timedelta(days=1)
            if match == 'tuần này':
                start -= timedelta(days=start.weekday())
        end = start + timedelta(days=7 if match == 'tuần này' else 1)
        if day_part == 'morning':
            start, end = start.replace(hour=6), start.replace(hour=12)
        elif day_part == 'noon':
            start, end = start.replace(hour=11), start.replace(hour=14)
        elif day_part == 'afternoon':
            start, end = start.replace(hour=12), start.replace(hour=18)
        elif day_part == 'evening':
            start, end = start.replace(hour=18), end
        reply = await adapter.execute('schedule.query',
            SimpleNamespace(from_iso=start.isoformat(), to_iso=end.isoformat()), context,
            operation_id=self._operation_id(), request_context=request_context)
        if reply.status != 'SUCCESS':
            return 'Hiện không thể truy vấn lịch của bạn.'
        items = reply.data.get('items', [])
        if not items:
            return 'Bạn chưa có lịch trong khoảng thời gian được hỏi.'
        zone = ZoneInfo(self.timezone)
        rendered = []
        has_timed_item = False
        for item in items[:10]:
            title = str(item.get('title') or 'Lịch')
            try:
                begins = datetime.fromisoformat(str(item['starts_at']).replace('Z', '+00:00')).astimezone(zone)
                ends = datetime.fromisoformat(str(item['ends_at']).replace('Z', '+00:00')).astimezone(zone)
                rendered.append(f"{title}, {begins.strftime('%d/%m/%Y')} từ {begins.strftime('%H:%M')} đến {ends.strftime('%H:%M')}")
                has_timed_item = True
            except (KeyError, TypeError, ValueError):
                rendered.append(title)
        return '. '.join(rendered) + ('.' if has_timed_item else '')

    def _key(self, context): return (context.user_id, context.device_id or 'web', context.session_id)
    def cleanup(self):
        now = self._now()
        for key, value in list(self._drafts.items()):
            if now - value['created'] > self.ttl: self._drafts.pop(key, None)
    def disconnect(self, context): self._drafts.pop(self._key(context), None)

    async def mutate_saved(self, operation, event_id, arguments, context, adapter, request_context, confirmation_proof):
        """Execute an already-confirmed saved-event mutation through Backend only."""
        if operation not in ('event.update', 'event.delete') or not confirmation_proof:
            return 'Chưa thể lưu lịch vì thiếu confirmation proof hợp lệ.'
        payload = dict(arguments); payload.update(event_id=event_id, confirmed=True,
                                                   confirmation_proof=confirmation_proof)
        result = await adapter.execute(operation, payload, context,
                                       operation_id=self._operation_id(),
                                       request_context=request_context)
        return 'Đã cập nhật lịch thành công.' if operation == 'event.update' and result.status == 'SUCCESS' else ('Đã hủy lịch thành công.' if operation == 'event.delete' and result.status == 'SUCCESS' else 'Backend chưa xác nhận lưu lịch.')
    def _parse(self, text):
        # Explicit end times are handled before the legacy transcript parser.
        end_match = re.search(r'(?:đến|tới)\s*(\d{1,2})(?::(\d{2}))?\s*(?:giờ)?\s*(sáng|trưa|chiều|tối)?', text, re.I)
        if end_match:
            hour_match = re.search(r'(?:lúc|từ)\s*(\d{1,2})(?::(\d{2}))?\s*(?:giờ)?\s*(sáng|trưa|chiều|tối)?', text, re.I)
            if hour_match:
                if max(int(hour_match.group(1)), int(end_match.group(1))) > 23 or max(
                        int(hour_match.group(2) or 0), int(end_match.group(2) or 0)) > 59:
                    return {'invalid': True}
                def hour24(raw, modifier):
                    hour = int(raw); modifier = (modifier or '').casefold()
                    if modifier == 'sáng' and hour == 12: return 0
                    if modifier in ('chiều', 'tối') and hour < 12: return hour + 12
                    if modifier == 'trưa' and hour < 11: return hour + 12
                    return hour
                start_hour = hour24(hour_match.group(1), hour_match.group(3))
                end_hour = hour24(end_match.group(1), end_match.group(3))
                base = self._local_now(); day = 1 if re.search(r'ngày mai|ngày mai|\bmai\b', text, re.I) else 0
                explicit = re.search(r'ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})', text, re.I)
                if explicit:
                    try:
                        base = base.replace(year=int(explicit.group(3)), month=int(explicit.group(2)),
                                            day=int(explicit.group(1)))
                    except ValueError:
                        return {'invalid': True}
                    day = 0
                start = base.replace(hour=start_hour, minute=int(hour_match.group(2) or 0), second=0, microsecond=0) + timedelta(days=day)
                end = start.replace(hour=end_hour, minute=int(end_match.group(2) or 0))
                if end <= start: return {'invalid': True}
                title = re.search(r'(học|lịch)\s+(.+?)(?=\s+(?:ngày|từ|lúc|đến)\b|$)', text, re.I)
                parsed_title = (('Học ' if title.group(1).casefold() == 'học' else '')
                                + title.group(2).strip()) if title else 'Lịch cá nhân'
                if parsed_title.casefold().startswith('học '):
                    parsed_title = 'Học ' + parsed_title[4:]
                return {'title': parsed_title, 'starts_at': start.isoformat(), 'ends_at': end.isoformat(), 'timezone': self.timezone}
        day = 1 if re.search(r'ngày mai|mai', text, re.I) else 0
        hour = re.search(r'(?:lúc|giờ)\s*(\d{1,2})', text, re.I)
        duration = re.search(r'(\d+)\s*tiếng', text, re.I)
        title = re.search(r'(?:học|lịch)\s+(.+?)(?:\s+(?:trong|từ)\b|$)', text, re.I)
        if not hour: return None
        if int(hour.group(1)) > 23 or (duration and not int(duration.group(1))):
            return {'invalid': True}
        start = self._local_now().replace(hour=int(hour.group(1)), minute=0, second=0, microsecond=0) + timedelta(days=day)
        end = start + timedelta(hours=int(duration.group(1))) if duration else None
        return {'title': title.group(1).strip() if title else 'Lịch cá nhân', 'starts_at': start.isoformat(), 'ends_at': end.isoformat() if end else None, 'timezone': self.timezone}
    async def _conflict(self, draft, context, adapter, request_context):
        if not draft.get('title') or not draft.get('starts_at') or not draft.get('ends_at'):
            return None
        if self.schedule_query_only:
            result = await adapter.execute('schedule.query',
                SimpleNamespace(from_iso=draft['starts_at'], to_iso=draft['ends_at']), context,
                operation_id=self._operation_id(), request_context=request_context)
            items = result.data.get('items') if result.status == 'SUCCESS' and isinstance(result.data, dict) else None
            return bool(items) if isinstance(items, list) else 'UNAVAILABLE'
        result = await adapter.execute('event.check_conflict', draft, context,
            operation_id=self._operation_id(), request_context=request_context)
        if result.status != 'SUCCESS': return result.status
        return bool(result.data.get('has_conflict')) if isinstance(result.data, dict) else 'INVALID'

    @staticmethod
    def _create_payload(draft):
        return {key: draft[key] for key in ('title', 'starts_at', 'ends_at', 'timezone',
                                             'idempotency_key')}

    @staticmethod
    def _fail(draft, message):
        draft['state'] = 'FAILED'
        draft['failure_message'] = message
        draft.pop('pending_id', None)
        return message

    @staticmethod
    def _mutation_failure(status):
        if status == 'FORBIDDEN':
            return 'Lịch chưa được tạo vì Backend từ chối quyền ghi; Calendar write gate hiện đang đóng.'
        if status == 'CONFLICT':
            return 'Lịch chưa được tạo vì bị trùng với lịch hiện có.'
        if status == 'INVALID':
            return 'Lịch chưa được tạo vì dữ liệu ngày giờ không hợp lệ.'
        if status == 'TIMEOUT':
            return 'Lịch chưa được tạo vì Backend phản hồi quá thời gian.'
        return 'Lịch chưa được tạo vì Backend không xác nhận ghi thành công.'

    async def handle(self, transcript, context, adapter, request_context):
        self.cleanup(); key = self._key(context); draft = self._drafts.get(key)
        low = transcript.lower().strip()
        confirmation_text = re.fullmatch(r'(?:đúng(?: rồi)?|xác nhận|ok|đồng ý)(?:[,.]?\s*(?:tạo(?: lịch)?(?: đi)?|lưu(?: lịch)?(?: đi)?))?[.!]?', low)
        if draft and re.search(r'(hủy|thôi|không tạo|không nữa|không đồng ý|từ chối)', low):
            self._drafts.pop(key, None); return 'Đã hủy lịch nháp, chưa lưu vào hệ thống.'
        if draft and confirmation_text:
            if draft.get('state') == 'FAILED':
                return draft.get('failure_message') or 'Yêu cầu tạo lịch trước đã thất bại; hệ thống sẽ không tự ghi lại.'
            if draft.get('conflict_checked') is not True:
                conflict = await self._conflict(draft, context, adapter, request_context)
                if conflict is not False:
                    return self._fail(draft, 'Lịch chưa được tạo vì không kiểm tra được xung đột.')
            draft['state'] = 'CONFIRMED'
            if self.schedule_query_only:
                return self._fail(draft, 'Lịch chưa được tạo vì phiên này chỉ có quyền đọc lịch và Calendar write gate đang đóng.')
            payload = self._create_payload(draft)
            payload['operation'] = 'create'
            confirmation = await adapter.confirm_confirmation(
                draft.get('pending_id'), payload, context, request_context)
            if not confirmation or not confirmation.get('confirmation_proof'):
                return self._fail(draft, 'Lịch chưa được tạo vì Backend không cấp confirmation proof hợp lệ.')
            args = {**payload, 'confirmed': True,
                    'confirmation_proof': confirmation['confirmation_proof']}
            draft['state'] = 'EXECUTING'
            reply = await adapter.execute('event.create', args, context,
                operation_id=self._operation_id(), request_context=request_context)
            if reply.status != 'SUCCESS':
                return self._fail(draft, self._mutation_failure(reply.status))
            event_id = str((reply.data or {}).get('id') or '') if getattr(reply, 'backend_confirmed', False) else ''
            if not event_id:
                return self._fail(draft, 'Lịch chưa được tạo vì phản hồi Backend không có event ID hợp lệ.')
            verification = await adapter.execute('schedule.query', SimpleNamespace(
                from_iso=draft['starts_at'], to_iso=draft['ends_at']), context,
                operation_id=self._operation_id(), request_context=request_context)
            items = (verification.data or {}).get('items', []) if verification.status == 'SUCCESS' else []
            if not any(str(item.get('id')) == event_id for item in items):
                return self._fail(draft, 'Lịch chưa được xác nhận lưu trong MySQL; hệ thống sẽ không báo thành công.')
            draft['state'] = 'SUCCESS'
            self._drafts.pop(key, None)
            return 'Đã tạo lịch thành công.'
        if not draft and confirmation_text:
            return 'Hiện không có lịch nào đang chờ xác nhận.'
        if draft and re.search(r'(đổi sang|chuyển sang)\s*(\d{1,2})(?::\d{2})?\s*giờ', low):
            if draft.get('state') == 'FAILED':
                return draft.get('failure_message') or 'Yêu cầu trước đã thất bại; hãy tạo một yêu cầu lịch mới.'
            change = re.search(r'(?:đổi sang|chuyển sang)\s*(\d{1,2})(?::(\d{2}))?\s*giờ\s*(sáng|trưa|chiều|tối)?', low)
            hour = int(change.group(1)); minute = int(change.group(2) or 0); modifier = change.group(3) or ''
            if modifier in ('chiều', 'tối') and hour < 12: hour += 12
            elif modifier == 'sáng' and hour == 12: hour = 0
            elif modifier == 'trưa' and hour < 11: hour += 12
            if hour > 23:
                return 'Bạn hãy chọn giờ từ 0 đến 23.'
            original_start = datetime.fromisoformat(draft['starts_at'])
            duration = datetime.fromisoformat(draft['ends_at']) - original_start
            start = original_start.replace(hour=hour, minute=minute)
            draft['starts_at'] = start.isoformat(); draft['ends_at'] = (start + duration).isoformat(); draft['confirmed'] = False; draft['conflict_checked'] = False; draft['state'] = 'PREPARED'
            conflict = await self._conflict(draft, context, adapter, request_context)
            if conflict is not False: return 'Chưa thể xác nhận lại vì không kiểm tra được xung đột.'
            draft['conflict_checked'] = True
            if not self.schedule_query_only:
                payload = self._create_payload(draft); payload['operation'] = 'create'
                prepared = await adapter.prepare_confirmation('create', payload, context, request_context)
                if not prepared or not prepared.get('pending_id'):
                    return self._fail(draft, 'Backend chưa chuẩn bị được xác nhận lịch sau khi đổi giờ.')
                draft['pending_id'] = prepared['pending_id']
            draft['state'] = 'WAITING_CONFIRMATION'
            return f"Đã đổi lịch sang {hour} giờ. Bạn xác nhận không?"
        intent = self._calendar_intent(transcript)
        if intent != 'create':
            return None
        if draft:
            # An explicit new create command replaces, rather than supplements,
            # the previous proposal in this owner/session scope.
            self._drafts.pop(key, None)
        parsed = self._parse(transcript)
        if parsed is None: return 'Bạn muốn tạo lịch vào lúc mấy giờ?'
        if parsed.get('invalid'): return 'Thời gian kết thúc phải sau thời gian bắt đầu.'
        if parsed['ends_at'] is None: return 'Bạn dự định thực hiện trong bao lâu?'
        parsed['confirmed'] = False; parsed['conflict_checked'] = False; parsed['idempotency_key'] = 'voice-' + uuid4().hex; self._drafts[key] = {'created': self._now(), 'state': 'PREPARED', **parsed}
        conflict = await self._conflict(self._drafts[key], context, adapter, request_context)
        if conflict is True:
            return 'Lịch đang bị trùng. Bạn muốn đổi giờ không?'
        if conflict != False:
            self._drafts.pop(key, None); return 'Chưa thể kiểm tra xung đột lịch lúc này.'
        self._drafts[key]['conflict_checked'] = True
        if not self.schedule_query_only:
            payload = self._create_payload(self._drafts[key])
            payload['operation'] = 'create'
            prepared = await adapter.prepare_confirmation('create', payload, context, request_context)
            if not prepared or not prepared.get('pending_id'):
                return self._fail(self._drafts[key], 'Lịch chưa được tạo vì Backend chưa chuẩn bị được yêu cầu xác nhận.')
            self._drafts[key]['pending_id'] = prepared['pending_id']
        self._drafts[key]['state'] = 'WAITING_CONFIRMATION'
        return f"Bạn muốn tạo lịch {parsed['title']} lúc {datetime.fromisoformat(parsed['starts_at']).strftime('%H:%M')} đến {datetime.fromisoformat(parsed['ends_at']).strftime('%H:%M')}, đúng không?"
