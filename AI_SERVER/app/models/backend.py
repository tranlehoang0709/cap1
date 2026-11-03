"""Strict contract subset derived from Backend controllers/DTOs/services, not draft routes."""

from datetime import datetime
import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints, field_validator, model_validator

MAX_ID = 9223372036854775807


def bigint(value: str, *, positive=False):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,18}" if positive else r"0|[1-9][0-9]{0,18}", value) or int(value) > MAX_ID:
        raise ValueError("Canonical BIGINT string required")
    return value


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, hide_input_in_errors=True)

    @model_validator(mode="before")
    @classmethod
    def literal_booleans(cls, value):
        if isinstance(value, dict):
            for key in ("allowed", "accepted", "replayed", "executionAllowed", "recorded", "budgetExceeded"):
                if key in value and type(value[key]) is not bool:
                    raise ValueError("Boolean required")
        return value

    @field_validator("deviceId", "userId", "ownerUserId", "providerId", "modelId", "id", "preferredProviderId", "preferredLlmModelId",
                     "sessionId", "conversationId", check_fields=False)
    @classmethod
    def ids(cls, value):
        return None if value is None else bigint(value, positive=True)


def validate_credential(value):
    secret = value.get_secret_value()
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", secret):
        raise ValueError("Provisioned base64url credential required")
    return value


def utc_time(value: str, whole=False):
    pattern = r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.000)?Z" if whole else r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z"
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError("UTC ISO timestamp required")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.second > 59:
        raise ValueError("Invalid timestamp")
    return value


class DeviceProof(ContractModel):
    deviceUid: str
    credential: SecretStr = Field(repr=False)

    @field_validator("deviceUid")
    @classmethod
    def uid(cls, value):
        if not value or len(value) > 128 or re.search(r"[\s\x00-\x1f\x7f]", value):
            raise ValueError("Invalid device UID")
        return value

    _credential = field_validator("credential")(validate_credential)


class Authorization(ContractModel):
    allowed: Literal[True]
    deviceId: str
    ownerUserId: str


class TelemetryPayload(ContractModel):
    uptimeSeconds: int | None = Field(default=None, ge=0, le=9007199254740991)
    firmwareVersion: str | None = Field(default=None, min_length=1, max_length=100, pattern=r"^[^\x00-\x1f\x7f]+$")


class Telemetry(ContractModel):
    wifiRssi: int | None = Field(default=None, ge=-127, le=0)
    freeHeapBytes: str | int | None = None
    batteryPercent: int | None = Field(default=None, ge=0, le=100)
    payload: TelemetryPayload | None = None

    @field_validator("freeHeapBytes")
    @classmethod
    def heap(cls, value):
        if value is None:
            return value
        if type(value) is int and not 0 <= value <= 9007199254740991:
            raise ValueError("Unsafe integer heap value")
        return bigint(str(value))


class Heartbeat(DeviceProof):
    observedAt: str
    telemetry: Telemetry | None = None

    @field_validator("observedAt")
    @classmethod
    def observed(cls, value):
        return utc_time(value, True)


class HeartbeatResult(ContractModel):
    accepted: bool
    deviceId: str
    lastSeenAt: str | None
    reason: Literal["STALE_OR_DUPLICATE"] | None = None

    @model_validator(mode="after")
    def consistency(self):
        if self.lastSeenAt is not None:
            utc_time(self.lastSeenAt, True)
        if self.accepted and (self.reason is not None or self.lastSeenAt is None):
            raise ValueError("Invalid accepted heartbeat")
        if not self.accepted and self.reason != "STALE_OR_DUPLICATE":
            raise ValueError("Invalid ignored heartbeat")
        return self


class ConfigRequest(ContractModel):
    userId: str
    deviceId: str | None = None
    providerId: str | None = None
    modelId: str | None = None
    includeCredential: bool = False


class Provider(ContractModel):
    id: str
    code: Literal["OPENAI", "GEMINI", "LOCAL"]
    name: str


class Model(ContractModel):
    id: str
    modelCode: str = Field(min_length=1)
    capability: Literal["llm"]


class Profile(ContractModel):
    assistantName: str | None
    systemPrompt: str | None = Field(repr=False)
    preferredProviderId: str | None
    preferredLlmModelId: str | None
    languageCode: str | None
    voiceCode: str | None


class CredentialReference(ContractModel):
    id: str
    providerId: str


class ResolvedConfig(ContractModel):
    userId: str
    provider: Provider
    model: Model
    profile: Profile
    credentialScope: Literal["USER", "SYSTEM", "NONE"]
    credentialReference: CredentialReference | None
    credential: SecretStr | None = Field(default=None, repr=False)

    @model_validator(mode="after")
    def coherent(self):
        ref = self.credentialReference
        if self.provider.code == "LOCAL":
            if ref is not None or self.credentialScope != "NONE":
                raise ValueError("Invalid LOCAL credential context")
        elif ref is None or ref.providerId != self.provider.id or self.credentialScope == "NONE":
            raise ValueError("Invalid Cloud credential reference")
        return self


RequestId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{16,128}$")]


class Admission(ContractModel):
    requestId: RequestId
    userId: str
    providerId: str
    modelId: str
    deviceId: str | None = None
    sessionId: str | None = None
    conversationId: str | None = None
    maxTotalTokens: str | None = None

    @field_validator("maxTotalTokens")
    @classmethod
    def budget(cls, value):
        return None if value is None else bigint(value)


class Remaining(ContractModel):
    requestsPerMinute: str | None
    requestsPerDay: str | None
    tokensPerMonth: str | None

    @field_validator("*")
    @classmethod
    def remaining(cls, value):
        return None if value is None else bigint(value)


class AdmissionResult(ContractModel):
    allowed: Literal[True]
    requestId: RequestId
    providerId: str
    mode: Literal["LIMITED", "UNLIMITED"]
    remainingQuota: Remaining
    reservedTokens: str | None
    reportDueAt: str
    replayed: Literal[False]
    executionAllowed: Literal[True]

    _reserved = field_validator("reservedTokens")(lambda v: None if v is None else bigint(v))
    _date = field_validator("reportDueAt")(lambda v: utc_time(v))


class AdmissionReplay(ContractModel):
    allowed: Literal[False]
    requestId: RequestId
    providerId: str
    replayed: Literal[True]
    executionAllowed: Literal[False]
    state: Literal["ADMITTED", "REPORT_MISSING", "SUCCESS", "FAILED", "CANCELLED"]
    reason: Literal["REQUEST_FINALIZED", "USAGE_REPORT_MISSING", "REQUEST_ALREADY_ADMITTED"]


class UsageReport(ContractModel):
    requestId: RequestId
    providerId: str
    status: Literal["success", "failed", "cancelled"]
    inputTokens: int = Field(ge=0, le=2147483647)
    outputTokens: int = Field(ge=0, le=2147483647)
    durationMs: int = Field(ge=0, le=2147483647)


class UsageResult(ContractModel):
    requestId: RequestId
    status: Literal["SUCCESS", "FAILED", "CANCELLED"]
    recorded: Literal[True]
    replayed: bool
    budgetExceeded: bool
