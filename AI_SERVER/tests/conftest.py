"""Isolate tests from the developer's environment and .env."""

from pathlib import Path
import os
import sys

import pytest

from app.core.config import Settings, get_settings
from app.core.backend_config import BackendSettings
from app.core.robot_config import RobotSettings
from app.core.lan_config import LanSettings
from app.core.live_config import LiveSettings


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch):
    for name in list(os.environ):
        if name.upper().startswith("AI_SERVER_"):
            monkeypatch.delenv(name)
    # Windows codec integration tests use the wheel's native libopus DLL.
    # Discover it from the active test venv, without consulting the user .env.
    if os.name == "nt":
        pyogg = Path(sys.prefix) / "Lib" / "site-packages" / "pyogg"
        opus_dll = next((path for path in pyogg.glob("*.dll")
                         if path.name.lower() in ("opus.dll", "libopus.dll", "libopus-0.dll")), None)
        if opus_dll is not None:
            monkeypatch.setenv("AI_SERVER_OPUS_LIBRARY", str(opus_dll))
    # Unit tests opt into the offline fixture mode explicitly; production defaults integrated.
    monkeypatch.setenv("AI_SERVER_BACKEND_MODE", "development-mock")
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setitem(BackendSettings.model_config, "env_file", None)
    monkeypatch.setitem(RobotSettings.model_config, "env_file", None)
    monkeypatch.setitem(LanSettings.model_config, "env_file", None)
    monkeypatch.setitem(LiveSettings.model_config, "env_file", None)
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
