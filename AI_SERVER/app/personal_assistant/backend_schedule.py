"""Authenticated read-only Backend adapter for PA-08 schedule.query."""
from datetime import datetime, timezone
import httpx
from app.personal_assistant.execution_contracts import ToolAvailability, BackendReceipt
from app.personal_assistant.tool_boundary import BackendToolReply

class BackendScheduleAdapter:
    def __init__(self, base_url: str, service_token: str, *, timeout_seconds: float = 10,
                 delegation_provider=None):
        self.base_url = base_url.rstrip('/'); self.service_token = service_token; self.timeout_seconds = timeout_seconds
        self.delegation_provider = delegation_provider
        self.last_http_status = None
        self.last_error = None
        self.error_trace = []
        self.http_trace = []
    async def _token(self, scope, context, request_context):
        if self.delegation_provider is not None:
            return await self.delegation_provider(scope, request_context)
        return context.delegation_token
    def supports(self, tool_id): return tool_id in {'schedule.query','assistant.query','report.query','plan.query','event.query','event.check_conflict','event.create','event.update','event.delete'} and bool(self.base_url and self.service_token)
    def supports_idempotency(self, tool_id): return False
    def availability(self, tool_id):
        ok = self.supports(tool_id)
        return ToolAvailability(status='AVAILABLE' if ok else 'UNAVAILABLE', endpoint_verified=ok, contract_verified=ok, auth_verified=ok)
    async def prepare_confirmation(self, operation, payload, context, request_context=None):
        token = await self._token('event.'+operation.split('.')[-1], context, request_context)
        if not token or not self.base_url: return None
        params={'session_id':context.session_id,'device_id':context.device_id,'scope':'event.'+operation.split('.')[-1]}
        headers={'Authorization':'Bearer '+token,'X-AI-Tool-Service':self.service_token}
        async with httpx.AsyncClient(timeout=self.timeout_seconds,trust_env=False) as client:
            response=await client.post(self.base_url+'/internal/tool-execution/event-prepare',params=params,json={'operation':operation,'payload':payload},headers=headers)
        self.last_http_status=response.status_code; self.http_trace.append(('event-prepare', response.status_code))
        return response.json() if response.status_code < 300 else None
    async def confirm_confirmation(self, pending_id, payload, context, request_context=None):
        scope='event.'+payload.get('operation','create')
        token = await self._token(scope, context, request_context)
        if not token or not self.base_url: return None
        params={'session_id':context.session_id,'device_id':context.device_id,'scope':scope}
        headers={'Authorization':'Bearer '+token,'X-AI-Tool-Service':self.service_token}
        async with httpx.AsyncClient(timeout=self.timeout_seconds,trust_env=False) as client:
            response=await client.post(self.base_url+'/internal/tool-execution/event-confirm',params=params,json={'pending_id':pending_id,'payload':payload},headers=headers)
        self.last_http_status=response.status_code; self.http_trace.append(('event-confirm', response.status_code))
        return response.json() if response.status_code < 300 else None
    async def execute(self, tool_id, arguments, context, *, operation_id, idempotency_key=None, request_context):
        if not self.supports(tool_id): return BackendToolReply('UNAVAILABLE')
        token = await self._token('schedule.query' if tool_id in ('assistant.query','report.query','plan.query') else tool_id, context, request_context)
        if not token: return BackendToolReply('UNAVAILABLE')
        def bound(value, end=False):
            if value is None or not value.date: return None
            clock = value.time or ('23:59:59' if end else '00:00:00')
            return datetime.fromisoformat(f'{value.date}T{clock}').replace(tzinfo=timezone.utc).isoformat()
        params = {'session_id': context.session_id}
        if context.device_id and context.device_id != 'web': params['device_id'] = context.device_id
        if tool_id in ('schedule.query', 'assistant.query', 'report.query', 'event.query'):
            start = getattr(arguments, 'from_iso', None) or bound(getattr(arguments, 'start', None))
            end = getattr(arguments, 'to_iso', None) or bound(getattr(arguments, 'end', None), True)
            if start: params['from'] = start
            if end: params['to'] = end
        if tool_id not in ('schedule.query', 'assistant.query', 'report.query', 'plan.query'):
            params['scope'] = tool_id
        if tool_id == 'assistant.query':
            params['mode'] = getattr(arguments, 'mode', 'date')

        async def exchange(operation):
            return await request_context.run(operation) if request_context is not None else await operation()

        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds, trust_env=False) as client:
                headers={'Authorization': 'Bearer ' + token, 'X-AI-Tool-Service': self.service_token}
                if tool_id in ('schedule.query','assistant.query','report.query','plan.query','event.query'):
                    path=('/internal/tool-execution/schedule' if tool_id == 'schedule.query' else
                          '/internal/tool-execution/assistant-summary' if tool_id == 'assistant.query' else
                          '/internal/tool-execution/assistant-report' if tool_id == 'report.query' else
                          '/internal/tool-execution/assistant-plan-progress' if tool_id == 'plan.query' else
                          '/internal/tool-execution/event-query')
                    response = await exchange(lambda: client.get(self.base_url + path, params=params, headers=headers))
                elif tool_id == 'event.check_conflict':
                    body = {key: arguments[key] for key in ('starts_at', 'ends_at')}
                    response = await exchange(lambda: client.post(self.base_url + '/internal/tool-execution/event-check-conflict', params=params, json=body, headers=headers))
                elif tool_id in ('event.create','event.update'):
                    body = {key: arguments[key] for key in ('title', 'starts_at', 'ends_at',
                            'timezone', 'confirmed', 'idempotency_key', 'confirmation_proof') if key in arguments}
                    if tool_id == 'event.update': params['event_id'] = arguments['event_id']
                    path = '/internal/tool-execution/event-update' if tool_id == 'event.update' else '/internal/tool-execution/event-create'
                    response = await exchange(lambda: client.post(self.base_url + path, params=params, json=body, headers=headers))
                else:
                    body = {key: arguments[key] for key in ('event_id', 'idempotency_key', 'confirmed', 'confirmation_proof') if key in arguments}
                    response = await exchange(lambda: client.post(self.base_url + '/internal/tool-execution/event-delete', params=params, json=body, headers=headers))
            self.last_http_status = response.status_code
            self.http_trace.append((tool_id, response.status_code))
            self.last_error = response.text[:500] if response.status_code >= 400 else None
            if self.last_error: self.error_trace.append((tool_id, self.last_error))
            if response.status_code in (401, 403): return BackendToolReply('FORBIDDEN')
            if response.status_code == 404: return BackendToolReply('NOT_FOUND')
            if response.status_code == 409: return BackendToolReply('CONFLICT')
            if response.status_code in (400, 422): return BackendToolReply('INVALID')
            if response.status_code >= 500: return BackendToolReply('UNAVAILABLE')
            response.raise_for_status(); data = response.json(); items = data.get('items') if isinstance(data, dict) else None
            if tool_id in ('schedule.query','event.query') and not isinstance(items, list): return BackendToolReply('UNAVAILABLE')
            if tool_id == 'assistant.query' and (not isinstance(data, dict)
                    or not isinstance(data.get('events'), list) or not isinstance(data.get('tasks'), list)):
                return BackendToolReply('UNAVAILABLE')
            if tool_id == 'report.query' and (not isinstance(data, dict)
                    or not isinstance(data.get('items'), list)):
                return BackendToolReply('UNAVAILABLE')
            if tool_id == 'plan.query' and (not isinstance(data, dict)
                    or not isinstance(data.get('plans'), list)):
                return BackendToolReply('UNAVAILABLE')
            receipt = BackendReceipt(execution_id='schedule-' + operation_id, tool_id=tool_id, operation_id=operation_id,
                user_id=context.user_id, session_id=context.session_id, correlation_id=context.correlation_id)
            return BackendToolReply('SUCCESS', data, True, receipt)
        except httpx.TimeoutException: return BackendToolReply('TIMEOUT')
        except (httpx.HTTPError, ValueError, TypeError): return BackendToolReply('UNAVAILABLE')
