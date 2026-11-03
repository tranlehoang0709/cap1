"""Mock-only quota bridge until Cloud secret delivery and execution budgets are approved."""

import asyncio
import sys
import time
from uuid import uuid4

from app.clients.backend import BackendCode, BackendError
from app.models import backend as dto
from app.models.audio import AudioError, ErrorCode, positive_int
from app.models.llm import LLMError, LLMErrorCode, ProviderDone
from app.services.mock_llm import MockLLMAdapter
from app.services.user_rate_limit import UserRateLimit


class UsageReporter:
    """Bounded, in-memory, coalesced reports. NOT a durable accounting outbox.

    Ambiguous failure/cancel is retained: no blind automatic resend. Backend
    does support identical report idempotency, for explicit reconciliation.
    """
    def __init__(self, client, *, max_entries: int):
        if not positive_int(max_entries):
            raise ValueError("Explicit report retention bound required")
        self.client, self.max_entries = client, max_entries
        self._entries = {}
        self.pending = set()
        self.rate_limit = UserRateLimit()

    def reserve(self, request_id):
        if request_id in self._entries:
            raise BackendError(BackendCode.DUPLICATE)
        if len(self._entries) >= self.max_entries:
            raise BackendError(BackendCode.LIMIT)
        self._entries[request_id] = (None, None)
        self.pending.add(request_id)

    async def submit(self, report: dto.UsageReport, context):
        if report.requestId not in self._entries:
            self.reserve(report.requestId)
        previous, task = self._entries[report.requestId]
        if previous is not None:
            if previous != report:
                raise BackendError(BackendCode.CONFLICT)
            return await asyncio.shield(task)
        # Record immutable body BEFORE scheduling HTTP; concurrent duplicates coalesce.
        task = asyncio.create_task(self.client.report_usage(report, context))
        self._entries[report.requestId] = (report, task)
        try:
            result = await task
            self.pending.discard(report.requestId)
            return result
        except BaseException:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise


class QuotaLLMAdapter:
    """Wrapper usable with mock Backend/LLM only. No secret broker exists yet.

    Config determines exact model/prompt. No provider/model/key fallback.
    No DB ai_sessions endpoint exists; opaque internal session UUID is NOT sent
    as Backend sessionId (which requires a persisted canonical BIGINT).
    """
    def __init__(self, delegate, session, reporter: UsageReporter, *, mock_only: bool,
                 max_total_tokens: str | None, report_context_factory):
        self.delegate, self.session, self.reporter = delegate, session, reporter
        self.mock_only, self.budget, self.report_context_factory = mock_only, max_total_tokens, report_context_factory
        if max_total_tokens is not None:
            dto.bigint(max_total_tokens)
        self._attempted = set()

    async def stream(self, request, context):
        session, config = self.session, self.session.config
        if self.mock_only is not True or not isinstance(self.delegate, MockLLMAdapter):
            raise BackendError(BackendCode.BLOCKED)  # No live bypass via constructor key.
        if (not session.valid or config is None or request.key != session.key
            or request.config.model != config.model.modelCode or request.system_prompt != config.profile.systemPrompt):
            raise BackendError(BackendCode.BINDING)
        if request.turn_id in self._attempted:
            raise BackendError(BackendCode.DUPLICATE)
        request_id = str(uuid4())
        self.reporter.rate_limit.claim(session.key.user_id)
        self.reporter.reserve(request_id)  # Bound attempts before side effects.
        self._attempted.add(request.turn_id)
        admission = await session.client.admit(dto.Admission(requestId=request_id,
            userId=session.key.user_id, deviceId=session.key.device_id,
            providerId=config.provider.id, modelId=config.model.id, maxTotalTokens=self.budget), context)
        if not admission.allowed or not admission.executionAllowed:
            raise BackendError(BackendCode.DUPLICATE)
        if admission.reservedTokens != self.budget:
            raise BackendError(BackendCode.BINDING)
        stream = None
        usage = None
        status = "failed"
        started = time.monotonic()
        try:
            stream = self.delegate.stream(request, context)
            async for event in stream:
                context.check()
                if isinstance(event, ProviderDone):
                    usage = event.usage
                    status = "success" if event.complete else "failed"
                yield event
        finally:
            exc = sys.exc_info()[1]
            if (isinstance(exc, asyncio.CancelledError)
                or isinstance(exc, AudioError) and exc.code == ErrorCode.CANCELLED
                or isinstance(exc, LLMError) and exc.code == LLMErrorCode.CANCELLED):
                status = "cancelled"
            elif exc is not None:
                status = "failed"
            try:
                context.check()
            except AudioError as error:
                status = "cancelled" if error.code == ErrorCode.CANCELLED else "failed"
            try:
                if stream is not None:
                    await stream.aclose()
            finally:
                # Unknown usage MUST stay pending; never invent zero actuals.
                if usage is not None:
                    await self.reporter.submit(dto.UsageReport(requestId=request_id, providerId=config.provider.id,
                        status=status, inputTokens=usage.input_tokens, outputTokens=usage.output_tokens,
                        durationMs=int((time.monotonic() - started) * 1000)),
                        self.report_context_factory())
