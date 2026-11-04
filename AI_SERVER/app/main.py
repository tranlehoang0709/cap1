from contextlib import asynccontextmanager
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.api.device_profiles import router as device_profiles_router
from app.api.health import router
from app.api.websocket import router as websocket_router
from app.core.config import Settings, get_settings
from app.core.robot_config import RobotSettings
from app.core.lan_config import LanSettings
from app.core.live_config import LiveSettings
from app.api.web_chat import router as web_chat_router
from app.services.backend_execution import UsageReporter
from app.api.xiaozhi_ota import router as ota_router
from app.api.lan_robot import router as lan_robot_router
from app.core.backend_config import BackendSettings
from app.api.robot_websocket import router as robot_router
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
        backend_client = getattr(application.state, "backend_client", None)
        if backend_client is not None:
            await backend_client.aclose()
        _log_lifecycle(event_level, "AI Server shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    application = FastAPI(title="AIVA-IoT AI Server", lifespan=lifespan)
    application.state.settings = settings if settings is not None else get_settings()
    application.state.robot_settings = RobotSettings()
    application.state.lan_settings = LanSettings()
    application.state.live_settings = LiveSettings()
    application.state.backend_settings = BackendSettings()
    application.state.backend_client = (
        application.state.backend_settings.create_client()
        if application.state.backend_settings.mode == "integrated" else None
    )
    # Per-user BE authorization/config/admission decide readiness at execution.
    application.state.backend_integration_blocker = None
    application.state.live_usage_reporter = UsageReporter(application.state.backend_client, max_entries=10000)
    import asyncio
    from app.core.llm_config import LLMSettings
    application.state.live_execution_slots = asyncio.Semaphore(LLMSettings().max_concurrent_requests)
    application.state.robot_slots = asyncio.Semaphore(application.state.robot_settings.max_sessions)
    from app.services.gateway_rate_limit import GatewayRateLimit
    application.state.robot_rate_limit = GatewayRateLimit()
    if application.state.robot_settings.enabled:
        from app.services.llm import LLMRunner
        from app.core.llm_config import LLMSettings
        application.state.robot_llm_runner = LLMRunner(LLMSettings())
    application.include_router(router)
    application.include_router(websocket_router)
    application.include_router(device_profiles_router)
    application.include_router(robot_router)
    application.include_router(ota_router)
    application.include_router(lan_robot_router)
    application.include_router(web_chat_router)
    return application


app = create_app()
