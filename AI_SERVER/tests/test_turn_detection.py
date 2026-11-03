"""Mock speech timelines only. No real VAD/Opus/STT or linguistic benchmark."""

import asyncio
from dataclasses import replace
import time

import pytest

from app.models.audio import AudioError, AudioFrame, AudioMetadata, TranscriptionResult
from app.services.audio_context import AudioContext
from app.services.audio_input import BoundedAudioInput
from app.services.stt import transcribe
from app.services.turn_detection import (
    Decision, LanguageEvidence, SpeechActivity, TextRules, TranscriptEvent,
    TurnDetectionConfig, TurnDetector,
)
from app.services.turn_input import HalfDuplexTurn, TurnEnded, TurnPhase, TurnTimedOut


# User-approved EXPERIMENTAL thresholds, not official Xiaozhi settings.
CONFIG = TurnDetectionConfig(700, 300, 15000)
# Test-only heuristic vocabulary; no production linguistic approval implied.
RULES = TextRules((".", "?", "!"), ("và", "nhưng", "ừm", "ờ", "...", "…", ","))


def detector(config=CONFIG):
    return TurnDetector(config, RULES, started_at_ms=0)


def text(at, value="Bật đèn phòng khách.", *, final=False):
    return TranscriptEvent(at, TranscriptionResult(value, final, "vi"))


def phrase(d):
    d.speech(SpeechActivity(0, True))
    d.transcription(text(900))
    d.speech(SpeechActivity(1000, False))


def test_complete_sentence_waits_for_silence_and_stability():
    d = detector()
    phrase(d)
    assert d.tick(1699) == Decision.WAIT
    assert d.tick(1700) == Decision.END
    assert d.tick(1701) == Decision.END  # Sticky boundary, never a second turn.


def test_final_alone_does_not_end_while_speaking_or_short_silence():
    d = detector()
    d.speech(SpeechActivity(0, True))
    assert d.transcription(text(100, final=True)) == Decision.WAIT
    assert d.tick(1000) == Decision.WAIT
    assert d.speech(SpeechActivity(1100, False)) == Decision.WAIT
    assert d.tick(1799) == Decision.WAIT
    assert d.tick(1800) == Decision.END


@pytest.mark.parametrize("value", ["Tôi muốn...", "Bật đèn và", "Ừm.", "Tôi muốn nhưng.", "Tôi muốn", ""])
def test_long_silence_incomplete_or_unknown_never_forces_end(value):
    d = detector()
    d.speech(SpeechActivity(0, True))
    d.transcription(text(100, value, final=True))
    d.speech(SpeechActivity(200, False))
    assert d.tick(900) == Decision.UNCERTAIN
    assert d.tick(14000) == Decision.UNCERTAIN
    assert not d.ended


def test_hesitation_then_continuation_is_one_utterance():
    d = detector()
    d.speech(SpeechActivity(0, True))
    d.transcription(text(100, "Tôi muốn...", final=True))
    d.speech(SpeechActivity(200, False))
    assert d.tick(900) == Decision.UNCERTAIN
    d.speech(SpeechActivity(1000, True))
    d.transcription(text(1300, "Tôi muốn nghe nhạc."))
    d.speech(SpeechActivity(1400, False))
    assert d.tick(2100) == Decision.END


def test_partial_change_resets_stability_but_same_final_does_not():
    d = detector()
    phrase(d)
    assert d.transcription(text(1600, "Bật đèn phòng ngủ.")) == Decision.WAIT
    assert d.tick(1700) == Decision.WAIT
    assert d.transcription(text(1750, "Bật đèn phòng ngủ.", final=True)) == Decision.WAIT
    assert d.tick(1899) == Decision.WAIT
    assert d.tick(1900) == Decision.END


def test_resumed_speech_invalidates_old_transcript():
    d = detector()
    phrase(d)
    assert d.speech(SpeechActivity(1500, True)) == Decision.WAIT
    d.speech(SpeechActivity(1600, False))
    assert d.tick(2300) == Decision.UNCERTAIN
    assert not d.ended
    assert d.transcription(text(2400, "Bật đèn rồi mở nhạc.")) == Decision.WAIT
    assert d.tick(2700) == Decision.END


def test_repeated_false_vad_does_not_restart_silence():
    d = detector()
    phrase(d)
    d.speech(SpeechActivity(1400, False))
    assert d.tick(1700) == Decision.END


def test_no_speech_and_no_false_vad_do_not_establish_boundary():
    d = detector()
    d.transcription(text(100, final=True))
    d.speech(SpeechActivity(200, False))
    assert d.tick(1000) == Decision.WAIT
    d.speech(SpeechActivity(1100, True))
    d.transcription(text(1200, final=True))
    assert d.tick(5000) == Decision.WAIT


@pytest.mark.parametrize("active", [True, False])
def test_timeout_is_uncertain_never_end(active):
    d = detector()
    d.speech(SpeechActivity(0, True))
    d.transcription(text(100, final=True))
    if not active:
        d.speech(SpeechActivity(14900, False))
    assert d.tick(15000) == Decision.UNCERTAIN
    assert d.timed_out and not d.ended
    assert d.tick(16000) == Decision.UNCERTAIN


def test_cancel_is_terminal():
    d = detector()
    phrase(d)
    assert d.cancel() == Decision.UNCERTAIN
    assert d.tick(1700) == Decision.UNCERTAIN
    assert d.transcript is None


def test_silence_config_can_be_increased_to_1000():
    d = detector(replace(CONFIG, min_silence_ms=1000))
    phrase(d)
    assert d.tick(1700) == Decision.WAIT
    assert d.tick(2000) == Decision.END


def test_env_config_requires_explicit_values_and_has_no_app_side_effects():
    values = {"AI_SERVER_TURN_MIN_SILENCE_MS": "700",
              "AI_SERVER_TURN_TRANSCRIPT_STABILITY_MS": "300",
              "AI_SERVER_TURN_MAX_DURATION_MS": "15000"}
    assert TurnDetectionConfig.from_env(values) == CONFIG
    with pytest.raises(ValueError):
        TurnDetectionConfig.from_env({})
    with pytest.raises(ValueError):
        TurnDetectionConfig.from_env(values | {"AI_SERVER_TURN_MIN_SILENCE_MS": "private-invalid"})


@pytest.mark.parametrize("values", [(0, 300, 15000), (True, 300, 15000), (700, -1, 15000),
                                     (700, 300, 700), (700, 300.5, 15000)])
def test_invalid_config(values):
    with pytest.raises(ValueError):
        TurnDetectionConfig(*values)


@pytest.mark.parametrize("at", [-1, True, float("nan"), float("inf")])
def test_invalid_time(at):
    with pytest.raises(ValueError):
        detector().tick(at)


def test_out_of_order_event_does_not_change_state():
    d = detector()
    d.speech(SpeechActivity(100, True))
    with pytest.raises(ValueError, match="Out-of-order"):
        d.speech(SpeechActivity(99, False))
    assert d.tick(1000) == Decision.WAIT


@pytest.mark.parametrize("value,evidence", [("Đèn đã bật.", LanguageEvidence.COMPLETE),
    ("Tôi muốn và.", LanguageEvidence.INCOMPLETE), ("Đang bật", LanguageEvidence.UNKNOWN),
    ("Ừm...", LanguageEvidence.INCOMPLETE), ("Bật đèn?", LanguageEvidence.COMPLETE)])
def test_language_rules_are_heuristic_and_explicit(value, evidence):
    assert RULES.classify(value) == evidence


def make_bridge(vad, *, config=CONFIG, emit=None):
    metadata = AudioMetadata("opus", 16000, 1, 60)
    audio = BoundedAudioInput(metadata, AudioContext(deadline=time.monotonic() + 5),
                              max_frames=20, max_bytes=100)
    events = []
    bridge = HalfDuplexTurn("turn-A", detector(config), audio,
                            speech_activity=vad, emit=events.append if emit is None else emit)
    return bridge, audio, metadata, events


def test_half_duplex_finishes_once_drops_processing_speaking_and_never_replays():
    async def scenario():
        vad_calls = []
        def mock_vad(frame):
            vad_calls.append(frame.payload)
            return frame.payload == b"speech"
        turn, audio, metadata, events = make_bridge(mock_vad)
        turn.microphone(AudioFrame(b"speech"), metadata=metadata, at_ms=0)
        turn.transcription(text(900))
        turn.microphone(AudioFrame(b"quiet"), metadata=metadata, at_ms=1000)
        assert turn.tick(1700) == Decision.END
        assert turn.phase == TurnPhase.PROCESSING and len(events) == 1
        assert isinstance(events[0], TurnEnded)
        assert not events[0].transcript_is_final  # Stable partial may establish boundary.
        assert not turn.microphone(AudioFrame(b"blocked"), metadata=metadata, at_ms=1800)
        turn.speaking()
        assert not turn.microphone(AudioFrame(b"blocked"), metadata=metadata, at_ms=1900)
        assert turn.transcription(text(2000, final=True)) == Decision.END
        assert turn.tick(2100) == Decision.END and len(events) == 1
        assert vad_calls == [b"speech", b"quiet"]
        # This represents STT reading the existing input; no blocked frame reached it.
        assert [(await audio.read()).payload, (await audio.read()).payload] == [b"speech", b"quiet"]
        assert await audio.read() is None
        await turn.aclose()
        assert audio.buffered_bytes == 0
        assert not turn.microphone(AudioFrame(b"blocked"), metadata=metadata, at_ms=2200)
    asyncio.run(scenario())


def test_new_speech_at_silence_threshold_is_not_preempted_by_stale_tick():
    async def scenario():
        turn, _, metadata, events = make_bridge(lambda frame: frame.payload == b"s")
        turn.microphone(AudioFrame(b"s"), metadata=metadata, at_ms=0)
        turn.transcription(text(900))
        turn.microphone(AudioFrame(b"q"), metadata=metadata, at_ms=1000)
        assert turn.microphone(AudioFrame(b"s"), metadata=metadata, at_ms=1700)
        assert turn.phase == TurnPhase.LISTENING and not events
        await turn.aclose()
    asyncio.run(scenario())


def test_timeout_closes_buffer_emits_timeout_once_even_during_speech():
    async def scenario():
        turn, audio, metadata, events = make_bridge(lambda frame: True)
        turn.microphone(AudioFrame(b"s"), metadata=metadata, at_ms=0)
        turn.transcription(text(100, final=True))
        assert not turn.microphone(AudioFrame(b"s"), metadata=metadata, at_ms=15000)
        assert turn.phase == TurnPhase.CLOSED and audio.buffered_bytes == 0
        assert events == [TurnTimedOut("turn-A", 15000)]
        assert turn.tick(15001) == Decision.UNCERTAIN
        assert len(events) == 1
        await turn.aclose()
    asyncio.run(scenario())


@pytest.mark.parametrize("method", ["bridge", "context", "deadline"])
def test_bridge_cancel_or_context_deadline_releases_resources_without_end(method):
    async def scenario():
        turn, audio, metadata, events = make_bridge(lambda frame: True)
        turn.microphone(AudioFrame(b"s"), metadata=metadata, at_ms=0)
        if method == "bridge":
            turn.cancel()
        elif method == "context":
            audio.context.cancel()
        else:
            audio.context.deadline = time.monotonic() - 1
            with pytest.raises(AudioError, match="deadline_exceeded"):
                turn.tick(100)
        assert turn.phase == TurnPhase.CLOSED and audio.buffered_bytes == 0
        assert not events
        await turn.aclose()
    asyncio.run(scenario())


def test_reentrant_end_callback_cannot_emit_twice():
    async def scenario():
        events = []
        def emit(event):
            events.append(event)
            turn.tick(event.at_ms)
        turn, _, metadata, _ = make_bridge(lambda frame: frame.payload == b"s", emit=emit)
        turn.microphone(AudioFrame(b"s"), metadata=metadata, at_ms=0)
        turn.transcription(text(900))
        turn.microphone(AudioFrame(b"q"), metadata=metadata, at_ms=1000)
        turn.tick(1700)
        assert len(events) == 1
        await turn.aclose()
    asyncio.run(scenario())


def test_synthetic_endpoint_metrics():
    # Reference boundaries are hand-labelled MOCK events, not acoustic ground truth.
    observations = []
    d = detector()
    phrase(d)
    assert d.tick(1700) == Decision.END
    observations.append((1000, 1700))
    d = detector()
    phrase(d)
    d.transcription(text(1600, "Bật đèn phòng ngủ."))
    assert d.tick(1700) == Decision.WAIT
    assert d.tick(1900) == Decision.END
    observations.append((1000, 1900))
    d = detector()
    d.speech(SpeechActivity(0, True))
    d.transcription(text(900, "Tôi muốn..."))
    d.speech(SpeechActivity(1000, False))
    assert d.tick(1700) == Decision.UNCERTAIN
    d.speech(SpeechActivity(1800, True))
    d.transcription(text(2200, "Tôi muốn nghe nhạc."))
    d.speech(SpeechActivity(2300, False))
    assert d.tick(3000) == Decision.END
    observations.append((2300, 3000))
    early = sum(end < reference for reference, end in observations)
    waits = [end - reference for reference, end in observations]
    assert early == 0 and waits == [700, 900, 700]
    print(f"MOCK ONLY: early={early}/{len(observations)}, post_sentence_wait_ms={waits}, mean_ms={sum(waits)/len(waits):.2f}")


def test_existing_stt_runner_drains_only_accepted_frames_after_end():
    class RecordingMockSTT:
        def __init__(self):
            self.frames = []
            self.released = False

        async def transcribe(self, audio, context):
            try:
                while (frame := await audio.read()) is not None:
                    self.frames.append(frame.payload)
                yield TranscriptionResult("MOCK final", True)
            finally:
                self.released = True

    async def scenario():
        turn, audio, metadata, events = make_bridge(lambda frame: frame.payload == b"s")
        mock = RecordingMockSTT()
        task = asyncio.create_task(transcribe(mock, audio, audio.context))
        turn.microphone(AudioFrame(b"s"), metadata=metadata, at_ms=0)
        turn.transcription(text(900))
        turn.microphone(AudioFrame(b"q"), metadata=metadata, at_ms=1000)
        turn.tick(1700)
        assert not turn.microphone(AudioFrame(b"processing"), metadata=metadata, at_ms=1800)
        turn.speaking()
        assert not turn.microphone(AudioFrame(b"speaking"), metadata=metadata, at_ms=1900)
        assert (await task).text == "MOCK final"
        assert mock.frames == [b"s", b"q"] and mock.released
        assert len(events) == 1
        await turn.aclose()
    asyncio.run(scenario())


def test_cancel_one_turn_does_not_affect_another():
    async def scenario():
        a, audio_a, metadata, events_a = make_bridge(lambda frame: True)
        b, audio_b, _, events_b = make_bridge(lambda frame: True)
        a.microphone(AudioFrame(b"a"), metadata=metadata, at_ms=0)
        b.microphone(AudioFrame(b"b"), metadata=metadata, at_ms=0)
        a.cancel()
        assert a.phase == TurnPhase.CLOSED and audio_a.buffered_bytes == 0
        assert b.phase == TurnPhase.LISTENING and audio_b.buffered_bytes == 1
        assert not events_a and not events_b
        await a.aclose()
        await b.aclose()
    asyncio.run(scenario())


def test_close_cancels_pending_stt_without_orphan_task():
    class WaitingMockSTT:
        def __init__(self):
            self.started = asyncio.Event()
            self.released = False

        async def transcribe(self, audio, context):
            self.started.set()
            try:
                await asyncio.Event().wait()
                yield TranscriptionResult("unreachable", True)
            finally:
                self.released = True

    async def scenario():
        turn, audio, _, events = make_bridge(lambda frame: True)
        mock = WaitingMockSTT()
        task = asyncio.create_task(transcribe(mock, audio, audio.context))
        await mock.started.wait()
        await turn.aclose()
        with pytest.raises(AudioError, match="cancelled"):
            await task
        assert mock.released and not events
        assert not [task for task in asyncio.all_tasks() if task is not asyncio.current_task() and not task.done()]
    asyncio.run(scenario())
