"""Offline faster-whisper settings; model artifacts stay outside the repository."""
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class LocalSTTSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LOCAL_STT_", extra="ignore",
                                     hide_input_in_errors=True, frozen=True)
    engine: Literal["faster-whisper"] = "faster-whisper"
    model: str = "Systran/faster-whisper-small"
    cache_dir: Path = Path.home() / ".cache" / "huggingface" / "hub"
    device: Literal["cuda"] = "cuda"
    compute_type: Literal["float16", "int8_float16"] = "float16"
    language: Literal["vi"] = "vi"
    beam_size: int = Field(default=5, ge=1, le=10)
    timeout_seconds: float = Field(default=30, gt=0, le=120, allow_inf_nan=False)
    max_audio_bytes: int = Field(default=5_000_000, gt=0, le=20_000_000)
    max_duration_seconds: float = Field(default=120, gt=0, le=600, allow_inf_nan=False)
    silence_rms_threshold: int = Field(default=80, ge=0, le=5000)
    vad_min_silence_ms: Literal[2000] = 2000

    @field_validator("model")
    @classmethod
    def supported_model(cls, value: str) -> str:
        if value != "Systran/faster-whisper-small":
            raise ValueError("Prompt 03 supports only the reviewed Local STT model")
        return value

    @field_validator("cache_dir")
    @classmethod
    def cache_outside_repository(cls, value: Path) -> Path:
        resolved = value.expanduser().resolve()
        project = Path(__file__).resolve().parents[2]
        if resolved == project or project in resolved.parents:
            raise ValueError("Local STT model cache must stay outside AI_SERVER")
        return resolved
