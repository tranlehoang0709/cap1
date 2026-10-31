# D2S207 — Quota, Rate Limit & Audit — pending business-rule approval

**Superseded:** the updated User instruction forbids a growing system_settings request
ledger without further approval. Do not implement the historical proposal below.
Current approval document: [d2s207-quota-design-for-approval.md](d2s207-quota-design-for-approval.md).
The review-only additive SQL is d2s207-schema-proposal.sql; it has not been executed.
Update: the User approved code/migration preparation and accounting. Quota APIs are now
implemented; see d2s207-test-report.md. Live DDL remains unapproved/unexecuted.

Schema inspected live on 2026-10-30: quota_policies has nullable User/Provider/limits,
no uniqueness rule for active policies; usage_records has no requestId or reservation
column/unique constraint. Both tables currently contain zero rows. No DDL proposed
under the user's no-schema-change constraint.

## Decisions awaiting the user's answer

1. Proposed policy: require exactly one active exact User+Provider row, no default/
   wildcard fallback. Missing/ambiguous policy denies. Minute = sliding 60 seconds;
   day/month = UTC calendar windows. NULL means unlimited, zero denies.
2. Proposed accounting: every admitted request consumes a request slot even if failed/
   cancelled; actual tokens charged for every final status. Admission requires maximum
   total token reservation; missing report keeps the reservation, with no invented TTL.
   Reported overrun is persisted truthfully and audited, and subsequent admission is
   blocked for reconciliation rather than silently discarding actual usage.
3. Proposed durable admission mechanism: reuse system_settings PK for requestId hash
   ledger + per-usage reservation metadata, lock the User row, reserve a usage_records
   row and ledger atomically before allowing AI processing. Same-request retries and
   final reports read the durable ledger under lock. No count-then-allow without a
   committed reservation. This storage usage requires approval; no ledger implementation
   or policy semantics are enabled while those decisions are pending.

## Dependency order after approval

- Reuse AI Provider/model/credential scope checks on the same transaction connection.
- Lock device first if present, then User, session/context, Provider/model and policy.
- Resolve approved policy; compute usage/reservations using DB UTC; atomically admit.
- Bind global request ID to immutable User/device/session/provider/model/budget context;
  conflicting retry returns 409, duplicate final usage cannot update/charge twice.
- Persist actual reports even after account/device/credential revoke, because completed
  work must still be accounted. Authenticate reporting service and match the admitted
  context; never authorize a new AI request as part of final reporting.
- Add scoped User/Admin statistics, safe audit admission/denial/report/overrun events
  and internal contract gate (disabled until AI Server agreement).
- Verify concurrency/rollover/retries/accounting with controlled-clock transaction
  tests, SQL predicates and live read-only checks. No live fixtures/DML without a
  separately suitable integration test environment. Report model vs real-engine evidence.

## Independent audit work completed

Added DEVICE_PAIRING_REQUESTED via existing UsersRepository.insertAuditLog in the same
transaction as request creation. Metadata contains deviceId/userId only; no pairing
code/hash. Audit failure rolls back request and lifecycle change. Existing approval/
rejection/revoke/restore/credential audit events remain in their transaction paths.
Executed related pairing suites: 3 suites / 100 tests passed, including the new audit
rollback/redaction test. No DB writes/schema changes were performed.

## Risks to document in the final implementation

system_settings is a workable existing durable key/value substrate, not a dedicated
high-throughput request ledger. User-row locking serializes one User's admissions and
reports across providers. Statistics/limiter must include committed in-flight holds,
prevent orphan reservation bypass and retain ledger metadata while retries remain
possible. Ledger growth/retention and a dedicated admission store can be designed
later with explicit schema/infrastructure approval. Backend admission idempotency
does not make external provider execution exactly once: AI Server must dedupe work
by requestId and enforce its admitted token ceiling.
