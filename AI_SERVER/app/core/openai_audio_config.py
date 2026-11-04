"""OpenAI voice model configuration; API keys come from OPENAI_API_KEY only."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import PROJECT_ROOT


class OpenAIAudioSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env", env_file_encoding="utf-8",
        env_ignore_empty=True, extra="ignore", hide_input_in_errors=True,
    )

    stt_model: str = Field(default="gpt-transcribe", min_length=1, max_length=128,
                           validation_alias="OPENAI_STT_MODEL")
    tts_model: str = Field(default="gpt-4o-mini-tts", min_length=1, max_length=128,
                           validation_alias="OPENAI_TTS_MODEL")
    tts_voice: str = Field(default="coral", min_length=1, max_length=64,
                           validation_alias="OPENAI_TTS_VOICE")
    timeout_seconds: float = Field(default=30, gt=0, le=120, validation_alias="OPENAI_AUDIO_TIMEOUT_SECONDS")
    max_audio_bytes: int = Field(default=5_000_000, gt=0, le=19_000_000,
                                 validation_alias="AI_SERVER_STT_MAX_AUDIO_BYTES")
    max_output_audio_bytes: int = Field(default=5_000_000, gt=0, le=5_000_000,
                                        validation_alias="AI_SERVER_ROBOT_MAX_OUTPUT_AUDIO_BYTES")
