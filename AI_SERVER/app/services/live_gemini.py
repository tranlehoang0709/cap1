"""Construct providers exclusively from the authenticated BE-resolved credential."""
import time
from app.clients.backend import BackendCode, BackendError
from app.clients.gemini_llm import GeminiLLMAdapter
from app.core.llm_config import LLMSettings
from app.services.audio_context import AudioContext
from app.services.backend_execution import QuotaLLMAdapter


def quota_gemini(state, session, *, input_bound_bytes, defer_turn_completion=False):
    config = session.config
    if (not session.valid or config is None or config.provider.code != 'GEMINI'
            or config.credential is None or not config.credential.get_secret_value().strip()
            or config.profile.systemPrompt is None):
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
        report_context_factory=lambda: AudioContext(deadline=time.monotonic() + state.backend_settings.timeout_seconds))
    return wrapped, limits
