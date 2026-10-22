from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    """Process health only; no database, backend or AI dependency checks."""
    return {"status": "ok"}
