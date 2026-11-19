"""Explicit per-device provider override for the authenticated robot gateway."""

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import PROJECT_ROOT


class GatewayRoutingSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AI_SERVER_GATEWAY_", env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore",
    )
    local_device_uids: str = ""
    local_provider_id: str | None = None
    local_model_id: str | None = None

    @field_validator("local_device_uids")
    @classmethod
    def validate_uids(cls, value: str) -> str:
        uids = [item.strip() for item in value.split(",") if item.strip()]
        if len(uids) > 16 or any(len(uid) > 128 or not uid.isascii()
                               or any(char.isspace() for char in uid) for uid in uids):
            raise ValueError("Invalid Local device UID selection")
        return ",".join(dict.fromkeys(uids))

    @model_validator(mode="after")
    def complete_target(self):
        if bool(self.local_device_uids) != bool(self.local_provider_id and self.local_model_id):
            raise ValueError("Local device selection requires provider and model IDs")
        return self

    def target_for(self, device_uid: str) -> tuple[str | None, str | None]:
        selected = set(self.local_device_uids.split(",")) if self.local_device_uids else set()
        return ((self.local_provider_id, self.local_model_id)
                if device_uid in selected else (None, None))
