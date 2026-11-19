"""Local foundation routes: no cloud router imports, auth or media execution."""
from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.clients.local.llama import LlamaServerAdapter, LocalLLMError
from app.core.runtime_config import LocalLLMSettings


async def local_readiness(application: FastAPI | None = None) -> dict:
    llm = {"status": "NOT_READY"}
    stt = {"status": "NOT_READY"}
    tts = {"status": "NOT_READY"}
    settings = None
    try:
        settings = LocalLLMSettings()
        if application is None:
            adapter = LlamaServerAdapter(settings)
            try:
                model = await adapter.discover_model()
            finally:
                await adapter.aclose()
        else:
            model = await application.state.local_llm.discover_model()
        llm.update(status="READY", model=model)
    except ValidationError:
        llm["reason"] = "invalid_local_configuration"
    except LocalLLMError as error:
        llm["reason"] = str(error)
    try:
        if application is None:
            from app.clients.stt_factory import create_local_stt_adapter
            local_stt = create_local_stt_adapter()
        else:
            local_stt = application.state.local_stt
        await local_stt.load()
        stt.update(status="READY", engine="faster-whisper",
                   model=local_stt.settings.model, language="vi")
    except Exception:
        stt["reason"] = "local_stt_load_failed"
    try:
        if application is None:
            from app.clients.tts_factory import create_local_tts_adapter
            local_tts = create_local_tts_adapter()
        else:
            local_tts = application.state.local_tts
        await local_tts.load()
        tts.update(status="READY", engine=local_tts.settings.engine,
                   model=local_tts.settings.model, language="vi",
                   output="opus/16000/mono/60ms")
    except Exception:
        tts["reason"] = "local_tts_load_failed"
    chat_configured = settings is not None and settings.chat_token is not None
    ready = (llm["status"] == "READY" and stt["status"] == "READY"
             and tts["status"] == "READY" and chat_configured)
    return {"status": "READY" if ready else "NOT_READY", "runtime": "local", "llama_server": llm,
            "llm_generation": "READY" if ready else "NOT_READY",
            "chat_auth": "READY" if chat_configured else "NOT_READY",
            "voice": "READY" if ready else "NOT_READY",
            "stt": stt, "tts": tts}


def install_local_routes(application: FastAPI) -> None:
    from app.api.local_chat import local_chat
    from app.clients.stt_factory import create_local_stt_adapter
    from app.clients.tts_factory import create_local_tts_adapter
    from app.services.local_chat import LocalChatSessions

    settings = LocalLLMSettings()
    application.state.local_llm_settings = settings
    application.state.local_llm = LlamaServerAdapter(settings)
    application.state.local_stt = create_local_stt_adapter()
    application.state.local_tts = create_local_tts_adapter()
    application.state.local_chat_sessions = LocalChatSessions(
        max_sessions=settings.max_sessions, max_turns=settings.max_turns,
        max_history_chars=settings.max_context_tokens * 4,
        ttl_seconds=settings.session_ttl_seconds)

    @application.get("/ready")
    async def ready():
        result = await local_readiness(application)
        return JSONResponse(result, status_code=200 if result["status"] == "READY" else 503)

    application.add_api_route("/local/chat", local_chat, methods=["POST"])

    from app.personal_assistant.api import analyze_intent
    from app.personal_assistant.workflow import WorkflowOrchestrator
    from app.personal_assistant.workflow_store import WorkflowStore
    application.state.pa_workflows = WorkflowOrchestrator(store=WorkflowStore(
        max_workflows=settings.max_sessions, ttl_seconds=settings.session_ttl_seconds))
    application.state.pa_analysis_sessions = LocalChatSessions(
        max_sessions=settings.max_sessions, max_turns=settings.max_turns,
        max_history_chars=settings.max_context_tokens * 4,
        ttl_seconds=settings.session_ttl_seconds)
    application.add_api_route('/internal/personal-assistant/analyze', analyze_intent, methods=['POST'])

    @application.post("/internal/web-chat")
    @application.post("/xiaozhi/ota/")
    async def pipeline_unavailable():
        return JSONResponse({"status": "NOT_READY", "runtime": "local"}, status_code=503)
