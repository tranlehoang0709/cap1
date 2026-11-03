"""User-approved initial LLM configuration; not wired into app startup."""

from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class LLMSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_SERVER_LLM_", extra="ignore",
                                     hide_input_in_errors=True, frozen=True)
    model: str = Field(default="gpt-6-luna", min_length=1, pattern=r"^[A-Za-z0-9._:-]+$")
    reasoning_effort: Literal["none", "low", "medium", "high", "xhigh", "max"] = "none"
    max_output_tokens: int = Field(default=256, gt=0, strict=True)
    max_output_chars: int = Field(default=500, gt=0, strict=True)
    max_concurrent_requests: int = Field(default=5, gt=0, strict=True)
    response_language: Literal["vi"] = "vi"

    @field_validator("max_output_tokens", "max_output_chars", "max_concurrent_requests", mode="before")
    @classmethod
    def numeric_environment(cls, value):
        if isinstance(value, str) and value.isascii() and value.isdecimal():
            return int(value)
        return value
