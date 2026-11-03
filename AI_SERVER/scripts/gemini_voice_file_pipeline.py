"""Real file audio -> Gemini STT -> LLMRunner -> Gemini TTS WAV.

No microphone, robot, Backend quota bypass, or mock provider is used. Multiple
--audio arguments are consecutive turns in one isolated user/session.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import os
from pathlib import Path
import sys
import time
import wave

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.clients.provider_factory import create_llm_adapter  # noqa: E402
from app.clients.stt_factory import create_gemini_stt_adapter  # noqa: E402
from app.clients.tts_factory import create_gemini_tts_adapter  # noqa: E402
from app.clients.gemini_tts import WAV_FORMAT  # noqa: E402
from app.core.backend_config import BackendSettings  # noqa: E402
from app.core.llm_config import LLMSettings  # noqa: E402
from app.core.provider_config import LLMProviderSettings  # noqa: E402
from app.core.stt_config import GeminiSTTSettings  # noqa: E402
from app.core.tts_config import GeminiTTSSettings  # noqa: E402
from app.models.audio import AudioError, AudioFrame, AudioMetadata, ErrorCode  # noqa: E402
from app.models.llm import ConversationKey, LLMError  # noqa: E402
from app.models.tts import TTSConfig  # noqa: E402
from app.services.llm import Conversation, LLMRunner  # noqa: E402
from app.services.voice_file_pipeline import VoiceFilePipeline, VoicePipelineError  # noqa: E402


class FileAudioInput:
    """One bounded WAV or Ogg Opus file exposed through AudioInput."""
    def __init__(self, path: Path, settings: GeminiSTTSettings):
        self.path = path
        self.data = path.read_bytes()
        if not self.data:
            raise AudioError(ErrorCode.EMPTY_AUDIO)
        if len(self.data) > settings.max_audio_bytes:
            raise AudioError(ErrorCode.AUDIO_TOO_LARGE)
        if path.suffix.lower() == ".ogg":
            self.metadata = AudioMetadata("ogg_opus", 24000, 1, 20)
        elif path.suffix.lower() == ".wav":
            try:
                with wave.open(io.BytesIO(self.data), "rb") as wav:
                    if (wav.getnchannels() != 1 or wav.getsampwidth() != 2
                            or wav.getcomptype() != "NONE" or wav.getframerate() not in (8000, 12000, 16000, 24000, 48000)):
                        raise ValueError
                    duration = wav.getnframes() / wav.getframerate()
                    if not 0 < duration <= settings.max_duration_seconds:
                        raise ValueError
                    self.metadata = AudioMetadata("wav", wav.getframerate(), 1, 20, "s16le")
            except Exception:
                raise AudioError(ErrorCode.INVALID_AUDIO) from None
        else:
            raise AudioError(ErrorCode.INVALID_METADATA)
        self.sent = False

    async def read(self):
        if self.sent:
            return None
        self.sent = True
        return AudioFrame(self.data)

    async def aclose(self):
        self.data = b""


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio", action="append", required=True, help="Vietnamese WAV/Ogg Opus; repeat for consecutive turns")
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--device-id", default="file-diagnostic")
    parser.add_argument("--output-dir", default=str(ROOT / "artifacts"))
    parser.add_argument("--enable", action="store_true", help="Explicitly enable standalone live requests")
    parser.add_argument("--export-audio", "--export-wav", dest="export_audio", action="store_true",
                        help="Explicitly save response WAV files")
    return parser.parse_args()


async def main(args) -> int:
    if not args.enable or os.getenv("AI_SERVER_VOICE_PIPELINE_DEMO_ENABLE", "").lower() != "true":
        print("BLOCKED: pass --enable and set AI_SERVER_VOICE_PIPELINE_DEMO_ENABLE=true")
        return 2
    try:
        if BackendSettings().mode != "development-mock":
            print("BLOCKED: standalone diagnostic requires development-mock; integrated mode remains fail-closed")
            return 2
        llm_provider = LLMProviderSettings()
        stt_settings, tts_settings = GeminiSTTSettings(), GeminiTTSSettings()
        if llm_provider.provider != "gemini":
            print("BLOCKED: AI_SERVER_LLM_PROVIDER must be gemini; no provider fallback")
            return 2
        stt = create_gemini_stt_adapter(stt_settings)
        llm, llm_model = create_llm_adapter(llm_provider)
        tts = create_gemini_tts_adapter(tts_settings)
    except Exception as error:
        print(f"BLOCKED: configuration invalid ({getattr(error, 'code', 'configuration')})")
        return 2

    key = ConversationKey(args.user_id, args.session_id, args.device_id)
    conversation = Conversation(key, max_turns=max(1, len(args.audio)), max_history_chars=20000)
    llm_settings = LLMSettings(model=llm_model)
    pipeline = VoiceFilePipeline(stt=stt, llm=llm, tts=tts, llm_runner=LLMRunner(llm_settings),
        llm_settings=llm_settings, stt_model=stt_settings.model, llm_model=llm_model,
        tts_config=TTSConfig(tts.model, tts.voice, "vi-VN", WAV_FORMAT),
        stt_timeout_seconds=stt_settings.timeout_seconds,
        llm_timeout_seconds=llm_provider.gemini_timeout_seconds,
        tts_timeout_seconds=tts_settings.timeout_seconds)

    output_dir = Path(args.output_dir).resolve()
    allowed = (ROOT / "artifacts").resolve()
    if args.export_audio and output_dir != allowed and allowed not in output_dir.parents:
        print("BLOCKED: output directory must remain inside AI_SERVER/artifacts")
        return 2
    if args.export_audio:
        output_dir.mkdir(parents=True, exist_ok=True)

    overall_ok = True
    for index, raw_path in enumerate(args.audio, 1):
        path = Path(raw_path).resolve()
        print(f"\nturn {index}: {path}")
        if not path.is_file():
            print("STT: BLOCKED (audio_file_not_found)\nLLM: NOT RUN\nTTS: NOT RUN")
            overall_ok = False
            continue
        try:
            audio = FileAudioInput(path, stt_settings)
        except AudioError as error:
            print(f"STT: FAIL ({error.code.value})\nLLM: NOT RUN\nTTS: NOT RUN")
            overall_ok = False
            continue
        started = time.perf_counter()
        try:
            result = await pipeline.process(audio, key=key, conversation=conversation,
                                            turn_id=f"file-turn-{index}")
        except VoicePipelineError as error:
            elapsed = round((time.perf_counter() - started) * 1000)
            print(f"{error.stage}: FAIL ({error.code})")
            if error.stage == "STT":
                print("LLM: NOT RUN\nTTS: NOT RUN")
            elif error.stage == "LLM":
                print("TTS: NOT RUN")
            print(f"elapsed_ms_before_failure: {elapsed}")
            overall_ok = False
            continue

        output = output_dir / f"voice_turn_{index}.wav" if args.export_audio else None
        if output is not None:
            output.write_bytes(result.audio)
        print("STT: PASS (real adapter)\nLLM: PASS (Gemini via LLMRunner)\nTTS: PASS (real adapter)")
        print(f"stt_model: {stt.model}\nstt_transcript: {result.transcript}")
        print(f"llm_model: {llm_model}\ngemini_answer: {result.answer}")
        print(f"llm_input_tokens: {result.usage.input_tokens if result.usage else 'unavailable'}")
        print(f"llm_output_tokens: {result.usage.output_tokens if result.usage else 'unavailable'}")
        print(f"tts_model: {tts.model}\ntts_voice: {tts.voice}")
        print(f"stt_latency_ms: {result.stt_ms}\nllm_latency_ms: {result.llm_ms}")
        print(f"tts_latency_ms: {result.tts_ms}\ntotal_processing_latency_ms: {result.total_ms}")
        print(f"wav_export: {output if output else 'disabled (audio stayed in RAM)'}\nwav_bytes: {len(result.audio)}")
        print(f"wav_sample_rate_hz: {result.wav_sample_rate_hz}\nwav_channels: {result.wav_channels}")
        print(f"wav_duration_seconds: {result.wav_duration_seconds:.2f}")
        print("scope: standalone; no Backend auth/quota/usage and no robot playback claim")
    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(parse_args())))
