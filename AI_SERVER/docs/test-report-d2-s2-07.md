# D2-S2-07 ? Gemini live LLM and token limits

## Implemented

- Added explicit `AI_SERVER_LLM_PROVIDER` selection via `provider_factory`; Gemini and OpenAI are selected without cross-provider fallback.
- Gemini streaming remains behind `LLMAdapter` and `LLMRunner`, uses conversation history, caller cancellation/deadline and existing `LLMSettings.max_output_tokens` ceiling, and returns actual Gemini usage metadata.
- Disabled automatic function calling in both Gemini adapter and smoke probe; no tools/function calling are used.
- Gemini HTTP 429 and 503 map to distinct safe error codes. SDK/network details are not exposed. SDK retries remain disabled (one attempt): no request idempotency contract exists to make billable generation retries safe.
- Added explicit standalone live diagnostic script. It requires `AI_SERVER_LLM_DEMO_ENABLE=true`, `AI_SERVER_BACKEND_MODE=development-mock`, and provider `gemini`; it refuses integrated mode and does not use MockLLM.
- Existing local sliding-window guard remains 12 requests/user/60 seconds within the mock-only quota bridge. It is not Backend quota admission. The integrated path remains fail-closed.

## Live Gemini diagnostic

Model: `gemini-3.5-flash-lite`. Three calls through `provider_factory -> GeminiLLMAdapter -> LLMRunner` returned real text and usage:

| Run | TTFT | Total | Input tokens | Output tokens | Total tokens |
|---|---:|---:|---:|---:|---:|
| 1 | 1747 ms | 1832 ms | 45 | 16 | 61 |
| 2 | 5140 ms | 5357 ms | 45 | 16 | 61 |
| 3 | 4855 ms | 4933 ms | 45 | 16 | 61 |

LIVE PASS applies only to the standalone Gemini LLM call. These runs did not use Backend auth, admission, usage reporting, robot audio or hardware. A prior diagnostic attempt returned network error; later calls succeeded. No Cloud/hardware pipeline PASS is claimed.

## Tests

- Focused: `112 passed` across Gemini adapter/config/smoke, Backend client and integration-mode, and LLM regression tests.
- Full suite: `392 passed, 18 failed`. Failures are existing firmware snapshot hash mismatch and robot/Opus tests, including unavailable `libopus` and legacy robot fixture behavior rejected by the current fail-closed path. No failure was in the focused Gemini adapter/Backend quota/LLM regression set.
- Live provider: 3/3 responses PASS. AFC warning is disabled in the request config.

## Not integrated / blocked

- Robot runtime does not call Gemini; `QuotaLLMAdapter` is deliberately mock-only. Backend policy schema/admission is not ready for live execution, credential brokering is absent, and usage reporting lacks a durable idempotent delivery path for ambiguous timeout/cancel.
- No safe automatic generation retry is enabled; 429/503 are classified and returned to caller.
- No changes to existing configured request/token/day/month policy values were made. Provider output remains capped by the current configured `LLMSettings.max_output_tokens`.
