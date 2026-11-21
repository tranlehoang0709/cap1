import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace
from app.services.calendar_voice import CalendarVoiceWorkflow
from app.personal_assistant.tool_boundary import TrustedToolContext

def ctx(session='s', device='9'):
    return TrustedToolContext('7', session, 'c', delegation_token='d', device_id=device, dialogue_ready=True)

class Adapter:
    def __init__(self, status='SUCCESS', data=None, create_status=None): self.status=status; self.create_status=create_status or status; self.data=data or {'has_conflict': False}; self.calls=[]
    async def prepare_confirmation(self, operation, payload, context, request_context=None):
        return {'pending_id': 'pending-test'}
    async def confirm_confirmation(self, pending_id, payload, context, request_context=None):
        return {'confirmation_proof': 'proof-test'}
    async def execute(self, tool, args, context, **kwargs):
        self.calls.append(tool); return SimpleNamespace(status=self.create_status if tool == 'event.create' else self.status, data=self.data)


def test_query_uses_local_day_boundaries_on_new_sessions():
    class Reads:
        async def execute(self, tool, args, context, **kwargs):
            assert tool == 'schedule.query'
            assert (args.from_iso, args.to_iso) == ('2026-11-22T00:00:00+07:00', '2026-11-23T00:00:00+07:00')
            return SimpleNamespace(status='SUCCESS', data={'items': [{'title': 'Lịch đã lưu'}]})

    async def run():
        for session in ['first', 'second']:
            flow = CalendarVoiceWorkflow(clock=lambda: datetime(2026, 11, 20, 18, tzinfo=timezone.utc))
            assert await flow.query('Ngày mai tôi có lịch gì?', ctx(session), Reads(), None) == 'Lịch đã lưu'

    asyncio.run(run())


def test_afternoon_query_supersedes_create_draft_and_uses_overlap_window():
    class Reads:
        def __init__(self): self.calls = []
        async def execute(self, tool, args, context, **kwargs):
            self.calls.append((tool, getattr(args, 'from_iso', None), getattr(args, 'to_iso', None)))
            if tool == 'event.check_conflict':
                return SimpleNamespace(status='SUCCESS', data={'has_conflict': False})
            assert tool == 'schedule.query'
            assert (args.from_iso, args.to_iso) == ('2026-11-22T12:00:00+07:00', '2026-11-22T18:00:00+07:00')
            return SimpleNamespace(status='SUCCESS', data={'items': [{'id': '21', 'title': 'Học tiếng Anh',
                'starts_at': '2026-11-22T13:00:00+07:00', 'ends_at': '2026-11-22T15:00:00+07:00'}]})
        async def prepare_confirmation(self, operation, payload, context, request_context=None):
            return {'pending_id': 'pending-test'}

    async def run():
        flow = CalendarVoiceWorkflow(clock=lambda: datetime(2026, 11, 20, 18, tzinfo=timezone.utc))
        adapter = Reads()
        await flow.handle('Tạo lịch học tiếng Anh ngày mai từ 1 giờ chiều đến 3 giờ chiều', ctx(), adapter, None)
        reply = await flow.query('Chiều mai tôi có lịch gì không?', ctx(), adapter, None)
        assert 'Học tiếng Anh' in reply
        assert not flow._drafts

    asyncio.run(run())


def test_robot_read_only_delegation_previews_but_never_sends_write():
    async def run():
        adapter = Adapter(data={'items': []})
        flow = CalendarVoiceWorkflow(schedule_query_only=True)
        await flow.handle('Ngày mai lúc 8 giờ học tiếng Anh trong 2 tiếng', ctx(), adapter, None)
        await flow.handle('Không đúng', ctx(), adapter, None)
        assert 'chỉ có quyền đọc' in await flow.handle('Xác nhận', ctx(), adapter, None)
        assert adapter.calls == ['schedule.query']

    asyncio.run(run())

def test_create_confirm_cancel_and_session_isolation():
    async def run():
        flow=CalendarVoiceWorkflow(); adapter=Adapter(create_status='FORBIDDEN')
        first=await flow.handle('Ngày mai lúc 8 giờ sáng tôi học tiếng Anh trong 2 tiếng',ctx(),adapter,None)
        assert 'đúng không' in first.lower()
        assert 'chưa được lưu' in (await flow.handle('Đúng',ctx(),adapter,None)).lower()
        assert adapter.calls == ['event.check_conflict', 'event.create']
        await flow.handle('Ngày mai lúc 8 giờ sáng tôi học tiếng Anh trong 2 tiếng',ctx(),adapter,None)
        assert 'hủy' in (await flow.handle('Thôi hủy',ctx(),adapter,None)).lower()
        assert adapter.calls == ['event.check_conflict', 'event.create', 'event.check_conflict']
        await flow.handle('Ngày mai lúc 8 giờ sáng tôi học tiếng Anh trong 2 tiếng',ctx('other'),adapter,None)
        assert 'không có lịch nào' in (await flow.handle('Đúng',ctx('wrong'),adapter,None)).lower()
    asyncio.run(run())

def test_missing_information_and_modify_draft():
    async def run():
        flow=CalendarVoiceWorkflow(); adapter=Adapter()
        assert 'mấy giờ' in (await flow.handle('Ngày mai tôi muốn học tiếng Anh',ctx(),adapter,None)).lower()
        await flow.handle('Ngày mai lúc 8 giờ sáng tôi học tiếng Anh trong 2 tiếng',ctx(),adapter,None)
        assert '9 giờ' in (await flow.handle('Đổi sang 9 giờ',ctx(),adapter,None)).lower()
    asyncio.run(run())

def test_conflict_and_expired_draft_are_safe():
    async def run():
        flow = CalendarVoiceWorkflow(ttl_seconds=5, now=lambda: 100, clock=lambda: __import__('datetime').datetime(2026, 11, 20, 8, 0))
        conflict = Adapter(data={'has_conflict': True})
        assert 'trùng' in (await flow.handle('Ngày mai lúc 8 giờ học tiếng Anh trong 2 tiếng', ctx(), conflict, None)).lower()
        assert conflict.calls == ['event.check_conflict']
        ok = Adapter()
        await flow.handle('Ngày mai lúc 8 giờ học tiếng Anh trong 2 tiếng', ctx(), ok, None)
        flow._now = lambda: 200
        assert 'không có lịch nào' in (await flow.handle('Đúng', ctx(), ok, None)).lower()
        assert 'event.create' not in ok.calls
    asyncio.run(run())

def test_invalid_range_and_disconnect_cleanup():
    async def run():
        flow = CalendarVoiceWorkflow(clock=lambda: __import__('datetime').datetime(2026, 11, 20, 8, 0))
        adapter = Adapter()
        assert 'kết thúc' in (await flow.handle('Ngày mai lúc 10 giờ đến 9 giờ học tiếng Anh', ctx(), adapter, None)).lower()
        await flow.handle('Ngày mai lúc 8 giờ học tiếng Anh trong 2 tiếng', ctx(), adapter, None)
        flow.disconnect(ctx())
        assert 'không có lịch nào' in (await flow.handle('Đúng', ctx(), adapter, None)).lower()
    asyncio.run(run())
