# D2S207 update — Quota Management implementation — 30/10/2026

## Authorization and delivered scope

User approved the seven-column additive usage_records design and accounting rules for
**code and migration preparation only**. DDL execution remains explicitly unapproved.
No ALTER/CREATE/DROP or quota data mutation was executed against any live database.
No request ledger is written to system_settings; that table is read only for existing
P4 User credential-scope preferences. No new table/dependency is introduced.

Implemented Admin quota GET/PUT, UNLIMITED/LIMITED/BLOCKED policy handling, atomic
admission/reservation, final usage/idempotency, missing-report handling, User/Admin
statistics and transactional audit. The public reference is API_CONTRACT.md section 10.
Approved design/decisions: d2s207-quota-design-for-approval.md. Migration prepared at
src/database/migrations/20261030_quota_admission.sql; not applied automatically.

## Files and dependency reuse

- Filled quotas.module/controller/service/repository.ts; added quotas.types.ts,
  dto/quota.dto.ts, quota-source.guard.ts and usage-report-sweeper.ts.
- Added AI Provider service checkProviderPermission helper and exported its module
  service. It reuses provider/model/credential-scope/GCM checks on the quota connection.
- Registered QuotasModule; extended configuration validation and .env.example with
  disabled admission/worker and no numeric report-timeout default.
- Added quotas.service.spec.ts, quotas.repository.spec.ts, quotas.http.spec.ts;
  extended AI/configuration/root-wiring regressions.
- Prepared quotas.mysql.integration.ts (6 real-DB cases), dedicated Jest config and
  test:quota:mysql runner option. Fixed test selection so existing plain MySQL suite
  and new quota suite do not accidentally run together on an unprepared schema.
- Added check-quota-readonly.cjs, manual migration, API/design/report updates.

Reuses mysql2 Pool/DatabaseModule, User row locks/role/account checks and audit via
UsersRepository, existing Admin/User JWT guards, P3 device ownership and P4 Provider/
credential checks. Existing P1–P6 behavior continues without the quota migration.
No firmware/AI Server changes or provider network calls were made.

## Runtime and accounting

Admin config locks actor/target Users in ascending ID order, requires target USER,
checks expectedPolicyId, deactivates previous active row, inserts a version and audit
atomically. No usage reset or policy deletion. Missing/duplicate policy never grants
implicit access. Mixed zero/null/positive limits are rejected instead of guessing mode.

Admission authenticates the internal caller, revalidates User/device/session context
and Provider/model/credential permission, locks User before counting, then inserts one
durable admitted usage row with unique requestId and reservation before allow commit.
No count-then-allow race, in-memory counter or growing settings ledger is used. A
same-context retry returns state/replayed=true/executionAllowed=false, not a second
permission to invoke a provider. Conflicting retry returns409 and never charges twice.

Rate window is sliding 60 seconds; day/month UTC; every committed admission consumes
one request even on failure/cancellation. Actual token columns stay NULL while pending;
reserved_tokens is the immutable original ceiling, effective hold is derived from
nonfinal state. A finite token limit requires maxTotalTokens; unlimited/null-token
quota may omit it but still logs admission and final actuals. Unknown pending holds
prevent enabling a finite cap; lower limits block new work without erasing existing work.

Final report locks User and row, validates request/provider, compares canonical report
hash, updates the existing row with actuals/final time and audit. Identical report is
idempotent, conflicting report is409. Reports remain permitted after account/device/key
revocation or admission shutdown, but cannot create unknown usage or authorize execution.
Unused hold is released by final state once; request count is not refunded. Token
accounting stays in the original admission month even for later reports.

Missing report marks REPORT_MISSING and keeps the reservation and request identity.
Worker is opt-in and needs configured timeout (no invented duration). Retry also detects
overdue requests without the worker. No automatic refund/cancelled=0 due to timeout.
An actual overrun is recorded truthfully and audited; LIMITED recomputes full actuals,
does not silently discard them or add an unapproved security hold. AI Server must enforce
its ceiling and durable execution/report retry; Backend cannot undo an external overrun
or prove exactly-once provider execution merely from admission idempotency.

Denial audit commits separately from HTTP error emission, without a usage row. Any
post-write/audit failure rolls back admission/finalization/configuration. Data/schema
failures fail closed. Statistics scope User by JWT and return aggregates, no keys or
private audit metadata. Unknown finite holds are reported explicitly rather than as a
usable balance; BLOCKED reports zero, explicit UNLIMITED reports null limits/remaining.

## Verification and acceptance

Actual command results are recorded in d2s207-results.json:

- `npm.cmd run build`: PASS.
- `npm.cmd run test:typecheck`: PASS.
- `npm.cmd run test:coverage -- --json --outputFile=coverage/sprint2/quota-update-results.json`:
  PASS, 468 tests across 18 suites, zero failures (82 more tests than the P8 baseline).
- Coverage: lines 93.46%, statements 91.60%, branches 85.98%, functions 87.47%.
- `node scripts/check-quota-readonly.cjs`: BLOCKED as expected; migration not applied,
  metadata only, no quota writes.
- `npm.cmd run test:quota:mysql`: BLOCKED because .env.test is absent; zero of six
  prepared real-MySQL cases executed. Mock/state-model concurrency results do not
  prove MySQL engine concurrency or real AI Server/Firmware execution.

| Criterion | Evidence/status |
|---|---|
| UNLIMITED/LIMITED/BLOCKED; missing/duplicate/invalid policies | PASS service and repository tests |
| Admin versioning/expected ID; User denied | PASS HTTP/role/service/SQL tests |
| No quota resets on mode changes/lower limits | PASS state model; known/unknown holds checked |
| UNLIMITED still requires valid auth/Provider/key | PASS delegated permission/helper tests |
| Concurrent admission respects limits | PASS serialized transaction model + User-lock/SQL assertions; actual MySQL race BLOCKED |
| Concurrent same requestId creates one usage | PASS model/global UNIQUE readiness check; actual constraint race BLOCKED |
| Reservation/final actuals/unused hold release | PASS service/repository tests; no fake actual token values |
| Duplicate/conflicting final report | PASS model/hash/update-once tests |
| Failed/cancelled/missing/late report/crash replay | PASS controlled-clock/state/worker tests |
| Minute/day/month boundaries and admission-month charging | PASS deterministic model and SQL boundary checks |
| Config changes vs in-flight/admission | PASS both transaction-model orders |
| User isolation/statistics and internal service identity | PASS HTTP/guard/User-scoped SQL tests |
| Audit atomicity and redaction | PASS admission/denial/report/overrun/config fault tests, no secret/prompt metadata |
| Old schema cannot silently bypass enforcement | PASS metadata/unique/FK checks and real root-app mocked-DB 409 tests |
| Existing P1–P6/P8 regression | PASS full backend suite |
| Real migrated MySQL integration | BLOCKED missing isolated .env.test/schema; 6 cases prepared/typechecked only |
| Live migration/production readiness | NOT RUN / blocked by explicit no-DDL instruction, not a test success |
| Backend–AI Server live contract | BLOCKED, new admission flag false by default |

Tests use mock persistence/transaction models plus SQL assertions. They do not establish
actual two-connection MySQL isolation; the opt-in suite must run on an isolated migrated
schema after separate execution approval. The actual running schema was checked with
metadata only and correctly remains QUOTA_SCHEMA_NOT_READY. No fixture was inserted.

## Deployment and remaining risks

1. Review/apply the prepared migration only after **separate explicit approval**, first
   on an isolated V1.5 test database. Existing legacy pending/negative/unknown usage
   needs audit; do not fabricate IDs/budgets or silently count unknown holds as zero.
2. Provide isolated .env.test with opt-in/test-only permissions and migrated schema;
   run test:quota:mysql. Runner never creates tables, applies DDL or falls back to .env.
3. Agree AI Server request identity, token ceiling, context binding, execution dedupe,
   durable report outbox, reconciliation and timeout value. Then configure service
   token/deadline and enable admission; test flags are not live contract approval.
4. Enable missing-report worker only with approved timeout; configure private secrets
   outside source. Source auth is shared trusted-service identity, not per-instance
   cryptographic report proof. No direct provider-key network validation is claimed.
5. User-row/provider locks serialize traffic; history/overdue scans and ledger growth
   need load testing. No unapproved index/counter table is added. Keep durable IDs with
   usage; future archive requires an agreed idempotency/tombstone horizon.

Implementation is complete for the approved code/preparation scope, but **not enabled
on the current DB** and not operationally ready for AI billing/admission until migration
and real integration are verified. Sprint readiness remains PARTIAL.

## Recovery

No commit/push or dependency changes. Earlier prompt and unrelated User/AI_SERVER work
is preserved. Disable new admissions with AI_QUOTA_CONTRACT_APPROVED=false; continue
authenticated reporting for already admitted requests if schema exists. Stop the worker
with AI_USAGE_REPORT_SWEEPER_ENABLED=false. Preserve usage IDs/reservations/policy
versions; do not drop ledger columns or delete pending rows to roll back counters.
No DB rollback is necessary for development because no DDL/quota writes were executed.
