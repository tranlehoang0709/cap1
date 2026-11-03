"""Explicit local DEVELOPMENT mode, never production auth or Cloud credentials."""

import ipaddress
from typing import Literal
from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class RobotSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_SERVER_ROBOT_", hide_input_in_errors=True)
    enabled: bool = False
    ai_mode: Literal["mock", "gemini"] = "mock"
    token: SecretStr | None = Field(default=None, repr=False)
    allowed_networks: list[str] = ["127.0.0.0/8", "::1/128"]
    energy_threshold: int | None = Field(default=None, gt=0, le=32767)
    min_silence_ms: int = Field(default=700, gt=0, le=10000)
    transcript_stability_ms: int = Field(default=300, gt=0, le=10000)
    max_turn_duration_ms: int = Field(default=15000, gt=0, le=120000)
    max_sessions: int = Field(default=2, gt=0, le=16)
    max_output_audio_bytes: int = Field(default=5_000_000, gt=0, le=5_000_000)
    max_total_audio_memory_bytes: int = Field(default=256_000_000, ge=15_000_000, le=2_000_000_000)
    deadline_seconds: float = Field(default=30, gt=1, le=120)

    @model_validator(mode="after")
    def development_only(self):
        private = [ipaddress.ip_network(n) for n in ("127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")]
        for value in self.allowed_networks:
            network = ipaddress.ip_network(value)
            if not any(network.version == n.version and network.subnet_of(n) for n in private):
                raise ValueError("Only explicit loopback/private networks allowed")
        if self.enabled and (self.token is None or len(self.token.get_secret_value()) < 32 or self.energy_threshold is None or not self.allowed_networks):
            raise ValueError("Development token, private allowlist and mock energy threshold required")
        if self.token is not None and (not self.token.get_secret_value().isascii() or any(c.isspace() for c in self.token.get_secret_value())):
            raise ValueError("ASCII token without whitespace required")
        # Conservative per-session peak: six decoded-input copies or three
        # bounded TTS WAV/PCM copies, whichever is larger. Session admission
        # then gives an explicit upper bound for aggregate audio memory.
        input_peak = self.max_turn_duration_ms * 32 * 6
        output_peak = self.max_output_audio_bytes * 3
        if max(input_peak, output_peak) * self.max_sessions > self.max_total_audio_memory_bytes:
            raise ValueError("Configured session/audio limits exceed total audio memory budget")
        return self
