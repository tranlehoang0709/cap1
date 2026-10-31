# D2S201: Admin Device List / Detail

## Scope and source of truth

Use the existing running MySQL V1.5 schema, also represented by
`src/database/AIVA_IoT_V1_5_CREATE_MYSQL.sql`. The later user-supplied DBML is
reference material only. Do not run the CREATE script for this task.
No tables, indexes, routines, triggers or persisted rows are created/altered/deleted.
The root `database_schema.sql` is empty and is not used.

Flow: HTTP -> AdminDeviceGuard -> UsersService -> DevicesController ->
DevicesService (DTO parsing) -> DevicesRepository -> MySQL -> explicit public projection.
Existing empty Auth/Devices files provided no HTTP convention; success is a plain JSON
object and errors use Nest's standard statusCode/message/error response.

## Admin access contract

There is no login/access-token issuer in this repository yet. This module verifies
HS256 access JWTs using Node crypto, with no additional dependency. Configure
`ADMIN_ACCESS_JWT_SECRET` (at least 32 bytes), `ADMIN_ACCESS_JWT_ISSUER`, and
`ADMIN_ACCESS_JWT_AUDIENCE`; missing configuration fails closed with 401.
Header: `Authorization: Bearer <access JWT>`; JWT header must be
`{"alg":"HS256","typ":"JWT"}`. Claims: `sub` (positive signed BIGINT decimal
string), `exp` (future integer Unix seconds), `iss`, `aud` (exact configured strings),
optional `nbf`. Unknown critical header extensions are rejected.
Never send a refresh token to these routes. `auth_sessions.refresh_token_hash` is
not an access-token verifier. Role claims in JWT are ignored: UsersService checks
persisted role cardinality, ADMIN role, active account and verified email per request.

Dev 1 must align its issuer with this contract or replace this route-specific guard
with its established verifier before integration. Access tokens should be short-lived.
Session logout/revocation is not implemented here; this verifier has no session claim.
Account suspension/demotion takes effect on the next request. Signing-key rotation
invalidates existing tokens. No signing key is added to `.env` by this task.

## HTTP contracts

`GET /admin/devices?page=1&limit=20&search=robot&connectionStatus=offline`

- page: positive decimal integer, default 1, maximum 1,000,000.
- limit: positive decimal integer, default 20, maximum 100.
- search: optional trimmed text, maximum 128 characters, no control characters;
  literal substring match on device_uid or display_name using MySQL collation.
  `%`, `_`, `!` are escaped, not treated as user wildcards.
- connectionStatus: optional exact stored status; lowercase identifier of 1–20
  characters, allowing digits and underscores after the first letter. Unknown
  well-formed values return empty results, because schema has VARCHAR, not ENUM.
- Arrays/repeated recognized query parameters are invalid. Unknown query fields
  are ignored. Sorting is fixed at device ID ascending; there is no sort parameter.

```json
{
  "items": [{
    "id": "42", "deviceUid": "robot-42", "displayName": "AIVA",
    "lifecycleStatus": "assigned", "connectionStatus": "offline",
    "lastSeenAt": null, "owner": {"id": "7", "displayName": "Owner"}
  }],
  "pagination": {"page": 1, "limit": 20, "total": 1}
}
```

`GET /admin/devices/:deviceId` (the prompt's second path is interpreted as detail).
ID is a canonical positive decimal string up to 9223372036854775807.
Returns list fields plus `hardwareModel`, `currentFirmwareId`, `createdAt`,
`updatedAt`, and `currentAssignment`:

```json
{
  "deviceId": "42", "userId": "7", "pairingRequestId": "9",
  "assignedBy": "1", "assignedAt": "2026-10-30T00:00:00.000Z"
}
```

BIGINT IDs are strings; nullable columns remain null; dates serialize as UTC ISO
strings. No assignment means both owner and currentAssignment are null. No
credentials, pairing codes, hashes, password fields or provider secrets are selected.
Status codes: 200 success, 400 invalid query/ID, 401 missing/invalid/expired token,
403 non-Admin/ineligible persisted identity, 404 absent device, 500 DB failure.

## Database relationships and query behavior

`devices.id` PK -> `device_assignments.device_id` PK (zero or one current row)
-> `users.id` PK through assignment.user_id. LEFT JOIN preserves unowned devices.
Assignment also references pairing_request_id (unique), assigned_by -> users.
Do not JOIN assignment history, telemetry or credentials into the list: those are
one-to-many and could duplicate devices. The current assignment PK prevents duplicates.
No User service provides a device lookup; reuse UsersService for account/RBAC and
the existing mysql2 Pool/DatabaseModule for device reads. There is no ORM installed.

List uses a read-only repeatable-read snapshot for count and page consistency.
Joins/detail use existing PKs; default order can traverse the devices PK. device_uid
has a unique index. Existing schema has no connection_status index, and substring
LIKE cannot rely on that unique index for range lookup. Filter/count can scan devices;
large offsets also cost more. No index changes are made under the user's constraints.

## Prompt 2 prerequisites (documentation only)

Pairing code is stored hashed, expiring, revocable and single-use. Validate the user,
code lifetime, device lifecycle and absence of current assignment. Approval must
authorize a persisted Admin and atomically lock/recheck request, code and device,
consume the code, insert the unique current assignment and update request/lifecycle.
Serialize competing approvals using device lock and assignment PK; define retry and
conflict responses, expiry duration, lifecycle vocabulary and audit behavior in Prompt 2.
History is separate from current assignment. Do not leak code/credential hashes.

## Proposed AI Server contracts (documentation only; no new routes enabled)

These are proposals for agreement with AI Server, not claims about its current API.
Use TLS and a separate authenticated service identity for internal server calls;
Admin access JWTs must not be reused as device credentials.

- Device authentication: proposed `POST /internal/devices/authenticate` from trusted
  AI Server. Body `{deviceUid, credential}`. Lookup UID via unique index; verify
  credential against device_credentials using an agreed hash scheme, requiring
  active, unrevoked and unexpired credentials. Do not compare plaintext to a hash.
  Return `{deviceId, lifecycleStatus, ownerUserId, assignment}` only after successful
  verification. Unknown/invalid credential -> generic 401; disallowed lifecycle ->
  403. Keep device credential and server-service authentication separate; redact both.
- Heartbeat: proposed `POST /internal/devices/:deviceId/heartbeat`, body
  `{eventId, observedAt, connectionStatus}`. Bind device ID to authenticated connection.
  Backend receipt time governs lastSeenAt; ignore stale events and never allow
  unauthenticated clients to mark another device online. Return `{accepted, serverTime}`.
- Telemetry: proposed `POST /internal/devices/:deviceId/telemetry`, body
  `{eventId, observedAt, eventType, wifiRssi?, freeHeapBytes?, batteryPercent?, payload?}`.
  Map to device_telemetry; enforce payload bound, battery 0–100, nonnegative heap,
  approved event types, rate limits and server timestamps. Never include tokens or
  provider keys in payload. Bad input -> 400, missing auth -> 401, forbidden binding ->
  403, missing device -> 404. Timeouts/retries and online expiry threshold need agreement.

Current telemetry schema has no eventId/unique deduplication column. Durable exactly-once
delivery is not promised: agree at-least-once behavior or an external idempotency store
without altering this schema. Heartbeat/telemetry persistence and offline timeout jobs
belong to later prompts. AI provider keys are not part of these Admin read responses.

## Verification / recovery

Run from BE: `npm.cmd run build`, `npm.cmd test`, then
`node scripts/check-devices-readonly.cjs` against existing `.env` credentials.
The last command inspects metadata, executes repository queries and EXPLAIN, checks
unique IDs and missing detail, and does not seed data. HTTP tests use mocked persistence
with real Nest routing/guards. Populated owner cases do not write to the live database.
See `d2s201-test-report.md` for actual run results and outstanding limitations.
Revert only this task's Devices files, app.module import, env example, tests, scripts
and docs to recover; leave unrelated user changes intact. Checkpoint before task:
`c7ad00e`. No commit or push is performed.
