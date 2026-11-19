"""Authenticated Local-only Vietnamese text chat, with optional SSE streaming."""
import asyncio
import hmac
import json
import logging
import time
import os
from uuid import uuid4
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from app.clients.local.llama import LocalLLMError
from app.core.llm_config import LLMSettings
from app.core.logging import get_logger, log_event
from app.models.llm import (ConversationKey, LLMError, LLMErrorCode, LLMRequest,
                            ProviderDelta, ProviderDone)
from app.services.audio_context import AudioContext


class LocalChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    user_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    session_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")
    content: str = Field(min_length=1, max_length=16000, repr=False)
    stream: bool = False
    personalize: bool = False
    delegation: str | None = Field(default=None, min_length=1, max_length=4096, repr=False)
    timezone: str = Field(default='Asia/Bangkok', max_length=100)


def _authorize(request: Request) -> None:
    if request.url.path == '/internal/pa08-chat':
        configured = os.getenv('AI_SERVER_BACKEND_TOOL_SERVICE_TOKEN', '')
        supplied = request.headers.getlist('x-ai-tool-service')
        if (not configured or len(supplied) != 1 or not hmac.compare_digest(
                supplied[0].encode(), configured.encode())):
            raise HTTPException(401, 'BACKEND_TOOL_SERVICE_UNAUTHORIZED')
        return
    configured = request.app.state.local_llm_settings.chat_token
    supplied = request.headers.getlist("authorization")
    if (configured is None or len(supplied) != 1 or not hmac.compare_digest(
            supplied[0].encode(), ("Bearer " + configured.get_secret_value()).encode())):
        raise HTTPException(401, "LOCAL_CHAT_UNAUTHORIZED")


async def _disconnect_watch(request: Request, context: AudioContext):
    while True:
        if await request.is_disconnected():
            context.cancel()
            return
        await asyncio.sleep(.1)


def _error_status(error: Exception) -> tuple[int, str]:
    if isinstance(error, LocalLLMError):
        return 503, str(error)
    if isinstance(error, LLMError):
        code = error.code.value
        return (504 if code == "timeout" else 429 if code == "rate_limit" else
                409 if code == "session_busy" else 503), code
    return 503, "local_llm_failed"


async def local_chat(request: Request):
    _authorize(request)
    try:
        raw = await request.body()
        if len(raw) > 70000:
            raise HTTPException(413, "REQUEST_TOO_LARGE")
        data = LocalChatRequest.model_validate_json(raw)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "INVALID_REQUEST") from None

    # Delegated PA-08 requests use the existing structured understanding and
    # workflow boundary. The delegation is opaque here and is only forwarded
    # to the Backend; the Backend remains authoritative for subject/ownership.
    if data.delegation:
        from app.personal_assistant.understanding import IntentUnderstanding
        from app.personal_assistant.tool_boundary import TrustedToolContext
        from app.personal_assistant.config import UnderstandingSettings
        settings = UnderstandingSettings()
        context = AudioContext(deadline=time.monotonic() + settings.timeout_seconds)
        understanding = IntentUnderstanding(request.app.state.local_llm,
            timeout_seconds=settings.timeout_seconds, max_output_tokens=settings.max_output_tokens)
        # User/session are correlation labels only; Backend verifies the signed
        # delegation and binds the actual owner. They are never authorization.
        trusted = TrustedToolContext(data.user_id, data.session_id, uuid4().hex,
            dialogue_ready=True, allowed_tools=frozenset({'schedule.query'}),
            delegation_token=data.delegation)
        try:
            analysis = await understanding.analyze(data.content,
                key=ConversationKey(data.user_id, data.session_id, 'pa08'),
                timezone=data.timezone, context=context)
            op = next((item for item in analysis.operations
                       if item.feature == 'PA-08' and item.action == 'query'), None)
            if op is None:
                # Authenticated Backend ingress may also carry ordinary chat.
                # Only PA-08 enters the tool workflow; other intents continue
                # through the existing general LLM chat below.
                data = data.model_copy(update={'delegation': None})
            else:
                from app.personal_assistant.tool_planning import plan_tools
                plan = plan_tools(analysis, trusted)
                workflow = await request.app.state.pa_workflows.create(plan, trusted)
                workflow = await request.app.state.pa_workflows.run(workflow.id, trusted)
                step = workflow.steps[0] if workflow.steps else None
                result = step.result if step else None
                if result is None or result.status != 'SUCCESS':
                    raise HTTPException(503, 'SCHEDULE_BACKEND_UNAVAILABLE')
                items = (result.data or {}).get('items', [])
                answer = ('Hôm nay bạn không có lịch nào.' if not items else
                          'Hôm nay bạn có ' + str(len(items)) + ' lịch trong hệ thống.')
                return JSONResponse({'content': answer, 'tool': 'schedule.query',
                    'tool_result': {'items': items}, 'grounded': True}, headers={'Cache-Control': 'no-store'})
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(503, 'SCHEDULE_BACKEND_UNAVAILABLE') from None

    settings = request.app.state.local_llm_settings
    sessions = request.app.state.local_chat_sessions
    claimed = False
    try:
        history = await sessions.claim(data.user_id, data.session_id)
        claimed = True
        model = await request.app.state.local_llm.discover_model()
    except Exception as error:
        if claimed:
            await sessions.finish(data.user_id, data.session_id, data.content, None)
        status, detail = _error_status(error)
        raise HTTPException(status, detail) from None
    config = LLMSettings(_env_file=None, model=model,
        max_output_tokens=settings.max_output_tokens, max_output_chars=settings.max_output_chars)
    context = AudioContext(deadline=time.monotonic() + (max(settings.timeout_seconds, 300)
                                                      if data.personalize else settings.timeout_seconds))
    llm_request = LLMRequest(ConversationKey(data.user_id, data.session_id, "local-text"),
        uuid4().hex, data.content, settings.system_prompt, history, config)

    async def events():
        started = time.perf_counter()
        answer = ""
        done = None
        watcher = asyncio.create_task(_disconnect_watch(request, context))
        try:
            if data.personalize:
                from app.personal_assistant.personalization import PersonalizedAssistant
                from app.personal_assistant.tool_boundary import TrustedToolContext
                service = PersonalizedAssistant(request.app.state.local_llm, settings,
                    workflows=request.app.state.pa_workflows)
                pending = await sessions.pending(data.user_id, data.session_id)
                reply = await service.reply(data.content,
                    context=TrustedToolContext(data.user_id, data.session_id, uuid4().hex,
                        allowed_tools=frozenset({'memory.query'}), delegation_token=data.delegation),
                    key=llm_request.key, history=history, request_context=context, pending=pending)
                if reply.pending is not None:
                    await sessions.save_pending(data.user_id, data.session_id, reply.pending)
                await sessions.finish(data.user_id, data.session_id, data.content,
                                      reply.text if reply.metadata['retain_history'] else None)
                yield 'delta', {'content': reply.text}
                yield 'done', {'content': reply.text, 'model': reply.model, 'usage': None,
                    'personalization': reply.metadata,
                    'latency_ms': round((time.perf_counter() - started) * 1000, 1)}
                return
            async for event in request.app.state.local_llm.stream(
                    llm_request, context, enable_thinking=False):
                if isinstance(event, ProviderDelta):
                    answer += event.text
                    if len(answer) > settings.max_output_chars:
                        raise LLMError(LLMErrorCode.CONTEXT_LIMIT)
                    yield "delta", {"content": event.text}
                elif isinstance(event, ProviderDone):
                    done = event
            if done is None or not done.complete or not answer.strip():
                log_event(get_logger('local_chat'), logging.WARNING,
                          'local_chat_incomplete', 'Local generation did not produce a complete answer',
                          provider='local', model=model, stage='generation',
                          reason=done.reason if done is not None else 'missing_completion',
                          status='empty' if not answer.strip() else 'incomplete')
                raise LLMError(LLMErrorCode.PROVIDER_ERROR)
            await sessions.finish(data.user_id, data.session_id, data.content, answer)
            usage = None if done.usage is None else {
                "input_tokens": done.usage.input_tokens,
                "output_tokens": done.usage.output_tokens,
                "total_tokens": done.usage.total_tokens,
            }
            yield "done", {"content": answer, "model": model, "usage": usage,
                           "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
        except BaseException:
            await sessions.finish(data.user_id, data.session_id, data.content, None)
            raise
        finally:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)

    if data.stream:
        async def sse():
            try:
                async for event, payload in events():
                    yield f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
            except Exception as error:
                _, detail = _error_status(error)
                yield f"event: error\ndata: {json.dumps({'error': detail})}\n\n"
        return StreamingResponse(sse(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store"})

    final = None
    try:
        async for event, payload in events():
            if event == "done":
                final = payload
    except Exception as error:
        status, detail = _error_status(error)
        raise HTTPException(status, detail) from None
    return JSONResponse(final, headers={"Cache-Control": "no-store"})
