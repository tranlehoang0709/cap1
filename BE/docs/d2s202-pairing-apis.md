# D2S202 — Device Pairing & Approval

## Scope and dependencies

Extends Prompt 1 on the existing running V1.5 MySQL tables. No DDL, new tables,
index changes, functions, procedures, triggers or dependencies. Runtime endpoints
insert/update requests, lifecycle, assignment, history, code consumption and audit
only as part of the requested workflows. No frontend, firmware or AI Server changes.

JWT verification was extracted from AdminDeviceGuard to `auth/access-role.guard.ts`.
AdminDeviceGuard and UserPairingGuard reuse it and set `request.currentUser` from
verified JWT sub and persisted role (never from request body or role claims).
The existing `ADMIN_ACCESS_JWT_*` configuration names and access-token contract are
retained for compatibility, now shared by both roles. Issuer must mint audience-matching
access tokens for Users as well as Admins. No login/token issuing endpoint is introduced.
UsersService remains the HTTP account/RBAC source. Mutations recheck active,
email-verified identities and single role inside their transaction with UsersRepository.
Approval additionally rechecks that the requester remains an eligible USER.

PairingRepository uses the existing mysql2 Pool/DatabaseModule. There is no ORM.
UsersRepository is reused on the same connection for user locks, roles and audit.
Prompt 1's device detail query is a public multi-table projection; a separate minimal
locking device read is needed for mutations, not another public Device service.

## Firmware inspection and code provisioning contract

Inspection of `xiaozhi-esp32/main/ota.cc:130` shows firmware receives `activation.code`
as plaintext from its OTA server, stores it in an in-memory string and displays/speaks
it (`application.cc:713`). No pairing-code hash persistence was found in that flow.
`ota.cc:431` computes HMAC-SHA256 over `activation.challenge` with hardware HMAC_KEY0,
then POSTs activation proof to the OTA `/activate` path. This is a different operation
from hashing the human-entered code in `device_pairing_codes`.

This backend defines a provisioning contract, not an existing firmware implementation:

- `pairingCode`: 6–128 ASCII letters/digits/underscore/hyphen, exact case-sensitive
  bytes; no trimming, case folding or numeric conversion (leading zeros preserved).
- Store lowercase hex `SHA256(UTF8(pairingCode))` in code_hash; unique index supports
  lookup. Never persist the raw code in requests/audit/logs or return a hash.
- Provisioner must supply device_id, created_at and expires_at; the backend does not
  generate/provision codes in this prompt. Expiry, consumption and revocation are
  checked using database UTC time, including a conditional consume at approval.
- Firmware currently has no AIVA-specific code-provisioning bridge. The OTA service
  must provision that hash and deliver the matching raw activation.code to the robot
  before the complete hardware-to-User workflow can work. Do not substitute the
  HMAC activation proof for code_hash. No hash format can be inferred from live rows:
  device_pairing_codes is empty at verification time.

Keep codes short-lived and protect provisioning/access endpoints at deployment.
Brute-force throttling is not introduced by this prompt; low-entropy codes need
deployment-level rate limiting. Device credentials remain separate (Prompt 3).

## API

All routes require Bearer access JWT and an active verified persisted account.
IDs are positive signed BIGINT decimal strings. Standard Nest error JSON is retained.
DB statuses are lowercase per the baseline; HTTP statuses are uppercase.

| Method / route | Role | Input | Success |
|---|---|---|---|
| POST /user/devices/pairing-requests | USER | `{pairingCode}` | 201 `{id,deviceId,status:"PENDING"}` |
| GET /user/devices/pairing-requests | USER | status,page,limit | 200 scoped list |
| GET /admin/pairing-requests | ADMIN | status,page,limit | 200 all requests |
| POST /admin/pairing-requests/:id/approve | ADMIN | optional `{reviewNote}` | 200 `{status:"APPROVED",assignment:{deviceId,userId}}` |
| POST /admin/pairing-requests/:id/reject | ADMIN | optional `{reviewNote}` | 200 `{status:"REJECTED",reviewNote}` |

List filters: page defaults 1, maximum 1,000,000; limit defaults 20, maximum 100.
Both are positive decimal integers. Status is pending/approved/rejected/cancelled,
case-insensitive. Sort is fixed at request ID descending. Unknown filters (including
userId), repeated filters/arrays and unknown body fields are rejected with 400.
reviewNote is optional text, at most 500 characters, no controls; trim to null if blank.
Omitting the review body is supported; explicit null reviewNote is invalid.

```json
{
  "items": [{
    "id": "10", "deviceId": "42", "userId": "7", "status": "PENDING",
    "reviewNote": null, "reviewedBy": null, "reviewedAt": null,
    "createdAt": "2026-10-30T00:00:00.000Z"
  }],
  "pagination": {"page": 1, "limit": 20, "total": 1}
}
```

User list always binds JWT userId in BOTH count and data queries. There is no User
request-detail route and no client-selectable owner filter. No code/hash/credentials
are included in lists. Empty/past-end pages return items:[] and the filtered total.

400 malformed input or unavailable code at submission (unknown/expired/consumed/revoked).
401 missing/invalid JWT. 403 wrong role or ineligible actor. 404 absent request/device
during review. 409 duplicate pending submission, already-reviewed request, assignment
conflict, unusable code at approval, ineligible requester, blocked lifecycle/reset,
deadlock/lock timeout/unique conflict. 500 unexpected DB/audit failure with generic
message; SQL details are not exposed. Refresh before retrying a 409. A repeated
approve/reject returns 409 and does not create another assignment/audit.

## Transaction and ownership rules

Creation: validate input/hash lookup -> lock parent device -> lock/recheck User ->
lock/revalidate code -> check lifecycle/assignment/reset -> detect pending duplicate
for that device/User -> insert pending request -> set pending_approval -> commit.
Code is NOT consumed by submission. Different Users may have competing pending requests;
the same User cannot accumulate duplicate pending requests even with another code.

Approval: discover request device without lock -> lock device -> lock/reload request
and require pending -> lock/revalidate Admin and requester in ascending numeric user-ID
order -> lock/revalidate code/device binding -> check eligibility -> conditionally
consume code -> INSERT current assignment -> INSERT open assignment history using
the assignment timestamp -> mark approved/reviewer/note -> lifecycle assigned ->
write audit -> commit. All writes and audit share one connection/transaction.

The parent device lock serializes submission and both review paths. Assignment PK
(device_id) plus unique pairing_request_id remains the final exclusivity barrier.
All workflow paths lock device before request/code/history child rows. Other modules
that unlink/reset/rotate pairing codes must follow the same parent-first protocol.
Use READ COMMITTED and fresh locking reads after waiting, not a stale transaction snapshot.
Deadlocks/timeouts become 409 with rollback; no unbounded automatic retry.

Rejection: lock device/request -> recheck Admin -> require pending -> mark rejected
with reviewer/time/note -> audit -> commit. No code consumption, assignment or history
insert. Return pending_approval to available only if no assignment or other pending
request exists; never overwrite maintenance/reset_pending. Rejection remains possible
even when code is expired, so Admin can clear obsolete pending requests.

Other Users' pending requests are not automatically reviewed when one is approved;
they remain visible as pending and cannot approve while ownership/code is invalid.
Admin can explicitly reject them. Request/audit creation and history insertion are
not detached side effects: any failure rolls back every write. If commit outcome is
unknown after a network error, refresh the request before retrying.

Audit actions: DEVICE_PAIRING_APPROVED / DEVICE_PAIRING_REJECTED, entity type
DEVICE_PAIRING_REQUEST, request ID, actor Admin ID, metadata deviceId/userId/reviewNote.

## Lifecycle and reset gate

Only available or pending_approval can submit/approve, and current assignment must
be absent. Assigned, revoked, reset_pending, maintenance and unrecognized states block.
Lifecycle alone is insufficient to bypass reset:

- Any incomplete unlink operation blocks.
- Prior ownership history without an unlink, or an open history row, blocks.
- The latest completed unlink must reference the latest closed assignment history.
- The latest reset attempt must match that unlink, have status acknowledged and an
  acknowledged_at timestamp no earlier than revocation and history unlink time.
- A fresh pairing code must have created_at >= acknowledged_at. Old codes cannot
  survive reset and be used to approve stale requests.
- Orphan reset jobs without an unlink block; a never-owned device with no unlink,
  history or reset job is eligible. Inconsistent legacy records fail closed.

No unlink/reset operation is performed here. The later unlink/reset module must
close history, complete its operation, record valid reset acknowledgement and restore
available lifecycle before reprovisioning a code.

## Verification / readiness

From BE: `npm.cmd run build`, `npm.cmd test`,
`node scripts/check-pairing-readonly.cjs`. The script validates live metadata, scoped
list and locking-read SQL without DML/fixtures. Tests cover real Nest HTTP routes,
guards, DTOs, service state transitions, transaction fault paths, SQL and reset predicates.
Concurrency service tests use a serialized in-memory transaction model; they are not
proof of populated MySQL races. See `d2s202-test-report.md` for verified vs pending items.
Prompt 3 can use assignment.device_id -> user_id and the shared verified identity;
firmware provisioning, login-issued JWT and populated MySQL concurrency integration
remain integration dependencies, not newly implemented features.
