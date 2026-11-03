"""Make one real, bounded Gemini Developer API request; never falls back to OpenAI."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import sys
from pathlib import Path
import time
from typing import Callable

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import httpx  # noqa: E402

from app.core.gemini_config import GeminiSettings  # noqa: E402
from app.core.llm_config import LLMSettings  # noqa: E402


class ProbeFailure(Exception):
    def __init__(self, status: str, *, model: str | None = None, latency_ms: int | None = None):
        self.status = status
        self.model = model
        self.latency_ms = latency_ms
        super().__init__(status)


@dataclass(frozen=True)
class GeminiProbeResult:
    model: str
    latency_ms: int
    response_text: str
    input_tokens: int | None
    output_tokens: int | None
    total_tokens: int | None


def classify_error(error: Exception) -> str:
    if isinstance(error, (TimeoutError, asyncio.TimeoutError, httpx.TimeoutException)):
        return "FAIL_TIMEOUT"
    if isinstance(error, (httpx.NetworkError, httpx.RequestError, OSError)):
        return "FAIL_NETWORK"
    code = getattr(error, "code", None)
    name = str(code).upper()
    labels = {
        "UNAUTHENTICATED": "401",
        "PERMISSION_DENIED": "403",
        "NOT_FOUND": "404",
        "RESOURCE_EXHAUSTED": "429",
    }
    name = labels.get(name, name)
    if name == "401":
        return "FAIL_HTTP_401_AUTHENTICATION"
    if name == "403":
        return "FAIL_HTTP_403_PERMISSION"
    if name == "404":
        return "FAIL_HTTP_404_MODEL_OR_ENDPOINT"
    if name == "429":
        return "FAIL_HTTP_429_RATE_OR_QUOTA"
    if name.isdecimal() and int(name) >= 500:
        return f"FAIL_HTTP_{name}"
    if name.isdecimal():
        return f"FAIL_HTTP_{name}"
    return "FAIL_API_ERROR"


async def run_probe(settings: GeminiSettings, *, client_factory: Callable[..., object] | None = None) -> GeminiProbeResult:
    if settings.api_key is None or not settings.api_key.get_secret_value().strip():
        raise ProbeFailure("BLOCKED_GEMINI_API_KEY_MISSING", model=settings.model)
    if settings.model is None or not settings.model.strip():
        raise ProbeFailure("BLOCKED_GEMINI_MODEL_MISSING")

    if client_factory is None:
        try:
            from google import genai
            from google.genai import types
        except ImportError:
            raise ProbeFailure("BLOCKED_GOOGLE_GENAI_NOT_INSTALLED", model=settings.model) from None
        client_factory = lambda **kwargs: genai.Client(**kwargs)
        http_options_factory = types.HttpOptions
        retry_options_factory = types.HttpRetryOptions
    else:
        # Injected only by unit tests; live execution always constructs the official client above.
        http_options_factory = lambda **kwargs: kwargs
        retry_options_factory = lambda **kwargs: kwargs

    try:
        client = client_factory(
            api_key=settings.api_key.get_secret_value(),
            http_options=http_options_factory(
                timeout=round(settings.timeout_seconds * 1000),
                retry_options=retry_options_factory(attempts=1),
            ),
        )
    except Exception:
        raise ProbeFailure("FAIL_CLIENT_CONFIGURATION", model=settings.model) from None
    started = time.perf_counter()
    try:
        async with asyncio.timeout(settings.timeout_seconds):
            response = await client.aio.models.generate_content(
                model=settings.model,
                contents="Xin chào AIVA",
                config={"max_output_tokens": LLMSettings().max_output_tokens, "candidate_count": 1,
                       "automatic_function_calling": {"disable": True}},
            )
        latency_ms = round((time.perf_counter() - started) * 1000)
        text = response.text
        if not isinstance(text, str) or not text.strip():
            raise ProbeFailure("FAIL_EMPTY_RESPONSE")
        metadata = getattr(response, "usage_metadata", None)
        input_tokens = None if metadata is None else getattr(metadata, "prompt_token_count", None)
        output_tokens = None if metadata is None else getattr(metadata, "candidates_token_count", None)
        total_tokens = None if metadata is None else getattr(metadata, "total_token_count", None)
        return GeminiProbeResult(settings.model, latency_ms, text, input_tokens, output_tokens, total_tokens)
    except ProbeFailure as error:
        error.model = settings.model
        error.latency_ms = round((time.perf_counter() - started) * 1000)
        raise
    except Exception as error:
        raise ProbeFailure(classify_error(error), model=settings.model,
                           latency_ms=round((time.perf_counter() - started) * 1000)) from None
    finally:
        try:
            async_client = getattr(client, "aio", None)
            close_async = getattr(async_client, "aclose", None)
            if close_async is not None:
                await close_async()
            close_sync = getattr(client, "close", None)
            if close_sync is not None:
                close_sync()
        except Exception:
            # Do not leak SDK errors or request details in terminal output.
            pass


async def main() -> int:
    settings = GeminiSettings()
    try:
        result = await run_probe(settings)
    except ProbeFailure as error:
        status = "BLOCKED" if error.status.startswith("BLOCKED_") else "FAIL"
        print(f"{status}: {error.status}")
        print(f"model: {error.model or 'unavailable'}")
        print(f"latency_ms: {error.latency_ms if error.latency_ms is not None else 'unavailable'}")
        print("input_tokens: unavailable")
        print("output_tokens: unavailable")
        print("total_tokens: unavailable")
        print("response: unavailable")
        return 2 if status == "BLOCKED" else 1
    print("PASS: LIVE GEMINI RESPONSE")
    print(f"model: {result.model}")
    print(f"latency_ms: {result.latency_ms}")
    print(f"input_tokens: {result.input_tokens if result.input_tokens is not None else 'unavailable'}")
    print(f"output_tokens: {result.output_tokens if result.output_tokens is not None else 'unavailable'}")
    print(f"total_tokens: {result.total_tokens if result.total_tokens is not None else 'unavailable'}")
    print(f"response: {result.response_text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
