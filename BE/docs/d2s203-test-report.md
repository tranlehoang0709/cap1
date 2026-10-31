# D2S203 verification — 2026-10-30

## Requirement / implementation

Implemented User-owned devices list, ownership-checked read/rename, Dashboard access
and a separately protected, default-disabled internal authorization adapter. The
external device credential/service-channel contract is **BLOCKED pending agreement**,
not approved by the presence of code/tests or a configuration flag.

Central consumer-facing contract: `../API_CONTRACT.md`, covering all implemented
Prompt 1–3 routes and unimplemented/blocked integration boundaries. Earlier prompt
documents remain implementation/history reports rather than the API entry point.

## Files and reused dependencies

Added Devices files: `dto/ownership.dto.ts`, `ownership.repository.ts`,
`ownership.service.ts`, `ownership.controller.ts`, `internal-device.guard.ts`.
Changed `devices.module.ts`, `app.module.ts` (static Pairing routes register before
dynamic User device detail), `.env.example`. Added `test/ownership.spec.ts`,
`scripts/check-ownership-readonly.cjs`, `API_CONTRACT.md` and this report.

Reuses UserPairingGuard -> AccessRoleGuard -> UsersService for JWT/current identity;
PairingTransaction.findDeviceById/getActiveAssignment and its connection-scoped
UsersRepository for device/assignment/user locks. Uses existing DatabaseModule/mysql2.
No ORM, dependencies, schema changes or firmware/AI Server modifications introduced.

## Flow / design decisions

User JWT identity -> User role guard -> OwnershipService -> assignment scoped SQL.
Approved request must match assignment user/device; assigned lifecycle and no active
unlink/latest pending or failed reset required. Offline is intentionally irrelevant.
Dashboard uses EXISTS-style LIMIT 1 query; pending requests grant nothing. A true
Dashboard check does not replace per-resource authorization in later data endpoints.

Detail/rename transactions lock parent device, current assignment and eligible owner;
revalidate approved request/access state before returning/updating. Rename accepts only
displayName (trimmed 1–120 Unicode characters), updates display_name/updated_at only.
Absent/another User's device -> 404 to conceal existence; owned but blocked -> 409.

Internal adapter requires a separate constant-time-checked service token, then approval
flag; additionally requires device credential proof, never UID alone. Proposed proof
is a random 32-byte base64url secret, SHA-256 hex digest stored in existing credentials.
Credential lookup binds device/hash/active/unrevoked/nullable future expiry and locks
the row. Device/current assignment/approved request/eligible owner and lifecycle are
rechecked under parent lock. Raw credential is not selected back, returned or logged.
TLS termination is a deployment prerequisite; no forwarded header is trusted to prove TLS.

Lock protocol must be shared by future revoke/reset writers: lock devices first.
If revoke commits first, the next authorization denies; if authorization linearizes
first, it may allow and Prompt 6 must invalidate that connection after revoke. Current
code does not claim to close remote sessions or atomically coordinate a socket opening
after DB commit. Deadlock/timeout -> retryable 409; unexpected DB errors -> fail closed.

## Verification

- PASS — `npm.cmd run build`.
- PASS — `npm.cmd test`: 8 suites / 205 tests; 45 new ownership tests plus 160 Prompt 1/2
  and User/configuration regression tests.
- PASS — `node scripts/check-ownership-readonly.cjs`: live SELECT/locking SQL without
  fixtures/DML; scoped empty result total=0 and Dashboard allowed=false.
- PASS — `git diff --check`; existing Windows line-ending notices only.

## Acceptance criteria

| Criterion | Status / evidence |
|---|---|
| User A lists only A's scope | PASS HTTP authenticated ID + bound repository SQL predicates |
| A cannot read/rename B's device | PASS HTTP 404 and no UPDATE invoked |
| Valid/invalid rename, forbidden extra fields | PASS HTTP + SQL field restriction tests |
| No approved device -> Dashboard denied | PASS service/HTTP and approved-request SQL check |
| Approved offline device -> Dashboard allowed | PASS fixture tests; SQL has no online requirement |
| Pending pairing cannot grant access | PASS repository requires matching approved request |
| Valid device proof/assignment -> allow | PASS simulated approved contract fixture; integration remains BLOCKED |
| Missing/invalid/revoked/expired credential -> reject | PASS input/service cases + DB-clock SQL predicate tests |
| Unassigned/revoked/reset-pending/blocked device denied | PASS fixture cases + lifecycle/unlink/reset SQL restrictions |
| Unauthorized internal caller rejected | PASS missing/wrong/User-JWT service token tests |
| Unapproved contract defaults denied | PASS HTTP + direct service checks; `.env` not enabled |
| Concurrent revoke vs authorization | PASS waiting/recheck transaction model; populated live MySQL race NOT VERIFIED |
| Prompt 1/2 regression | PASS full backend suite |
| No DB structure/data modification during implementation | PASS command review; only metadata/SELECT/transaction reads on live DB |

## Blockers / next task

Cross-service contract remains BLOCKED: AI Server/Firmware must approve proof
format, secure provisioning, TLS service channel, token rotation and lifecycle/session
invalidation semantics. Current firmware activation.challenge HMAC is a separate
protocol, not evidence of this credential scheme. Do not switch the approval flag on
as a substitute for that agreement. Backend login issuer remains an external dependency.
No populated live integration fixtures were inserted; actual rename/credential proof/
two-connection revoke race on MySQL remain NOT VERIFIED. Tests use real Nest HTTP
with mocked persistence plus SQL assertions and live empty-data query smoke.

Prompt 4 may build AI configuration/API key access on the verified ownership service;
it must apply authorization per request and keep provider secrets out of device/User
responses. Full hardware-to-AI Server authorization is not claimed complete.

## Recovery

No commit/push. Preserve Prompt 1/2 and unrelated AI_SERVER/user changes. Revert only
new Ownership/controller/guard/DTO/test/script/report files, this prompt's DevicesModule
registrations and internal-auth env example fields; restore module ordering only if
the dynamic detail route is also removed. No production data rollback is needed because
no DML was executed during development. Runtime renames affect existing device name
only; no assignment/credential is provisioned or revoked by these APIs.
