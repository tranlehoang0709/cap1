"""Build the explicitly configured Gemini TTS adapter; no mock fallback."""

from app.clients.gemini_tts import GeminiTTSAdapter
from app.core.tts_config import GeminiTTSSettings


def create_gemini_tts_adapter(settings: GeminiTTSSettings | None = None, *, reuse_client: bool = False) -> GeminiTTSAdapter:
    settings = settings or GeminiTTSSettings()
    if settings.api_key is None or not settings.api_key.get_secret_value().strip():
        raise ValueError("Gemini TTS API key is not configured")
    return GeminiTTSAdapter(api_key=settings.api_key.get_secret_value(), model=settings.model,
        voice=settings.voice, timeout_seconds=settings.timeout_seconds, max_text_chars=settings.max_text_chars,
        reuse_client=reuse_client)
