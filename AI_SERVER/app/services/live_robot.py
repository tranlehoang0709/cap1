"""RAM-only Gemini voice pipeline using the credential selected by BE."""
from app.clients.stt_factory import create_gemini_stt_adapter
from app.clients.tts_factory import create_gemini_tts_adapter
from app.clients.gemini_tts import WAV_FORMAT
from app.core.stt_config import GeminiSTTSettings
from app.core.tts_config import GeminiTTSSettings
from app.models.tts import PlaybackLimits, TTSConfig
from app.services.live_gemini import quota_gemini
from app.services.llm import LLMRunner
from app.services.opus_codec import OpusCodec
from app.services.orchestrator import AIOrchestrator, OrchestrationLimits
from app.services.robot_transport import RobotAudioOutput, GeminiOpusTTSAdapter, OPUS_FORMAT, PCM_FORMAT
from app.services.turn_detection import TurnDetectionConfig, TextRules


def create_live_robot(state, ws, session, session_id, version):
    config, settings = session.config, state.robot_settings
    # Limits match the existing robot orchestrator: 16k history chars, 16 turns,
    # and <= 15 s input by default. Reserve before accepting turn audio.
    prompt = config.profile.systemPrompt or ''
    llm, limits = quota_gemini(state, session, input_bound_bytes=len(prompt.encode()) + 4 * (16000 + 16000),
                               defer_turn_completion=True)
    secret = config.credential
    stt_settings = GeminiSTTSettings(GEMINI_API_KEY=secret)
    tts_settings = GeminiTTSSettings(GEMINI_API_KEY=secret)
    if config.profile.voiceCode:
        tts_settings = tts_settings.model_copy(update={'voice':config.profile.voiceCode})
    stt = create_gemini_stt_adapter(stt_settings)
    tts = create_gemini_tts_adapter(tts_settings)
    source = TTSConfig(tts.model, tts.voice, 'vi-VN', WAV_FORMAT)
    output = RobotAudioOutput(ws, session_id, version)
    # Robot turns use the firmware's explicit listen.start/listen.stop boundary.
    # Do not infer speech or end-of-turn from an energy threshold here.
    def explicit_turn_activity(_frame):
        return True
    frames = (settings.max_turn_duration_ms+59)//60
    codec = OpusCodec(16000, 60)
    try:
        orch = AIOrchestrator(session.key, stt=stt, llm=llm,
            tts=GeminiOpusTTSAdapter(tts, source, max_wav_bytes=settings.max_output_audio_bytes),
            output=output, llm_runner=LLMRunner(limits), input_metadata=PCM_FORMAT.metadata,
            turn_config=TurnDetectionConfig(settings.min_silence_ms, settings.transcript_stability_ms, settings.max_turn_duration_ms),
            language_rules=TextRules(('.', '?', '!'), ('...', 'và', 'nhưng', 'ừm')),
            speech_activity=explicit_turn_activity, tts_config=TTSConfig(tts.model, tts.voice, 'vi-VN', OPUS_FORMAT),
            playback_limits=PlaybackLimits(2, 4096, 1275, 8, 500, 16),
            limits=OrchestrationLimits(settings.deadline_seconds, .02, frames, frames*1920, 16, 16000),
            system_prompt=prompt, defer_stt_until_input_complete=True)
        session.bind(orch)
        return orch, codec, llm, output
    except BaseException:
        codec.close()
        raise
