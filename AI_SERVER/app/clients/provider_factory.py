"""Construct exactly the configured provider; never fall back on credentials/errors."""

from app.core.provider_config import LLMProviderSettings
from app.models.llm import LLMError, LLMErrorCode


def create_llm_adapter(settings: LLMProviderSettings | None = None, *, reuse_client: bool = False):
    settings = settings or LLMProviderSettings()
    if settings.provider == "gemini":
        if settings.gemini_api_key is None or not settings.gemini_api_key.get_secret_value().strip():
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        if not settings.gemini_model or not settings.gemini_model.strip():
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        from app.clients.gemini_llm import GeminiLLMAdapter
        return GeminiLLMAdapter(api_key=settings.gemini_api_key.get_secret_value(),
                                timeout_seconds=settings.gemini_timeout_seconds,
                                reuse_client=reuse_client), settings.gemini_model
    if settings.provider == "openai":
        if settings.openai_api_key is None or not settings.openai_api_key.get_secret_value().strip():
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        if not settings.openai_model or not settings.openai_model.strip():
            raise LLMError(LLMErrorCode.INVALID_INPUT)
        from app.clients.openai_llm import OpenAILLMAdapter
        return OpenAILLMAdapter(api_key=settings.openai_api_key.get_secret_value()), settings.openai_model
    raise LLMError(LLMErrorCode.INVALID_INPUT)
