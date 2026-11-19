"""Analysis budgets independent of chat, speech and Cloud generation."""
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class UnderstandingSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='LOCAL_PA_', extra='ignore')
    timeout_seconds: float = Field(default=300, gt=0, le=300)
    max_output_tokens: int = Field(default=2048, ge=256, le=4096)
