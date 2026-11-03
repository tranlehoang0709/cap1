"""Mock inference and official SDK + in-memory HTTP only; no live API calls."""

import asyncio
from contextlib import aclosing
import json
import logging
import time

import httpx2
from openai import AsyncOpenAI
from pydantic import ValidationError
import pytest

from app.clients.openai_llm import OpenAILLMAdapter
from app.core.llm_config import LLMSettings
from app.models.audio import AudioMetadata, TranscriptionResult
from app.models.llm import (
    ConversationKey, LLMError, LLMResult, ProviderDelta, ProviderDone, TextChunk, Usage,
)
from app.services.audio_context import AudioContext
from app.services.audio_input import BoundedAudioInput
from app.services.llm import Conversation, LLMRunner
from app.services.mock_llm import MockLLMAdapter
from app.services.turn_detection import SpeechActivity, TextRules, TranscriptEvent, TurnDetectionConfig, TurnDetector
from app.services.turn_input import HalfDuplexTurn


CONFIG = LLMSettings()
SCRIPT = (ProviderDelta("Xin "), ProviderDelta("chào. "), ProviderDelta("Tôi là AIVA."),
          ProviderDone(True, "completed", Usage(10, 8, 18)))


def make_turn(turn_id="t1", *, seconds=10):
    context = AudioContext(deadline=time.monotonic() + seconds)
    audio = BoundedAudioInput(AudioMetadata("opus", 16000, 1, 60), context, max_frames=2, max_bytes=100)
    detector = TurnDetector(TurnDetectionConfig(700, 300, 15000), TextRules((".",), ()), started_at_ms=0)
    turn = HalfDuplexTurn(turn_id, detector, audio, speech_activity=lambda frame: True, emit=lambda event: None)
    detector.speech(SpeechActivity(0, True))
    turn.transcription(TranscriptEvent(100, TranscriptionResult("Xin chào.", True)))
    detector.speech(SpeechActivity(200, False))
    turn.tick(900)
    return turn


def make_conversation(user="u1", session="s1", device="d1", **limits):
    return Conversation(ConversationKey(user, session, device), max_turns=limits.get("max_turns", 10),
                        max_history_chars=limits.get("max_history_chars", 10000))


def run_stream(runner, adapter, conversation, turn, *, key=None, transcript=None, prompt="Bạn là AIVA."):
    return runner.stream(adapter, conversation, conversation.key if key is None else key, turn,
                         TranscriptionResult("Xin chào.", True) if transcript is None else transcript,
                         prompt, turn.audio.context)


async def collect(runner, adapter, conversation, turn, **kwargs):
    return [event async for event in run_stream(runner, adapter, conversation, turn, **kwargs)]


def test_streaming_order_before_final_and_history_commit():
    async def scenario():
        turn, conversation = make_turn(), make_conversation()
        mock = MockLLMAdapter(SCRIPT)
        async with aclosing(run_stream(LLMRunner(CONFIG), mock, conversation, turn)) as stream:
            assert await anext(stream) == TextChunk(0, "Xin chào.", True)
            assert not conversation.history
            assert await anext(stream) == TextChunk(1, " Tôi là AIVA.", True)
            final = await anext(stream)
            assert final == LLMResult("Xin chào. Tôi là AIVA.", True, "completed", Usage(10, 8, 18))
            with pytest.raises(StopAsyncIteration):
                await anext(stream)
        assert [item.role for item in conversation.history] == ["user", "assistant"]
        assert mock.released == 1
        await turn.aclose()
    asyncio.run(scenario())


def test_context_isolation_user_session_device_and_next_turn():
    async def scenario():
        runner = LLMRunner(CONFIG)
        conversations = [make_conversation(), make_conversation("u2"),
                         make_conversation(session="s2"), make_conversation(device="d2")]
        turns = [make_turn(str(i)) for i in range(4)]
        mocks = [MockLLMAdapter((ProviderDelta(f"Đáp {i}."), ProviderDone(True, "completed"))) for i in range(4)]
        await asyncio.gather(*(collect(runner, mock, conv, turn)
                               for mock, conv, turn in zip(mocks, conversations, turns)))
        for i, conv in enumerate(conversations):
            assert conv.history[-1].text == f"Đáp {i}."
            assert mocks[i].requests[0].history == ()
            await turns[i].aclose()
        conversations[0].release(turns[0])
        next_turn = make_turn("next")
        next_mock = MockLLMAdapter(SCRIPT)
        await collect(runner, next_mock, conversations[0], next_turn)
        assert next_mock.requests[0].history[-1].text == "Đáp 0."
        assert all("Đáp 1." != message.text for message in next_mock.requests[0].history)
        await next_turn.aclose()
    asyncio.run(scenario())


@pytest.mark.parametrize("change", [{"max_output_tokens": 0}, {"max_output_chars": -1},
    {"max_concurrent_requests": True}, {"max_output_tokens": 1.5}, {"model": ""},
    {"reasoning_effort": "invalid"}, {"response_language": "unknown"}])
def test_invalid_configuration(change):
    with pytest.raises(ValidationError):
        LLMSettings(**change)


def test_config_from_environment(monkeypatch):
    monkeypatch.setenv("AI_SERVER_LLM_MAX_OUTPUT_TOKENS", "128")
    monkeypatch.setenv("AI_SERVER_LLM_MAX_OUTPUT_CHARS", "250")
    monkeypatch.setenv("AI_SERVER_LLM_MAX_CONCURRENT_REQUESTS", "2")
    config = LLMSettings()
    assert (config.max_output_tokens, config.max_output_chars, config.max_concurrent_requests) == (128, 250, 2)
    assert (config.model, config.reasoning_effort, config.response_language) == ("gpt-6-luna", "none", "vi")


@pytest.mark.parametrize("script,reason,expected", [
    ((ProviderDelta("Xin chào. " + "x" * 600), ProviderDone(True, "completed")), "output_limit", "Xin chào."),
    ((ProviderDelta("x" * 600), ProviderDone(True, "completed")), "output_limit", ""),
    ((ProviderDelta("Xin chào. câu chưa"), ProviderDone(False, "token_limit", Usage(1, 256, 257))),
     "token_limit", "Xin chào."),
    ((ProviderDelta("câu chưa xong"), ProviderDone(False, "token_limit")), "token_limit", ""),
])
def test_limits_discard_unfinished_tail_and_do_not_commit(script, reason, expected):
    async def scenario():
        turn, conv = make_turn(), make_conversation()
        events = await collect(LLMRunner(CONFIG), MockLLMAdapter(script), conv, turn)
        assert events[-1].reason == reason and not events[-1].complete
        assert events[-1].text == expected and not conv.history
        assert all(chunk.tts_safe for chunk in events[:-1])
        assert len(events[-1].text) <= 500
        await turn.aclose()
    asyncio.run(scenario())


def test_unicode_and_sentence_limits_never_slice_grapheme():
    async def scenario():
        config = LLMSettings(max_output_chars=20)
        turn, conv = make_turn(), make_conversation()
        script = (ProviderDelta("Chào 👨‍👩‍👧‍👦. "), ProviderDelta("e\u0301" * 50), ProviderDone(True, "completed"))
        events = await collect(LLMRunner(config), MockLLMAdapter(script), conv, turn)
        assert events[-1].text == "Chào 👨‍👩‍👧‍👦."
        assert events[-1].reason == "output_limit"
        await turn.aclose()
    asyncio.run(scenario())


def test_unpunctuated_completed_tail_is_not_tts_safe():
    async def scenario():
        turn, conv = make_turn(), make_conversation()
        events = await collect(LLMRunner(CONFIG), MockLLMAdapter((ProviderDelta("Chào bạn"), ProviderDone(True, "completed"))), conv, turn)
        assert events[0] == TextChunk(0, "Chào bạn", False)
        assert events[-1].complete
        await turn.aclose()
    asyncio.run(scenario())


@pytest.mark.parametrize("events,code", [((), "invalid_stream"), ((ProviderDone(True, "completed"),), "empty_response"),
    ((ProviderDelta("x"),), "invalid_stream"), (("invalid",), "invalid_stream"),
    ((ProviderDone(True, "completed"), ProviderDelta("late")), "invalid_stream")])
def test_invalid_provider_contract(events, code):
    async def scenario():
        turn, conv = make_turn(), make_conversation()
        with pytest.raises(LLMError, match=code):
            await collect(LLMRunner(CONFIG), MockLLMAdapter(events), conv, turn)
        assert not conv.history
        await turn.aclose()
    asyncio.run(scenario())


class HoldingMock:
    def __init__(self):
        self.started = asyncio.Event()
        self.proceed = asyncio.Event()
        self.active = self.maximum = self.released = 0

    async def stream(self, request, context):
        self.active += 1
        self.maximum = max(self.active, self.maximum)
        self.started.set()
        try:
            await self.proceed.wait()
            yield ProviderDelta("Xong.")
            yield ProviderDone(True, "completed")
        finally:
            self.active -= 1
            self.released += 1


def test_five_concurrent_overload_and_slot_reuse():
    async def scenario():
        runner, mock = LLMRunner(CONFIG), HoldingMock()
        turns = [make_turn(f"t{i}") for i in range(6)]
        convs = [make_conversation(session=f"s{i}") for i in range(6)]
        tasks = [asyncio.create_task(collect(runner, mock, convs[i], turns[i])) for i in range(5)]
        for _ in range(20):
            if mock.active == 5:
                break
            await asyncio.sleep(0)
        assert mock.active == mock.maximum == 5
        with pytest.raises(LLMError, match="overloaded"):
            await collect(runner, mock, convs[5], turns[5])
        turns[0].cancel()
        with pytest.raises(LLMError, match="cancelled"):
            await tasks[0]
        task6 = asyncio.create_task(collect(runner, mock, convs[5], turns[5]))
        mock.proceed.set()
        await asyncio.gather(*tasks[1:], task6)
        assert mock.active == 0 and mock.released == 6 and mock.maximum == 5
        for turn in turns:
            await turn.aclose()
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["timeout", "cancel", "disconnect", "task"])
def test_timeout_cancel_disconnect_cleanup(mode):
    async def scenario():
        runner, mock = LLMRunner(CONFIG), HoldingMock()
        turn = make_turn(seconds=.03 if mode == "timeout" else 2)
        conv = make_conversation()
        task = asyncio.create_task(collect(runner, mock, conv, turn))
        await mock.started.wait()
        if mode == "cancel":
            turn.cancel()
        elif mode == "disconnect":
            await turn.aclose()
        elif mode == "task":
            task.cancel()
        if mode == "task":
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(LLMError, match="timeout" if mode == "timeout" else "cancelled"):
                await task
        assert mock.active == 0 and mock.released == 1 and not conv.history
        await turn.aclose()
        assert not [t for t in asyncio.all_tasks() if t is not asyncio.current_task() and not t.done()]
    asyncio.run(scenario())


def test_duplicate_processing_speaking_and_cross_scope_are_rejected():
    async def scenario():
        runner, mock = LLMRunner(CONFIG), MockLLMAdapter(SCRIPT)
        turn, conv = make_turn(), make_conversation()
        with pytest.raises(LLMError, match="invalid_input"):
            await collect(runner, mock, conv, turn, key=ConversationKey("other", "s1", "d1"))
        with pytest.raises(LLMError, match="invalid_input"):
            await collect(runner, mock, conv, turn, transcript=TranscriptionResult("partial", False))
        await collect(runner, mock, conv, turn)
        with pytest.raises(LLMError, match="session_busy"):
            await collect(runner, mock, conv, turn)
        turn.speaking()
        another = make_turn("other")
        with pytest.raises(LLMError, match="session_busy"):
            await collect(runner, mock, conv, another)
        with pytest.raises(LLMError, match="session_busy"):
            conv.release(turn)
        assert len(mock.requests) == 1
        await turn.aclose()
        await another.aclose()
    asyncio.run(scenario())


def test_early_stream_close_does_not_commit_and_releases_slot():
    async def scenario():
        runner, mock = LLMRunner(LLMSettings(max_concurrent_requests=1)), MockLLMAdapter(SCRIPT)
        turn, conv = make_turn(), make_conversation()
        async with aclosing(run_stream(runner, mock, conv, turn)) as stream:
            assert isinstance(await anext(stream), TextChunk)
        assert mock.released == 1 and not conv.history
        other = make_turn("other")
        await collect(runner, MockLLMAdapter(SCRIPT), make_conversation(session="other"), other)
        await turn.aclose()
        await other.aclose()
    asyncio.run(scenario())


def sdk_event(kind, sequence, **extra):
    return {"type": kind, "sequence_number": sequence, **extra}


def sdk_response(*, complete=True, usage=True):
    return {"id": "resp_mock", "object": "response", "created_at": 0,
            "status": "completed" if complete else "incomplete", "model": "gpt-6-luna", "output": [],
            "incomplete_details": None if complete else {"reason": "max_output_tokens"},
            "usage": {"input_tokens": 10, "output_tokens": 8, "total_tokens": 18} if usage else None}


class SSEBody(httpx2.AsyncByteStream):
    def __init__(self, events, *, hang=False):
        self.events, self.hang = events, hang
        self.closed = False
        self.started = asyncio.Event()

    async def __aiter__(self):
        self.started.set()
        for event in self.events:
            yield ("data: " + json.dumps(event) + "\n\n").encode()
        if self.hang:
            await asyncio.Event().wait()

    async def aclose(self):
        self.closed = True


def official_adapter(events, *, status=200, hang=False):
    body, requests, clients = SSEBody(events, hang=hang), [], []
    async def handle(request):
        requests.append(request)
        if status != 200:
            return httpx2.Response(status, json={"error": {"message": "private-secret-prompt", "type": "test", "code": "test"}})
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, stream=body)
    def factory(**kwargs):
        assert kwargs["max_retries"] == 0
        client = AsyncOpenAI(**kwargs, http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handle), trust_env=False))
        clients.append(client)
        return client
    adapter = OpenAILLMAdapter(api_key="mock-key-not-a-live-secret", client_factory=factory)
    return adapter, requests, clients, body


def test_official_sdk_sse_request_parameters_usage_and_close():
    async def scenario():
        adapter, requests, clients, body = official_adapter([
            sdk_event("response.output_text.delta", 0, delta="Xin chào. ", item_id="msg", output_index=0, content_index=0),
            sdk_event("response.completed", 1, response=sdk_response()),
        ])
        turn, conv = make_turn(), make_conversation()
        events = await collect(LLMRunner(CONFIG), adapter, conv, turn)
        assert events[-1].usage == Usage(10, 8, 18)
        assert events[-1].text == "Xin chào."
        payload = json.loads(requests[0].content)
        assert payload["model"] == "gpt-6-luna" and payload["reasoning"] == {"effort": "none"}
        assert payload["stream"] is True and payload["store"] is False
        assert payload["max_output_tokens"] == 256
        assert payload["input"] == [{"role": "user", "content": "Xin chào."}]
        assert "tiếng Việt" in payload["instructions"]
        assert str(requests[0].url) == "https://api.openai.com/v1/responses"
        assert len(requests) == 1 and body.closed and clients[0].is_closed()
        assert "mock-key" not in repr(adapter)
        await turn.aclose()
    asyncio.run(scenario())


@pytest.mark.parametrize("status,code", [(429, "rate_limit"), (401, "provider_error"),
                                        (500, "provider_error"), (503, "provider_error")])
def test_official_sdk_http_failure_no_retry_no_secret(status, code, caplog):
    caplog.set_level(logging.DEBUG)
    async def scenario():
        adapter, requests, clients, _ = official_adapter([], status=status)
        turn, conv = make_turn(), make_conversation()
        with pytest.raises(LLMError, match=code) as error:
            await collect(LLMRunner(CONFIG), adapter, conv, turn)
        assert "private-secret" not in str(error.value)
        assert len(requests) == 1 and clients[0].is_closed() and not conv.history
        await turn.aclose()
    asyncio.run(scenario())
    assert "mock-key-not-a-live-secret" not in caplog.text
    assert "private-secret-prompt" not in caplog.text


def test_history_budget_rejects_before_provider_and_turn_budget_is_bounded():
    async def scenario():
        runner, mock = LLMRunner(CONFIG), MockLLMAdapter(SCRIPT)
        turn = make_turn()
        with pytest.raises(LLMError, match="context_limit"):
            await collect(runner, mock, make_conversation(max_history_chars=10), turn)
        conv = make_conversation(max_turns=1)
        await collect(runner, mock, conv, turn)
        await turn.aclose()
        conv.release(turn)
        other = make_turn("other")
        with pytest.raises(LLMError, match="context_limit"):
            await collect(runner, mock, conv, other)
        assert len(mock.requests) == 1
        await other.aclose()
    asyncio.run(scenario())


def test_mock_provider_failure_is_safe_and_does_not_retry():
    class Failure:
        def __init__(self):
            self.calls = 0
            self.released = False

        async def stream(self, request, context):
            self.calls += 1
            try:
                raise RuntimeError("sensitive-prompt-and-key")
                yield
            finally:
                self.released = True

    async def scenario():
        runner, mock, turn, conv = LLMRunner(CONFIG), Failure(), make_turn(), make_conversation()
        with pytest.raises(LLMError, match="provider_error") as error:
            await collect(runner, mock, conv, turn)
        assert "sensitive" not in str(error.value) and mock.calls == 1 and mock.released
        with pytest.raises(LLMError, match="session_busy"):
            await collect(runner, mock, conv, turn)
        assert mock.calls == 1 and not conv.history
        await turn.aclose()
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["timeout", "cancel"])
def test_preflight_context_prevents_request(mode):
    async def scenario():
        turn, conv, mock = make_turn(), make_conversation(), MockLLMAdapter(SCRIPT)
        if mode == "timeout":
            turn.audio.context.deadline = time.monotonic() - 1
        else:
            turn.cancel()
        with pytest.raises(LLMError, match="timeout" if mode == "timeout" else "cancelled"):
            await collect(LLMRunner(CONFIG), mock, conv, turn)
        assert not mock.requests and not conv.history
        await turn.aclose()
    asyncio.run(scenario())


def test_official_sdk_application_limit_closes_stream_and_client():
    async def scenario():
        adapter, requests, clients, body = official_adapter([
            sdk_event("response.output_text.delta", 0, delta="Câu đủ. " + "x" * 600,
                      item_id="msg", output_index=0, content_index=0),
        ], hang=True)
        turn, conv = make_turn(), make_conversation()
        events = await collect(LLMRunner(CONFIG), adapter, conv, turn)
        assert events[-1] == LLMResult("Câu đủ.", False, "output_limit", None)
        assert body.closed and clients[0].is_closed() and len(requests) == 1
        assert not conv.history
        await turn.aclose()
    asyncio.run(scenario())


@pytest.mark.parametrize("kind", ["response.failed", "error", "response.refusal.delta"])
def test_official_sdk_terminal_failure_events_close(kind):
    async def scenario():
        extra = {"response": sdk_response()} if kind == "response.failed" else {}
        adapter, _, clients, body = official_adapter([sdk_event(kind, 0, **extra)])
        turn, conv = make_turn(), make_conversation()
        with pytest.raises(LLMError, match="provider_error"):
            await collect(LLMRunner(CONFIG), adapter, conv, turn)
        assert body.closed and clients[0].is_closed() and not conv.history
        await turn.aclose()
    asyncio.run(scenario())


def test_official_sdk_token_incomplete_and_optional_usage():
    async def scenario():
        adapter, _, clients, body = official_adapter([
            sdk_event("response.output_text.delta", 0, delta="Đủ câu. chưa", item_id="msg", output_index=0, content_index=0),
            sdk_event("response.incomplete", 1, response=sdk_response(complete=False, usage=False)),
        ])
        turn, conv = make_turn(), make_conversation()
        events = await collect(LLMRunner(CONFIG), adapter, conv, turn)
        assert events[-1] == LLMResult("Đủ câu.", False, "token_limit", None)
        assert not conv.history and body.closed and clients[0].is_closed()
        await turn.aclose()
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["timeout", "disconnect"])
def test_official_sdk_hanging_sse_is_cancelled_and_closed(mode):
    async def scenario():
        adapter, _, clients, body = official_adapter([], hang=True)
        turn, conv = make_turn(seconds=.05 if mode == "timeout" else 2), make_conversation()
        task = asyncio.create_task(collect(LLMRunner(CONFIG), adapter, conv, turn))
        await body.started.wait()
        if mode == "disconnect":
            await turn.aclose()
        with pytest.raises(LLMError, match="timeout" if mode == "timeout" else "cancelled"):
            await task
        assert body.closed and clients[0].is_closed() and not conv.history
        await turn.aclose()
    asyncio.run(scenario())


def test_official_sdk_rejects_reordered_events():
    async def scenario():
        adapter, _, clients, body = official_adapter([
            sdk_event("response.output_text.delta", 2, delta="Xin ", item_id="msg", output_index=0, content_index=0),
            sdk_event("response.output_text.delta", 1, delta="chào.", item_id="msg", output_index=0, content_index=0),
        ])
        turn, conv = make_turn(), make_conversation()
        with pytest.raises(LLMError, match="invalid_stream"):
            await collect(LLMRunner(CONFIG), adapter, conv, turn)
        assert body.closed and clients[0].is_closed()
        await turn.aclose()
    asyncio.run(scenario())
