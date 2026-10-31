# D2S206 — Device Revoke, Backup & Recovery — 2026-10-30

## Requirement / implementation

Implemented Admin revoke/recovery metadata/reset status/restore, encrypted file backup
with seven-day DB expiry, durable reset job pull/lease/challenge ACK, immediate database
authorization invalidation and controlled retention cleanup. No schema/index/function/
trigger change. No real development revoke/reset/restore/cleanup or fixture inserted.
API contract added to `../API_CONTRACT.md`, section 9.

## Files / dependencies

Added `src/modules/device-recovery/`: recovery.dto.ts, recovery-store.ts,
recovery.repository.ts, recovery.service.ts, reset-source.guard.ts,
recovery.controller.ts, recovery.module.ts. Changed app.module.ts and .env.example.
Added `test/recovery.spec.ts`, `test/recovery.http.spec.ts`,
`scripts/check-recovery-readonly.cjs`, `scripts/cleanup-recovery-backups.cjs`, this
report and API contract section. Existing Prompt 1–5 and unrelated work preserved.

Reuses AdminDeviceGuard/AccessRoleGuard, OwnershipTransaction -> PairingTransaction
device/assignment/user locks, UsersRepository audit, DatabaseModule/mysql2 and Prompt
4 SecretEncryptionService. Live schema inspected includes ai_sessions; its unended
rows for only this device become revoked/ended with DEVICE_REVOKED error code. No
User login sessions, global AI profiles, credentials for other devices or User keys
are affected. Existing Pairing reset gate is reused without weakening its conditions.

## Execution / function mapping

validateRevokeEligibility is the locked assignment/approved request/Admin check in
revokeDeviceAssignment. createRecoveryBackup is RecoveryStore's encrypted exclusive
file write + fsync + checksum read-back. invalidateDeviceAccess is revoke's scoped
assignment deletion/credential+code revoke/session logical invalidation. requestDeviceReset
claims existing durable job; processResetAcknowledgment validates service proof,
attempt/challenge and confirmations. validateRestoreEligibility is the locked latest
operation/ACK/owner/expiry/content check inside restoreDeviceAssignment.
cleanupExpiredBackups is an explicit CLI/service action, with seven-day orphan cleanup;
writeRevokeAudit uses existing UsersRepository on the same transaction connection.

Backup before revoke: device+actor locks -> history/operation -> durable encrypted file
-> backup metadata DB now+7 days -> scoped revoke/reset pending job -> audit -> commit.
Filesystem and MySQL are not one transaction; encrypted orphan after rollback/unknown
commit is retained for safe later cleanup, not deleted in a way that could destroy
the only backup for a committed revoke. Restore waits for genuine ACK and rechecks
expiry after I/O; inserts assignment/open history, name only, audit atomically.

Reset delivery uses existing reset_jobs as a durable pull outbox, not synchronous
network inside transaction. Claim commits attempt/hash before handing command to the
authenticated service. In-flight duplicates do not resend; expired lease allows same
job ID/new challenge, stale attempt cannot ACK. Offline/sent/failed never become reset
success without valid proof and both remote confirmations. Duplicate ACK does not
revoke freshly provisioned credentials/codes or change a later owner's lifecycle.

## Verification

Final commands/results:

- PASS — `npm.cmd run build`.
- PASS — `npm.cmd test`: 14 suites / 364 tests, including all 322 Prompt 1–5 regression
  tests and 42 recovery/HTTP/file/SQL tests.
- PASS — `node scripts/check-recovery-readonly.cjs`: live metadata/SELECT/locking SQL,
  DML PREPARE/DEALLOCATE only; no INSERT/UPDATE/DELETE executed.
- PASS — `node scripts/cleanup-recovery-backups.cjs`: dryRun=true, expiredInNextBatch=0,
  no file deletion/DML; presence sweeper disabled in this command process.
- PASS — `git diff --check`; Windows LF/CRLF notices only.

Actual encrypted file tests use uniquely named OS temporary directories, read-back,
tamper/wrong-context/path traversal checks, controlled mtime and explicit path
verification before recursive temporary-directory cleanup. No backup files or keys
left in the workspace/live storage. GCM master key is test-only memory configuration.

## Acceptance matrix

| Criterion | Result / evidence |
|---|---|
| Durable encrypted backup before assignment removal | PASS fsync/read-back temp file + service ordering; deployment power-loss durability NOT VERIFIED |
| Backup failure prevents revocation | PASS state-model rollback and no revoke invocation |
| Immediate effective access removal | PASS assignment/credential/code/session scoped SQL and ownership regression; physical AI socket closure BLOCKED |
| User/other robots unchanged | PASS model invariants + SQL WHERE field review |
| Duplicate revoke/reset idempotency | PASS key fingerprint, one-operation concurrent model, claim lease and duplicate ACK tests |
| Offline stays reset-pending / failures recoverable | PASS failed delivery/retry model; no timeout-to-success path |
| Fake/stale ACK rejected | PASS hash/attempt guards, input validation and service role HTTP tests |
| Valid ACK enables eligible new Pairing | PASS existing PairingTransaction gate exercised with matching completed model rows |
| Restore within seven days / exact expiry denied | PASS success, controlled time, expiry recheck after I/O |
| New owner/later operation protected | PASS owner/latest-operation conflict and idempotent revoke key tests |
| Restore vs Pairing race | PASS both serialized transaction-model orders; actual MySQL two-connection race NOT VERIFIED |
| Atomic audit/DB failure handling | PASS state rollback + repository work/commit failure and connection release tests |
| Cleanup expiry/orphan safety | PASS controlled DB/filesystem time, reference protection, retryable delete error and retained metadata |
| Unauthorized User/Admin/source denied | PASS real Nest route/guard HTTP + persisted actor service checks |
| Prompt 2/3/5 and all earlier regression | PASS full backend suite |
| Integration contracts | Documented; storage/reset/service proof/retention deployment approval BLOCKED |

## Remaining blockers / next task

RECOVERY_STORAGE_APPROVED=false and RESET_CONTRACT_APPROVED=false by default. No
directory/master key/service token/retry lease is provisioned automatically. The
storage operator must approve durability, Windows private ACL/volume behavior,
capacity and secure retention/snapshot policy. File unlink is logical deletion,
not proof of SSD/snapshot physical erasure. Cleanup scheduling is operator-controlled;
expiry denial is enforced even before cleanup runs.

AI Server/Firmware lack a reset management channel/ACK implementation; they must
validate real firmware proof, close physical sessions and confirm actual reset before
success ACK. Revoked owner credentials cannot be the credential used to regain a
management channel. Lease has no invented default and must be agreed/configured.
The backend records logical session revocation immediately but cannot close remote
WebSockets by changing a row. No remote implementation or acknowledgement was faked.

Backup is only assignment/device-name state present in this DB. Global User config
is intentionally left unchanged, and unknown firmware state is not backed up. Restore
does not un-revoke old secrets; fresh DEV-03 provisioning is required for reconnect.
No populated live write/rollback/race or hardware reset test was executed; model tests
are not MySQL engine or hardware proof. Full end-to-end DoD remains unverified/blocked
at those integration boundaries. Prompt 7 can use transaction audit events and current
ownership/scope metadata for quota/rate limit/audit work.

## Recovery

No commit/push; pre-task HEAD c7ad00e with previous prompt and user changes uncommitted.
Remove only the new module/tests/scripts/report, its AppModule registration and env/
contract sections to revert development code. No development DB rollback is needed.
If deployed revokes exist, keep metadata, encrypted blobs and master key readable;
do not roll back by deleting audit/history or reactivating credentials directly. Use
the authorized restore/reset/reprovision flow. Do not delete an orphan immediately
after an ambiguous commit; first reconcile DB references and retention age.
