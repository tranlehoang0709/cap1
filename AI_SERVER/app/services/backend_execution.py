"""Quota admission and usage settlement for isolated mocks or authenticated Gemini."""

import asyncio
import sys
import time
from uuid import uuid4

from app.clients.backend import BackendCode, BackendError
from app.models import backend as dto
from app.models.audio import AudioError, ErrorCode, positive_int
from app.models.llm import LLMError, LLMErrorCode, ProviderDone
from app.services.mock_llm import MockLLMAdapter
from app.clients.gemini_llm import GeminiLLMAdapter
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
    """Quota wrapper for explicitly isolated mocks or BE-authenticated Gemini.

    Live requests bind the delivered credential to admission's credential ID,
    use persisted BE conversation/session IDs, and settle provider actual usage.
    Unknown usage remains pending; it is never replaced by estimated zeroes.
    """
    def __init__(self, delegate, session, reporter: UsageReporter, *, mock_only: bool,
                 max_total_tokens: str | None, report_context_factory, execution_slots=None,
                 defer_turn_completion: bool = False, expected_system_prompt: str | None = None):
        self.delegate, self.session, self.reporter = delegate, session, reporter
        self.mock_only, self.budget, self.report_context_factory = mock_only, max_total_tokens, report_context_factory
        if max_total_tokens is not None:
            dto.bigint(max_total_tokens)
        self._attempted = set()
        self._provider_started = set()
        self._prepared = {}
        self._pending_completions = {}
        self.defer_turn_completion = defer_turn_completion
        self.expected_system_prompt = expected_system_prompt
        self.execution_slots = execution_slots

    def _validate_mode(self):
        config = self.session.config
        if self.mock_only is True and isinstance(self.delegate, MockLLMAdapter):
            return
        if (self.mock_only is not False or not isinstance(self.delegate, GeminiLLMAdapter)
                or config is None or config.provider.code != 'GEMINI' or not config.credential
                or not config.credential.get_secret_value().strip() or config.credentialReference is None
                or self.budget is None or int(self.budget) <= 0):
            raise BackendError(BackendCode.BLOCKED)

    async def prepare(self, turn_id, context):
        self._validate_mode()
        session, config = self.session, self.session.config
        if not session.valid or config is None or turn_id in self._prepared:
            raise BackendError(BackendCode.DUPLICATE)
        request_id = str(uuid4())
        self.reporter.rate_limit.claim(session.key.user_id)
        self.reporter.reserve(request_id)
        persisted = None
        if not self.mock_only:
            persisted = await session.client.start_turn(dto.TurnStart(userId=session.key.user_id,
                deviceId=None if session.key.device_id == 'web' else session.key.device_id,
                channel='web' if session.key.device_id == 'web' else 'robot'), context)
        admission = await session.client.admit(dto.Admission(requestId=request_id,
            userId=session.key.user_id, deviceId=None if session.key.device_id == 'web' else session.key.device_id,
            providerId=config.provider.id, modelId=config.model.id, maxTotalTokens=self.budget,
            sessionId=persisted.sessionId if persisted else None,
            conversationId=persisted.conversationId if persisted else None), context)
        if not admission.allowed or not admission.executionAllowed:
            raise BackendError(BackendCode.DUPLICATE)
        if admission.reservedTokens != self.budget:
            raise BackendError(BackendCode.BINDING)
        if not self.mock_only and admission.credentialId != config.credentialReference.id:
            # Rotation/revocation between resolve and admission must never cause
            # execution under a key different from the ledger credential.
            raise BackendError(BackendCode.BINDING)
        self._prepared[turn_id] = (request_id, persisted)
        return request_id

    async def settle_unused(self, turn_id):
        """Release a prepared admission only when no LLM call was attempted.

        This is used for empty/STT-failed/cancelled audio turns. Once the
        provider stream starts, usage may be ambiguous and must remain pending
        unless Gemini supplies actual usage.
        """
        if turn_id in self._provider_started:
            return False
        prepared = self._prepared.pop(turn_id, None)
        if prepared is None:
            return False
        request_id, _persisted = prepared
        await self.reporter.submit(dto.UsageReport(
            requestId=request_id, providerId=self.session.config.provider.id,
            status="cancelled", inputTokens=0, outputTokens=0,
            durationMs=0), self.report_context_factory())
        return True

    async def finish_turn(self, turn_id, *, played: bool):
        """Persist a completed answer only after the output sink confirms playback."""
        pending = self._pending_completions.pop(turn_id, None)
        self._prepared.pop(turn_id, None)
        if pending is None or not played or self.mock_only:
            return False
        session, persisted, request_id, transcript, answer = pending
        if persisted is None or not 0 < len(answer) <= 500:
            return False
        await session.client.complete_turn(dto.TurnComplete(userId=session.key.user_id,
            sessionId=persisted.sessionId, requestId=request_id,
            content=transcript, response=answer), self.report_context_factory())
        return True

    async def stream(self, request, context):
        session, config = self.session, self.session.config
        self._validate_mode()
        if (not session.valid or config is None or request.key != session.key
            or request.config.model != config.model.modelCode
            or request.system_prompt != (self.expected_system_prompt
                                          if self.expected_system_prompt is not None
                                          else config.profile.systemPrompt)):
            raise BackendError(BackendCode.BINDING)
        if request.turn_id in self._attempted:
            raise BackendError(BackendCode.DUPLICATE)
        if not self.mock_only and (len(request.system_prompt.encode()) + len(request.transcript.encode())
                + sum(len(m.text.encode()) for m in request.history) + request.config.max_output_tokens > int(self.budget)):
            raise BackendError(BackendCode.LIMIT)
        if request.turn_id not in self._prepared:
            await self.prepare(request.turn_id, context)
        request_id, persisted = self._prepared[request.turn_id]
        self._attempted.add(request.turn_id)
        stream = None
        acquired = False
        usage = None
        answer = ''
        status = "failed"
        started = time.monotonic()
        try:
            if not self.mock_only and self.execution_slots is not None:
                await context.run(self.execution_slots.acquire)
                acquired = True
            if not self.mock_only:
                input_tokens = await self.delegate.count_input_tokens(request, context)
                if input_tokens + request.config.max_output_tokens > int(self.budget):
                    raise BackendError(BackendCode.LIMIT)
            stream = self.delegate.stream(request, context)
            async for event in stream:
                self._provider_started.add(request.turn_id)
                context.check()
                if isinstance(event, ProviderDone):
                    usage = event.usage
                    status = "success" if event.complete else "failed"
                elif hasattr(event, 'text'):
                    answer = (answer + event.text)[:501]
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
                if acquired:
                    self.execution_slots.release()
                # Unknown usage MUST stay pending; never invent zero actuals.
                if usage is not None:
                    settled = await self.reporter.submit(dto.UsageReport(requestId=request_id, providerId=config.provider.id,
                        status=status, inputTokens=usage.input_tokens, outputTokens=usage.output_tokens,
                        durationMs=int((time.monotonic() - started) * 1000)),
                        self.report_context_factory())
                    if not self.mock_only:
                        if settled.budgetExceeded:
                            raise BackendError(BackendCode.LIMIT)
                        if status == 'success' and persisted and 0 < len(answer) <= 500:
                            if self.defer_turn_completion:
                                self._pending_completions[request.turn_id] = (
                                    session, persisted, request_id, request.transcript, answer)
                            else:
                                await session.client.complete_turn(dto.TurnComplete(userId=session.key.user_id,
                                    sessionId=persisted.sessionId, requestId=request_id,
                                    content=request.transcript, response=answer), self.report_context_factory())
                elif not self.mock_only and exc is None:
                    # Keep admission pending when Gemini supplied no actual usage.
                    raise BackendError(BackendCode.BLOCKED)
