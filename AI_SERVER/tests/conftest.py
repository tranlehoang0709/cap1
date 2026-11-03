"""Isolate tests from the developer's environment and .env."""

from pathlib import Path
import os

import pytest

from app.core.config import Settings, get_settings
from app.core.backend_config import BackendSettings
from app.core.robot_config import RobotSettings


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch):
    for name in list(os.environ):
        if name.upper().startswith("AI_SERVER_"):
            monkeypatch.delenv(name)
    # Unit tests opt into the offline fixture mode explicitly; production defaults integrated.
    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "development-mock")
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setitem(BackendSettings.model_config, "env_file", None)
    monkeypatch.setitem(RobotSettings.model_config, "env_file", None)
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
