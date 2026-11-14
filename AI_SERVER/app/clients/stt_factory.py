"""Build explicit real STT adapters from environment-backed settings."""
from __future__ import annotations

from app.core.stt_config import GeminiSTTSettings
from app.models.audio import AudioError, ErrorCode


def create_gemini_stt_adapter(settings: GeminiSTTSettings | None = None) -> GeminiSTTAdapter:
    from app.core.runtime_config import require_cloud_runtime
    require_cloud_runtime()
    from app.clients.gemini_stt import GeminiSTTAdapter
    settings = settings or GeminiSTTSettings()
    if settings.api_key is None or not settings.api_key.get_secret_value().strip():
        raise AudioError(ErrorCode.PROVIDER_FAILED)
    return GeminiSTTAdapter(api_key=settings.api_key.get_secret_value(), model=settings.model,
        timeout_seconds=settings.timeout_seconds, max_audio_bytes=settings.max_audio_bytes,
        max_duration_seconds=settings.max_duration_seconds)


def create_local_stt_adapter(settings=None):
    from app.clients.local.stt import LocalSTTAdapter
    return LocalSTTAdapter(settings)
