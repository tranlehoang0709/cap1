"""Explicit integration selection. Missing Backend routes never enable mock execution."""

from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.clients.backend import BackendClient, ClientLimits, ServiceTokens
from app.core.config import PROJECT_ROOT


class BackendSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_SERVER_BACKEND_",
        env_file=PROJECT_ROOT / ".env", extra="ignore", hide_input_in_errors=True)

    # Safe by default: the mock robot pipeline requires an explicit opt-in.
    mode: Literal["development-mock", "integrated"] = "integrated"
    url: str = "https://backend.invalid"
    device_token: SecretStr | None = Field(default=None, repr=False)
    config_token: SecretStr | None = Field(default=None, repr=False)
    quota_token: SecretStr | None = Field(default=None, repr=False)
    web_chat_token: SecretStr | None = Field(default=None, repr=False)
    timeout_seconds: float = Field(default=5, gt=0, le=60, allow_inf_nan=False)
    max_connections: int = Field(default=10, ge=1, le=100)
    max_response_bytes: int = Field(default=65536, ge=1024, le=1048576)
    allow_local_http: bool = False

    @model_validator(mode="after")
    def credentials(self):
        if self.mode == "integrated":
            if any(v is None for v in (self.device_token, self.config_token, self.quota_token)):
                raise ValueError("Integrated mode requires three separate Backend service tokens")
            self.service_tokens()
        return self

    def service_tokens(self):
        return ServiceTokens(self.device_token, self.config_token, self.quota_token)

    def create_client(self, *, transport=None):
        return BackendClient(self.url, self.service_tokens(),
            ClientLimits(self.timeout_seconds, self.max_connections, self.max_response_bytes),
            allow_local_http=self.allow_local_http, transport=transport)


# Backend routes exist, but the complete production media/secret/quota pipeline
# is not currently available to this server.
INTEGRATION_BLOCKER = "cloud_media_pipeline_unavailable"
