# H-04 Group III workflow verification — 2026-11-15

Added `memory_workflow.py` as a memory-specific mixin on WorkflowOrchestrator.
Existing schedule/reminder expansion, conflict handling, dependency and ownership
guards, execution boundary and Backend receipt validation were retained.

Memory operations now retain proposal/policy, lookup, selected scope, mode,
revision-bound readback, consent and ACK stages in the existing WorkflowStore.
The memory-only H-02 dialogue syncs this state without executing tools. Update
and delete require records actually returned by authenticated `memory.query`;
caller-provided IDs or descriptions cannot substitute for current records.
Append/replace and multi-record deletion have explicit before/after/scope
previews. Changes invalidate consent. Successful lookup is preserved across
mode changes; successful writes cannot be replaced or replayed.

Prohibited storage content is checked before retention, including content and
source evidence. Prohibited proposals keep only a sanitized blocked operation.
Habit statements are proposals, never consent. Missing ACK, interrupted writes
and ACK target mismatches require reconciliation. No automatic write replay is
introduced. Query owner/digest mismatches are rejected without retaining the
foreign returned content in the workflow.

## Tests

`tests/test_pa_memory_workflow.py`: **18 passed**, covering:

- Readback required before consent; dependency-preserving save and valid ACK.
- Replace/append using verified before content and exact after content.
- Item/group deletion with explicit verified scope.
- Seven prohibited-data categories and sanitized retention.
- Recurring habit proposal without automatic storage.
- Stable workflow ID, revision changes and successful lookup retention.
- Repeated confirmation/run and partial-group completion without replay.
- Missing ACK and cancellation during a write requiring reconciliation.
- Lookup ownership mismatch without foreign-data retention.
- Unavailable Backend retaining BLOCKED with no executed tool result.

Final regression command:

```text
.venv-win/Scripts/python.exe -m pytest tests/test_pa_memory_workflow.py tests/test_pa_workflow.py tests/test_pa_dialogue.py tests/test_pa_tools.py tests/test_pa_execution.py tests/test_pa_integration.py -q -p no:cacheprovider
```

Result: **135 passed**. The new tests use explicitly scoped Backend fixtures;
they do not constitute live PA-04 persistence or ACK evidence. No live Backend
test was claimed. Production tools remain NOT_IMPLEMENTED and memory workflows
remain BLOCKED, with no executed mutation. The analyze response still carries
`executed=false`.

No Backend, DB, calendar/reminder implementation or HTTP binding was changed.
Mixed calendar/memory execution is not enabled. Pending memory workflow state
uses the existing process-local TTL/capacity and owner locking; it is not durable
across process restarts. Trusted application code must show readback output and
pass the matching revision before confirming; `/analyze` does not execute tools.
