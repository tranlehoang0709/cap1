"""Internal Web Chat credential; never a Gemini key or a user JWT."""
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from app.core.config import PROJECT_ROOT


class LiveSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='AI_SERVER_LIVE_', env_file=PROJECT_ROOT / '.env',
                                     extra='ignore', hide_input_in_errors=True)
    web_token: SecretStr | None = Field(default=None, repr=False)
    gemini_timeout_seconds: float = Field(default=30, gt=0, le=120,
        validation_alias='GEMINI_TIMEOUT_SECONDS')
