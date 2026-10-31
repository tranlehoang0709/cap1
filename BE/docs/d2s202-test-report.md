# D2S202 verification — 2026-10-30

## Requirement and implementation

Implemented User create/list pairing requests, Admin list/approve/reject, exclusive
current assignment, history creation, code validation/consumption, reset eligibility,
transactional audit and conflict handling. Reused existing JWT verifier (extracted
into AccessRoleGuard), UsersService/UsersRepository, DatabaseModule/mysql2 and V1.5
tables/indexes. No database structure, frontend, firmware or AI Server modification.

Changed Prompt 1 files: `src/app.module.ts` registers PairingModule;
`src/modules/devices/admin-device.guard.ts` delegates to the shared verifier.
New files: `src/modules/auth/access-role.guard.ts`, `src/modules/pairing/` (DTO,
types, repository/transaction, service, controllers, module and User guard),
`test/pairing.service.spec.ts`, `test/pairing.repository.spec.ts`,
`test/pairing.http.spec.ts`, `scripts/check-pairing-readonly.cjs`,
`docs/d2s202-pairing-apis.md` and this report. Existing uncommitted work was preserved.

## Execution flow / design

JWT + persisted role -> controller -> service input/eligibility checks -> repository
transaction -> device row lock -> dependent row/user locks -> state change + audit ->
commit. Failure rolls back all writes and releases connection. PK/unique constraints
defend against alternate writers; parent locks serialize these API workflows. SQL is
parameterized, pagination bounded, statuses projected uppercase. Assignment history
starts open on successful approval for a later unlink to close.

Used application transactions rather than adding stored routines or triggers: this
matches existing code, keeps audit atomic and requires no DB structure changes.
Available/pending_approval and acknowledged-reset vocabulary comes from baseline DBML.
Human-code SHA-256 is an explicit backend provisioning contract; firmware currently
receives a raw activation code and uses HMAC-SHA256 for a separate challenge proof.

## Verification

- PASS — `npm.cmd run build`.
- PASS — `npm.cmd test`: 7 suites / 160 tests, including existing 61 Device/User/config
  tests and 99 new Pairing HTTP/service/repository tests.
- PASS — `node scripts/check-pairing-readonly.cjs`: real metadata, scoped lists and
  locking reads succeeded with no DML.
- PASS — `git diff --check`: no whitespace errors; Windows line-ending notices only.

Live schema confirmed pairing codes/requests, assignment/history, unlink/reset and
audit tables, FK/index definitions. No triggers found in the connected schema.
Pairing code/request/unlink/reset tables were empty. Executed metadata reads, scoped
lists and transaction locking reads only; no test fixtures/DML or schema changes.

The initial added service test failed TypeScript compilation because its mock index
signature also covered the nested users object. Corrected it to a mapped method type;
the subsequent run passed. No production implementation error was hidden.

## Acceptance matrix

| Criterion | Result / evidence |
|---|---|
| Valid/unknown/expired/consumed/revoked codes | PASS in service tests and DB predicate/SQL tests |
| Request created PENDING, no early consumption | PASS in service + 201 HTTP tests |
| User isolation, authenticated current ID | PASS scoped count/list SQL + HTTP tests |
| Admin approval, one assignment/history/audit | PASS service + repository + HTTP tests |
| Admin rejection without assignment/consumption | PASS service + HTTP tests |
| Non-Admin/missing/invalid/expired JWT denied | PASS HTTP + existing Device guard regression |
| Duplicate request/repeated review conflict | PASS service + HTTP tests |
| Concurrent approve/approve and approve/reject | PASS in transaction model; live MySQL race NOT VERIFIED |
| Rollback on audit/commit failure, release on errors | PASS transactional model + repository fault tests |
| Revoked/reset-pending and stale/mismatched reset blocked | PASS service + reset predicate tests |
| Exclusive assignment in populated live MySQL | NOT VERIFIED; schema PK confirmed, no live fixtures inserted |
| Existing Device/User/configuration tests | PASS in full backend suite |
| API contracts and integration prerequisites | PASS documented in d2s202-pairing-apis.md |
| No unintended DB structure/data changes during development | PASS reviewed commands/code; only metadata/SELECT/transaction reads executed |

## Remaining integration and next task

Implementation is ready for Prompt 3's ownership/authorization work on the assignment
read model, but full DoD integration verification remains incomplete: a disposable or
preprovisioned test environment is needed for real two-connection approval races,
constraint collisions, populated transaction rollback and end-to-end login/JWT plus
firmware provisioning. Do not count in-memory race tests as MySQL engine proof.
No issuer or firmware provisioning endpoint exists in current code; no secret was
generated or saved. SHA-256 stored code hash must be implemented by the provisioner.

## Recovery

Pre-task HEAD remains c7ad00e with Prompt 1 and unrelated user work uncommitted.
No commit/push performed. To recover only Prompt 2, remove its new files and PairingModule
registration; restore the previous AdminDeviceGuard body from AccessRoleGuard with
ADMIN required role. Preserve all Prompt 1 Device work and unrelated AI_SERVER changes.
No DML was run during this task, so development recovery needs no DB rollback.
Runtime approvals must later be undone through the authorized unlink/reset workflow,
not by deleting assignment/audit/history rows manually.
