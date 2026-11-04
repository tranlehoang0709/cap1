from fastapi import APIRouter, HTTPException, Request

from app.clients.backend import BackendClient

router = APIRouter(prefix="/backend", tags=["backend"])


@router.get("/health")
async def backend_health(request: Request) -> dict:
    settings = request.app.state.settings
    if not settings.backend_url or not settings.backend_service_token:
        raise HTTPException(status_code=503, detail="AI_SERVER_BACKEND_URL and service token are required")
    try:
        result = await BackendClient(settings.backend_url, settings.backend_service_token).health()
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail="Backend is unavailable") from exc
    return {"status": "ok", "backend": result}
