"""Backend-authorized Local STT, llama.cpp LLM and Piper TTS robot pipeline."""
import time

from app.clients.local.voice import OPUS_FORMAT
from app.core.llm_config import LLMSettings
from app.models.tts import PlaybackLimits, TTSConfig
from app.services.audio_context import AudioContext
from app.services.backend_execution import QuotaLLMAdapter
from app.services.llm import LLMRunner
from app.services.opus_codec import OpusCodec
from app.services.orchestrator import AIOrchestrator, OrchestrationLimits
from app.services.robot_transport import PCM_FORMAT, RobotAudioOutput
from app.services.turn_detection import TextRules, TurnDetectionConfig


def create_local_robot(state, ws, session, session_id, version):
    config, robot = session.config, state.robot_settings
    if config is None or config.provider.code != "LOCAL":
        raise ValueError("Local provider configuration required")
    prompt = config.profile.systemPrompt or state.local_llm_settings.system_prompt
    limits = LLMSettings(_env_file=None, model=config.model.modelCode,
        max_output_tokens=state.local_llm_settings.max_output_tokens,
        max_output_chars=min(500, state.local_llm_settings.max_output_chars))
    budget = str(len(prompt.encode("utf-8")) + 32000 + limits.max_output_tokens)
    llm = QuotaLLMAdapter(state.local_llm, session, state.live_usage_reporter,
        mock_only=False, max_total_tokens=budget,
        execution_slots=state.live_execution_slots, defer_turn_completion=True,
        expected_system_prompt=prompt, credential_source="LOCAL_ENV",
        expected_provider_code="LOCAL",
        report_context_factory=lambda: AudioContext(
            deadline=time.monotonic() + state.backend_settings.timeout_seconds))
    output = RobotAudioOutput(ws, session_id, version)
    frames = (robot.max_turn_duration_ms + 59) // 60
    codec = OpusCodec(16000, 60)
    try:
        orch = AIOrchestrator(session.key, stt=state.local_stt, llm=llm,
            tts=state.local_tts, output=output, llm_runner=LLMRunner(limits),
            input_metadata=PCM_FORMAT.metadata,
            turn_config=TurnDetectionConfig(robot.min_silence_ms,
                robot.transcript_stability_ms, robot.max_turn_duration_ms),
            language_rules=TextRules((".", "?", "!"), ("...", "và", "nhưng", "ừm")),
            speech_activity=lambda _frame: True,
            tts_config=TTSConfig(state.local_tts.settings.model, "vais1000", "vi-VN", OPUS_FORMAT),
            playback_limits=PlaybackLimits(2, 4096, 1275, 8, 500, 16),
            limits=OrchestrationLimits(robot.deadline_seconds, .02, frames,
                                       frames * 1920, 16, 16000),
            system_prompt=prompt, defer_stt_until_input_complete=True)
        session.bind(orch)
        return orch, codec, llm, output
    except BaseException:
        codec.close()
        raise
