"""Local foundation routes: no cloud router imports, auth or media execution."""
from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.clients.local.llama import LlamaServerAdapter, LocalLLMError
from app.core.runtime_config import LocalLLMSettings


async def local_readiness(application: FastAPI | None = None) -> dict:
    llm = {"status": "NOT_READY"}
    stt = {"status": "NOT_READY"}
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
    chat_configured = settings is not None and settings.chat_token is not None
    ready = llm["status"] == "READY" and stt["status"] == "READY" and chat_configured
    return {"status": "READY" if ready else "NOT_READY", "runtime": "local", "llama_server": llm,
            "llm_generation": "READY" if ready else "NOT_READY",
            "chat_auth": "READY" if chat_configured else "NOT_READY", "voice": "NOT_READY",
            "stt": stt, "tts": "NOT_IMPLEMENTED"}


def install_local_routes(application: FastAPI) -> None:
    from app.api.local_chat import local_chat
    from app.clients.stt_factory import create_local_stt_adapter
    from app.services.local_chat import LocalChatSessions

    settings = LocalLLMSettings()
    application.state.local_llm_settings = settings
    application.state.local_llm = LlamaServerAdapter(settings)
    application.state.local_stt = create_local_stt_adapter()
    application.state.local_chat_sessions = LocalChatSessions(
        max_sessions=settings.max_sessions, max_turns=settings.max_turns,
        max_history_chars=settings.max_context_tokens * 4,
        ttl_seconds=settings.session_ttl_seconds)

    @application.get("/ready")
    async def ready():
        result = await local_readiness(application)
        return JSONResponse(result, status_code=200 if result["status"] == "READY" else 503)

    @application.websocket("/ws/robot")
    @application.websocket("/ws/dev-robot")
    async def voice_unavailable(ws: WebSocket):
        await ws.close(code=1013, reason="Local voice NOT_READY")

    application.add_api_route("/local/chat", local_chat, methods=["POST"])

    @application.post("/internal/web-chat")
    @application.post("/xiaozhi/ota/")
    async def pipeline_unavailable():
        return JSONResponse({"status": "NOT_READY", "runtime": "local"}, status_code=503)
