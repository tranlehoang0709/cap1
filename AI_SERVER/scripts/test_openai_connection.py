"""Make one real, bounded OpenAI Responses API request; never uses mock adapters."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import sys
from pathlib import Path
import time
from typing import Callable

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from openai import (  # noqa: E402
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
)
from pydantic import Field, SecretStr, StringConstraints  # noqa: E402
from pydantic_settings import BaseSettings, SettingsConfigDict  # noqa: E402
from typing import Annotated  # noqa: E402

from app.core.config import PROJECT_ROOT as APP_ROOT  # noqa: E402
from app.core.llm_config import LLMSettings  # noqa: E402


ModelName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128,
                                               pattern=r"^[^\s\x00-\x1f\x7f]+$")]


class OpenAIProbeSettings(BaseSettings):
    """Probe-only config. Environment overrides `.env`; secrets are hidden in repr/errors."""

    model_config = SettingsConfigDict(env_file=APP_ROOT / ".env", env_file_encoding="utf-8",
        env_prefix="", extra="ignore", hide_input_in_errors=True, env_ignore_empty=True)

    api_key: SecretStr | None = Field(default=None, validation_alias="OPENAI_API_KEY", repr=False)
    model: ModelName | None = Field(default=None, validation_alias="OPENAI_MODEL")
    timeout_seconds: float = Field(default=30, gt=0, le=120, allow_inf_nan=False,
                                   validation_alias="OPENAI_TIMEOUT_SECONDS")


class ProbeFailure(Exception):
    def __init__(self, category: str):
        self.category = category
        super().__init__(category)


@dataclass(frozen=True)
class ProbeResult:
    model: str
    request_id: str | None
    latency_ms: int
    input_tokens: int | None
    output_tokens: int | None
    response_text: str


def classify_error(error: Exception) -> str:
    """Map SDK exceptions to a safe, actionable label without exposing its body."""
    if isinstance(error, APITimeoutError):
        return "TIMEOUT"
    if isinstance(error, AuthenticationError):
        return "HTTP_401_AUTHENTICATION"
    if isinstance(error, PermissionDeniedError):
        return "HTTP_403_PERMISSION"
    if isinstance(error, NotFoundError):
        return "HTTP_404_MODEL_OR_ENDPOINT"
    if isinstance(error, RateLimitError):
        return "HTTP_429_RATE_LIMIT_OR_BILLING"
    if isinstance(error, APIConnectionError):
        return "NETWORK"
    if isinstance(error, APIStatusError):
        return f"HTTP_{error.status_code}"
    return "API_ERROR"


async def run_probe(settings: OpenAIProbeSettings, *, client_factory: Callable[..., AsyncOpenAI] = AsyncOpenAI) -> ProbeResult:
    if settings.api_key is None or not settings.api_key.get_secret_value().strip():
        raise ProbeFailure("BLOCKED_OPENAI_API_KEY_MISSING")
    if settings.model is None or not settings.model.strip():
        raise ProbeFailure("BLOCKED_OPENAI_MODEL_MISSING")

    client = client_factory(api_key=settings.api_key.get_secret_value(), timeout=settings.timeout_seconds,
                            max_retries=0)
    started = time.perf_counter()
    try:
        response = await client.responses.create(
            model=settings.model,
            input="Xin chào AIVA",
            reasoning={"effort": "none"},
            max_output_tokens=LLMSettings().max_output_tokens,
            store=False,
        )
        latency_ms = round((time.perf_counter() - started) * 1000)
        usage = response.usage
        return ProbeResult(
            model=settings.model,
            request_id=getattr(response, "_request_id", None),
            latency_ms=latency_ms,
            input_tokens=None if usage is None else usage.input_tokens,
            output_tokens=None if usage is None else usage.output_tokens,
            response_text=response.output_text,
        )
    except (APIConnectionError, APIStatusError) as error:
        raise ProbeFailure(classify_error(error)) from None
    except Exception:
        # Never print SDK exception text, which may contain request details.
        raise ProbeFailure("API_ERROR") from None
    finally:
        await client.close()


async def main() -> int:
    settings = OpenAIProbeSettings()
    try:
        result = await run_probe(settings)
    except ProbeFailure as error:
        print(error.category)
        return 2
    print("LIVE PASS")
    print(f"model: {result.model}")
    print(f"request_id: {result.request_id or 'unavailable'}")
    print(f"latency_ms: {result.latency_ms}")
    print(f"input_tokens: {result.input_tokens if result.input_tokens is not None else 'unavailable'}")
    print(f"output_tokens: {result.output_tokens if result.output_tokens is not None else 'unavailable'}")
    print(f"response: {result.response_text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
