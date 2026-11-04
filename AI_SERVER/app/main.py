from contextlib import asynccontextmanager
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.api.device_profiles import router as device_profiles_router
from app.api.health import router
from app.api.websocket import router as websocket_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging, get_logger

logger = get_logger()


def _log_lifecycle(level: int, message: str) -> None:
    try:
        logger.log(level, message)
    except Exception:
        # A broken output handler must not prevent startup or shutdown cleanup.
        return


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    configure_logging(application.state.settings.log_level)
    # Keep the two lifecycle events visible even at the chosen warning threshold.
    event_level = max(logging.INFO, logger.getEffectiveLevel())
    _log_lifecycle(event_level, "AI Server startup")
    try:
        yield
    finally:
        _log_lifecycle(event_level, "AI Server shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    application = FastAPI(title="AIVA-IoT AI Server", lifespan=lifespan)
    application.state.settings = settings if settings is not None else get_settings()
    application.include_router(router)
    application.include_router(websocket_router)
    application.include_router(device_profiles_router)
    return application


app = create_app()
