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

    @field_validator("deviceId", "userId", "ownerUserId", "providerId", "modelId", "credentialId", "id", "preferredProviderId", "preferredLlmModelId",
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

class DevicePersonalMemoryRequest(DeviceProof):
    expectedOwner: str
    write: dict[str, str] | None = None


class DeviceReminderReceiptRequest(DeviceProof):
    expectedOwner: str
    reminderId: str
    deliveryId: str


class DeviceReminderReceiptResult(ContractModel):
    reminderId: str
    deliveryId: str
    status: Literal["acknowledged"]
    acknowledgedAt: str = Field(min_length=1)


class DevicePersonalMemoryResult(ContractModel):
    saved: bool
    name: str | None
    residence: str | None


class DeviceToolDelegationRequest(ContractModel):
    device_uid: str
    credential: SecretStr = Field(repr=False)
    session_id: str
    proof_nonce: str
    scope: Literal["schedule.query", "event.query", "event.check_conflict", "event.create", "event.update", "event.delete"]

    _credential = field_validator("credential")(validate_credential)


class Authorization(ContractModel):
    allowed: Literal[True]
    deviceId: str
    ownerUserId: str

class ToolDelegation(ContractModel):
    delegation_token: SecretStr = Field(repr=False)
    token_type: Literal["Bearer"]
    expires_in: int = Field(gt=0, le=300)
    scope: Literal["schedule.query", "event.query", "event.check_conflict", "event.create", "event.update", "event.delete"]
    session_id: str
    device_id: str


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
    includeCredential: bool | None = None


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
    userDisplayName: str | None = Field(default=None, min_length=1, max_length=120,
                                        pattern=r"^[^\x00-\x1f\x7f]+$")
    provider: Provider
    model: Model
    profile: Profile
    credentialScope: Literal["USER", "SYSTEM", "NONE"]
    credentialSource: Literal["ENV_SYSTEM", "BACKEND", "NONE"] = "BACKEND"
    credentialReference: CredentialReference | None
    credential: SecretStr | None = Field(default=None, repr=False, exclude=True)

    @model_validator(mode="after")
    def coherent(self):
        ref = self.credentialReference
        if self.provider.code == "LOCAL":
            if ref is not None or self.credentialScope != "NONE":
                raise ValueError("Invalid LOCAL credential context")
        elif self.provider.code == "GEMINI" and self.credentialSource == "ENV_SYSTEM":
            if self.credentialScope != "SYSTEM" or ref is not None or self.credential is not None:
                raise ValueError("Invalid ENV_SYSTEM credential context")
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
    credentialId: str | None = None
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


class TurnStart(ContractModel):
    userId: str
    deviceId: str | None = None
    channel: Literal["web", "robot"]

class TurnUserMessage(ContractModel):
    userId: str
    sessionId: str
    content: str = Field(min_length=1, max_length=16000, repr=False)

class TurnAssistantMessage(ContractModel):
    userId: str
    sessionId: str
    content: str = Field(min_length=1, max_length=500, repr=False)
    providerId: str


class TurnResult(ContractModel):
    conversationId: str
    sessionId: str

class TurnMessageSaved(ContractModel):
    conversationId: str
    sessionId: str
    saved: bool
    recorded: bool


class TurnComplete(ContractModel):
    userId: str
    sessionId: str
    requestId: RequestId
    content: str = Field(min_length=1, max_length=16000, repr=False)
    response: str = Field(min_length=1, max_length=500, repr=False)


class TurnSaved(ContractModel):
    conversationId: str
    sessionId: str
    saved: bool


class MemoryContextRequest(ContractModel):
    userId: str
    deviceId: str


class MemoryUpsertItem(ContractModel):
    key: Literal["profile.name", "profile.residence"]
    value: str = Field(min_length=1, max_length=200, repr=False)


class MemoryUpsertRequest(MemoryContextRequest):
    memories: tuple[MemoryUpsertItem, ...] = Field(min_length=1, max_length=8)


class MemoryContextItem(ContractModel):
    key: Literal["profile.name", "profile.residence"]
    value: str = Field(min_length=1, max_length=200, repr=False)
    category: Literal["personal_information"]
    updatedAt: str


class MemoryContextResult(ContractModel):
    userId: str
    items: list[MemoryContextItem]


class MemorySavedItem(ContractModel):
    key: Literal["profile.name", "profile.residence"]
    updatedAt: str


class MemoryUpsertResult(ContractModel):
    userId: str
    saved: list[MemorySavedItem]
