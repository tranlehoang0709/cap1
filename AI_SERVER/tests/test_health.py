import asyncio
import logging

import httpx


def test_health_and_lifespan(monkeypatch):
    # Import after the autouse fixture isolates settings.
    from app.main import create_app
    from app.core.config import Settings

    events = []
    logger = logging.getLogger("ai_server")
    monkeypatch.setattr(logger, "log", lambda level, message: events.append((level, message)))
    async def exercise_application():
        application = create_app(Settings(_env_file=None, log_level="warning"))
        async with application.router.lifespan_context(application):
            assert events == [(logging.WARNING, "AI Server startup")]
            transport = httpx.ASGITransport(app=application)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.get("/health")
                assert response.status_code == 200
                assert response.json() == {"status": "ok", "runtime": "cloud"}
                assert response.headers["content-type"] == "application/json"

    asyncio.run(exercise_application())
    assert events == [
        (logging.WARNING, "AI Server startup"),
        (logging.WARNING, "AI Server shutdown"),
    ]
