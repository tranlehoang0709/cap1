# Prompt 7 update — Quota Management design for approval

Status: **DESIGN AND ACCOUNTING APPROVED** by the User on 30/10/2026 for code and migration
preparation. **DDL execution is not approved and has not been performed.** Implementation
report: d2s207-test-report.md. This supersedes the earlier system_settings-ledger proposal. Live SHOW CREATE
TABLE/index inspection confirms usage_records has neither request ID uniqueness nor
durable reservation/report idempotency fields; quota_policies has a nonunique User/
Provider index and nullable limits. Existing locks/audit can be reused, but existing
columns alone cannot express reliable admission and final-report recovery without
misusing another table or overloading actual-token fields.

## A. Minimal schema change proposed

Extend **usage_records**, no new table. Keep existing actual input_tokens/output_tokens,
duration_ms, status, occurred_at and context FKs. Proposed nullable columns preserve
legacy records without fabricated request IDs or fake token counts:

| New column | Type | Purpose |
|---|---|---|
| request_id | VARCHAR(128), ascii_bin, UNIQUE | Durable globally unique AI Server request ID; binary/case-sensitive comparison |
| request_fingerprint | CHAR(64), ASCII | Hash of immutable User/device/session/provider/model/budget context; reject conflicting retry |
| quota_policy_id | BIGINT, nullable FK | Policy version used at admission; referenced policy rows retained |
| reserved_tokens | BIGINT, nullable | Immutable declared maximum for the request; effective outstanding hold derived from nonfinal status |
| report_due_at | DATETIME | DB-UTC deadline for missing-report reconciliation; configured, no invented duration |
| report_fingerprint | CHAR(64), ASCII | Canonical final-report hash; identical retry is idempotent, conflicting report rejected |
| finalized_at | DATETIME | Completion/report receipt time, separate from admission occurred_at |

Only one usage_records row per admitted request; final report updates that row.
New requests require nonnull request_id/fingerprint by application validation. Legacy
rows retain NULL IDs; no attempt to infer which historical rows represent the same
external request. A pre-migration data audit must identify legacy nonfinal/unbounded
requests; such records cannot silently be treated as zero token holds.

No quota_policies schema change is required: derive UNLIMITED/LIMITED/BLOCKED from
the stored three limits. Admin updates are serialized under User locks; admission
requires exactly one active exact User+Provider policy. Even if manual/external writes
create duplicates, admission fails closed rather than choosing a convenient policy.

The unique request_id index and policy FK are in the review-only SQL proposal beside
this document. An index for due-report scanning can be considered after test-scale
EXPLAIN; it is not required for the initial correctness mechanism. Existing User/time
and Provider/time indexes support bounded accounting queries, with Provider filtering.
This favors minimal schema change over a separate counter/reservation table; User-row
serialization may constrain throughput and must be measured before larger deployment.

## B. Policy and Admin API

| Mode | Persisted limits | Admission |
|---|---|---|
| UNLIMITED | all three NULL | Skip quota/rate enforcement, retain auth/Provider/credential validation and usage logging |
| LIMITED | positive limits and/or NULL, at least one positive | Enforce each nonnull dimension |
| BLOCKED | all three zero | Deny new requests |

Reject mixed zero/positive/null configurations rather than creating ambiguous mode
semantics. Missing policy -> deny; multiple active exact policies -> deny. No wildcard
or missing-policy fallback. Nullable legacy User/Provider policy rows do not grant
implicit permission for this per-User+Provider feature.

Proposed endpoints (not registered yet):

- GET /admin/ai/quotas/users/:userId/providers/:providerId
- PUT /admin/ai/quotas/users/:userId/providers/:providerId

PUT body: mode, the applicable three limits, expectedPolicyId (null for first creation,
otherwise the currently active row ID). UNLIMITED/BLOCKED may normalize omitted limits
to all NULL/all zero respectively; contradictory explicitly supplied values are 400.
LIMITED requires explicit fields (positive integer or NULL) to avoid accidental defaults.
BIGINT token limits use decimal strings; request limits fit the existing INT columns.

Use active verified Admin RBAC, validate target User/Provider, lock affected User rows
in ascending numeric ID order, compare expectedPolicyId, deactivate the old policy and
insert a new active policy version with audit in the same transaction. No history
deletion and no automatic usage reset. Stale configuration ->409. Duplicate legacy
active policies ->409 with Admin-only diagnostics; repair must be explicit, not an
automatic pick/delete. Normal Admin API operations cannot create such duplicates.

Policy changes affect **new admissions** immediately, not already admitted execution.
Lowering a limit below used+held is permitted but leaves remaining=0 and blocks new
work; it cannot undo consumption or guaranteed budget already admitted. Changing to
UNLIMITED does not delete history or make retries bill/count again. BLOCKED denies
new work; cancellation of an already executing provider request is an AI Server action,
not something a DB quota update alone can guarantee.

## C. Accounting/time decisions requiring approval

1. Every new committed admission consumes one request count, including requests later
   failed/cancelled. Denied requests do not create usage rows. Same request ID + context
   does not consume another slot. Minute window is sliding 60 seconds; day/month use
   UTC calendar boundaries from DB time.
2. Token accounting belongs to the **admission month** (occurred_at), even when final
   usage is reported in a later month. This keeps the reservation and its actual
   replacement in the same logical period. This is an application quota, not a pricing
   or provider-billing statement.
3. A finite monthly token cap requires maxTotalTokens, including input and output
   ceiling, before processing. Check actual finalized tokens + outstanding holds +
   requested ceiling against the cap under lock. Actual-token columns stay NULL until
   a final report; reservation is never disguised as actual output tokens.
4. UNLIMITED or a NULL token limit may omit token budget; it still records an admitted
   request and actual final usage. Declared ceilings can optionally be tracked. To
   activate a finite token cap, any existing unbounded nonfinal requests must first
   be finalized/reconciled: otherwise Admin PUT returns409 UNBOUNDED_REQUESTS_IN_FLIGHT.
   Admin can first block new work while obtaining those reports. Do not invent a budget.
5. First valid final report records actual input/output/duration/status. Pending hold
   becomes zero by finalized state, releasing unused tokens atomically. Failed or
   cancelled work records actual tokens too; proven no-execution cancellation reports
   zero actual tokens. Request count is not refunded.
6. Missing report / timeout / server crash does **not** prove no execution. Mark overdue
   work REPORT_MISSING, retain its hold and request identity; no automatic token refund
   or request replay as new execution. AI_USAGE_REPORT_TIMEOUT_SECONDS must be approved/
   configured before enabling the missing-report worker; no numeric default proposed.
   Late valid reports settle the same row. AI Server needs durable report retries and
   reconciliation for work proven cancelled; elapsed time alone cannot settle it.
7. If actual tokens exceed the admitted ceiling, record the truth and audit the budget
   violation; do not reject/drop real usage just to keep counters under the limit.
   Recompute LIMITED availability from the full actual amount (remaining never negative
   in the API). Strict physical token caps require AI Server to enforce its ceiling;
   Backend reservation cannot undo a provider call that ignored it. No new automatic
   global/User security hold is silently introduced by this proposal; such a hold
   would be a separate business rule to approve.
8. Retain request-ID/report idempotency metadata with usage; no automatic ledger deletion
   is proposed. Future retention/archive needs a dedupe/tombstone horizon agreement so
   deleting old usage cannot make an old request look like a new one.

## D. Atomic flow and crash recovery

Admission: service auth -> validate context -> lock parent Device if supplied -> lock
User -> recheck account/assignment/session/Provider/model/credential -> lock/resolve
exact policy -> look up unique request ID -> calculate committed usage/holds -> insert
ADMITTED row with policy/reservation/context hashes -> audit -> commit -> allowed.

All admission/report/Admin configuration writers share the User lock protocol.
COUNT/SUM is used only inside that serialized transaction followed by a durable
reservation before allow. No Redis or new growing system_settings namespace is used.
The unique index also protects conflicting request IDs across Users/processes. Deadlock/
timeout/unique conflict is retried safely or returns409; never bypasses the quota check.

Identical admitted retry returns the same admission state with replayed=true; it does
not instruct AI Server to launch provider execution a second time. A finalized request
returns its terminal state instead of issuing another execution permit. Conflicting
request context ->409. AI Server must persist/dedupe execution by requestId; Backend
admission idempotency does not prove exactly-once execution at external providers.

Usage report: authenticate service -> locate request -> lock its User/row -> match
provider/context -> compare report hash -> atomically set actuals/final state/audit.
An identical final report returns recorded=true,replayed=true. Different final payload
for an already finalized request ->409, no second charge or silent overwrite. Reporting
completed work remains permitted after User/device/key revoke; it does not grant any
new access or execution. Unknown request ID cannot manufacture a billable usage row.

Backend crash before commit leaves no admission; retry can admit once. Crash after
commit/before reply is recovered by unique request ID. AI Server crash/missing report
retains the outstanding hold; durable usage retry/reconciliation settles it. Denial
audit must be committed deliberately, not inserted then lost by throwing/rolling back
the same transaction. Audit failure must never allow unaudited configuration changes.

## E. API/tests/dependency plan after approval

Keep proposed internal authorize-request/usage and User/Admin usage statistics routes.
Reuse P3 transaction-scoped identity/ownership, P4 Provider/model/credential checks,
existing audit and authenticated internal service patterns. Internal contract stays
disabled until AI Server agrees on token ceilings, request identity and reporting.

Proposed responses: missing/ambiguous policy denies (403/409), explicit BLOCKED ->403,
exhausted LIMITED ->429 QUOTA_EXCEEDED, mismatched retry/report ->409. UNLIMITED returns
null remaining/limits for unlimited dimensions, not a made-up numeric quota. Statistics
show actual tokens separately from outstanding reserved tokens and use JWT scope for
User data. Admin configuration emits AI_QUOTA_POLICY_CHANGED; admission/report/missing/
overrun events contain identifiers/limits only, never keys or prompt content.

Tests: UNLIMITED with missing credential still denied; exact-policy missing/duplicate;
LIMITED/BLOCKED and 0/NULL validation; rolling/UTC boundaries; multi-connection concurrent
admission; duplicate ID/body conflict; actual settlement and unused hold release;
failed/cancelled accounting; missing/late report/crash replay; UNLIMITED->LIMITED with
unknown holds; limit reductions; Admin/User A/B isolation; transactional audit failure.
Run real write/concurrency cases only on an isolated MySQL test schema, still unavailable
as of the Sprint 2 handoff. No robot firmware/test DB provisioning is implied by approval
of this design.

## Approval record

User approved **A** (7 nullable fields + unique index + policy FK on usage_records, no new
table/settings ledger) and **B/C/D** (Admin versioning, window/accounting/reservation/
timeout/config-change/retry semantics). No further approval is needed for that code scope.
Numeric missing-report timeout can remain a required deployment setting without a
default; supply a value separately if it should be fixed now. Implementation and any
DDL execution require separate, explicit scope: approving code/migration preparation
does not automatically authorize altering the currently running database.
