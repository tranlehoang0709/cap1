"""Run with: .venv/bin/python scripts/run_dev.py (from any working directory)."""

from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import uvicorn  # noqa: E402

from app.core.config import ConfigurationError, get_settings  # noqa: E402


def main() -> None:
    try:
        settings = get_settings()
    except ConfigurationError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from None
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=settings.reload,
        reload_dirs=[str(PROJECT_ROOT / "app")] if settings.reload else None,
        ws="websockets-sansio",
        ws_max_size=settings.ws_max_message_bytes,
        ws_ping_interval=None,
        ws_per_message_deflate=False,
        proxy_headers=False,
    )


if __name__ == "__main__":
    main()
