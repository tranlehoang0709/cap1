"""Explicit provider selection for standalone adapter diagnostics."""

from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import PROJECT_ROOT


class LLMProviderSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", env_file=PROJECT_ROOT / ".env",
                                     env_file_encoding="utf-8", extra="ignore",
                                     hide_input_in_errors=True)
    provider: Literal["gemini", "openai"] = Field(default="openai", validation_alias="AI_SERVER_LLM_PROVIDER")
    openai_api_key: SecretStr | None = Field(default=None, repr=False, validation_alias="OPENAI_API_KEY")
    openai_model: str | None = Field(default=None, validation_alias="OPENAI_MODEL")
    openai_timeout_seconds: float = Field(default=30, gt=0, le=120, validation_alias="OPENAI_TIMEOUT_SECONDS")
    gemini_api_key: SecretStr | None = Field(default=None, repr=False, validation_alias="GEMINI_API_KEY")
    gemini_model: str | None = Field(default=None, validation_alias="GEMINI_MODEL")
    gemini_timeout_seconds: float = Field(default=30, gt=0, le=120, validation_alias="GEMINI_TIMEOUT_SECONDS")
