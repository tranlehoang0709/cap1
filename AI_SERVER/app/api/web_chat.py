"""BE-only text execution. User identity is supplied by the authenticated BE."""
import asyncio
import hmac
import json
import time
from types import SimpleNamespace
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import Field
from app.models import backend as dto
from app.models.llm import ConversationKey, LLMRequest, ProviderDelta, ProviderDone, LLMError
from app.models.audio import AudioError
from app.clients.backend import BackendCode, BackendError
from app.services.audio_context import AudioContext
from app.services.live_gemini import quota_gemini

router = APIRouter()


class WebRequest(dto.ContractModel):
    userId: str
    providerId: str
    content: str = Field(min_length=1, max_length=16000, repr=False)


@router.post('/internal/web-chat')
async def web_chat(request: Request):
    state = request.app.state
    expected = state.live_settings.web_token
    supplied = request.headers.getlist('authorization')
    if (expected is None or len(expected.get_secret_value()) < 43 or len(supplied) != 1
            or not hmac.compare_digest(supplied[0].encode(), ('Bearer '+expected.get_secret_value()).encode())):
        raise HTTPException(401, 'SERVICE_UNAUTHORIZED')
    if state.backend_settings.mode != 'integrated' or state.backend_client is None:
        raise HTTPException(503, 'INTEGRATED_BACKEND_REQUIRED')
    try:
        body = bytearray()
        async with asyncio.timeout(5):
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 70000:
                    raise HTTPException(413, 'REQUEST_TOO_LARGE')
        data = WebRequest.model_validate(json.loads(body))
        context = AudioContext(deadline=time.monotonic()+90)
        config = await state.backend_client.resolve_config(dto.ConfigRequest(userId=data.userId,
            providerId=data.providerId, includeCredential=True), context)
        session = SimpleNamespace(valid=True, config=config, client=state.backend_client,
            key=ConversationKey(data.userId, uuid4().hex, 'web'))
        prompt = config.profile.systemPrompt
        if prompt is None:
            raise BackendError(BackendCode.BLOCKED)
        wrapped, limits = quota_gemini(state, session,
            input_bound_bytes=len(prompt.encode())+len(data.content.encode())+256)
        text = ''
        done = None
        turn_id = uuid4().hex
        stream = wrapped.stream(LLMRequest(session.key, turn_id, data.content, prompt, (), limits), context)
        try:
            async for event in stream:
                if isinstance(event, ProviderDelta):
                    text += event.text
                    if len(text) > limits.max_output_chars:
                        raise HTTPException(502, 'OUTPUT_LIMIT')
                elif isinstance(event, ProviderDone):
                    done = event
        finally:
            await stream.aclose()
        if done is None or not done.complete or done.usage is None or not text.strip():
            raise HTTPException(502, 'INCOMPLETE_PROVIDER_RESPONSE')
        _, saved = wrapped._prepared[turn_id]
        return JSONResponse({'content': text, 'conversation_id': saved.conversationId,
                'usage': {'input_tokens': done.usage.input_tokens, 'output_tokens': done.usage.output_tokens}},
                headers={'Cache-Control':'no-store'})
    except BackendError as error:
        status = error.status if error.status in (400,401,403,404,409,429) else 503
        raise HTTPException(status, error.reason or error.code.value) from None
    except LLMError as error:
        raise HTTPException(429 if error.code.value=='rate_limit' else 502, error.code.value) from None
    except AudioError as error:
        raise HTTPException(504 if error.code.value=='timeout' else 503, error.code.value) from None
    except (ValueError, TimeoutError):
        raise HTTPException(400, 'INVALID_REQUEST') from None
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, 'AI_EXECUTION_FAILED') from None
