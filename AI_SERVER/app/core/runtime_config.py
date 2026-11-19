"""Runtime selection is process-local; local settings never read cloud .env."""
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class RuntimeSettings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", hide_input_in_errors=True)
    runtime: Literal["cloud", "local"] = Field(default="cloud", validation_alias="AI_RUNTIME")


class LocalLLMSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LOCAL_LLM_", extra="ignore",
                                     hide_input_in_errors=True)
    base_url: str = "http://127.0.0.1:8001/v1"
    api_key: SecretStr | None = Field(default=None, repr=False)
    timeout_seconds: float = Field(default=90, gt=0, le=300, allow_inf_nan=False)
    connect_timeout_seconds: float = Field(default=5, gt=0, le=30, allow_inf_nan=False)
    max_retries: int = Field(default=1, ge=0, le=2)
    max_output_tokens: int = Field(default=256, gt=0, le=4096)
    max_output_chars: int = Field(default=8000, gt=0, le=32000)
    max_context_tokens: int = Field(default=8192, ge=512, le=131072)
    max_sessions: int = Field(default=64, gt=0, le=1000)
    max_turns: int = Field(default=20, gt=0, le=100)
    session_ttl_seconds: int = Field(default=3600, ge=60, le=86400)
    chat_token: SecretStr | None = Field(default=None, repr=False)
    system_prompt: str = "Bạn là AIVA, một trợ lý hữu ích. Luôn trả lời tự nhiên bằng tiếng Việt."

    @field_validator("base_url")
    @classmethod
    def loopback_only(cls, value: str) -> str:
        from urllib.parse import urlsplit
        parsed = urlsplit(value)
        if (parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or parsed.path.rstrip("/") != "/v1"):
            raise ValueError("Local LLM requires a loopback HTTP /v1 URL")
        return value.rstrip("/")

    @field_validator("chat_token")
    @classmethod
    def strong_chat_token(cls, value: SecretStr | None):
        if value is not None and len(value.get_secret_value()) < 43:
            raise ValueError("LOCAL_LLM_CHAT_TOKEN must contain at least 43 characters")
        return value


def require_cloud_runtime() -> None:
    if RuntimeSettings().runtime == "local":
        raise RuntimeError("Cloud providers are disabled in local runtime")
