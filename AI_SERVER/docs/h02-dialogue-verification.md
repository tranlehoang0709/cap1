# H-02 verification — 2026-11-15

Source audit found that the analyze route already retained pending dialogue in
LocalChatSessions keyed by user/session. Revision checks, bounded RAM TTL,
per-session concurrent-request rejection, workflow creation/revision, dependency
preservation, cancellation and repeated-confirmation handling already existed.
These implementations were retained.

Changes are confined to dialogue handling, its tests, a dedicated live probe and
AI_SERVER documentation. No Backend, DB, other service implementation, shared
server restart or Git commit was performed.

Added memory update mode selection (replace/append), required exact proposed
content, target/topic clarification and explicit unavailable-before readback.
Memory update/delete cannot be confirmed without verified Backend target data.
The dialogue remains BLOCKED/MEMORY_LOOKUP_NOT_IMPLEMENTED. Memory creation
reads back its proposal and waits for consent, then remains blocked by the
existing trusted privacy-review gate. No tool execution is dispatched.

Important uncertain information requires restatement. Bare twelve-hour times
cannot inherit a model's assumed morning/evening. Existing memory policy/issue
metadata is consumed without changing the memory understanding implementation.
Tool planning receives dialogue_ready only for a complete confirmation proposal
or a ready dialogue.

## Automated regression

Executed with `.venv-win/Scripts/python.exe -m pytest`:

- `tests/test_pa_dialogue.py`
- `tests/test_pa_tools.py`
- `tests/test_pa_workflow.py`
- `tests/test_pa_understanding.py`
- `tests/test_pa_integration.py`
- `tests/test_pa_execution.py`

Final result: **158 passed**. These tests include scripted model outputs; they
are separate from live verification below.

## Real Gemma

Probe: `scripts/test_h02_gemma_live.py`, current analyze source mounted through
ASGITransport, real configured llama.cpp HTTP adapter, authenticated requests.
Model discovery: `ggml-org/gemma-4-e4b-it-GGUF:Q4_0`.

| Case | Result |
|---|---|
| Tạo lịch học ngày mai → Từ 7 đến 9 giờ tối → Đúng rồi | PASS |
| Repeated confirmation, same workflow and dialogue revision | PASS |
| Correct start to 20:00, revoke consent, cancel | PASS |
| Preference memory readback and confirmation | PASS |
| Memory update, choose replace, clarify target, attempt confirmation | PASS |
| Delete memory topic, attempt confirmation | PASS |
| Two independent sessions, resume original schedule | PASS |

The first combined run exposed a model misclassification of a mode-selection
answer. The dialogue now handles an exact replace/append answer for a single
pending memory update. A focused rerun exposed a missing target: the probe now
answers the dialogue's target clarification before confirmation. The final
focused memory-update run passed; the other cases passed in the combined run.
The probe supports `--case memory_update` for focused reruns.

Every response checked `executed=false`. Schedule workflow status was BLOCKED;
memory update/delete confirmation stayed UNCONFIRMED because real target lookup
is unavailable. These PASS results validate safe dialogue behavior, not actual
Backend persistence or successful memory mutation. Exact stored before/after
confirmation remains blocked until authenticated Backend memory lookup exists.
Pending state remains process-local and expires on TTL/restart; it is not a
distributed or durable store. Voice and /local/chat are separate integrations.
