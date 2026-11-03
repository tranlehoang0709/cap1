"""Interactive keyboard text -> Gemini LLMRunner -> Gemini TTS WAV diagnostic.

This standalone live diagnostic is development-only. It never calls Google SDKs
directly and does not provide Backend authorization, quota, or usage reporting.
"""

from __future__ import annotations

import argparse
import asyncio
import ctypes
from contextlib import aclosing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import os
import io
from pathlib import Path
import sys
import threading
import time
import wave
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.clients.provider_factory import create_llm_adapter  # noqa: E402
from app.clients.tts_factory import create_gemini_tts_adapter  # noqa: E402
from app.clients.gemini_tts import PCM_FORMAT, WAV_FORMAT  # noqa: E402
from app.core.backend_config import BackendSettings  # noqa: E402
from app.core.llm_config import LLMSettings  # noqa: E402
from app.core.provider_config import LLMProviderSettings  # noqa: E402
from app.core.tts_config import GeminiTTSSettings  # noqa: E402
from app.models.audio import AudioMetadata, TranscriptionResult  # noqa: E402
from app.models.llm import ConversationKey, LLMError, LLMResult, ProviderDelta, TextChunk  # noqa: E402
from app.models.tts import PlaybackScope, TTSConfig, TTSRequest, TTSAudioChunk, TTSError  # noqa: E402
from app.services.audio_context import AudioContext  # noqa: E402
from app.services.audio_input import BoundedAudioInput  # noqa: E402
from app.services.llm import Conversation, LLMRunner  # noqa: E402
from app.services.turn_detection import TextRules, TurnDetectionConfig, TurnDetector  # noqa: E402
from app.services.turn_input import HalfDuplexTurn  # noqa: E402
from app.services.voice_file_pipeline import VoicePipelineError, _inspect_wav  # noqa: E402
from app.services.voice_response_policy import voice_system_prompt  # noqa: E402


def current_time_instruction(now: datetime | None = None) -> str:
    """Return a fresh, explicitly zoned clock context for this individual turn."""
    try:
        zone = ZoneInfo("Asia/Ho_Chi_Minh")
    except ZoneInfoNotFoundError:
        # Windows installations may omit the IANA timezone database. Vietnam
        # currently uses UTC+07:00 year-round; this fallback carries the zone label.
        zone = timezone(timedelta(hours=7), "Asia/Ho_Chi_Minh")
    local_now = now.astimezone(zone) if now else datetime.now(zone)
    return f"Thời gian hiện tại tại Việt Nam (Asia/Ho_Chi_Minh): {local_now.isoformat(timespec='seconds')}."


def should_exit(value: str) -> bool:
    return value.strip().casefold() == "exit"


def _tts_diagnostic(origin: float, event: str, segment: int, **fields) -> None:
    if os.getenv("AI_SERVER_TTS_DIAGNOSTICS", "").lower() != "true":
        return
    details = " ".join(f"{name}={value}" for name, value in fields.items())
    print(f"TTS_DIAG event={event} segment={segment} elapsed_ms={round((time.perf_counter()-origin)*1000)} {details}".rstrip(), flush=True)


def new_session(*, user_id: str = "interactive-user", device_id: str = "keyboard"):
    key = ConversationKey(user_id, uuid4().hex, device_id)
    return key, Conversation(key, max_turns=16, max_history_chars=8000)


@dataclass(frozen=True)
class TurnResult:
    question: str
    answer: str
    usage: object
    llm_model: str
    tts_model: str
    tts_voice: str
    llm_ms: int
    tts_ms: int
    total_ms: int
    llm_ttft_ms: int
    first_sentence_ms: int
    tts_first_audio_ms: int
    time_to_first_audio_ms: int
    wav_path: Path | None
    audio: bytes
    wav_duration_seconds: float
    wav_sample_rate_hz: int
    playback_started: bool = False
    playback_submit_ms: int | None = None


async def process_question(question: str, *, llm, tts, runner: LLMRunner,
                           conversation: Conversation, key: ConversationKey,
                           llm_model: str, tts_settings: GeminiTTSSettings,
                           llm_timeout_seconds: float, output_dir: Path,
                           turn_id: str | None = None, export_wav: bool = False,
                           audio_sink=None) -> TurnResult:
    question = question.strip()
    if not question:
        raise ValueError("empty_question")
    if key != conversation.key:
        raise ValueError("session_mismatch")
    started = time.perf_counter()
    turn_id = turn_id or uuid4().hex
    llm_context = AudioContext(deadline=time.monotonic() + llm_timeout_seconds)
    bounded = BoundedAudioInput(AudioMetadata("pcm", 16000, 1, 20, "s16le"),
                                llm_context, max_frames=1, max_bytes=2)
    detector = TurnDetector(TurnDetectionConfig(700, 300, 15000), TextRules((".", "?", "!"), ()),
                            started_at_ms=0)
    turn = HalfDuplexTurn(turn_id, detector, bounded, speech_activity=lambda _frame: True,
                          emit=lambda _event: None)
    if not turn.end_input(0):
        raise RuntimeError("turn_boundary_failed")
    transcript = TranscriptionResult(question, True, "vi")
    system_prompt = voice_system_prompt("Bạn là trợ lý AIVA.") + "\n\n" + current_time_instruction()
    llm_started = time.perf_counter()
    timings: dict[str, float] = {}

    class MeasuredLLM:
        async def stream(self, request, context):
            async for provider_event in llm.stream(request, context):
                if isinstance(provider_event, ProviderDelta) and provider_event.text and "llm_ttft" not in timings:
                    timings["llm_ttft"] = time.perf_counter()
                yield provider_event

    answer_parts: list[str] = []
    llm_result: LLMResult | None = None
    tts_tasks: list[asyncio.Task] = []
    segment_audio: dict[int, bytearray] = {}
    segment_started: dict[int, float] = {}
    segment_queued: dict[int, float] = {}
    segment_deadlines: dict[int, float] = {}
    segment_finished: list[float] = []
    audio_total = [0]
    tts_slot = asyncio.Semaphore(1)

    async def synthesize_segment(event: TextChunk):
        # Keep one Interactions stream per adapter client at a time. The LLM
        # continues independently, so this only serializes TTS sentences.
        async with tts_slot:
            queued_at = segment_queued[event.index]
            _tts_diagnostic(started, "segment_dequeued", event.index,
                            queue_wait_ms=round((time.perf_counter() - queued_at) * 1000))
            await synthesize_segment_inner(event)

    async def synthesize_segment_inner(event: TextChunk):
        segment_index = event.index
        segment_started[segment_index] = time.perf_counter()
        tts_context = AudioContext(deadline=time.monotonic() + tts_settings.timeout_seconds)
        segment_deadlines[segment_index] = tts_context.deadline
        _tts_diagnostic(started, "deadline_set", segment_index,
                        timeout_ms=round(tts_settings.timeout_seconds * 1000),
                        remaining_ms=round((tts_context.deadline - time.monotonic()) * 1000))
        request = TTSRequest(PlaybackScope(key, turn_id, f"{turn_id}-tts-{segment_index}"),
                             segment_index, event.text.strip(),
                             TTSConfig(tts_settings.model, tts_settings.voice, "vi-VN", WAV_FORMAT))
        _tts_diagnostic(started, "tts_segment_validated", segment_index,
                        text_chars=len(request.text), nonempty=bool(request.text),
                        under_limit=len(request.text) <= tts_settings.max_text_chars)
        buffer = bytearray()
        seq = 0
        cleanup_reason = "complete"
        diagnostic_hook = getattr(tts, "_diagnostic_hook", None)
        if os.getenv("AI_SERVER_TTS_DIAGNOSTICS", "").lower() == "true" and hasattr(tts, "_diagnostic_hook"):
            tts._diagnostic_hook = lambda name, _request: _tts_diagnostic(started, name, segment_index)
        try:
            streaming = getattr(tts, "stream_pcm", None)
            if streaming is not None:
                _tts_diagnostic(started, "adapter_stream_enter", segment_index)
                async with aclosing(streaming(request, tts_context)) as chunks:
                    async for chunk in chunks:
                        if not isinstance(chunk, TTSAudioChunk) or chunk.sequence != seq or chunk.audio_format != PCM_FORMAT:
                            raise VoicePipelineError("TTS", "invalid_audio")
                        if audio_total[0] + len(chunk.payload) > 5_000_000:
                            raise VoicePipelineError("TTS", "audio_limit")
                        audio_total[0] += len(chunk.payload)
                        buffer.extend(chunk.payload)
                        seq += 1
                        if seq == 1:
                            _tts_diagnostic(started, "first_pcm_received", segment_index,
                                            since_request_ms=round((time.perf_counter() - segment_started[segment_index]) * 1000),
                                            chunk_bytes=len(chunk.payload))
                        if "first_audio" not in timings:
                            timings["first_audio"] = time.perf_counter()
                        if audio_sink is not None:
                            await asyncio.to_thread(audio_sink.write_segment, segment_index, chunk.payload)
            else:
                # Compatibility for existing real unary TTS adapters and test fixtures.
                async with aclosing(tts.synthesize(request, tts_context)) as chunks:
                    async for chunk in chunks:
                        if not isinstance(chunk, TTSAudioChunk) or chunk.sequence != seq or chunk.audio_format != WAV_FORMAT:
                            raise VoicePipelineError("TTS", "invalid_audio")
                        if audio_total[0] + len(chunk.payload) > 5_000_000:
                            raise VoicePipelineError("TTS", "audio_limit")
                        audio_total[0] += len(chunk.payload)
                        buffer.extend(chunk.payload)
                        seq += 1
                if buffer:
                    with wave.open(io.BytesIO(buffer), "rb") as source:
                        if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != 24000:
                            raise VoicePipelineError("TTS", "invalid_audio")
                        pcm = source.readframes(source.getnframes())
                    buffer.clear()
                    buffer.extend(pcm)
                    timings.setdefault("first_audio", time.perf_counter())
                    if audio_sink is not None:
                        await asyncio.to_thread(audio_sink.write_segment, segment_index, pcm)
            if not buffer or not any(buffer):
                raise VoicePipelineError("TTS", "invalid_audio")
            segment_audio[segment_index] = buffer
            segment_finished.append(time.perf_counter())
            if audio_sink is not None:
                await asyncio.to_thread(audio_sink.finish_segment, segment_index)
        except asyncio.CancelledError:
            cleanup_reason = "task_cancelled"
            raise
        except VoicePipelineError:
            cleanup_reason = "invalid_audio_or_limit"
            raise
        except TTSError as error:
            cleanup_reason = error.code.value
            _tts_diagnostic(started, "tts_error", segment_index, error=error.code.value,
                            since_segment_start_ms=round((time.perf_counter() - segment_started[segment_index]) * 1000),
                            deadline_expired=time.monotonic() >= segment_deadlines[segment_index])
            raise VoicePipelineError("TTS", f"{error.code.value}:segment_{segment_index}") from None
        finally:
            if os.getenv("AI_SERVER_TTS_DIAGNOSTICS", "").lower() == "true" and hasattr(tts, "_diagnostic_hook"):
                tts._diagnostic_hook = diagnostic_hook
            tts_context.cancel()
            _tts_diagnostic(started, "segment_context_cleanup", segment_index,
                            reason=cleanup_reason, context_cancel_requested=True)
            if segment_index not in segment_audio:
                buffer.clear()
                if audio_sink is not None:
                    audio_sink.abort()

    try:
        async with aclosing(runner.stream(MeasuredLLM(), conversation, key, turn, transcript,
                                           system_prompt, llm_context)) as events:
            async for event in events:
                if isinstance(event, TextChunk):
                    answer_parts.append(event.text)
                    if event.tts_safe:
                        if len(tts_tasks) >= 16:
                            raise VoicePipelineError("TTS", "segment_limit")
                        timings.setdefault("first_sentence", time.perf_counter())
                        segment_queued[event.index] = time.perf_counter()
                        _tts_diagnostic(started, "segment_created", event.index,
                                        text_chars=len(event.text.strip()), nonempty=bool(event.text.strip()),
                                        safe=event.tts_safe)
                        _tts_diagnostic(started, "segment_queued", event.index)
                        tts_tasks.append(asyncio.create_task(synthesize_segment(event)))
                elif isinstance(event, LLMResult):
                    llm_result = event
                    timings["llm_done"] = time.perf_counter()
                    active_tts = sum(not task.done() for task in tts_tasks)
                    _tts_diagnostic(started, "llm_stream_completed", -1,
                                    active_tts_segments=active_tts,
                                    llm_elapsed_ms=round((timings["llm_done"] - llm_started) * 1000))
        if tts_tasks:
            await asyncio.gather(*tts_tasks)
        timings["tts_done"] = time.perf_counter()
        answer = "".join(answer_parts).strip()
        if llm_result is None or not llm_result.complete or not answer:
            raise VoicePipelineError("LLM", "incomplete_response")
        if llm_result.usage is None:
            raise VoicePipelineError("LLM", "usage_unavailable")
    except VoicePipelineError:
        if audio_sink is not None:
            audio_sink.abort()
        for task in tts_tasks:
            if not task.done():
                _tts_diagnostic(started, "task_cancel_requested", -1)
                task.cancel()
        if tts_tasks:
            await asyncio.gather(*tts_tasks, return_exceptions=True)
        raise
    except TTSError as error:
        if audio_sink is not None:
            audio_sink.abort()
        for task in tts_tasks:
            if not task.done():
                task.cancel()
        if tts_tasks:
            await asyncio.gather(*tts_tasks, return_exceptions=True)
        raise VoicePipelineError("TTS", error.code.value) from None
    except LLMError as error:
        if audio_sink is not None:
            audio_sink.abort()
        for task in tts_tasks:
            if not task.done():
                task.cancel()
        if tts_tasks:
            await asyncio.gather(*tts_tasks, return_exceptions=True)
        raise VoicePipelineError("LLM", error.code.value) from None
    except Exception:
        if audio_sink is not None:
            audio_sink.abort()
        for task in tts_tasks:
            if not task.done():
                task.cancel()
        if tts_tasks:
            await asyncio.gather(*tts_tasks, return_exceptions=True)
        stage = "TTS" if llm_result is not None and tts_tasks else "LLM"
        raise VoicePipelineError(stage, "provider_error") from None
    finally:
        await turn.aclose()
        try:
            conversation.release(turn)
        except LLMError:
            # No claim occurred (for example, invalid context); nothing to release.
            pass
        if audio_sink is not None:
            await asyncio.to_thread(audio_sink.finish)
    if not tts_tasks:
        raise VoicePipelineError("TTS", "no_complete_sentence")
    pcm_buffer = bytearray()
    for index in sorted(segment_audio):
        pcm_buffer.extend(segment_audio[index])
        segment_audio[index].clear()
    wav_sink = io.BytesIO()
    with wave.open(wav_sink, "wb") as output:
        output.setnchannels(1); output.setsampwidth(2); output.setframerate(24000)
        output.writeframes(pcm_buffer)
    pcm_buffer.clear()
    audio = wav_sink.getvalue()
    wav_sink.close()
    duration, rate, channels, width = _inspect_wav(audio)
    if channels != 1 or width != 2 or rate != 24000:
        raise VoicePipelineError("TTS", "invalid_audio")

    wav_path = None
    if export_wav:
        output_dir.mkdir(parents=True, exist_ok=True)
        wav_path = output_dir / f"voice-{key.session_id[:8]}-{turn_id[:8]}.wav"
        wav_path.write_bytes(audio)
    first_audio = timings.get("first_audio")
    first_sentence = timings.get("first_sentence")
    tts_start = min(segment_started.values()) if segment_started else time.perf_counter()
    tts_end = max(segment_finished) if segment_finished else tts_start
    llm_ttft = timings.get("llm_ttft", llm_started)
    llm_done = timings.get("llm_done", llm_started)
    return TurnResult(question, answer, llm_result.usage, llm_model, tts_settings.model,
                      tts_settings.voice, round((llm_done - llm_started) * 1000),
                      round((tts_end - tts_start) * 1000),
                      round(((timings.get("tts_done") or time.perf_counter()) - started) * 1000),
                      round((llm_ttft - llm_started) * 1000),
                      round(((first_sentence or llm_started) - started) * 1000),
                      round(((first_audio or tts_start) - tts_start) * 1000),
                      round(((first_audio or time.perf_counter()) - started) * 1000),
                      wav_path, audio, duration, rate,
                      bool(audio_sink is not None and audio_sink.playback_started),
                      (round((audio_sink.first_playback_time - started) * 1000)
                       if audio_sink is not None and audio_sink.first_playback_time is not None else None))


class StreamingWindowsPCMPlayer:
    """Bounded raw PCM playback through WinMM; does not create audio files."""

    class _WaveFormat(ctypes.Structure):
        _fields_ = [("format_tag", ctypes.c_ushort), ("channels", ctypes.c_ushort),
                    ("sample_rate", ctypes.c_uint),
                    ("avg_bytes", ctypes.c_uint), ("block_align", ctypes.c_ushort),
                    ("bits", ctypes.c_ushort), ("extra", ctypes.c_ushort)]

    class _WaveHeader(ctypes.Structure):
        pass

    _WaveHeader._fields_ = [("data", ctypes.c_void_p), ("buffer_length", ctypes.c_uint),
        ("bytes_recorded", ctypes.c_uint), ("user", ctypes.c_size_t), ("flags", ctypes.c_uint),
        ("loops", ctypes.c_uint), ("next", ctypes.POINTER(_WaveHeader)), ("reserved", ctypes.c_size_t)]

    def __init__(self, *, max_queued_chunks: int = 8):
        self._max_queued_chunks = max_queued_chunks
        self._condition = threading.Condition()
        self._handle = ctypes.c_void_p()
        self._headers = []
        self._current_segment = 0
        self._disabled = os.name != "nt"
        self.playback_started = False
        self.first_playback_time = None
        self.failure_code = None

    def _open(self):
        if self._disabled or self._handle.value:
            return
        try:
            winmm = ctypes.WinDLL("winmm")
            self._winmm = winmm
            winmm.waveOutOpen.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_uint,
                ctypes.POINTER(self._WaveFormat), ctypes.c_size_t, ctypes.c_size_t, ctypes.c_uint]
            winmm.waveOutPrepareHeader.argtypes = [ctypes.c_void_p, ctypes.POINTER(self._WaveHeader), ctypes.c_uint]
            winmm.waveOutWrite.argtypes = [ctypes.c_void_p, ctypes.POINTER(self._WaveHeader), ctypes.c_uint]
            winmm.waveOutUnprepareHeader.argtypes = [ctypes.c_void_p, ctypes.POINTER(self._WaveHeader), ctypes.c_uint]
            winmm.waveOutClose.argtypes = [ctypes.c_void_p]
            winmm.waveOutReset.argtypes = [ctypes.c_void_p]
            fmt = self._WaveFormat(1, 1, 24000, 48000, 2, 16, 0)
            result = winmm.waveOutOpen(ctypes.byref(self._handle), ctypes.c_uint(0xFFFFFFFF),
                                       ctypes.byref(fmt), 0, 0, 0)
            if result != 0:
                self._disabled = True
                self.failure_code = f"waveOutOpen_{result}"
                return
            self._format = fmt
        except Exception as error:
            self._disabled = True
            self.failure_code = type(error).__name__

    def _reap_one(self, *, wait: bool):
        while self._headers:
            header, buffer = self._headers[0]
            if header.flags & 1:
                self._winmm.waveOutUnprepareHeader(self._handle, ctypes.byref(header), ctypes.sizeof(header))
                self._headers.pop(0)
                continue
            if not wait:
                return False
            time.sleep(.005)
        return True

    def write_segment(self, segment_index: int, pcm: bytes):
        if not pcm or len(pcm) % 2:
            return
        with self._condition:
            while segment_index > self._current_segment and not self._disabled:
                self._condition.wait(.05)
            if self._disabled:
                return
            self._open()
            if self._disabled:
                return
            while len(self._headers) >= self._max_queued_chunks:
                self._reap_one(wait=True)
            buffer = ctypes.create_string_buffer(pcm)
            header = self._WaveHeader(ctypes.cast(buffer, ctypes.c_void_p), len(pcm), 0, 0, 0, 0, None, 0)
            if self._winmm.waveOutPrepareHeader(self._handle, ctypes.byref(header), ctypes.sizeof(header)) != 0:
                self._disabled = True
                self.failure_code = "waveOutPrepareHeader_failed"
                return
            if self._winmm.waveOutWrite(self._handle, ctypes.byref(header), ctypes.sizeof(header)) != 0:
                self._winmm.waveOutUnprepareHeader(self._handle, ctypes.byref(header), ctypes.sizeof(header))
                self._disabled = True
                self.failure_code = "waveOutWrite_failed"
                return
            self._headers.append((header, buffer))
            self.playback_started = True
            if self.first_playback_time is None:
                self.first_playback_time = time.perf_counter()

    def finish_segment(self, segment_index: int):
        with self._condition:
            while segment_index > self._current_segment and not self._disabled:
                self._condition.wait(.05)
            if segment_index == self._current_segment:
                self._current_segment += 1
                self._condition.notify_all()

    def finish(self):
        with self._condition:
            while self._headers and not self._disabled:
                self._reap_one(wait=True)
            if self._handle.value:
                if self._disabled:
                    self._winmm.waveOutReset(self._handle)
                    for header, _buffer in list(self._headers):
                        self._winmm.waveOutUnprepareHeader(self._handle, ctypes.byref(header), ctypes.sizeof(header))
                    self._headers.clear()
                self._winmm.waveOutClose(self._handle)
                self._handle = ctypes.c_void_p()

    def abort(self):
        with self._condition:
            self._disabled = True
            if self._handle.value:
                self._winmm.waveOutReset(self._handle)
                for header, _buffer in list(self._headers):
                    self._winmm.waveOutUnprepareHeader(self._handle, ctypes.byref(header), ctypes.sizeof(header))
                self._headers.clear()
                self._winmm.waveOutClose(self._handle)
                self._handle = ctypes.c_void_p()
            self._condition.notify_all()


def play_audio(audio: bytes, wav_path: Path | None = None) -> str | None:
    """Play from RAM on Windows; only use the default player for explicit export."""
    if os.name != "nt":
        return None
    try:
        import winsound
        winsound.PlaySound(audio, winsound.SND_MEMORY)
        return "memory"
    except Exception:
        if wav_path is not None:
            try:
                os.startfile(str(wav_path))  # type: ignore[attr-defined]
                return "default-player"
            except OSError:
                pass
        return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enable", action="store_true", help="Explicitly permit live Gemini requests")
    parser.add_argument("--export-audio", "--export-wav", dest="export_audio", action="store_true",
                        help="Explicitly save each WAV under artifacts")
    parser.add_argument("--output-dir", default=str(ROOT / "artifacts" / "interactive_voice"))
    return parser


def load_live_adapters():
    if BackendSettings().mode != "development-mock":
        raise RuntimeError("integrated_mode_fail_closed")
    provider = LLMProviderSettings()
    if provider.provider != "gemini":
        raise RuntimeError("gemini_provider_required")
    tts_settings = GeminiTTSSettings()
    llm, llm_model = create_llm_adapter(provider, reuse_client=True)
    tts = create_gemini_tts_adapter(tts_settings, reuse_client=True)
    return llm, llm_model, tts, tts_settings, provider.gemini_timeout_seconds


async def interactive(args) -> int:
    if not args.enable or os.getenv("AI_SERVER_INTERACTIVE_VOICE_DEMO_ENABLE", "").lower() != "true":
        print("BLOCKED: cần --enable và AI_SERVER_INTERACTIVE_VOICE_DEMO_ENABLE=true")
        return 2
    try:
        llm, llm_model, tts, tts_settings, llm_timeout = load_live_adapters()
    except Exception as error:
        safe_reason = str(error) if isinstance(error, RuntimeError) and str(error) in (
            "integrated_mode_fail_closed", "gemini_provider_required") else "configuration_invalid"
        print(f"BLOCKED: cấu hình/provider không sẵn sàng ({safe_reason})")
        return 2

    key, conversation = new_session()
    runner = LLMRunner(LLMSettings(model=llm_model))
    output_dir = Path(args.output_dir).resolve()
    artifacts = (ROOT / "artifacts").resolve()
    if output_dir != artifacts and artifacts not in output_dir.parents:
        await llm.aclose()
        await tts.aclose()
        print("BLOCKED: output-dir phải nằm trong AI_SERVER/artifacts")
        return 2
    print(f"Gemini voice session mới: {key.session_id}")
    print("Nhập câu hỏi tiếng Việt; gõ exit để kết thúc.")
    while True:
        try:
            question = input("Bạn> ")
        except (EOFError, KeyboardInterrupt):
            await llm.aclose()
            await tts.aclose()
            print("Kết thúc session.")
            return 0
        if should_exit(question):
            await llm.aclose()
            await tts.aclose()
            print("Kết thúc session.")
            return 0
        if not question.strip():
            print("Bỏ qua câu hỏi rỗng.")
            continue
        try:
            audio_sink = StreamingWindowsPCMPlayer() if os.name == "nt" else None
            result = await process_question(question, llm=llm, tts=tts, runner=runner,
                conversation=conversation, key=key, llm_model=llm_model, tts_settings=tts_settings,
                llm_timeout_seconds=llm_timeout, output_dir=output_dir, export_wav=args.export_audio,
                audio_sink=audio_sink)
        except VoicePipelineError as error:
            print(f"FAIL {error.stage}: {error.code}; có thể tiếp tục hoặc gõ exit.")
            continue
        except (OSError, ValueError) as error:
            print(f"FAIL: {str(error) or type(error).__name__}; có thể tiếp tục hoặc gõ exit.")
            continue
        print(f"Bạn: {result.question}")
        print(f"AIVA: {result.answer}")
        print(f"model: {result.llm_model}; TTS: {result.tts_model}/{result.tts_voice}")
        print(f"tokens: input={result.usage.input_tokens}, output={result.usage.output_tokens}, total={result.usage.total_tokens}")
        print(f"latency_ms: LLM_TTFT={result.llm_ttft_ms}, first_sentence={result.first_sentence_ms}, LLM_total={result.llm_ms}, TTS_first_audio={result.tts_first_audio_ms}, TTS_total={result.tts_ms}, API_time_to_first_audio={result.time_to_first_audio_ms}, WinMM_submit={result.playback_submit_ms}, total={result.total_ms}")
        print(f"audio: {result.wav_duration_seconds:.2f}s/{result.wav_sample_rate_hz}Hz; playback_mode={'WinMM chunk' if result.playback_started else 'buffered WAV fallback'}")
        if result.wav_path is not None:
            print(f"WAV đã export: {result.wav_path}")
        else:
            print("Audio chỉ nằm trong RAM; không tạo file WAV.")
        playback = "streamed" if result.playback_started else play_audio(result.audio, result.wav_path)
        if playback == "streamed":
            print("Windows đã nhận PCM theo chunk và bắt đầu playback; không xác nhận âm thanh vật lý tại loa.")
        elif playback == "memory":
            if audio_sink is not None and audio_sink.failure_code:
                print(f"WinMM streaming unavailable: {audio_sink.failure_code}; used buffered in-memory playback.")
            print("Đã phát WAV trong RAM qua Windows.")
        elif playback == "default-player":
            print(f"Phát RAM lỗi; đã mở WAV export bằng trình phát mặc định: {result.wav_path}")
        elif os.name == "nt":
            print(f"Phát tự động lỗi; mở thủ công: {result.wav_path}" if result.wav_path
                  else "Phát trong RAM lỗi; bật --export-audio để lưu WAV và mở thủ công.")
        del result


def main() -> int:
    args = build_parser().parse_args()
    return asyncio.run(interactive(args))


if __name__ == "__main__":
    raise SystemExit(main())
