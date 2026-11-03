"""Gemini Developer API config; secrets are loaded but never represented."""

from typing import Annotated

from pydantic import Field, SecretStr, StringConstraints
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import PROJECT_ROOT


GeminiModel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128,
                                                pattern=r"^[^\s\x00-\x1f\x7f]+$")]


class GeminiSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="",
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
        hide_input_in_errors=True,
    )

    api_key: SecretStr | None = Field(default=None, validation_alias="GEMINI_API_KEY", repr=False)
    model: GeminiModel | None = Field(default=None, validation_alias="GEMINI_MODEL")
    timeout_seconds: float = Field(default=30, gt=0, le=120, allow_inf_nan=False,
                                   validation_alias="GEMINI_TIMEOUT_SECONDS")
