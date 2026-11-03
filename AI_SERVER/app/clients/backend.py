"""Async management client; explicit credentials, bounded resources, zero retries."""

import asyncio
from dataclasses import dataclass, field
from enum import StrEnum
import ipaddress
import json
import math
from urllib.parse import urlsplit

import httpx
from pydantic import SecretStr, TypeAdapter, ValidationError

from app.models import backend as dto
from app.models.audio import AudioError, ErrorCode, positive_int
from app.services.audio_context import AudioContext


class BackendCode(StrEnum):
    TIMEOUT = "backend_timeout"
    NETWORK = "backend_network_error"
    HTTP = "backend_http_denied"
    INVALID_RESPONSE = "backend_invalid_response"
    CANCELLED = "backend_cancelled"
    CLOSED = "backend_closed"
    BINDING = "backend_identity_mismatch"
    BLOCKED = "integration_blocked"
    DUPLICATE = "duplicate_execution"
    CONFLICT = "usage_report_conflict"
    LIMIT = "backend_resource_limit"


class BackendError(Exception):
    def __init__(self, code: BackendCode, *, status: int | None = None, reason: str | None = None):
        self.code, self.status, self.reason = code, status, reason
        super().__init__(code.value)  # Never interpolate backend body or secret.


@dataclass(frozen=True)
class ServiceTokens:
    device: SecretStr = field(repr=False)
    config: SecretStr = field(repr=False)
    quota: SecretStr = field(repr=False)

    def __post_init__(self):
        for value in (self.device, self.config, self.quota):
            dto.validate_credential(value)
        if len({v.get_secret_value() for v in (self.device, self.config, self.quota)}) != 3:
            raise ValueError("Separate service credentials required")


@dataclass(frozen=True)
class ClientLimits:
    timeout_seconds: float
    max_connections: int
    max_response_bytes: int

    def __post_init__(self):
        if (type(self.timeout_seconds) not in (float, int) or not math.isfinite(self.timeout_seconds) or self.timeout_seconds <= 0
            or not positive_int(self.max_connections) or not positive_int(self.max_response_bytes)):
            raise ValueError("Explicit positive HTTP budgets required")


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


class BackendClient:
    def __init__(self, base_url: str, tokens: ServiceTokens, limits: ClientLimits, *, allow_local_http=False,
                 transport: httpx.AsyncBaseTransport | None = None):
        parts = urlsplit(base_url)
        local = parts.hostname == "localhost"
        try:
            local = local or ipaddress.ip_address(parts.hostname or "").is_loopback
        except ValueError:
            pass
        if (parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/")
            or not parts.hostname or parts.scheme not in ("https", "http")
            or (parts.scheme == "http" and not (allow_local_http is True and local))):
            raise ValueError("HTTPS Backend origin required; local HTTP requires explicit opt-in")
        self._tokens, self._limits = tokens, limits
        self._slots = asyncio.Semaphore(limits.max_connections)
        self._closed = False
        self._client = httpx.AsyncClient(base_url=base_url, trust_env=False, follow_redirects=False,
            timeout=httpx.Timeout(limits.timeout_seconds),
            limits=httpx.Limits(max_connections=limits.max_connections, max_keepalive_connections=limits.max_connections),
            transport=transport)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.aclose()

    async def aclose(self):
        self._closed = True
        await self._client.aclose()

    async def _post(self, path, request, token, result_type, context):
        if self._closed:
            raise BackendError(BackendCode.CLOSED)
        try:
            payload = request.model_dump(mode="json", exclude_none=True)
            if isinstance(request, dto.DeviceProof):
                payload["credential"] = request.credential.get_secret_value()
            async def exchange():
                async with self._slots:
                    async with self._client.stream("POST", path, json=payload,
                        headers={"Authorization": "Bearer " + token.get_secret_value(), "Accept": "application/json"}) as response:
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            if len(data) + len(chunk) > self._limits.max_response_bytes:
                                raise BackendError(BackendCode.INVALID_RESPONSE)
                            data.extend(chunk)
                        if response.status_code != 200:
                            reasons = {"SERVICE_UNAUTHORIZED", "CONTRACT_NOT_APPROVED", "DEVICE_UNAUTHORIZED",
                                "DEVICE_ACCESS_DENIED", "AUTHORIZATION_RETRY", "AUTHORIZATION_UNAVAILABLE", "INVALID_INPUT",
                                "PROVIDER_UNAVAILABLE", "MODEL_UNAVAILABLE", "PROFILE_NOT_CONFIGURED", "MODEL_REQUIRED",
                                "CREDENTIAL_REQUIRED", "CREDENTIAL_UNAVAILABLE", "SYSTEM_SCOPE_NOT_ALLOWED",
                                "HEARTBEAT_FROM_FUTURE", "MONITORING_UNAVAILABLE", "QUOTA_BLOCKED", "QUOTA_EXCEEDED",
                                "QUOTA_POLICY_MISSING", "QUOTA_SCHEMA_NOT_READY", "QUOTA_UNAVAILABLE", "REQUEST_CONTEXT_CONFLICT",
                                "TOKEN_RESERVATION_REQUIRED", "USAGE_CONTEXT_CONFLICT", "USAGE_REPORT_CONFLICT",
                                "USAGE_REPORT_TIMEOUT_NOT_CONFIGURED", "QUOTA_REQUEST_CONFLICT"}
                            reason = None
                            try:
                                body = json.loads(data.decode("utf-8"), object_pairs_hook=_object)
                                if isinstance(body, dict):
                                    candidate = body.get("reason", body.get("message"))
                                    if isinstance(candidate, str) and candidate in reasons:
                                        reason = candidate
                            except (ValueError, UnicodeError):
                                pass
                            raise BackendError(BackendCode.HTTP, status=response.status_code, reason=reason)
                        if response.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
                            raise BackendError(BackendCode.INVALID_RESPONSE)
                        decoded = json.loads(data.decode("utf-8"), object_pairs_hook=_object,
                                             parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))
                        return TypeAdapter(result_type).validate_python(decoded, strict=True)
            # Finite total timeout covers slot wait, all chunks and HTTP operations.
            async with asyncio.timeout(self._limits.timeout_seconds):
                return await context.run(exchange)
        except BackendError:
            raise
        except (TimeoutError, httpx.TimeoutException):
            raise BackendError(BackendCode.TIMEOUT) from None
        except AudioError as error:
            raise BackendError(BackendCode.CANCELLED if error.code == ErrorCode.CANCELLED else BackendCode.TIMEOUT) from None
        except httpx.RequestError:
            raise BackendError(BackendCode.NETWORK) from None
        except (ValueError, ValidationError, TypeError):
            raise BackendError(BackendCode.INVALID_RESPONSE) from None

    async def authorize(self, request: dto.DeviceProof, context: AudioContext):
        return await self._post("/internal/devices/authorize", request, self._tokens.device, dto.Authorization, context)

    async def heartbeat(self, request: dto.Heartbeat, context: AudioContext):
        return await self._post("/internal/devices/heartbeat", request, self._tokens.device, dto.HeartbeatResult, context)

    async def resolve_config(self, request: dto.ConfigRequest, context: AudioContext):
        result = await self._post("/internal/ai/resolve-config", request, self._tokens.config, dto.ResolvedConfig, context)
        if result.userId != request.userId:
            raise BackendError(BackendCode.BINDING)
        return result

    async def admit(self, request: dto.Admission, context: AudioContext):
        result = await self._post("/internal/ai/authorize-request", request, self._tokens.quota,
                                  dto.AdmissionResult | dto.AdmissionReplay, context)
        if result.requestId != request.requestId or result.providerId != request.providerId:
            raise BackendError(BackendCode.BINDING)
        return result

    async def report_usage(self, request: dto.UsageReport, context: AudioContext):
        result = await self._post("/internal/ai/usage", request, self._tokens.quota, dto.UsageResult, context)
        if result.requestId != request.requestId or result.status.lower() != request.status:
            raise BackendError(BackendCode.BINDING)
        return result
