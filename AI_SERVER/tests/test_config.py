from pathlib import Path

from pydantic import ValidationError
import pytest

from app.core.config import ConfigurationError, PROJECT_ROOT, Settings, get_settings


def test_confirmed_defaults():
    settings = get_settings()
    assert (settings.host, settings.port, settings.log_level, settings.reload) == (
        "127.0.0.1", 8000, "warning", True,
    )


def test_dotenv_and_environment_precedence(dotenv_file, monkeypatch):
    settings = get_settings()
    assert (settings.host, settings.port, settings.log_level, settings.reload) == (
        "127.0.0.1", 8123, "info", False,
    )
    monkeypatch.setenv("AI_SERVER_HOST", "localhost")
    monkeypatch.setenv("AI_SERVER_PORT", "8124")
    monkeypatch.setenv("AI_SERVER_LOG_LEVEL", "warning")
    monkeypatch.setenv("AI_SERVER_RELOAD", "true")
    get_settings.cache_clear()
    overridden = get_settings()
    assert (overridden.host, overridden.port, overridden.log_level, overridden.reload) == (
        "localhost", 8124, "warning", True,
    )


def test_dotenv_path_independent_of_cwd(dotenv_file, monkeypatch, tmp_path):
    directory = tmp_path / "elsewhere"
    directory.mkdir()
    monkeypatch.chdir(directory)
    assert get_settings().port == 8123
    assert PROJECT_ROOT == Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("host", ["127.0.0.1", "0.0.0.0", "::1", "localhost", "ai-server.local"])
def test_valid_host(host):
    assert Settings(host=host).host == host


@pytest.mark.parametrize("host", ["", "http://localhost", "localhost:8000", "a b", "256.0.0.1", "-bad.local"])
def test_invalid_host(host):
    with pytest.raises(ValidationError):
        Settings(host=host)


@pytest.mark.parametrize("port", [0, 65536, -1, "abc", 1.5, True])
def test_invalid_port(port):
    with pytest.raises(ValidationError):
        Settings(port=port)


@pytest.mark.parametrize("port", [1, 65535])
def test_valid_port_boundaries(port):
    assert Settings(port=port).port == port


@pytest.mark.parametrize("field,value", [("log_level", "verbose"), ("reload", "perhaps")])
def test_invalid_other_settings(field, value):
    with pytest.raises(ValidationError):
        Settings(**{field: value})


@pytest.mark.parametrize("name", ["HOST", "PORT", "LOG_LEVEL", "RELOAD"])
def test_invalid_configuration_is_safe(name, monkeypatch):
    sensitive_value = "sensitive-test-value/do-not-display"
    monkeypatch.setenv(f"AI_SERVER_{name}", sensitive_value)
    with pytest.raises(ConfigurationError) as caught:
        get_settings()
    assert f"AI_SERVER_{name}" in str(caught.value)
    assert sensitive_value not in str(caught.value)


@pytest.mark.parametrize("reload", [True, False])
def test_entrypoint_passes_configuration_to_uvicorn(monkeypatch, reload):
    from scripts import run_dev

    monkeypatch.setenv("AI_SERVER_HOST", "localhost")
    monkeypatch.setenv("AI_SERVER_PORT", "8125")
    monkeypatch.setenv("AI_SERVER_LOG_LEVEL", "debug")
    monkeypatch.setenv("AI_SERVER_RELOAD", str(reload).lower())
    calls = []
    monkeypatch.setattr(run_dev.uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    run_dev.main()
    args, kwargs = calls[0]
    assert args == ("app.main:app",)
    assert kwargs == {
        "host": "localhost", "port": 8125, "log_level": "debug", "reload": reload,
        "reload_dirs": [str(PROJECT_ROOT / "app")] if reload else None,
        "ws": "websockets-sansio", "ws_max_size": 4096,
        "ws_ping_interval": None, "ws_per_message_deflate": False,
        "proxy_headers": False,
    }


def test_entrypoint_invalid_configuration_exits_safely(monkeypatch, capsys):
    from scripts import run_dev

    monkeypatch.setenv("AI_SERVER_PORT", "sensitive-invalid-value")
    with pytest.raises(SystemExit) as caught:
        run_dev.main()
    assert caught.value.code == 2
    output = capsys.readouterr()
    assert "AI_SERVER_PORT" in output.err
    assert "sensitive-invalid-value" not in output.err
    assert "Traceback" not in output.err


@pytest.mark.parametrize("limit", [0, -1, 4097, "abc", True])
def test_invalid_ws_limit(limit):
    with pytest.raises(ValidationError):
        Settings(ws_max_message_bytes=limit)


def test_ws_limit_environment_and_entrypoint(monkeypatch):
    from scripts import run_dev

    monkeypatch.setenv("AI_SERVER_WS_MAX_MESSAGE_BYTES", "1024")
    calls = []
    monkeypatch.setattr(run_dev.uvicorn, "run", lambda *args, **kwargs: calls.append(kwargs))
    run_dev.main()
    assert get_settings().ws_max_message_bytes == 1024
    assert calls[0]["ws_max_size"] == 1024


def test_invalid_ws_limit_safe_error(monkeypatch):
    monkeypatch.setenv("AI_SERVER_WS_MAX_MESSAGE_BYTES", "do-not-display")
    with pytest.raises(ConfigurationError) as caught:
        get_settings()
    assert "AI_SERVER_WS_MAX_MESSAGE_BYTES" in str(caught.value)
    assert "do-not-display" not in str(caught.value)
