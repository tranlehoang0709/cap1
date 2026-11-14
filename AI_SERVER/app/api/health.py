from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict:
    """Liveness stays OK; local dependency readiness is reported separately."""
    runtime = request.app.state.runtime
    result = {"status": "ok", "runtime": runtime}
    if runtime == "local":
        from app.api.local_runtime import local_readiness
        result["readiness"] = await local_readiness(request.app)
    return result
