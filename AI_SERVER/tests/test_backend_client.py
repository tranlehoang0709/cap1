"""Backend contract fixtures, NOT live Backend/MySQL/Cloud evidence."""

import asyncio
from datetime import datetime, timezone
import json
import logging
import time

import httpx
from pydantic import SecretStr, ValidationError
import pytest

from app.clients.backend import BackendClient, BackendCode, BackendError, ClientLimits, ServiceTokens
from app.models import backend as dto
from app.models.llm import LLMRequest, ProviderDelta, ProviderDone, Usage
from app.core.llm_config import LLMSettings
from app.services.audio_context import AudioContext
from app.services.backend_execution import QuotaLLMAdapter, UsageReporter
from app.services.device_auth import authorize_device
from app.services.mock_llm import MockLLMAdapter


def context(seconds=2):
    return AudioContext(deadline=time.monotonic() + seconds)


TOKENS = ServiceTokens(SecretStr("A" * 43), SecretStr("B" * 43), SecretStr("C" * 43))
PROOF = dto.DeviceProof(deviceUid="robot-42", credential=SecretStr("D" * 43))
AUTH = {"allowed": True, "deviceId": "42", "ownerUserId": "7"}
CONFIG = {"userId": "7", "provider": {"id": "2", "code": "OPENAI", "name": "OpenAI"},
    "model": {"id": "21", "modelCode": "gpt-6-luna", "capability": "llm"},
    "profile": {"assistantName": "AIVA", "systemPrompt": "MOCK prompt", "preferredProviderId": "2",
                "preferredLlmModelId": "21", "languageCode": "vi", "voiceCode": "mock-voice"},
    "credentialScope": "USER", "credentialReference": {"id": "9", "providerId": "2"}}


class BackendFixture:
    def __init__(self):
        self.calls = []
        self.overrides = {}
    async def handle(self, request):
        self.calls.append(request)
        path, body = request.url.path, json.loads(request.content)
        if path in self.overrides:
            response = self.overrides[path]
            if callable(response):
                return await response(request)
            return response
        if path == "/internal/devices/authorize":
            return httpx.Response(200, json=AUTH)
        if path == "/internal/ai/resolve-config":
            return httpx.Response(200, json=CONFIG)
        if path == "/internal/devices/heartbeat":
            return httpx.Response(200, json={"accepted": True, "deviceId": "42", "lastSeenAt": "2026-11-03T01:00:00.000Z"})
        if path == "/internal/ai/authorize-request":
            return httpx.Response(200, json={"allowed": True, "requestId": body["requestId"], "providerId": body["providerId"],
                "mode": "UNLIMITED", "remainingQuota": {"requestsPerMinute": None, "requestsPerDay": None, "tokensPerMonth": None},
                "reservedTokens": body.get("maxTotalTokens"), "reportDueAt": "2026-11-03T01:01:00.123Z",
                "replayed": False, "executionAllowed": True})
        if path == "/internal/ai/usage":
            return httpx.Response(200, json={"requestId": body["requestId"], "status": body["status"].upper(),
                "recorded": True, "replayed": False, "budgetExceeded": False})
        raise AssertionError("Unexpected route")


def client(fixture, timeout=1, max_bytes=8192):
    return BackendClient("https://backend.invalid", TOKENS, ClientLimits(timeout, 2, max_bytes),
                         transport=httpx.MockTransport(fixture.handle))


def test_auth_config_and_service_credentials_are_separate():
    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            session = await authorize_device(api, PROOF, context(), expected_device_id="42")
            cfg = await session.resolve(context())
            assert (session.key.user_id, session.key.device_id) == ("7", "42")
            assert session.key.session_id != "42"  # Server-minted opaque internal identifier.
            assert cfg.credentialReference.id == "9" and not hasattr(cfg, "apiKey")
            assert fixture.calls[0].headers["authorization"] == "Bearer " + "A" * 43
            assert fixture.calls[1].headers["authorization"] == "Bearer " + "B" * 43
            assert json.loads(fixture.calls[0].content) == {"deviceUid": "robot-42", "credential": "D" * 43}
            assert json.loads(fixture.calls[1].content) == {"userId": "7", "deviceId": "42"}
        with pytest.raises(BackendError, match="backend_closed"):
            await api.authorize(PROOF, context())
    asyncio.run(scenario())


@pytest.mark.parametrize("label,status,reason", [("invalid", 401, "DEVICE_UNAUTHORIZED"),
    ("expired", 401, "DEVICE_UNAUTHORIZED"), ("revoked", 401, "DEVICE_UNAUTHORIZED"),
    ("disallowed", 403, "DEVICE_ACCESS_DENIED"), ("gate", 403, "CONTRACT_NOT_APPROVED"),
    ("unavailable", 500, "AUTHORIZATION_UNAVAILABLE")])
def test_auth_fail_closed_no_retry(label, status, reason, caplog):
    caplog.set_level(logging.DEBUG)
    async def scenario():
        fixture = BackendFixture()
        fixture.overrides["/internal/devices/authorize"] = httpx.Response(status, json={"allowed": False, "reason": reason})
        async with client(fixture) as api:
            with pytest.raises(BackendError) as error:
                await authorize_device(api, PROOF, context())
            assert error.value.status == status and error.value.reason == reason
            assert len(fixture.calls) == 1
    asyncio.run(scenario())
    assert "D" * 43 not in caplog.text and "A" * 43 not in caplog.text


@pytest.mark.parametrize("body", [AUTH | {"allowed": False}, AUTH | {"allowed": 1},
    AUTH | {"deviceId": 42}, AUTH | {"ownerUserId": "0"}, AUTH | {"unexpected": "SECRET"}])
def test_bad_auth_response_is_not_a_session(body):
    async def scenario():
        fixture = BackendFixture()
        fixture.overrides["/internal/devices/authorize"] = httpx.Response(200, json=body)
        async with client(fixture) as api:
            with pytest.raises(BackendError, match="backend_invalid_response"):
                await authorize_device(api, PROOF, context())
    asyncio.run(scenario())


def test_wrong_expected_device_and_wrong_resolved_user():
    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            with pytest.raises(BackendError, match="identity_mismatch"):
                await authorize_device(api, PROOF, context(), expected_device_id="99")
            session = await authorize_device(api, PROOF, context())
            fixture.overrides["/internal/ai/resolve-config"] = httpx.Response(200, json=CONFIG | {"userId": "99"})
            with pytest.raises(BackendError, match="identity_mismatch"):
                await session.resolve(context())
            assert not session.valid
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["timeout", "network", "cancel"])
def test_timeout_network_cancel_do_not_retry(mode):
    async def scenario():
        fixture = BackendFixture()
        started = asyncio.Event()
        async def fail(request):
            started.set()
            if mode == "network":
                raise httpx.ConnectError("SECRET", request=request)
            await asyncio.Event().wait()
        fixture.overrides["/internal/devices/authorize"] = fail
        async with client(fixture, timeout=.03 if mode == "timeout" else 1) as api:
            ctx = context()
            task = asyncio.create_task(api.authorize(PROOF, ctx))
            await started.wait()
            if mode == "cancel":
                ctx.cancel()
            expected = {"timeout": "backend_timeout", "network": "backend_network_error", "cancel": "backend_cancelled"}[mode]
            with pytest.raises(BackendError, match=expected):
                await task
            assert len(fixture.calls) == 1
    asyncio.run(scenario())


@pytest.mark.parametrize("response", [httpx.Response(200, text="not JSON"),
    httpx.Response(200, content=b'{"allowed":true,"allowed":false}', headers={"content-type": "application/json"}),
    httpx.Response(200, json={"secret": "x" * 9000}), httpx.Response(302, headers={"location": "https://other.invalid"})])
def test_malformed_oversized_or_redirect_is_rejected(response):
    async def scenario():
        fixture = BackendFixture()
        fixture.overrides["/internal/devices/authorize"] = response
        async with client(fixture) as api:
            with pytest.raises(BackendError):
                await api.authorize(PROOF, context())
            assert len(fixture.calls) == 1
    asyncio.run(scenario())


def test_heartbeat_server_timestamp_binding_and_cleanup():
    class BoundOrchestrator:
        turn = type("Turn", (), {"turn_id": "turn"})()
        def __init__(self, key):
            self.key, self.commands = key, []
        async def control(self, command, **kwargs):
            self.commands.append(command.value)
    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            session = await authorize_device(api, PROOF, context())
            bound = BoundOrchestrator(session.key)
            session.bind(bound)
            await session.heartbeat_received(context(), telemetry=dto.Telemetry(wifiRssi=-65),
                received_at=datetime(2026, 11, 3, 1, 0, 0, 123, tzinfo=timezone.utc))
            body = json.loads(fixture.calls[-1].content)
            assert body["observedAt"] == "2026-11-03T01:00:00Z"
            assert body["telemetry"] == {"wifiRssi": -65}
            fixture.overrides["/internal/devices/heartbeat"] = httpx.Response(401, json={"reason": "DEVICE_UNAUTHORIZED"})
            with pytest.raises(BackendError):
                await session.heartbeat_received(context())
            assert not session.valid and bound.commands == ["REVOKE"]
    asyncio.run(scenario())


@pytest.mark.parametrize("values", [{"wifiRssi": 1}, {"batteryPercent": 101}, {"freeHeapBytes": "-1"},
    {"payload": {"secret": "invalid"}}, {"wifiRssi": True}])
def test_invalid_telemetry(values):
    with pytest.raises(ValidationError):
        dto.Telemetry(**values)


async def prepared(api):
    session = await authorize_device(api, PROOF, context())
    await session.resolve(context())
    return session


def request(session, turn="turn"):
    return LLMRequest(session.key, turn, "Chào.", session.config.profile.systemPrompt, (), LLMSettings(model=session.config.model.modelCode))


@pytest.mark.parametrize("status", ["success", "failed", "cancelled"])
def test_usage_reporting_coalesces_and_rejects_conflict(status):
    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            reporter = UsageReporter(api, max_entries=3)
            report = dto.UsageReport(requestId="request_1234567890", providerId="2", status=status, inputTokens=10, outputTokens=2, durationMs=20)
            a, b = await asyncio.gather(reporter.submit(report, context()), reporter.submit(report, context()))
            assert a == b and not reporter.pending
            assert sum(r.url.path == "/internal/ai/usage" for r in fixture.calls) == 1
            with pytest.raises(BackendError, match="usage_report_conflict"):
                await reporter.submit(report.model_copy(update={"durationMs": 21}), context())
    asyncio.run(scenario())


def test_quota_before_mock_execution_config_binding_and_actual_usage():
    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            session = await prepared(api)
            mock = MockLLMAdapter((ProviderDelta("Chào."), ProviderDone(True, "completed", Usage(10, 2, 12))))
            reporter = UsageReporter(api, max_entries=3)
            adapter = QuotaLLMAdapter(mock, session, reporter, mock_only=True, max_total_tokens="1000", report_context_factory=context)
            events = [e async for e in adapter.stream(request(session), context())]
            assert events[-1].usage.total_tokens == 12 and len(mock.requests) == 1
            assert fixture.calls[-2].url.path == "/internal/ai/authorize-request" and fixture.calls[-1].url.path == "/internal/ai/usage"
            admission = json.loads(fixture.calls[-2].content)
            assert admission["userId"] == "7" and admission["deviceId"] == "42"
            assert "sessionId" not in admission  # Internal UUID is NOT a DB session ID.
            assert fixture.calls[-1].headers["authorization"] == "Bearer " + "C" * 43
            assert not reporter.pending
            with pytest.raises(BackendError, match="duplicate_execution"):
                await anext(adapter.stream(request(session), context()))
    asyncio.run(scenario())


@pytest.mark.parametrize("mode", ["deny", "replay", "live", "disabled_provider"])
def test_no_provider_execution_on_quota_or_config_or_live_block(mode):
    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            if mode == "disabled_provider":
                session = await authorize_device(api, PROOF, context())
                fixture.overrides["/internal/ai/resolve-config"] = httpx.Response(403, json={"message": "PROVIDER_UNAVAILABLE"})
                with pytest.raises(BackendError):
                    await session.resolve(context())
                assert not session.valid
                return
            session = await prepared(api)
            if mode == "deny":
                fixture.overrides["/internal/ai/authorize-request"] = httpx.Response(429, json={"allowed": False, "reason": "QUOTA_EXCEEDED"})
            if mode == "replay":
                async def replay(req):
                    body = json.loads(req.content)
                    return httpx.Response(200, json={"allowed": False, "requestId": body["requestId"], "providerId": "2",
                        "replayed": True, "executionAllowed": False, "state": "ADMITTED", "reason": "REQUEST_ALREADY_ADMITTED"})
                fixture.overrides["/internal/ai/authorize-request"] = replay
            mock = MockLLMAdapter((ProviderDone(True, "completed"),))
            adapter = QuotaLLMAdapter(mock, session, UsageReporter(api, max_entries=3), mock_only=mode != "live",
                                     max_total_tokens=None, report_context_factory=context)
            with pytest.raises(BackendError):
                await anext(adapter.stream(request(session), context()))
            assert not mock.requests and all(r.url.path != "/internal/ai/usage" for r in fixture.calls)
    asyncio.run(scenario())


def test_unknown_usage_on_cancel_is_pending_not_zero():
    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            session = await prepared(api)
            mock = MockLLMAdapter((ProviderDelta("Chào."), ProviderDone(True, "completed")), delay_seconds=.01)
            reporter = UsageReporter(api, max_entries=3)
            adapter = QuotaLLMAdapter(mock, session, reporter, mock_only=True, max_total_tokens=None, report_context_factory=context)
            stream = adapter.stream(request(session), context())
            assert isinstance(await anext(stream), ProviderDelta)
            await stream.aclose()
            assert len(reporter.pending) == 1 and mock.released == 1
            assert all(r.url.path != "/internal/ai/usage" for r in fixture.calls)
    asyncio.run(scenario())


def test_prepared_admission_without_llm_execution_settles_cancelled_zero_once():
    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            session = await prepared(api)
            reporter = UsageReporter(api, max_entries=3)
            adapter = QuotaLLMAdapter(MockLLMAdapter(()), session, reporter, mock_only=True,
                max_total_tokens="1000", report_context_factory=context)
            await adapter.prepare("empty-audio-turn", context())
            assert await adapter.settle_unused("empty-audio-turn") is True
            assert await adapter.settle_unused("empty-audio-turn") is False
            report = [json.loads(r.content) for r in fixture.calls if r.url.path == "/internal/ai/usage"]
            assert len(report) == 1
            assert report[0]["status"] == "cancelled"
            assert report[0]["inputTokens"] == report[0]["outputTokens"] == 0
            assert not reporter.pending
    asyncio.run(scenario())


@pytest.mark.parametrize("url", ["http://example.com", "https://user:secret@backend.invalid", "https://backend.invalid/path", "https://backend.invalid?token=bad"])
def test_secure_origin_required(url):
    with pytest.raises(ValueError):
        BackendClient(url, TOKENS, ClientLimits(1, 2, 1024))


@pytest.mark.parametrize("status", ["success", "failed", "cancelled"])
def test_quota_wrapper_settles_known_usage_after_completion_or_cancel(status):
    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            session = await prepared(api)
            mock = MockLLMAdapter((ProviderDone(status == "success", "completed" if status == "success" else "incomplete", Usage(3, 2, 5)),))
            reporter = UsageReporter(api, max_entries=3)
            adapter = QuotaLLMAdapter(mock, session, reporter, mock_only=True, max_total_tokens=None, report_context_factory=context)
            ctx = context()
            stream = adapter.stream(request(session), ctx)
            await anext(stream)  # Provider supplied actual usage, so settlement is possible.
            if status == "cancelled":
                ctx.cancel()
                await stream.aclose()
            else:
                with pytest.raises(StopAsyncIteration):
                    await anext(stream)
            reports = [json.loads(r.content) for r in fixture.calls if r.url.path == "/internal/ai/usage"]
            assert len(reports) == 1 and reports[0]["status"] == status
            assert reports[0]["inputTokens"] == 3 and reports[0]["outputTokens"] == 2
    asyncio.run(scenario())


def test_real_tcp_connection_reuse_and_cleanup():
    async def scenario():
        connections, requests, tasks = [], [], set()
        async def handle(reader, writer):
            task = asyncio.current_task()
            tasks.add(task)
            connections.append(writer)
            try:
                while True:
                    try:
                        headers = await reader.readuntil(b"\r\n\r\n")
                    except asyncio.IncompleteReadError:
                        return
                    rows = headers.decode().split("\r\n")
                    fields = dict(row.split(": ", 1) for row in rows[1:] if ": " in row)
                    body = await reader.readexactly(int(fields.get("Content-Length", fields.get("content-length", "0"))))
                    requests.append((rows[0], json.loads(body)))
                    data = json.dumps(AUTH).encode()
                    writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + str(len(data)).encode() + b"\r\nConnection: keep-alive\r\n\r\n" + data)
                    await writer.drain()
            finally:
                writer.close()
                await writer.wait_closed()
                tasks.discard(task)
        server = await asyncio.start_server(handle, "127.0.0.1", 0)
        try:
            port = server.sockets[0].getsockname()[1]
            async with BackendClient(f"http://127.0.0.1:{port}", TOKENS, ClientLimits(1, 2, 2048), allow_local_http=True) as api:
                await api.authorize(PROOF, context())
                await api.authorize(PROOF, context())
            assert len(connections) == 1 and len(requests) == 2
            assert requests[0][0] == "POST /internal/devices/authorize HTTP/1.1"
            assert requests[0][1]["credential"] == "D" * 43
        finally:
            server.close()
            await server.wait_closed()
            for task in tuple(tasks):
                task.cancel()
            await asyncio.gather(*tuple(tasks), return_exceptions=True)
    asyncio.run(scenario())


def test_backend_to_orchestrator_mock_e2e_and_revocation():
    from app.models.audio import AudioMetadata, AudioFrame
    from app.models.tts import AudioFormat, TTSConfig, PlaybackLimits
    from app.services.llm import LLMRunner
    from app.services.mock_stt import MockStreamingSTT
    from app.services.mock_tts import MockTTS, MockAudioOutput
    from app.services.orchestrator import AIOrchestrator, OrchestrationLimits, SessionState
    from app.services.turn_detection import TurnDetectionConfig, TextRules

    async def scenario():
        fixture = BackendFixture()
        async with client(fixture) as api:
            session = await prepared(api)
            stt, output, now = MockStreamingSTT("Chào."), MockAudioOutput(), [0]
            reporter = UsageReporter(api, max_entries=3)
            delegate = MockLLMAdapter((ProviderDelta("Xin chào."), ProviderDone(True, "completed", Usage(10, 2, 12))))
            llm = QuotaLLMAdapter(delegate, session, reporter, mock_only=True, max_total_tokens="1000", report_context_factory=context)
            cfg = session.config
            orch = AIOrchestrator(session.key, stt=stt, llm=llm, tts=MockTTS(((b"ab",),)), output=output,
                llm_runner=LLMRunner(LLMSettings(model=cfg.model.modelCode)), input_metadata=AudioMetadata("opus", 16000, 1, 60),
                turn_config=TurnDetectionConfig(700, 300, 15000), language_rules=TextRules((".",), ()),
                speech_activity=lambda frame: frame.payload == b"speech",
                tts_config=TTSConfig("mock-model", cfg.profile.voiceCode, cfg.profile.languageCode,
                    AudioFormat(AudioMetadata("pcm", 8000, 1, 10, "s16le"), "raw")),
                playback_limits=PlaybackLimits(2, 8, 4, 2, 500, 3),
                limits=OrchestrationLimits(2, .005, 4, 20, 3, 10000), system_prompt=cfg.profile.systemPrompt, clock_ms=lambda: now[0])
            session.bind(orch)
            task = session.start_turn("turn")
            session.microphone("turn", AudioFrame(b"speech"))
            await stt.partial_ready.wait()
            now[0] = 100
            session.microphone("turn", AudioFrame(b"quiet"))
            now[0] = 800
            orch.tick()
            await asyncio.wait_for(output.finished.wait(), 1)
            assert orch.state == SessionState.SPEAKING
            assert not orch.microphone("turn", AudioFrame(b"blocked"))
            assert len(delegate.requests) == 1 and not reporter.pending
            # Recheck denies while waiting for real playback evidence: stop pipeline.
            fixture.overrides["/internal/devices/heartbeat"] = httpx.Response(401, json={"reason": "DEVICE_UNAUTHORIZED"})
            with pytest.raises(BackendError):
                await session.heartbeat_received(context())
            outcome = await task
            assert outcome.state == SessionState.CLOSED and not outcome.receipt
            assert output.aborted and orch.playback.queue.bytes == 0
            assert not session.microphone("turn", AudioFrame(b"late"))
            with pytest.raises(BackendError, match="identity_mismatch"):
                session.start_turn("new")
            assert sum(r.url.path == "/internal/ai/usage" for r in fixture.calls) == 1
    asyncio.run(scenario())


def test_two_authorized_devices_are_bound_to_different_backend_users():
    async def scenario():
        fixture = BackendFixture()
        async def auth(req):
            uid = json.loads(req.content)["deviceUid"]
            return httpx.Response(200, json=AUTH if uid == "robot-42" else {"allowed": True, "deviceId": "43", "ownerUserId": "8"})
        async def config(req):
            uid = json.loads(req.content)["userId"]
            return httpx.Response(200, json=CONFIG | {"userId": uid})
        fixture.overrides["/internal/devices/authorize"] = auth
        fixture.overrides["/internal/ai/resolve-config"] = config
        async with client(fixture) as api:
            a, b = await asyncio.gather(authorize_device(api, PROOF, context()),
                authorize_device(api, dto.DeviceProof(deviceUid="robot-43", credential=SecretStr("E"*43)), context()))
            await asyncio.gather(a.resolve(context()), b.resolve(context()))
            assert (a.key.user_id, a.key.device_id) == ("7", "42")
            assert (b.key.user_id, b.key.device_id) == ("8", "43")
            assert a.key.session_id != b.key.session_id and a.config.userId != b.config.userId
    asyncio.run(scenario())
