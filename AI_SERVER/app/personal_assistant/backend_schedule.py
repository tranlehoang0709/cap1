"""Authenticated read-only Backend adapter for PA-08 schedule.query."""
from datetime import datetime, timezone
import httpx
from app.personal_assistant.execution_contracts import ToolAvailability, BackendReceipt
from app.personal_assistant.tool_boundary import BackendToolReply

class BackendScheduleAdapter:
    def __init__(self, base_url: str, service_token: str, *, timeout_seconds: float = 10):
        self.base_url = base_url.rstrip('/'); self.service_token = service_token; self.timeout_seconds = timeout_seconds
    def supports(self, tool_id): return tool_id == 'schedule.query' and bool(self.base_url and self.service_token)
    def supports_idempotency(self, tool_id): return False
    def availability(self, tool_id):
        ok = self.supports(tool_id)
        return ToolAvailability(status='AVAILABLE' if ok else 'UNAVAILABLE', endpoint_verified=ok, contract_verified=ok, auth_verified=ok)
    async def execute(self, tool_id, arguments, context, *, operation_id, idempotency_key=None, request_context):
        if tool_id != 'schedule.query' or not context.delegation_token or not self.supports(tool_id): return BackendToolReply('UNAVAILABLE')
        def bound(value, end=False):
            if value is None or not value.date: return None
            clock = value.time or ('23:59:59' if end else '00:00:00')
            return datetime.fromisoformat(f'{value.date}T{clock}').replace(tzinfo=timezone.utc).isoformat()
        params = {'session_id': context.session_id}; start, end = bound(arguments.start), bound(arguments.end, True)
        if start: params['from'] = start
        if end: params['to'] = end
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds, trust_env=False) as client:
                response = await client.get(self.base_url + '/internal/tool-execution/schedule', params=params,
                    headers={'Authorization': 'Bearer ' + context.delegation_token, 'X-AI-Tool-Service': self.service_token})
            if response.status_code in (401, 403): return BackendToolReply('FORBIDDEN')
            if response.status_code == 404: return BackendToolReply('NOT_FOUND')
            if response.status_code == 409: return BackendToolReply('CONFLICT')
            if response.status_code >= 500: return BackendToolReply('UNAVAILABLE')
            response.raise_for_status(); data = response.json(); items = data.get('items') if isinstance(data, dict) else None
            if not isinstance(items, list): return BackendToolReply('UNAVAILABLE')
            receipt = BackendReceipt(execution_id='schedule-' + operation_id, tool_id=tool_id, operation_id=operation_id,
                user_id=context.user_id, session_id=context.session_id, correlation_id=context.correlation_id)
            return BackendToolReply('SUCCESS', {'items': items}, True, receipt)
        except httpx.TimeoutException: return BackendToolReply('TIMEOUT')
        except (httpx.HTTPError, ValueError, TypeError): return BackendToolReply('UNAVAILABLE')
