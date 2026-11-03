"""File-based STT -> provider-neutral LLMRunner -> TTS pipeline.

This service accepts only injected adapters. It has no Google SDK dependency,
mock fallback, Backend admission bypass, or robot playback behavior.
"""

from __future__ import annotations

from dataclasses import dataclass
import io
import time
import wave

from app.core.llm_config import LLMSettings
from app.models.audio import AudioError, AudioMetadata, TranscriptionResult
from app.models.llm import ConversationKey, LLMError, LLMResult, TextChunk, Usage
from app.models.tts import PlaybackScope, TTSConfig, TTSRequest, TTSAudioChunk, TTSError, TTSErrorCode
from app.services.audio_context import AudioContext
from app.services.audio_input import BoundedAudioInput
from app.services.llm import Conversation, LLMRunner
from app.services.stt import transcribe
from app.services.turn_detection import SpeechActivity, TextRules, TranscriptEvent, TurnDetectionConfig, TurnDetector
from app.services.turn_input import HalfDuplexTurn
from app.services.voice_response_policy import voice_system_prompt


class VoicePipelineError(Exception):
    def __init__(self, stage: str, code: str):
        self.stage, self.code = stage, code
        super().__init__(f"{stage}:{code}")


@dataclass(frozen=True)
class VoiceFileTurnResult:
    transcript: str
    answer: str
    usage: Usage | None
    audio: bytes
    stt_ms: int
    llm_ms: int
    tts_ms: int
    total_ms: int
    wav_duration_seconds: float
    wav_sample_rate_hz: int
    wav_channels: int
    wav_sample_width_bytes: int


class VoiceFilePipeline:
    def __init__(self, *, stt, llm, tts, llm_runner: LLMRunner, llm_settings: LLMSettings,
                 stt_model: str, llm_model: str, tts_config: TTSConfig,
                 stt_timeout_seconds: float, llm_timeout_seconds: float, tts_timeout_seconds: float,
                 base_system_prompt: str = "Bạn là trợ lý AIVA."):
        self.stt, self.llm, self.tts, self.runner = stt, llm, tts, llm_runner
        self.llm_settings, self.stt_model, self.llm_model = llm_settings, stt_model, llm_model
        self.tts_config = tts_config
        self.stt_timeout, self.llm_timeout, self.tts_timeout = (
            stt_timeout_seconds, llm_timeout_seconds, tts_timeout_seconds)
        self.system_prompt = voice_system_prompt(base_system_prompt)

    async def process(self, audio, *, key: ConversationKey, conversation: Conversation,
                      turn_id: str) -> VoiceFileTurnResult:
        started = time.perf_counter()
        stt_context = AudioContext(deadline=time.monotonic() + self.stt_timeout)
        stt_started = time.perf_counter()
        try:
            transcript = await transcribe(self.stt, audio, stt_context)
        except AudioError as error:
            raise VoicePipelineError("STT", error.code.value) from None
        except Exception:
            raise VoicePipelineError("STT", "provider_error") from None
        stt_ms = round((time.perf_counter() - stt_started) * 1000)
        if not transcript.is_final or not transcript.text.strip():
            raise VoicePipelineError("STT", "empty_transcript")

        llm_context = AudioContext(deadline=time.monotonic() + self.llm_timeout)
        llm_audio = BoundedAudioInput(AudioMetadata("pcm", 16000, 1, 20, "s16le"),
                                      llm_context, max_frames=1, max_bytes=2)
        detector = TurnDetector(TurnDetectionConfig(700, 300, 15000),
                                TextRules((".", "?", "!"), ()), started_at_ms=0)
        turn = HalfDuplexTurn(turn_id, detector, llm_audio,
                              speech_activity=lambda _frame: True, emit=lambda _event: None)
        detector.speech(SpeechActivity(0, True))
        detector.speech(SpeechActivity(100, False))
        turn.transcription(TranscriptEvent(200, transcript))
        turn.tick(900)
        llm_started = time.perf_counter()
        answer, llm_result = "", None
        try:
            async for event in self.runner.stream(self.llm, conversation, key, turn, transcript,
                                                   self.system_prompt, llm_context):
                if isinstance(event, TextChunk):
                    answer += event.text
                elif isinstance(event, LLMResult):
                    llm_result = event
            if llm_result is None or not llm_result.complete or not answer.strip():
                raise VoicePipelineError("LLM", "incomplete_response")
        except VoicePipelineError:
            raise
        except LLMError as error:
            raise VoicePipelineError("LLM", error.code.value) from None
        except Exception:
            raise VoicePipelineError("LLM", "provider_error") from None
        finally:
            await turn.aclose()
            try:
                conversation.release(turn)
            except LLMError:
                pass
        llm_ms = round((time.perf_counter() - llm_started) * 1000)

        tts_context = AudioContext(deadline=time.monotonic() + self.tts_timeout)
        request = TTSRequest(PlaybackScope(key, turn_id, f"{turn_id}-tts"), 0, answer, self.tts_config)
        tts_started = time.perf_counter()
        audio_buffer = bytearray()
        expected_sequence = 0
        try:
            async for chunk in self.tts.synthesize(request, tts_context):
                if (not isinstance(chunk, TTSAudioChunk) or chunk.sequence != expected_sequence
                        or chunk.audio_format != self.tts_config.audio_format):
                    raise VoicePipelineError("TTS", TTSErrorCode.INVALID_AUDIO.value)
                if len(audio_buffer) + len(chunk.payload) > 5_000_000:
                    raise VoicePipelineError("TTS", TTSErrorCode.LIMIT.value)
                audio_buffer.extend(chunk.payload)
                expected_sequence += 1
        except VoicePipelineError:
            raise
        except TTSError as error:
            raise VoicePipelineError("TTS", error.code.value) from None
        except Exception:
            raise VoicePipelineError("TTS", "provider_error") from None
        finally:
            tts_context.cancel()
        audio_bytes = bytes(audio_buffer)
        audio_buffer.clear()
        wav_metadata = _inspect_wav(audio_bytes)
        tts_ms = round((time.perf_counter() - tts_started) * 1000)
        return VoiceFileTurnResult(transcript.text, answer, llm_result.usage, audio_bytes,
            stt_ms, llm_ms, tts_ms, round((time.perf_counter() - started) * 1000), *wav_metadata)


def _inspect_wav(data: bytes) -> tuple[float, int, int, int]:
    if not data:
        raise VoicePipelineError("TTS", TTSErrorCode.INVALID_AUDIO.value)
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels, rate, frames, width = wav.getnchannels(), wav.getframerate(), wav.getnframes(), wav.getsampwidth()
            pcm = wav.readframes(frames)
            if (wav.getcomptype() != "NONE" or channels != 1 or rate != 24000 or width != 2
                    or frames <= 0 or len(pcm) != frames * channels * width or not any(pcm)):
                raise ValueError
            return frames / rate, rate, channels, width
    except Exception:
        raise VoicePipelineError("TTS", TTSErrorCode.INVALID_AUDIO.value) from None
