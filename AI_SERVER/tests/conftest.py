"""Isolate tests from the developer's environment and .env."""

from pathlib import Path
import os

import pytest

from app.core.config import Settings, get_settings


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch):
    for name in list(os.environ):
        if name.upper().startswith("AI_SERVER_"):
            monkeypatch.delenv(name)
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def dotenv_file(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / ".env"
    path.write_text(
        "AI_SERVER_HOST=127.0.0.1\nAI_SERVER_PORT=8123\n"
        "AI_SERVER_LOG_LEVEL=info\nAI_SERVER_RELOAD=false\n",
        encoding="utf-8",
    )
    monkeypatch.setitem(Settings.model_config, "env_file", path)
    return path
