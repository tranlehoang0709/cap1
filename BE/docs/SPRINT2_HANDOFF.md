# AIVA-IoT — Dev 2 Sprint 2 handoff — 30/10/2026

**Later update:** User approved the P7 additive schema design and accounting for code
preparation. The resulting implementation is documented in d2s207-test-report.md.
The original P8 run/evidence below remains historical; migration execution and actual
MySQL/external integration are still blocked, not retroactively marked passed.

**Readiness: PARTIAL.** P1–P6 Backend behavior has automated unit/HTTP/model coverage;
P7 quota admission/reporting/statistics is not implemented pending business-rule and
ledger approval. No full Backend–AI Server–physical robot E2E success is claimed.

API entry point: [API_CONTRACT.md](../API_CONTRACT.md).
Actual summary: [d2s208-results.json](d2s208-results.json).
Previous implementation details: d2s201 through d2s206 test reports in this directory;
pending quota decisions: [d2s207-implementation-plan.md](d2s207-implementation-plan.md).

## Executed results and evidence

| Command/check | Result | Actual outcome |
|---|---|---|
| npm.cmd run build | PASS | Nest build completed |
| npm.cmd run test:typecheck | PASS | All src/test TypeScript checked, including the prepared MySQL suite |
| npm.cmd run test:coverage | PASS | 15 suites, 386 passed, 0 failed, 0 Jest pending |
| Six check-*-readonly.cjs scripts | PASS | Existing MySQL metadata/SELECT/locking reads, EXPLAIN and PREPARE; no DML |
| npm.cmd run test:mysql | BLOCKED | .env.test missing; no isolated schema/config present, zero MySQL integration cases executed |
| Physical robot tests | NOT RUN | User has 2 sample Xiaozhi robots, not firmware-updated; explicitly deferred |
| Live AI Server management integration | BLOCKED | Device/config/heartbeat/quota/reset integration contracts and clients not available/verified |

Coverage of all Backend source except executable bootstrap main.ts:

| Metric | Covered / total | Coverage |
|---|---|---|
| Statements | 1794 / 1978 | 90.69% |
| Branches | 1021 / 1213 | 84.17% |
| Functions | 325 / 377 | 86.20% |
| Lines | 1332 / 1438 | 92.62% |

Jest evidence is generated at `coverage/sprint2/test-results.json` and
`coverage/sprint2/coverage-summary.json` (ignored build artifacts). Summary above was
read from those files, not estimated. Empty placeholder modules such as quotas have
no executable code to cover; high coverage does not prove those missing features exist.

The 386 tests include real Nest HTTP routing/guards/services with mocked persistence,
transaction state models, SQL/predicate tests and real encrypted files in isolated
temporary directories. They are **not** 386 real-MySQL or physical-hardware E2E tests.
The opt-in MySQL suite has 5 prepared cases and was typechecked but never executed.
Jest's 0 pending count does not include those blocked opt-in cases or hardware work.

## Feature / API / test matrix

| Group | Feature / API | Automated evidence | Result / limit |
|---|---|---|---|
| T1 | GET /admin/devices, /:id; filters/page/empty/detail | devices.spec.ts | PASS mocked HTTP/SQL; live empty list/query smoke PASS |
| T1/T3 | GET /user/devices, /:id; PATCH /:id | ownership.spec.ts | PASS tenant scope/404/name/SQL; populated MySQL writes BLOCKED |
| T2 | User pairing request/list; Admin list/approve/reject | pairing.service/repository/http.spec.ts | PASS code/expiry/duplicate/rollback/one-owner model; MySQL concurrency BLOCKED |
| T3 | GET /user/dashboard/access | ownership.spec.ts | PASS approved offline/empty/pending rules |
| T3 | POST /internal/devices/authorize | ownership.spec.ts | PASS service proof/JWT isolation/credential/lifecycle tests; actual provisioning BLOCKED |
| T4 | GET /ai/providers; PATCH /admin/ai/providers/:id | ai-configuration.spec.ts, ai-http.spec.ts | PASS roles/default/model/provider compatibility |
| T4 | User profile; USER/SYSTEM key create/list/replace/revoke | same suites | PASS tenant isolation, GCM integrity, no key fallback/redaction |
| T4 | POST /internal/ai/resolve-config | same suites | PASS simulated approved reference-only contract; live secret delivery BLOCKED |
| T5 | POST /internal/devices/heartbeat | monitoring.spec.ts, monitoring.http.spec.ts | PASS timestamps/duplicates/telemetry/rollback/proof tests |
| T5 | Admin/User /devices/:id/monitoring; sweeper | same suites | PASS 60-second boundary/offline/reconnect/ownership/timer; hardware NOT RUN |
| T6 | Admin revoke/recovery/reset-status/restore | recovery.spec.ts, recovery.http.spec.ts | PASS encrypted temp files, exact 7-day expiry, duplicate/race/cleanup models |
| T6 | Internal reset claim/ACK | same suites | PASS source/attempt/hash/retry/failure tests; physical reset/session close BLOCKED |
| T7 | Quota authorize-request/usage/statistics APIs | No implementation or tests yet | BLOCKED pending P7 decisions, not included in pass count |
| T7/T9 | Pairing/create/approve/reject/revoke/restore/key audit | pairing/recovery/ai suites | PASS transactional audit and secret exclusion tests |
| T8 | Real Pair -> concurrent Approve -> Authorize | mysql.integration.ts case 1 | BLOCKED isolated DB missing; prepared only |
| T8 | Real profile/config/key isolation | mysql.integration.ts case 2 | BLOCKED isolated DB missing; external callers simulated |
| T8 | Real heartbeat -> timeout -> reconnect | mysql.integration.ts case 3 | BLOCKED isolated DB missing |
| T8 | Real revoke -> backup -> synthetic ACK -> restore | mysql.integration.ts case 4 | BLOCKED isolated DB missing; ACK would still be simulated |
| T8 | Real concurrent restore vs new pairing | mysql.integration.ts case 5 | BLOCKED isolated DB missing |
| T8 | AI config -> quota -> actual inference -> final usage | None | BLOCKED P7 missing and external contract absent |
| T9 | JWT, roles, User A/B, service token gates, SQL failures | all HTTP/service suites | PASS deterministic coverage, no public plaintext key |
| T9 | Full AppModule DI/route precedence/guards | application-wiring.spec.ts, 17 tests | PASS real module graph, explicitly mocked MySQL |
| T10 | Available API flows/error clarity | root wiring + route/service tests | PASS only for available APIs; full portal/hardware UX NOT RUN |
| T10 | User registration/login token issuer | Auth HTTP files still empty | BLOCKED external Dev 1 dependency; verifier tests are not login tests |

## Confirmed defects and fixes

1. **LOCAL incorrectly required obsolete SYSTEM grant.** Reproduced a failing test:
   a User with stored SYSTEM preference whose permission was withdrawn could not
   switch to LOCAL, receiving SYSTEM_SCOPE_NOT_ALLOWED. LOCAL now resolves NONE/no
   credential independently of that old preference; an explicit new SYSTEM selection
   still requires permission. New negative/positive regression tests pass. No SYSTEM
   fallback or permission relaxation for Cloud providers was introduced.
2. **App configuration prevented safe isolated DB integration.** Previously the only
   accepted database was aiva_iot, and AppModule always loaded .env. NODE_ENV=test now
   loads only .env.test and requires explicit MYSQL_INTEGRATION_TESTS=true plus a name
   matching aiva_iot_test or aiva_iot_test_<suffix>; aiva_iot is forbidden in test mode.
   Development/production retain the original aiva_iot restriction. New validator
   and full-AppModule tests pass; actual isolated MySQL bootstrap remains unverified.
3. **Coverage reporting measured Users only by default.** Jest now measures all src
   except main.ts; test:coverage/typecheck/mysql scripts make verification repeatable.
   No arbitrary coverage threshold was invented. This was a reporting gap, not proof
   of a runtime security defect.

Also added a regression for recovery cleanup where file deletion succeeds but the
metadata/audit transaction fails: retry remains safe because expiry already denies
restore and missing file deletion is idempotent. P7's independent audit work added
DEVICE_PAIRING_REQUESTED; creation rolls back if audit fails, without logging the code.

Baseline before these P8 changes: 365 tests/14 suites pass. The LOCAL reproduction
then failed as expected (1 failed, 42 passed in that service suite); after fixing it,
all affected and full regression tests pass. No confirmed product defect found in
this review remains unfixed within the tested scope. Missing functionality and
unverified integration are still release blockers, not silently counted as resolved.

One smoke run was mistakenly started concurrently with Nest rebuilding dist; four
scripts briefly failed MODULE_NOT_FOUND while artifacts were being recreated. All
six scripts were rerun **after build completion** and passed. This orchestration error
was not a product defect; build-dependent scripts must run after the build finishes.

## Isolated MySQL test runbook

No database/table is created or migrated by the runner. Do not point it at the real
aiva_iot database, even if existing data seems empty. The current connected DB was
used for read-only checks only; no fixture/revoke/restore/cleanup DML was executed.

1. Operator supplies a separately provisioned V1.5 test schema named aiva_iot_test or
   aiva_iot_test_<suffix>, with ADMIN/USER role catalog and enabled LOCAL/OPENAI providers.
   Provisioning requires a separate approved DB setup; no CREATE script was run here.
2. Copy `.env.test.example` to ignored `.env.test`, fill test-only credentials locally,
   set MYSQL_INTEGRATION_TESTS=true. Never copy production secrets. Use a dedicated
   MySQL user permitted only on that isolated schema; run without concurrent unrelated
   consumers of the same fixture schema.
3. From BE run `npm.cmd run test:typecheck`, then `npm.cmd run test:mysql`.
4. Runner preflights opt-in/name/tables/catalog and aborts before fixtures if missing.
   It never falls back to .env. The test generates random in-memory JWT/encryption/
   service secrets and a temporary private backup directory; background sweep is disabled.
5. Real HTTP requests commit synthetic data so multi-connection locking can be tested.
   Fixtures have unique User/model/device identities; cleanup targets captured fixture
   IDs in FK order, never TRUNCATE/FK-disable/global DELETE. Shared catalog rows are
   not changed/deleted. Cleanup failures must be reported and reconciled, not hidden.
6. Passing those 5 cases would verify real Backend+MySQL flows with **simulated** AI
   Server/Firmware ACK clients. It would still not validate physical reset, real key
   delivery/provider inference, factory credential provisioning or hardware reconnect.

The prepared suite was typechecked only. Its real DB DML/concurrency/cleanup behavior
is itself NOT RUN until the isolated environment is supplied; do not treat preparation
as executed evidence. No schema/production name safety check is bypassed for convenience.

## External integration and UX status

- AI Server currently exposes health/device profiles/dev-echo in inspected source;
  no verified Management client flow for device auth/config/quota/reset exists. Presence
  of a local service/health route is not evidence of these contracts working.
- Firmware currently receives activation.code and signs a separate challenge. It
  does not demonstrate the new secure credential/reset/heartbeat contracts. No firmware
  was flashed or changed; the two known sample boards are reserved for later testing.
- Auth login/register/refresh issuer is not implemented here. Synthetic signed access
  tokens exercise verifier/RBAC only. Users cannot complete a real signup-to-robot flow yet.
- Frontend remains out of scope; available APIs were exercised, not the entire visual
  portal. No claim of complete User experience acceptance is made.
- Internal gates remain false in the example deployment. Test-local approval flags
  are not cross-team approval and do not authorize production secret delivery.

UX limitations to communicate to consumers: unknown/other User device uses 404;
blocked owned device uses 409; unknown stored status filters may return empty; no AI
models are currently provisioned; changing Provider without a compatible/default model
returns MODEL_REQUIRED; real credential validity is not checked with OpenAI/Gemini.
Monitoring computes the exact 60-second timeout, while materialized list state may
lag a sweep cadence. Revoke requires Idempotency-Key; restore never reactivates an old
credential and needs fresh DEV-03 provisioning before reconnect.

## Blockers / remaining risks / next actions

| Priority | Blocker/risk | Required action |
|---|---|---|
| Release | P7 quota/rate/usage missing | Approve policy/accounting/durable-ledger decisions, implement and test before AI execution integration |
| Release | Isolated DB absent | Provision test schema/credentials/catalog, run opt-in suite and actual lock/race/rollback checks |
| Release | Auth issuer unavailable | Dev 1 align login/JWT issuance with shared verifier contract |
| Release | Device factory proof/provisioning and reset path absent | Firmware/AI Server agree secure independent management channel, update boards and verify true ACK/session close |
| Release | Cloud secret delivery unapproved | Agree broker/secure delivery; reference-only config cannot perform Cloud calls by itself |
| Operational | Recovery volume/retention/master-key approval | Validate private ACL, fsync/durability, snapshot retention, cleanup schedule and key rotation plan |
| Integrity evidence | Concurrency currently model-tested only | Execute the real MySQL suite; do not infer engine isolation from serialization models |
| Capacity | Status/search/sweep queries may scan devices | Measure on test-scale data; no unauthorized index/schema changes in this sprint |
| Operational | Session invalidation is not socket closure | Implement/reconcile remote invalidation, retry and acknowledgement behavior |

P8's available tests, defect fixes, safety checks, coverage and handoff are complete
within the available environment. Sprint 2 acceptance remains **PARTIAL**, not READY:
the quota and real integration blockers must be resolved before overall sign-off.

## Changed files and recovery

P8 production fixes: ai-providers.service.ts, configuration.ts, app.module.ts.
Verification/tooling: jest.config.cjs, jest.mysql.config.cjs, package.json scripts,
.gitignore, .env.test.example, run-mysql-integration.cjs; new application-wiring.spec.ts
and mysql.integration.ts; added AI/configuration/recovery regressions. API_CONTRACT.md,
this report and d2s208-results.json contain handoff evidence. Prior P7 audit changes
are in pairing.service/repository and related tests, documented separately.

No dependencies installed/upgraded; no real DB/table changes, actual secrets, firmware
updates, commits or pushes. The worktree contains earlier P1–P7 and unrelated User/
AI_SERVER changes. Revert only P8-specific hunks/files to undo this review; preserve
those earlier changes. Current HEAD remains c7ad00e and is not a checkpoint containing
all this uncommitted work. Make a reviewed checkpoint before future integration work.
