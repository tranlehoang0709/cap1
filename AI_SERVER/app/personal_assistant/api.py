"""Internal authenticated analysis route for the Local runtime only."""
import asyncio
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import Field, field_validator

from app.api.local_chat import LocalChatRequest, _authorize, _disconnect_watch, _error_status
from app.models.llm import ConversationKey
from app.personal_assistant.config import UnderstandingSettings
from app.personal_assistant.understanding import IntentUnderstanding, UnderstandingError
from app.personal_assistant.dialogue import DialogueManager
from app.services.audio_context import AudioContext


class AnalyzeRequest(LocalChatRequest):
    stream: bool = Field(default=False, exclude=True)
    timezone: str = Field(default='Asia/Bangkok', max_length=100)
    expected_revision: int | None = Field(default=None, ge=1)

    @field_validator('timezone')
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('Invalid timezone') from None
        return value


async def analyze_intent(request: Request):
    _authorize(request)
    raw = await request.body()
    if len(raw) > 70000:
        raise HTTPException(413, 'REQUEST_TOO_LARGE')
    try:
        data = AnalyzeRequest.model_validate_json(raw)
        if data.stream or data.personalize or not data.content.strip():
            raise ValueError('Structured analysis requires nonempty non-streaming input')
    except ValueError:
        raise HTTPException(400, 'INVALID_REQUEST') from None
    settings = UnderstandingSettings()
    sessions = request.app.state.pa_analysis_sessions
    claimed = False
    context = AudioContext(deadline=time.monotonic() + settings.timeout_seconds)
    watcher = None
    try:
        await sessions.claim(data.user_id, data.session_id)
        claimed = True
        watcher = asyncio.create_task(_disconnect_watch(request, context))
        service = IntentUnderstanding(request.app.state.local_llm,
                                      timeout_seconds=settings.timeout_seconds,
                                      max_output_tokens=settings.max_output_tokens)
        manager = DialogueManager(service, request.app.state.pa_workflows,
                                  max_turns=request.app.state.local_llm_settings.max_turns)
        pending = await sessions.pending(data.user_id, data.session_id)
        if data.expected_revision is not None and (pending is None or pending.revision != data.expected_revision):
            raise HTTPException(409, 'STALE_DIALOGUE_REVISION')
        timezone = (pending.analysis.timezone if pending and 'timezone' not in data.model_fields_set
                    else data.timezone)
        result = await manager.turn(data.content,
            key=ConversationKey(data.user_id, data.session_id, 'pa-analysis'),
            timezone=timezone, context=context, pending=pending)
        await sessions.save_pending(data.user_id, data.session_id, result)
        return JSONResponse(manager.response(result), headers={'Cache-Control': 'no-store'})
    except HTTPException:
        raise
    except UnderstandingError:
        raise HTTPException(502, 'INVALID_PA_INTERPRETATION') from None
    except PermissionError:
        raise HTTPException(403, 'DIALOGUE_OWNER_MISMATCH') from None
    except KeyError:
        raise HTTPException(409, 'WORKFLOW_EXPIRED') from None
    except ValueError as error:
        if str(error) == 'DIALOGUE_TIMEZONE_MISMATCH':
            raise HTTPException(409, 'DIALOGUE_TIMEZONE_MISMATCH') from None
        raise HTTPException(409, 'DIALOGUE_OR_WORKFLOW_CONFLICT') from None
    except Exception as error:
        status, detail = _error_status(error)
        raise HTTPException(status, detail) from None
    finally:
        if claimed:
            await sessions.finish(data.user_id, data.session_id, data.content, None)
        if watcher is not None:
            watcher.cancel()
            await asyncio.gather(watcher, return_exceptions=True)
