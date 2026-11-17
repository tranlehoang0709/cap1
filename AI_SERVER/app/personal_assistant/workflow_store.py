"""Bounded process-local workflow retention and one active writer per workflow."""
import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
import time
import math

from app.personal_assistant.workflow_schema import Workflow, mark_cancelled


@dataclass
class _Entry:
    workflow: Workflow
    expires: float
    busy: bool = False


class WorkflowStore:
    def __init__(self, *, max_workflows=32, ttl_seconds=3600, max_chars=1_000_000, clock=time.monotonic):
        if max_workflows < 1 or not math.isfinite(ttl_seconds) or ttl_seconds <= 0 or max_chars < 4096:
            raise ValueError('Invalid workflow retention budget')
        self.max_workflows, self.ttl_seconds, self.max_chars = max_workflows, ttl_seconds, max_chars
        self._clock = clock
        self._entries = {}
        self._lock = asyncio.Lock()

    def _prune(self):
        now = self._clock()
        expired = [key for key, value in self._entries.items() if not value.busy and value.expires <= now]
        for key in expired:
            del self._entries[key]
        return len(expired)

    def _entry(self, workflow_id, context):
        self._prune()
        entry = self._entries.get(workflow_id)
        if entry is None:
            raise KeyError('Workflow not found or expired')
        wf = entry.workflow
        if (wf.user_id, wf.session_id, wf.correlation_id) != (context.user_id, context.session_id, context.correlation_id):
            raise PermissionError('Workflow owner/session/correlation mismatch')
        return entry

    async def create(self, workflow):
        async with self._lock:
            self._prune()
            for entry in self._entries.values():
                old = entry.workflow
                if (old.user_id, old.session_id, old.correlation_id) == (workflow.user_id, workflow.session_id, workflow.correlation_id):
                    if old.plan_fingerprint != workflow.plan_fingerprint:
                        raise ValueError('Use explicit revision for an existing proposal')
                    return old.model_copy(deep=True)
            if len(self._entries) >= self.max_workflows:
                raise ValueError('Workflow capacity reached')
            if len(workflow.model_dump_json()) + len(workflow.steps) * 2048 > self.max_chars:
                raise ValueError('Workflow state budget reached')
            self._entries[workflow.id] = _Entry(workflow.model_copy(deep=True), self._clock() + self.ttl_seconds)
            return workflow.model_copy(deep=True)

    async def get(self, workflow_id, context):
        async with self._lock:
            return self._entry(workflow_id, context).workflow.model_copy(deep=True)

    async def cleanup(self):
        async with self._lock:
            return self._prune()

    async def _publish(self, workflow):
        async with self._lock:
            entry = self._entries[workflow.id]
            workflow.cancel_requested |= entry.workflow.cancel_requested
            if workflow.cancel_requested and workflow.state == 'COMPLETED':
                mark_cancelled(workflow)
            entry.workflow = workflow.model_copy(deep=True)
            entry.expires = self._clock() + self.ttl_seconds

    async def request_cancel(self, workflow_id, context):
        async with self._lock:
            entry = self._entry(workflow_id, context)
            if entry.workflow.state in ('COMPLETED', 'CANCELLED'):
                return entry.workflow.model_copy(deep=True)
            entry.workflow.cancel_requested = True
            if not entry.busy:
                mark_cancelled(entry.workflow)
            return entry.workflow.model_copy(deep=True)

    @asynccontextmanager
    async def edit(self, workflow_id, context):
        async with self._lock:
            entry = self._entry(workflow_id, context)
            if entry.busy:
                raise RuntimeError('WORKFLOW_BUSY')
            entry.busy = True
            working = entry.workflow.model_copy(deep=True)
        try:
            yield working
        except BaseException:
            raise
        else:
            await self._publish(working)
        finally:
            async with self._lock:
                entry.busy = False
