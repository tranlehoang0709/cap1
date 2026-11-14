"""Construct Gemini providers from the server-owned environment credential."""
import logging
import time
from app.clients.backend import BackendCode, BackendError
from app.clients.gemini_llm import GeminiLLMAdapter
from app.core.llm_config import LLMSettings
from app.services.audio_context import AudioContext
from app.services.backend_execution import QuotaLLMAdapter
from app.core.logging import get_logger, log_event
from app.core.provider_config import LLMProviderSettings

logger = get_logger("live_gemini")


def env_system_gemini_key():
    key = LLMProviderSettings().gemini_api_key
    if key is None or not key.get_secret_value().strip():
        raise BackendError(BackendCode.BLOCKED)
    return key


def quota_gemini(state, session, *, input_bound_bytes, defer_turn_completion=False,
                 expected_system_prompt=None):
    config = session.config
    env_key = None
    try:
        env_key = env_system_gemini_key()
    except BackendError:
        pass
    checks = {
        "session_valid": bool(session.valid),
        "config_present": config is not None,
        "gemini_provider": bool(config is not None and config.provider.code == "GEMINI"),
        "credential_source_env_system": bool(config is not None and config.credentialSource == "ENV_SYSTEM"),
        "env_key_present": env_key is not None,
        "credential_scope_system": bool(config is not None and config.credentialScope == "SYSTEM"),
        "system_prompt": bool(config is not None and config.profile is not None and config.profile.systemPrompt),
    }
    if not all(checks.values()):
        log_event(logger, logging.WARNING, "robot.integration_blocked",
                  "Gemini robot turn blocked by incomplete resolved configuration",
                  **checks)
        raise BackendError(BackendCode.BLOCKED)
    limits = LLMSettings(model=config.model.modelCode)
    # Reservation is a conservative bound, not an increase of generation limits.
    # Existing max_output_tokens/max_output_chars/concurrency remain unchanged.
    budget = str(input_bound_bytes + limits.max_output_tokens)
    adapter = GeminiLLMAdapter(api_key=env_key.get_secret_value(),
        timeout_seconds=state.live_settings.gemini_timeout_seconds)
    wrapped = QuotaLLMAdapter(adapter, session, state.live_usage_reporter, mock_only=False,
        max_total_tokens=budget,
        execution_slots=state.live_execution_slots,
        defer_turn_completion=defer_turn_completion,
        expected_system_prompt=expected_system_prompt, credential_source="ENV_SYSTEM",
        report_context_factory=lambda: AudioContext(deadline=time.monotonic() + state.backend_settings.timeout_seconds))
    return wrapped, limits
