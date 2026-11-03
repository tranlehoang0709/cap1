"""Environment-backed Gemini TTS settings; secrets are excluded from repr/errors."""

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import PROJECT_ROOT


class GeminiTTSSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore", hide_input_in_errors=True)
    api_key: SecretStr | None = Field(default=None, repr=False, validation_alias="GEMINI_API_KEY")
    model: str = Field(default="gemini-3.8-flash-tts", min_length=1, max_length=128, validation_alias="GEMINI_TTS_MODEL")
    voice: str = Field(default="Kore", min_length=1, max_length=80, validation_alias="GEMINI_TTS_VOICE")
    timeout_seconds: float = Field(default=30, gt=0, le=120, allow_inf_nan=False,
                                   validation_alias="GEMINI_TTS_TIMEOUT_SECONDS")
    max_text_chars: int = Field(default=2000, gt=0, le=10000, validation_alias="GEMINI_TTS_MAX_TEXT_CHARS")
