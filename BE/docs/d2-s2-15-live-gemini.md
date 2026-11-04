# D2-S2-15 — BE ↔ AI_SERVER Gemini integration

Date: 2026-11-04. Status: implementation connected; **LIVE acceptance BLOCKED**.
No firmware or frontend was changed. The existing additive quota migration was
applied after verifying need, passing isolated SQL tests, and confirming the
working ledger was empty, under D2-S2-15's conditional schema authorization.
A separate isolated MySQL test schema was retained for verification.
No Git commit/push was run.

## Root cause

1. BE already supports `includeCredential=true` on guarded
   `POST /internal/ai/resolve-config`, including decryption and ownership/scope
   checks. AI_SERVER's strict DTO/client previously did not accept this field.
2. `QuotaLLMAdapter` rejected every non-mock adapter. Web Chat always raised
   `AI_PIPELINE_UNAVAILABLE`; `/ws/robot` unconditionally closed on listen.start.
3. There was no integrated path binding persisted conversation/session IDs to
   admission, real Gemini actual usage, and final message persistence.
4. Deployment remains unready independently of those code changes: read-only
   inspection found 0/7 quota ledger columns, 0 enabled Gemini LLM models,
   0 active Gemini credentials belonging to verified active users, and disabled
   AI config/quota contract flags. The verified schema gap was subsequently
   fixed with the existing migration; models/credentials/gates remain unready.

## Implemented flow

Web: authenticated user → BE `/web-chat/messages` → service-authenticated
AI_SERVER `/internal/web-chat` → BE resolve-config with credential → start
conversation/session → quota admission → Gemini countTokens and generation →
BE actual usage settlement → idempotent message completion → public response.

Robot: explicit device UID/credential → BE device authorization AND secret-bearing
AI configuration before receiving audio → strict hello → manual listen.start →
fresh config/ownership check and quota admission → RAM-only Opus decode → Gemini
STT → quota-wrapped Gemini LLM → Gemini TTS → paced Opus playback with existing
playback proof. Disconnect invalidates/cancels the session. Reconnect gets a new
session, not a replay of an old provider execution. No firmware was modified.

The prior `/ws/dev-robot` remains a legacy development endpoint. Its integrated
branch is not used by `/ws/robot`; it does not become a mock fallback.

## API contract

| Route | Authentication / data | Result |
| --- | --- | --- |
| `POST BE /web-chat/messages` | User JWT; existing `{content, provider_id}` | `{content, conversation_id, usage:{input_tokens,output_tokens}}` |
| `POST AI_SERVER /internal/web-chat` | Separate `AI_SERVER_LIVE_WEB_TOKEN`; `{userId,providerId,content}` from BE | Same safe text/metadata; no credential |
| `POST BE /internal/ai/resolve-config` | Existing config service token + approved contract; optional `providerId`, `modelId`, `includeCredential:true` | Existing config plus decrypted `credential` only for internal execution |
| `POST BE /internal/ai/turns/start` | Config service token; `{userId,deviceId?,channel:"web"|"robot"}` | Persisted decimal-string `{conversationId,sessionId}` |
| `POST BE /internal/ai/authorize-request` | Existing quota service token; existing IDs/budget plus real session/conversation IDs | Existing admission plus `credentialId` selected for the ledger |
| `POST BE /internal/ai/usage` | Existing quota service token; real request/provider IDs, status, actual token counts/duration | Existing idempotent settlement response |
| `POST BE /internal/ai/turns/complete` | Config service token; `{userId,sessionId,requestId,content,response}` | `{conversationId,sessionId,saved}` after successful settled usage |
| `WS AI_SERVER /ws/robot` | Explicit provisioned proof; strict hello/session/heartbeat/playback | Integrated real-provider voice path; no mock fallback |

Only coordinated BE + AI_SERVER deployment should enable live requests: the
new live client requires admission's `credentialId` to match the delivered
`credentialReference.id`. If a key rotates between resolution and admission,
execution stops rather than charging one credential while using another.

## Credential and accounting behavior

- Internal config responses use `Cache-Control: no-store`. Python uses a
  repr-hidden, serialization-excluded `SecretStr`. There is no `.env` Gemini-key
  fallback. The same BE-selected Gemini key is used for voice adapters.
- BE's public response uses an explicit allowlist, including numeric usage
  fields, so extra internal fields cannot be forwarded to FE.
- The new BE→AI_SERVER service token was configured as a separate matching pair
  in the local ignored `.env` files. Existing AI provider keys, other service
  tokens and approval flags were preserved. No secret value was printed.
- 12 requests/user/sliding 60 s remains enforced by BE across providers/devices;
  the shared AI_SERVER limiter is an additional per-process check. Web and robot
  executions share the configured LLM concurrency limit (default 5).
- Existing generation limits remain unchanged: defaults 256 output tokens and
  500 output characters. Reservations are conservative input bounds plus the
  existing output cap; actual `count_tokens` is checked before generation. A
  request whose counted input + output cap exceeds its reservation is rejected.
  The Web reservation includes a small metadata margin, not extra output tokens.
- Actual accounting comes from Gemini usage metadata, including total output
  token counts. It is never computed from characters or audio duration. Unknown
  usage stays pending/report_missing; no fabricated zero report or blind retry.
- `usage_records.request_kind='LLM'` accounts LLM usage under the existing BE
  contract. STT/TTS do not fabricate LLM usage or new billing fields. Separate
  STT/TTS provider billing is not represented by the existing LLM-only ledger.
- Successful usage must be finalized for the exact user/session/conversation
  before messages can be written. Replaying identical completion does not add
  messages. With `save_history=0`, message content is not written; accounting
  and conversation/session metadata remain available.
- Usage settlement and message completion are separate bounded transactions.
  A failed completion is an error, not a successful Web response. The internal
  completion API is idempotent for explicit reconciliation. Failed/unexecuted
  turns can retain incomplete session metadata; no fake successful history is
  created. Reconnect does not automatically retry a failed provider request.

## Actual readiness / live checks

Read-only command `node scripts/check-d2s215-readiness.cjs` returned:

```text
Quota schema columns: 7 / 7
Active verified-user Gemini credentials: 0
Enabled Gemini LLM models: 0
AI_CONFIG_CONTRACT_APPROVED false
AI_QUOTA_CONTRACT_APPROVED false
```

The three existing BE service tokens match their AI_SERVER counterparts; only
presence/equality booleans were inspected. BE and AI_SERVER were started and
both returned health 200. Actual public Web Chat without JWT returned 401;
internal config with valid service proof but disabled contract returned 403;
internal Web Chat without service proof returned 401; WebSocket missing device
proof was denied. These are live negative-auth checks, **not Gemini LIVE PASS**.

No real Gemini request was sent: there is no valid ready BE model/credential
context in this environment. No conversation/messages/usage were fabricated in
the working MySQL database. Working-DB live persistence is **NOT VERIFIED**.

The legacy isolated runner initially reported `.env.test` missing. A new
explicit isolated-only runner then prepared
`aiva_iot_test_d2s215_6ed86f830acc`, using the existing fresh-install baseline
and quota migration only inside that new database. **2 actual MySQL tests PASS**:
real encrypted fixture-credential resolution, admission, usage settlement,
duplicate/conflicting usage, idempotent two-message persistence, and refusal to
persist an unsettled turn. Provider token values are synthetic fixtures here,
not live Gemini usage. At that stage only the isolated schema was modified;
working models/credentials were not provisioned.
The isolated DB is retained for review; its private connection file
`BE/.env.test.connection.json` matches the existing `.env.*` ignore pattern.
The working DB was then checked: **0 usage rows, 0 nonfinal rows**. Its prior
`SHOW CREATE TABLE usage_records` was saved privately at
`BE/.env.d2s215-usage-schema-before.sql`. After applying the existing additive
migration, BE `QuotasRepository.assertSchema()` validated all seven columns,
types/collations, unique request index and quota policy foreign key. The working
DB now has **7/7** columns; no usage rows were inserted.

The existing manual migration is
`BE/src/database/migrations/20261030_quota_admission.sql`. Its header states:
“Run once only after an explicit execution approval.” It can lock/rebuild and
auto-commit. That original header belongs to the earlier task. D2-S2-15 permits
schema work after need is verified; the checks and isolated test above satisfied
that condition before applying it. No new migration was invented or auto-run
at startup. No data/table/column was dropped.

## Windows CMD

Readiness (SELECT only):

```bat
cd /d E:\learn\AI_Project\cap1\BE
node scripts\check-d2s215-readiness.cjs
npm.cmd run build
npm.cmd run start
```

In a second CMD:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv\Scripts\python.exe -m pip install -r requirements-windows.txt
.venv\Scripts\python.exe scripts\setup_windows_audio.py
run_lan.cmd
```

Do not start duplicates if the current processes already occupy ports 3000/8000.
Current local settings use BE loopback port 3000, AI_SERVER bind 0.0.0.0:8000
and advertised `ws://192.168.0.104:8000/ws/robot`. Update the configured origin
when the LAN address changes. Firewall instructions remain in the D2-S2-14 guide.

Before live execution, deploy BE+AI_SERVER together, configure an enabled Gemini
model, a verified USER profile/system prompt, that user's valid encrypted
credential (or explicitly permitted SYSTEM scope), and a real quota policy.
Enable contract flags only after their prerequisites are met. Do not replace
these with fixture rows in the working database. Device proof and explicit VAD
energy threshold are additionally required for voice.

Set `BE/.env` `AI_SERVER_URL` and `AI_SERVER_WEB_TOKEN`; set the matching separate
`AI_SERVER_LIVE_WEB_TOKEN` in `AI_SERVER/.env`. The local pair is already set.
No provider key belongs in firmware, FE or a CMD argument.

After readiness, one explicit paid/live Web Chat request (JWT entered hidden):

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv\Scripts\python.exe scripts\test_d2s215_live.py --provider-id <GEMINI_PROVIDER_ID>
```

Use the returned conversation ID for a read-only persistence check:

```bat
cd /d E:\learn\AI_Project\cap1\BE
node scripts\check-d2s215-conversation.cjs <CONVERSATION_ID>
node scripts\run-mysql-integration.cjs --quota
```

The first command verifies completed session/conversation, expected user and
assistant message counts (or no content for disabled history), and settled
actual usage without printing transcripts or secrets. The integration runner
requires an explicitly preprovisioned isolated test DB and refuses the working DB.

The dedicated D2-S2-15 SQL tests can be repeated without touching the working DB:

```bat
cd /d E:\learn\AI_Project\cap1\BE
node scripts\run-d2s215-mysql.cjs
```

On a new environment only, `--prepare-isolated` creates a fresh uniquely named
test database and applies baseline/migration there; it refuses an existing
connection file. It never changes the working DB. No database is auto-dropped.

For authenticated WS control/reconnect:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv\Scripts\python.exe scripts\lan_device.py simulate --origin http://192.168.0.104:8000 --uid <BE_DEVICE_UID>
```

This control simulator does not prove real microphone/speaker/Gemini audio.
The current attached SD2 still runs the earlier dev-voice build; it has not been
changed by D2-S2-15. Full physical Wi-Fi voice acceptance remains separate.

## Files changed

- BE: `ai/ai.service.ts`, `ai-profiles/ai-profiles.controller.ts`,
  `ai-providers/ai-providers.service.ts`, `quotas/quotas.service.ts`.
- BE tests: new `test/live-chat.spec.ts`, updated async unavailable test in
  `test/ai.service.spec.ts`, credential delivery/cache tests in
  `test/ai-configuration.spec.ts` and `test/ai-http.spec.ts`.
- BE tools: `scripts/check-d2s215-readiness.cjs`,
  `scripts/check-d2s215-conversation.cjs`, `scripts/run-d2s215-mysql.cjs`,
  `jest.live-mysql.config.cjs`, `test/live-gemini.mysql.integration.ts`;
  `.env.example`, local ignored `.env` and isolated connection file,
  README, API contract and this report.
- AI_SERVER: `models/backend.py`, `clients/backend.py`, `clients/gemini_llm.py`,
  `services/device_auth.py`, `services/backend_execution.py`, new
  `services/live_gemini.py`, `services/live_robot.py`, `api/web_chat.py`,
  `core/live_config.py`, updated `api/lan_robot.py`, `main.py`,
  `core/backend_config.py`.
- AI_SERVER tools/config: new `scripts/test_d2s215_live.py`, updated
  `scripts/lan_device.py`, `scripts/run_lan.py`, `.env.example`, local ignored
  `.env`, README and AGENTS flow map.
- AI_SERVER tests: new `test_live_gemini_integration.py`,
  `test_live_robot_pipeline.py`; updated `test_lan_bootstrap.py`,
  `test_backend_integration_mode.py`, `conftest.py`.

Existing unrelated changes were preserved. No Git operations were performed.

## Executed verification results

| Check | Result |
| --- | --- |
| BE production build | PASS |
| Related BE suites (8 suites, final run) | 165 PASS |
| Final related AI_SERVER subset | 77 PASS |
| Dedicated actual MySQL tests, isolated DB | 2 PASS |
| Working ledger migration / schema validation | PASS: 7/7 columns, unique index/FK; prior ledger empty |
| Full AI_SERVER regression run | 536 PASS, 1 FAIL: historical snapshot parent hash |
| Full BE regression run | 452 PASS, 12 FAIL in application-wiring tests; another suite fails TypeScript compilation |
| BE `tsc --noEmit` | FAIL: four errors in existing `test/devices.spec.ts` referring to missing `list`, `owner`, `currentAssignment` |
| Actual TCP health and negative-auth gates | PASS |
| Real Gemini Web Chat / voice | LIVE BLOCKED: working deployment prerequisites absent |
| Actual provider usage + working MySQL rows | LIVE BLOCKED / NOT VERIFIED |

Full BE failures are in `test/application-wiring.spec.ts` (legacy routes missing
from modules outside this change) and `test/devices.spec.ts` (repository/type
expectations). Those modules/legacy tests were not rewritten to force a green
result. The historical firmware snapshot was not changed. Full regression logs
are in `AI_SERVER/artifacts/d2-s2-15/`. Two additional credential-delivery tests
were subsequently added and pass in the final related BE run above.

Reproduce relevant tests:

```bat
cd /d E:\learn\AI_Project\cap1\BE
npm.cmd run build
npm.cmd test -- --runTestsByPath test/live-chat.spec.ts test/ai.service.spec.ts test/ai-http.spec.ts test/ai-configuration.spec.ts test/internal-integration.spec.ts test/quotas.service.spec.ts test/quotas.http.spec.ts test/quotas.repository.spec.ts
node scripts\run-d2s215-mysql.cjs
cd /d E:\learn\AI_Project\cap1\AI_SERVER
set "PATH=%CD%\.venv\Lib\site-packages\pyogg;%PATH%"
.venv\Scripts\python.exe -m pytest tests/test_live_gemini_integration.py tests/test_live_robot_pipeline.py tests/test_lan_bootstrap.py tests/test_backend_client.py tests/test_backend_integration_mode.py -q -p no:cacheprovider --basetemp=.pytest-d2s215-manual
```

Release/rollback: do not enable working contract gates until the working DB and
approved user/model/credential/policy are ready. The new reverse service-token
pair is configuration only; it grants no quota override. Removing execution
configuration disables Web Chat without dropping usage/history columns. No
destructive down migration or Git operation was performed.
