"""Structured, console-only application logging with defensive redaction."""

from __future__ import annotations

import json
import hashlib
import logging
import re
import traceback
from datetime import datetime, timezone
from typing import Any

_LOGGER_NAME = "ai_server"
_HANDLER_MARKER = "_ai_server_console_handler"
_TRANSPORT_FILTER_MARKER = "_ai_server_transport_filter"
_REDACTIONS = (
    re.compile(r"(?i)(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+"),
    re.compile(r"(?i)(\bbearer\s+)[A-Za-z0-9._~+/-]{8,}"),
    re.compile(
        r'(?i)(["\']?(?:device[_ -]?token|access[_ -]?token|refresh[_ -]?token|'
        r'api[_ -]?key|secret|password)["\']?\s*[:=]\s*["\']?)[^\s,;"\']+'
    ),
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
)
_SAFE_CONTEXT = {"connection_id", "session_ref", "device_ref", "close_code", "reason", "error_type"}
_SECRET_KEY = re.compile(
    r"(?i)^(?:authorization|device[_ -]?token|access[_ -]?token|refresh[_ -]?token|"
    r"api[_ -]?key|secret|password)$"
)


def redact_sensitive(value: Any) -> Any:
    """Redact common credential forms recursively without exposing raw payloads."""
    if isinstance(value, str):
        for pattern in _REDACTIONS:
            value = pattern.sub(r"\1[REDACTED]" if pattern.groups else "[REDACTED]", value)
        return value
    if isinstance(value, bytes):
        return "[BINARY REDACTED]"
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if _SECRET_KEY.fullmatch(str(key)) else redact_sensitive(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact_sensitive(item) for item in value]
    return value


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event = getattr(record, "event", None) or _event_from_message(record.getMessage())
        entry: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "event": event,
            "message": redact_sensitive(record.getMessage()),
        }
        for field in _SAFE_CONTEXT:
            if hasattr(record, field):
                entry[field] = redact_sensitive(getattr(record, field))
        if record.exc_info:
            frames = traceback.extract_tb(record.exc_info[2])
            stack = "".join(
                f'  File "{frame.filename}", line {frame.lineno}, in {frame.name}\n'
                for frame in frames
            )
            error_name = getattr(record.exc_info[0], "__name__", "Exception")
            entry["exception"] = redact_sensitive(f"{stack}{error_name}: [exception message redacted]")
        return json.dumps(entry, ensure_ascii=False, separators=(",", ":"))


def _event_from_message(message: str) -> str:
    known = {"AI Server startup": "app.startup", "AI Server shutdown": "app.shutdown"}
    return known.get(message, "application.event")


class _TransportLogFilter(logging.Filter):
    """Transport diagnostics below WARNING can expose headers and raw frames.

    Application events provide safe connection lifecycle logs instead. Filter
    records rather than formatting/redacting arbitrary conversation content.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno >= logging.WARNING


def configure_logging(log_level: str) -> logging.Logger:
    """Configure one idempotent console handler for the application logger."""
    for name in ("uvicorn.error", "uvicorn.asgi"):
        transport_logger = logging.getLogger(name)
        if not any(getattr(item, _TRANSPORT_FILTER_MARKER, False) for item in transport_logger.filters):
            transport_filter = _TransportLogFilter()
            setattr(transport_filter, _TRANSPORT_FILTER_MARKER, True)
            transport_logger.addFilter(transport_filter)
    logger = logging.getLogger(_LOGGER_NAME)
    level = 5 if log_level == "trace" else getattr(logging, log_level.upper())
    logger.setLevel(level)
    logger.propagate = False
    handler = next((item for item in logger.handlers if getattr(item, _HANDLER_MARKER, False)), None)
    if handler is None:
        handler = logging.StreamHandler()
        setattr(handler, _HANDLER_MARKER, True)
        logger.addHandler(handler)
    handler.setFormatter(_JsonFormatter())
    handler.setLevel(logging.NOTSET)
    return logger


def get_logger(name: str | None = None) -> logging.Logger:
    """Return the shared application logger or a child logger."""
    return logging.getLogger(_LOGGER_NAME if not name else f"{_LOGGER_NAME}.{name}")


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    message: str,
    *,
    exc_info: Any = None,
    **context: Any,
) -> None:
    """Emit an allowlisted structured event; logging failures never escape."""
    try:
        safe_context = {}
        for key, value in context.items():
            if key == "session_id":
                safe_context["session_ref"] = _reference(value)
            elif key == "device_ref":
                safe_context[key] = _reference(value)
            elif key in _SAFE_CONTEXT:
                safe_context[key] = redact_sensitive(value)
        logger.log(level, redact_sensitive(message), extra={"event": event, **safe_context}, exc_info=exc_info)
    except Exception:
        # Logging must not interfere with WebSocket/resource cleanup.
        return


def _reference(value: Any) -> str:
    """Hash opaque identifiers so accidentally supplied credentials are not logged."""
    digest = hashlib.sha256(str(value).encode("utf-8", errors="replace")).hexdigest()
    return digest[:16]
