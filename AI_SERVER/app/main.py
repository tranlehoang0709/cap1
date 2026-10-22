from contextlib import asynccontextmanager
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.api.health import router
from app.api.websocket import router as websocket_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    logger = configure_logging(application.state.settings.log_level)
    # Keep the two lifecycle events visible even at the chosen warning threshold.
    event_level = max(logging.INFO, logger.getEffectiveLevel())
    logger.log(event_level, "AI Server startup")
    try:
        yield
    finally:
        logger.log(event_level, "AI Server shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    application = FastAPI(title="AIVA-IoT AI Server", lifespan=lifespan)
    application.state.settings = settings if settings is not None else get_settings()
    application.include_router(router)
    application.include_router(websocket_router)
    return application


app = create_app()
