"""Construct providers exclusively from the authenticated BE-resolved credential."""
import logging
import time
from app.clients.backend import BackendCode, BackendError
from app.clients.gemini_llm import GeminiLLMAdapter
from app.core.llm_config import LLMSettings
from app.services.audio_context import AudioContext
from app.services.backend_execution import QuotaLLMAdapter
from app.core.logging import get_logger, log_event

logger = get_logger("live_gemini")


def quota_gemini(state, session, *, input_bound_bytes, defer_turn_completion=False,
                 expected_system_prompt=None):
    config = session.config
    checks = {
        "session_valid": bool(session.valid),
        "config_present": config is not None,
        "gemini_provider": bool(config is not None and config.provider.code == "GEMINI"),
        "credential_present": bool(config is not None and config.credential is not None
                                    and config.credential.get_secret_value().strip()),
        "credential_reference": bool(config is not None and config.credentialReference is not None),
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
    adapter = GeminiLLMAdapter(api_key=config.credential.get_secret_value(),
        timeout_seconds=state.live_settings.gemini_timeout_seconds)
    wrapped = QuotaLLMAdapter(adapter, session, state.live_usage_reporter, mock_only=False,
        max_total_tokens=budget,
        execution_slots=state.live_execution_slots,
        defer_turn_completion=defer_turn_completion,
        expected_system_prompt=expected_system_prompt,
        report_context_factory=lambda: AudioContext(deadline=time.monotonic() + state.backend_settings.timeout_seconds))
    return wrapped, limits
