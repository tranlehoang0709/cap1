"""Advertised address is explicit; never derive it from an HTTP Host header."""
from urllib.parse import urlsplit
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from app.core.config import PROJECT_ROOT


class LanSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_SERVER_LAN_", env_file=PROJECT_ROOT / ".env",
                                     extra="ignore", hide_input_in_errors=True)
    public_origin: str | None = None

    @field_validator("public_origin")
    @classmethod
    def origin(cls, value):
        if not value:
            return None
        p = urlsplit(value)
        if (p.scheme not in ("http", "https") or not p.hostname or p.username or p.password
                or p.query or p.fragment or p.path not in ("", "/")
                or p.hostname in ("0.0.0.0", "127.0.0.1", "localhost", "::", "::1")):
            raise ValueError("Explicit LAN HTTP(S) origin required, without credentials or path")
        _ = p.port
        return value.rstrip("/")

    def websocket_url(self):
        if not self.public_origin:
            raise ValueError("AI_SERVER_LAN_PUBLIC_ORIGIN is required")
        p = urlsplit(self.public_origin)
        if p.scheme != "https":
            raise ValueError("HTTPS LAN origin required for the secure gateway")
        return "wss://" + p.netloc + "/ws/robot"
