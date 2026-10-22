"""Development settings; importing this module does not read configuration."""

from functools import lru_cache
from ipaddress import ip_address
from pathlib import Path
import re
from typing import Literal

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class ConfigurationError(ValueError):
    """A configuration failure safe to display without settings or input values."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AI_SERVER_",
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
        validate_default=True,
    )

    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    log_level: Literal["critical", "error", "warning", "info", "debug", "trace"] = "warning"
    reload: bool = True
    ws_max_message_bytes: int = Field(default=4096, ge=1, le=4096)

    @field_validator("host")
    @classmethod
    def validate_host(cls, value: str) -> str:
        value = value.strip()
        try:
            ip_address(value)
            return value
        except ValueError:
            pass
        # Reject malformed numeric IPv4 addresses instead of treating them as DNS.
        if re.fullmatch(r"[0-9.]+", value):
            raise ValueError("host must be a valid IP address or DNS hostname")
        hostname = value.removesuffix(".")
        labels = hostname.split(".")
        if len(hostname) > 253 or not all(
            re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
            for label in labels
        ):
            raise ValueError("host must be a valid IP address or DNS hostname")
        return value

    @field_validator("port", "ws_max_message_bytes", mode="before")
    @classmethod
    def reject_boolean_port(cls, value: object) -> object:
        if isinstance(value, bool):
            raise ValueError("value must be an integer, not a boolean")
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Read root .env once; process environment overrides its values."""
    try:
        return Settings()
    except ValidationError as error:
        hints = {
            "host": "AI_SERVER_HOST: valid IP address or DNS hostname, without URL or port",
            "port": "AI_SERVER_PORT: integer between 1 and 65535",
            "log_level": "AI_SERVER_LOG_LEVEL: critical, error, warning, info, debug or trace",
            "reload": "AI_SERVER_RELOAD: boolean such as true or false",
            "ws_max_message_bytes": "AI_SERVER_WS_MAX_MESSAGE_BYTES: integer between 1 and 4096",
        }
        fields = {item["loc"][0] for item in error.errors(include_input=False, include_context=False)}
        details = "; ".join(hints[field] for field in hints if field in fields)
        raise ConfigurationError(f"Invalid configuration. {details or 'Check supported settings.'}") from None
    except (OSError, UnicodeError):
        raise ConfigurationError("Cannot read AI_SERVER/.env; check file permissions and UTF-8 encoding.") from None
