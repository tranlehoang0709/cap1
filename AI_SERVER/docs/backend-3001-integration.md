> Historical original-workspace audit. The assembled checkout preserves newer main implementations. See [current handoff](../../HANDOFF.md) for selected files, test failures and live blockers; this historical report does not certify the current runtime.

# Backend 3001 integration audit — 2026-11-04

Status: **BLOCKED for authenticated end-to-end integration**.
Only AI_SERVER was modified. No Backend, frontend, firmware, database or running
process was modified. No Git pull/reset/merge/stage/commit/push was performed.

## Target and evidence

- AI_SERVER: `E:/captone_ai/repo/AI_SERVER`.
- Backend source: `E:/captone_be_fix/BE`; live URL `http://127.0.0.1:3001`.
- Live `GET /health`: HTTP 200, `{"status":"ok"}`.
- Live `GET /api/docs-json`: inspected routes below agree with this source.
- Live unauthenticated `POST /internal/devices/authorize` and
  `POST /web-chat/messages`, both with `{}` and no credentials: HTTP 401.
  These prove rejection of unauthenticated requests, not successful integration.
- Target BE `.env` contains none of the three AI service-token names or the
  device contract approval flag. No secret values were printed or copied.

## Actual contract versus existing AI client

All paths below use POST. The existing client remains unchanged: missing BE
routes cannot safely be replaced with unrelated user/admin endpoints.

| API | Existing AI_SERVER request | Target BE source / live Swagger | Result |
|---|---|---|---|
| Device authorization | `/internal/devices/authorize`: `deviceUid`, `credential`; device service token | Registered in `DevicesModule`, `InternalDeviceGuard`, `DeviceAuthorizationServiceAuth`; returns `allowed`, `deviceId`, `ownerUserId` | Contract present; authenticated live BLOCKED |
| Device heartbeat | `/internal/devices/heartbeat`: device proof, `observedAt`, optional telemetry | Internal route absent; `/devices/device/heartbeat` uses a different device-auth contract | BLOCKED for robot heartbeat |
| AI resolve-config | `/internal/ai/resolve-config`: `userId`, optional `deviceId`, `providerId`, `modelId`, `includeCredential` | `ai-providers.controller.ts` and service are empty; module has no controller | BLOCKED |
| Quota admission | `/internal/ai/authorize-request`: `requestId`, `userId`, `providerId`, `modelId`, optional device/session/conversation IDs, `maxTotalTokens` | `quotas.controller.ts` empty; module registers providers only | BLOCKED |
| Usage settlement | `/internal/ai/usage`: `requestId`, `providerId`, `status`, `inputTokens`, `outputTokens`, `durationMs` | Route absent | BLOCKED |
| Turn start | `/internal/ai/turns/start`: `userId`, optional `deviceId`, `channel` | Route absent | BLOCKED |
| Turn complete | `/internal/ai/turns/complete`: `userId`, `sessionId`, `requestId`, `content`, `response` | Route absent | BLOCKED |
| Web Chat | BE should call AI `/internal/web-chat` with `userId`, `providerId`, `content` and separate service token | BE `/web-chat/messages` accepts user JWT plus `content`, `provider_id`; `AiService.chat()` generates `[Mock ${p.name}] ...` locally | BLOCKED for real AI |

BE `/internal/ai/sessions`, PATCH `/internal/ai/sessions/:id` and
`/internal/usage` use ADMIN/JWT and snake_case DTOs. They are not replacements
for turn start/complete, quota admission or idempotent usage settlement.
The existing quota DTO helper functions alone do not expose HTTP endpoints.
BE's exception filter also discards structured `reason` from device guard
errors; the AI client still denies the response, but cannot recover its exact
reason. No security checks were weakened to accommodate this behavior.

## Configuration and preserved execution

Created ignored `.env` with `AI_SERVER_BACKEND_MODE=integrated`,
`AI_SERVER_BACKEND_URL=http://127.0.0.1:3001` and
`AI_SERVER_BACKEND_ALLOW_LOCAL_HTTP=true`. AI binds to loopback, reload is off,
and the private development robot route remains disabled. BackendClient already
limits HTTP opt-in to loopback, disables redirects and environment proxies,
bounds responses/timeouts and does not retry.

No tokens or API keys were generated. Integrated startup deliberately fails
until real, distinct device/config/quota tokens are provisioned:

| AI_SERVER setting | Matching Backend setting |
|---|---|
| `AI_SERVER_BACKEND_DEVICE_TOKEN` | `AI_DEVICE_SERVICE_TOKEN` |
| `AI_SERVER_BACKEND_CONFIG_TOKEN` | `AI_CONFIG_SERVICE_TOKEN` |
| `AI_SERVER_BACKEND_QUOTA_TOKEN` | `AI_QUOTA_SERVICE_TOKEN` |
| `AI_SERVER_LIVE_WEB_TOKEN` | BE must supply this credential when its Web Chat caller is implemented; no caller setting exists in current source |

The three Backend client tokens require distinct base64url values of 43–128
characters. Provision through an approved secret channel, not chat or reports.
Device authorization additionally requires BE `DEVICE_AUTH_CONTRACT_APPROVED=true`
under its owner's authorization, a real device credential and an active owner.
The orphaned config guard also expects `AI_CONFIG_CONTRACT_APPROVED=true`; enabling
a flag cannot create the absent controller/service implementation.

Resolved `.env.example` conflicts, removed duplicate settings, retained settings
actually consumed by existing source, and documented token mapping. Kept existing
provider/model examples without asserting their live availability. Integrated
Gemini LLM uses BE-resolved credentials, not a local diagnostic key.

Resolved the other existing conflict blocks in `app/core/config.py`,
`scripts/sd2_console.py`, `tests/conftest.py`, `tests/test_robot_gateway.py`,
`tests/test_sd2_console.py` and `AGENTS.md`. Retained TLS settings, per-device WSS
console support and test isolation; no Git merge command was used.
Added four checks for blank optional paths and preserved certificate/key paths.

Prepared execution remains the existing architecture:
authenticated BE Web Chat -> AI `/internal/web-chat` -> resolve-config -> turn
start -> quota admission -> Gemini -> actual usage settlement -> turn complete.
ESP32 `/ws/robot` requires WSS and device authorization/config before media,
per-turn admission, and scoped playback evidence. Missing BE APIs prevent these
flows from being accepted as live working integrations.

## Verification

Used existing `E:/captone_integrate/AI_SERVER/.venv/Scripts/python.exe`
(Python 3.12.14) read-only; no packages were installed into that environment.
The workspace has no local venv and the `python` WindowsApps alias is unusable.

- `python -m compileall -q app scripts tests`: PASS after conflict resolution.
- Focused `pytest tests/test_config.py tests/test_backend_client.py
  tests/test_backend_integration_mode.py -q`: **93 PASS**, one Starlette warning.
- Earlier expanded fixture run of those files plus
  `test_live_gemini_integration.py`, `test_live_robot_pipeline.py`,
  `test_lan_bootstrap.py`: **123 PASS, 3 FAIL** (before four new config checks).
  Failures: countTokens fixture expects only the base system prompt but source
  appends the server clock; native integrated robot round-trip disconnects; local
  WSS robot fixture receives an error instead of hello. A direct Opus constructor
  check confirms `CodecError: libopus unavailable` in this environment. No native
  audio/hardware PASS is claimed, and the timestamp assertion was not weakened.
- `test_lan_device.py` and `test_sd2_console.py`: collection BLOCKED by missing
  declared `pyserial`; the initially attempted gateway test selection was also
  interrupted during collection. Full suite not run.
- Initial collection without a test-only environment override failed because
  module-level `app=create_app()` loads integrated settings before pytest fixtures
  run. Subsequent fixture commands temporarily used process-only
  `AI_SERVER_BACKEND_MODE=development-mock` for collection, removed afterward;
  existing fixtures isolate settings and integrated-specific tests set their own
  doubles. This is **fixture evidence only**. The `.env` remains integrated.
- No live Gemini requests, successful authenticated BE requests, DB writes or
  ESP32 tests were performed. Live PASS is limited to health and auth rejection.

## Remaining work and recovery

BE owner must implement/register the missing config/quota/turn/heartbeat APIs
with their approved service guards, idempotency, privacy and response contracts,
and replace the local mock Web Chat path with the authenticated AI caller.
Any DB V1.5 changes are BLOCKED for this task; no working DB schema inspection,
migration or schema-readiness claim was made.

Then provision real service credentials, user/model/provider configuration,
quota policies and device proof. Configure a real TLS certificate, ESP32 trust
anchor and native libopus before LAN acceptance. Repeat authenticated API,
Web Chat, settlement and hardware tests only after these gates are ready.

Rollback is limited to this report, the added README/AGENTS audit notes, the new
ignored `.env`, the `.env.example` configuration and the listed conflict/test
edits. Review file diffs before selective rollback; preserve unrelated work.
Do not restore conflict markers into executable Python or use Git reset/merge.
