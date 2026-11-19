"""Offline Piper Vietnamese TTS settings; model artifacts stay outside Git."""
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class LocalTTSSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LOCAL_TTS_", extra="ignore",
                                     hide_input_in_errors=True, frozen=True)
    engine: str = "piper"
    model: str = "vi_VN-vais1000-medium"
    model_path: Path = Path.home() / ".cache" / "aiva-iot" / "piper" / "vi_VN-vais1000-medium.onnx"
    config_path: Path = Path.home() / ".cache" / "aiva-iot" / "piper" / "vi_VN-vais1000-medium.onnx.json"
    source_sample_rate_hz: int = 22050
    target_sample_rate_hz: int = 16000
    frame_duration_ms: int = 60
    max_text_chars: int = Field(default=1000, gt=0, le=4000)
    max_audio_seconds: float = Field(default=120, gt=0, le=300, allow_inf_nan=False)
    timeout_seconds: float = Field(default=45, gt=0, le=180, allow_inf_nan=False)

    @field_validator("engine")
    @classmethod
    def piper_only(cls, value: str) -> str:
        if value != "piper":
            raise ValueError("Only the reviewed offline Piper engine is supported")
        return value

    @field_validator("model")
    @classmethod
    def reviewed_model(cls, value: str) -> str:
        if value != "vi_VN-vais1000-medium":
            raise ValueError("Only the reviewed Vietnamese voice is supported")
        return value

    @field_validator("model_path", "config_path")
    @classmethod
    def model_outside_repository(cls, value: Path) -> Path:
        resolved = value.expanduser().resolve()
        project = Path(__file__).resolve().parents[2]
        if resolved == project or project in resolved.parents:
            raise ValueError("Local TTS artifacts must stay outside AI_SERVER")
        return resolved

    @model_validator(mode="after")
    def fixed_audio_profile(self):
        if (self.source_sample_rate_hz != 22050 or self.target_sample_rate_hz != 16000
                or self.frame_duration_ms != 60):
            raise ValueError("Local TTS audio profile must be 22050 Hz PCM to 16000 Hz/60 ms Opus")
        return self
