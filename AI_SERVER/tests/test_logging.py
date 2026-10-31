import json
from io import StringIO
import logging

from app.core.logging import configure_logging, get_logger, log_event, redact_sensitive


def test_redact_sensitive_secrets_and_binary_payloads():
    value = (
        "Authorization: Bearer abc.def.secret Device-Token: dev-secret "
        "api_key=api-secret password='open-sesame' sk-12345678901234567890"
    )
    redacted = redact_sensitive(value)
    for secret in ("abc.def.secret", "dev-secret", "api-secret", "open-sesame", "12345678901234567890"):
        assert secret not in redacted
    assert redact_sensitive(b"audio bytes") == "[BINARY REDACTED]"
    assert redact_sensitive({"Authorization": "Bearer token"})["Authorization"] == "[REDACTED]"


def test_configure_logging_is_idempotent_and_json_formatted(monkeypatch):
    logger = configure_logging("info")
    configure_logging("debug")
    assert sum(bool(getattr(handler, "_ai_server_console_handler", False)) for handler in logger.handlers) == 1
    stream = StringIO()
    handler = next(handler for handler in logger.handlers if getattr(handler, "_ai_server_console_handler", False))
    monkeypatch.setattr(handler, "stream", stream)

    log_event(
        get_logger("test"), logging.WARNING, "test.auth_failed", "Authentication failed",
        connection_id="safe-ref", session_id="private-session-ref", authorization="Bearer never-log-this",
    )
    output = stream.getvalue()
    entry = json.loads(output)
    assert entry["timestamp"].endswith("+00:00")
    assert entry["level"] == "WARNING"
    assert entry["event"] == "test.auth_failed"
    assert entry["connection_id"] == "safe-ref"
    assert len(entry["session_ref"]) == 16
    assert "never-log-this" not in output
    assert "private-session-ref" not in output


def test_unexpected_exception_keeps_traceback_but_hides_exception_message(monkeypatch):
    logger = configure_logging("info")
    stream = StringIO()
    handler = next(handler for handler in logger.handlers if getattr(handler, "_ai_server_console_handler", False))
    monkeypatch.setattr(handler, "stream", stream)
    try:
        raise RuntimeError("Authorization: Bearer private-token conversation text")
    except RuntimeError:
        log_event(logger, logging.ERROR, "test.failure", "Unexpected error", exc_info=True)

    output = stream.getvalue()
    entry = json.loads(output)
    assert entry["level"] == "ERROR"
    assert "RuntimeError" in entry["exception"]
    assert "test_unexpected_exception_keeps_traceback" in entry["exception"]
    assert "private-token" not in output
    assert "conversation text" not in output


def test_logging_failure_is_swallowed(monkeypatch):
    logger = get_logger("broken")

    def fail(*args, **kwargs):
        raise RuntimeError("handler failure")

    monkeypatch.setattr(logger, "log", fail)
    log_event(logger, logging.ERROR, "test.failure", "safe event")


def test_lifecycle_formatter_names_startup_and_shutdown():
    formatter = configure_logging("warning").handlers[0].formatter
    startup = logging.LogRecord("ai_server", logging.WARNING, __file__, 1, "AI Server startup", (), None)
    shutdown = logging.LogRecord("ai_server", logging.WARNING, __file__, 1, "AI Server shutdown", (), None)
    assert json.loads(formatter.format(startup))["event"] == "app.startup"
    assert json.loads(formatter.format(shutdown))["event"] == "app.shutdown"


def test_transport_logging_keeps_warnings_and_errors_without_duplicate_filters(monkeypatch):
    configure_logging("debug")
    configure_logging("trace")
    for name in ("uvicorn.error", "uvicorn.asgi"):
        logger = logging.getLogger(name)
        filters = [item for item in logger.filters if getattr(item, "_ai_server_transport_filter", False)]
        assert len(filters) == 1
        stream = StringIO()
        handler = logging.StreamHandler(stream)
        monkeypatch.setattr(logger, "handlers", [handler])
        monkeypatch.setattr(logger, "propagate", False)
        monkeypatch.setattr(logger, "level", 5)
        for level in (5, logging.DEBUG, logging.INFO):
            logger.log(level, "private-header-or-frame")
        logger.warning("safe transport warning")
        logger.error("safe transport error")
        assert "private-header-or-frame" not in stream.getvalue()
        assert "safe transport warning" in stream.getvalue()
        assert "safe transport error" in stream.getvalue()
