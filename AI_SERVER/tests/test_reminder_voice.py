import asyncio

from app.clients.backend import BackendCode, BackendError
from app.services.reminder_voice import handle_reminder_receipt


def test_voice_receipt_requires_explicit_delivery_and_waits_for_backend():
    class Session:
        calls = []
        fail = True

        async def confirm_reminder_receipt(self, reminder_id, delivery_id, context):
            self.calls.append((reminder_id, delivery_id, context))
            if self.fail:
                raise BackendError(BackendCode.NETWORK)

    async def scenario():
        session = Session()
        context = object()
        assert await handle_reminder_receipt(session, 'Tôi chưa nhận nhắc nhở 11', context) is None
        assert await handle_reminder_receipt(session, 'Xác nhận đã nhận nhắc nhở 11', context) is None
        assert session.calls == []
        transcript = 'Xác nhận đã nhận nhắc nhở 11, mã giao 22.'
        assert 'chưa thể' in await handle_reminder_receipt(session, transcript, context)
        session.fail = False
        assert 'Đã xác nhận' in await handle_reminder_receipt(session, transcript, context)
        assert session.calls == [('11', '22', context), ('11', '22', context)]

    asyncio.run(scenario())
