"""Build explicit real STT adapters from environment-backed settings."""

from app.clients.gemini_stt import GeminiSTTAdapter
from app.core.stt_config import GeminiSTTSettings
from app.models.audio import AudioError, ErrorCode


def create_gemini_stt_adapter(settings: GeminiSTTSettings | None = None) -> GeminiSTTAdapter:
    settings = settings or GeminiSTTSettings()
    if settings.api_key is None or not settings.api_key.get_secret_value().strip():
        raise AudioError(ErrorCode.PROVIDER_FAILED)
    return GeminiSTTAdapter(api_key=settings.api_key.get_secret_value(), model=settings.model,
        timeout_seconds=settings.timeout_seconds, max_audio_bytes=settings.max_audio_bytes,
        max_duration_seconds=settings.max_duration_seconds)
