# H-06 Group III personalization — 2026-11-15

Existing MEMORY_UNAVAILABLE fallback, consent/owner/receipt checks and the
read-only PA-05 service were retained. No Backend, database, memory schema or
PA-04 HTTP binding was changed. Undecided Group III items 10, 13 and 23 were not
assigned new business behavior.

## Changes

- Reuse H-01 prohibited-data checks for input, records and memory proposals.
  Sensitive current input is excluded from retained chat history and new pending
  state. Lack of memory.query permission prevents even calling the reader.
- Enforce Backend expires_at. Optional LOCAL_PA05_MAX_AGE_SECONDS requires a
  sufficiently recent updated_at; missing, old or future timestamps prompt for
  restatement. No default maximum age is invented. Expired values are withheld
  from review and generation, and a user confirmation cannot renew Backend data.
- Eligible consented records undergo bounded Gemma review for conflicting,
  uncertain or prohibited meaning. Failed review requires clarification.
- Group records using existing category values only. There is no new topic ID,
  table, hierarchy, repetition threshold or automatic memory write.
- Habit statements read back a proposal. Exact yes/no answers to a server-held,
  verbatim-grounded proposal preserve consent/refusal even if Gemma classifies
  the reply as ordinary chat. Unrelated assistant text cannot supply consent.
- Personalized local-chat update/delete turns retain H-02/H-04 pending state in
  their own claimed user/session store. They ask for replace/append and exact
  item/group scope. Real before/after confirmation remains blocked without
  verified Backend records. No workflow execution is called from chat.
- workflow_reply formats H-04 previews and exact changes after scoped ACKs,
  including partial changes. Missing ACK is never reported as success.
- A stable memory.changed event identity is prepared after verified changes.
  Website and Xiaozhi voice remain NOT_CONNECTED, sent=false. No notification
  transport, voice playback or hardware delivery was implemented or claimed.

## Automated checks

Final targeted/regression command:

```text
.venv-win/Scripts/python.exe -m pytest tests/test_personalization.py tests/test_personalization_group3.py tests/test_pa_memory_workflow.py tests/test_pa_dialogue.py tests/test_pa_workflow.py tests/test_pa_tools.py tests/test_pa_integration.py tests/test_pa_execution.py tests/test_local_chat.py -q -p no:cacheprovider
```

Result: **205 passed**. Tests cover all seven prohibited categories, consent and
read permission, configured age, expiry, conflicts, record grouping, update mode
and scope, session continuity, precise/partial ACK responses, missing ACK,
notification non-delivery, and the full chat input size budget. ACK tests use
contract-faithful fixtures and do not establish live PA-04 availability.

## Real Gemma

Probe: `scripts/test_h06_group3_gemma_live.py`, real llama.cpp HTTP adapter,
model `ggml-org/gemma-4-e4b-it-GGUF:Q4_0`, current in-process PA-05 service.
This does not restart or claim deployment of the shared server.

| Case | Result | Read source |
|---|---|---|
| Fallback MEMORY_UNAVAILABLE | PASS | No PA-04 API |
| Proposal → consent → refusal | PASS after focused rerun | No PA-04 API |
| Habit statement stays a proposal | PASS | No PA-04 API |
| Prohibited OTP candidate | PASS | No PA-04 API |
| Expired record withheld, ask again | PASS | Labelled read fixture |
| Configured age exceeded, ask again | PASS | Labelled read fixture |
| Record without consent withheld | PASS | Labelled read fixture |
| Contradictory preferences, ask again | PASS | Labelled read fixture |
| Update mode retained, repeated yes remains blocked | PASS | No PA-04 API |
| Delete scope confirmation remains blocked without records/ACK | PASS | No PA-04 API |

The first consent run exposed Gemma classifying an exact consent answer as
ordinary chat. The grounded yes/no handling above was added, with regression
tests, and the full proposal/consent/refusal sequence passed on a focused real
Gemma rerun. The standalone habit case also passed on that rerun.

Expiry, stale-age, unconsented and conflict cases combine **real Gemma** with
explicitly labelled synthetic scoped read data. They verify selection and
dialogue behavior, not authenticated live PA-04 retrieval or persistence.
Every live mutation attempt checked executed=false; Website/Xiaozhi delivery
also checked sent=false. Actual memory updates/deletes, live write ACKs and
notification/hardware E2E remain blocked by missing PA-04/channel bindings.
