"""Bounded Gemini STT settings; audio is sent only to the explicit model."""

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import PROJECT_ROOT


class GeminiSTTSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore", hide_input_in_errors=True)

    api_key: SecretStr | None = Field(default=None, repr=False, validation_alias="GEMINI_API_KEY")
    model: str = Field(default="gemini-3.5-flash-lite", min_length=1, max_length=128,
                       validation_alias="GEMINI_STT_MODEL")
    timeout_seconds: float = Field(default=30, gt=0, le=120, allow_inf_nan=False,
                                   validation_alias="GEMINI_STT_TIMEOUT_SECONDS")
    max_audio_bytes: int = Field(default=5_000_000, gt=0, le=19_000_000, validation_alias="AI_SERVER_STT_MAX_AUDIO_BYTES")
    max_duration_seconds: float = Field(default=120, gt=0, le=600, allow_inf_nan=False,
                                        validation_alias="AI_SERVER_STT_MAX_DURATION_SECONDS")
