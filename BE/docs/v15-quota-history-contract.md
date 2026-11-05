# V1.5 quota and history adapter: review candidate

Status: IMPLEMENTED / UNIT TESTED, NOT ACTIVATED OR APPROVED. No schema migration, production admission or model inference has been performed. This document is a review artifact, not authorization to enable flags.

## Existing boundaries

The original device, configuration and quota contract gates, service tokens, RBAC, active/verified-user checks, device ownership, provider/model permission and policy checks remain in place. LOCAL remains the default and there is no Cloud fallback. Successful generation additionally needs an installed execution adapter/model and approved history/credential-delivery behavior.

`AI_QUOTA_STORAGE` optionally selects `v15-settings`; absent means the existing `extended` implementation. The candidate also requires `AI_QUOTA_V15_CONTRACT_APPROVED=true` for NEW admission. Neither option was added to the real environment. Existing contract flags remain false. Changing storage/approval requires review of this persistence design and the end-to-end execution contract; it is not a launcher repair.

## Storage without the seven extra columns

- Base `usage_records` retains user/provider/model/session/conversation/credential IDs, request kind, actual token/duration counters, status and occurrence time.
- Existing `system_settings.setting_value` JSON holds versioned request ID and fingerprint, usage-row ID, policy ID, reserved tokens, deadline, report fingerprint and finalization time.
- Keys are `aiva.quota.v15.` + SHA-256(request ID), within the existing key length. The original ID inside JSON is checked; malformed/colliding/inconsistent records fail closed.
- No prompt, response, API key, JWT or service token goes into this metadata. Chat content continues to use original conversations/messages/session tables.
- The namespace is hidden and write-protected in the ordinary settings API, case-insensitively to match MySQL collation. Direct database access remains privileged as before.
- Metadata readiness probes verify required V1.5 columns and InnoDB engines; they perform SELECTs only. No DDL or seven-column references occur in the candidate write path.

## Admission and settlement invariants

The original service takes a global target-user row lock before admission, totals and policy decisions, serializing providers/devices and the 12-per-60-second limit. Policy updates take the same lock. READ COMMITTED transactions use the same connection for the base usage row and JSON metadata. Both writes commit or both roll back. Duplicate request-key insertion rolls back the losing transaction, including its base row; the original retry/replay contract is preserved.

Totals include existing base usage rows, actual settled tokens in the UTC month, all outstanding reservations even across a month boundary, and pending legacy rows with no metadata as unbounded. Unbounded outstanding requests block token-limited admission. Missing usage reports retain reservations; no timeout silently frees budget. Existing BLOCKED/LIMITED/UNLIMITED policy rules and global limits are reused, not replaced.

Reports lock and verify the metadata/base-row identity, user/provider/model/session/conversation/status binding before updating actual counters and finalization fingerprint in one transaction. Existing service-level replay behavior accepts identical finalized reports and rejects conflicting reports. Actual over-budget consumption is recorded/audited rather than discarded. New-admission approval revocation does not prevent authenticated settlement of already admitted work. Original report authentication remains required; this is not an unauthenticated settlement path.

The history branch verifies a successful, finalized usage request with exact request/user/session/conversation/provider binding, then reuses the original history transaction, ownership, session and idempotency checks. No new conversation, message or history mutation was performed on the actual database during this task. The original extended path remains available and unchanged when selected.

## Retention, rollback and operational limits

Do not delete metadata or switch storage while requests remain outstanding. Metadata is required for replay and accounting; deleting it can strand settlement. Revoking new-admission approval is the safe stop mechanism while retaining the adapter and authenticated settlement path. A full storage switch requires reconciliation, retention and ownership review; no automatic conversion/purge/reconciliation is implemented.

V1.5 has no dedicated ledger index. The candidate scans the namespace/base usage for accounting and overdue reports; expected volume and retention need approval and load testing. There is deliberately no cleanup job or automatic sweeper activation. Back up both existing tables together under the normal database backup policy. Unknown/corrupt rows fail closed; operators must investigate without discarding history.

## Verification and remaining acceptance

`test/v15-quota-ledger.spec.ts` tests strict metadata validation, protected namespace (including case variants), atomic rollback, duplicate request IDs, absent approval, retained missing-report reservations, cross-month/legacy accounting, settlement after admission revocation and exact settled-history binding. These tests use isolated SQL harnesses and are NOT live inference evidence. Existing quota and configuration tests also pass.

A real READ ONLY transaction against aiva_iot verified V1.5 readiness and empty accounting queries. Schema/columns/FKs/indexes remain identical to the prior baseline audit; system_settings and usage_records remain empty. No admission, policy creation, settlement, migration, contract approval or paid API call was run.

Before activation: approve the candidate storage/accounting/retention contract; provision an authorized LOCAL model, execution adapter and a legitimate quota policy; verify atomic admission/replay/settlement/history through the actual services under failure and concurrency. Device/config/quota and other relevant contracts must be reviewed independently. This task does not grant those approvals.
