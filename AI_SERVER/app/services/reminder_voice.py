"""Explicit acknowledgement of a specific reminder delivery."""
import re

from app.clients.backend import BackendError


_COMMAND = re.compile(
    r"^(?:tôi\s+)?xác\s+nhận\s+đã\s+nhận\s+(?:lời\s+)?nhắc\s+nhở"
    r"(?:\s+mã)?\s+([1-9][0-9]{0,18})(?:\s*,)?\s+mã\s+giao"
    r"(?:\s+hàng)?\s+([1-9][0-9]{0,18})[.!]?$", re.I)


async def handle_reminder_receipt(session, transcript, context):
    match = _COMMAND.fullmatch(transcript.strip())
    if not match:
        return None
    reminder_id, delivery_id = match.groups()
    if any(int(value) > 9223372036854775807 for value in (reminder_id, delivery_id)):
        return 'Mã nhắc nhở hoặc mã giao không hợp lệ.'
    try:
        await session.confirm_reminder_receipt(reminder_id, delivery_id, context)
    except BackendError:
        return 'Tôi chưa thể xác nhận đã nhận nhắc nhở này.'
    return 'Đã xác nhận bạn nhận được nhắc nhở.'
