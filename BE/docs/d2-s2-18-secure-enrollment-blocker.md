# D2-S2-18 — Secure wireless enrollment: schema blocker

Status: **BLOCKED before implementation** (2026-11-04). The live MySQL schema
was inspected read-only. No BE source, schema, or data was changed; no tests
were run because the authenticated-device enrollment contract cannot be
implemented safely with the current schema.

## Existing contract

Current routes and roles:

| Method/path | Role | Behavior |
| --- | --- | --- |
| `POST /devices/admin` | ADMIN | Register device by UID/model. |
| `POST /devices/admin/:id/pairing-codes` | ADMIN | Issue short-lived one-time code; plaintext returned once. |
| `POST /user/devices/pairing-requests` | USER | Submit `{ "pairingCode": "..." }`; request is tied to the device referenced by the code and authenticated user. |
| `GET /user/devices/pairing-requests` | USER | List own requests. |
| `GET /admin/pairing-requests` | ADMIN | List/review queue. |
| `POST /admin/pairing-requests/:id/approve` | ADMIN | Approve, assign device and record audit. |
| `POST /admin/pairing-requests/:id/reject` | ADMIN | Reject and record audit. |
| `POST /devices/admin/:id/credential` | ADMIN | Issue a random credential once; immediately revokes the currently active credential. |
| `POST /internal/devices/authorize` | AI_SERVER service token | Validate UID + active credential for AI_SERVER. |

The older `/devices/pairing-requests` and `/devices/admin/pairing-requests/...`
routes also exist. They are a separate implementation surface; new enrollment
must select and reuse one canonical pairing contract rather than introduce a
third route family.

## MySQL inspection

Read-only `information_schema` inspection confirmed these tables:
`devices`, `device_credentials`, `device_pairing_codes`,
`device_pairing_requests`, `audit_logs`.

Relevant columns:

- `devices`: identity is `device_uid`; there is no per-device public key,
  certificate fingerprint, or key version.
- `device_pairing_codes`: `code_hash`, expiry, consumed/revoked timestamps.
- `device_pairing_requests`: device/user/code IDs, state, reviewer and audit
  fields.
- `device_credentials`: credential hash, status, expiry/revoke timestamps.
  It has no staged delivery ciphertext/acknowledgment/supersession state.
- `audit_logs`: can represent lifecycle audit events without a new audit table.

No enrollment challenge table exists. The current tables cannot prove an
uncredentialed ESP32's identity, store a one-time replay-safe challenge, retain
a credential for protected one-time delivery, or model prepare/ack/commit
rotation. `device_uid`, MAC, and a fleet-shared secret are not suitable
substitutes. The current issuance revokes the old active credential before the
device has received or durably stored its replacement.

## Proposed minimum API contract (not implemented)

Requires a unique device root private key/certificate provisioned before
operation, with the corresponding public identity registered against the
device. Requests must use verified HTTPS, signatures over method/path/body,
challenge ID and server nonce, and bounded clock-independent expiry. The
private root key must never be sent to BE. Rate-limit by device identity,
source and challenge lifecycle; never log proof, nonce, pairing code, or
credential. UID may route a lookup but must not authorize it.

1. `POST /internal/devices/enrollment/challenges` — device proves its
   registered public key identity. Body: `{deviceUid, publicKeyId}` plus a
   detached signature over the request. Response: `{challengeId, nonce,
   expiresAt}`. No credential is issued. Limit one unexpired challenge per
   device, persist only nonce hash, expire quickly (suggested 2 minutes),
   one use, constant response for unknown/revoked identity.
2. Authenticated user submits the existing one-time pairing code to
   `POST /user/devices/pairing-requests` with current contract. Response
   remains `{id, deviceId, status:"PENDING"}`. Approval stays on the existing
   Admin endpoint. No user ID is accepted from the body.
3. `POST /internal/devices/enrollment/credential-delivery` — device proves
   possession by signing the fresh server nonce with its registered key.
   Body: `{deviceUid, challengeId, signature}`. Response while pending:
   `202 {status:"PENDING_APPROVAL", retryAfterSeconds}`. After approval,
   atomically create a new credential and return it once as
   `200 {status:"READY", credential, deliveryId, expiresAt}` over TLS with
   `Cache-Control: no-store`. The credential is not in a URL. Require an
   idempotency/delivery ID and signed challenge; second retrieval must not
   disclose the secret again. Device signs a receipt/credential hash to
   `POST /internal/devices/enrollment/credential-ack`. Activate only after
   valid acknowledgment; expire unacknowledged delivery and revoke the staged
   credential. Do not permit audio/WebSocket before active state.
4. Rotation: `POST /internal/devices/credentials/rotation/prepare` returns a
   one-time staged replacement under the device-root proof and fresh
   challenge. Device persists it and sends signed
   `POST /internal/devices/credentials/rotation/ack`. Commit atomically
   activates new and revokes old; until commit the old credential stays valid.
   Abort/timeout revokes only the staged replacement. An explicit ADMIN
   recovery/revoke remains available and audited.

These are proposed paths, not existing APIs. The existing AI_SERVER service
token guard cannot authenticate an ESP32 and must not be reused as device proof.

## Minimum migration required (not applied)

1. Add provisioned device public-key identity to `devices` (key algorithm,
   public key/certificate fingerprint, key version, state, uniqueness and
   rotation/revocation timestamps). Registration must validate an attested or
   controlled manufacturing identity; never register keys supplied solely by
   an unauthenticated caller.
2. Add `device_enrollment_challenges`: device FK, nonce hash, created/expiry,
   consumed/revoked timestamps and bounded attempt count; unique challenge ID
   and indexes for device/expiry/state.
3. Add staged credential delivery/rotation metadata, or a separate
   `device_credential_handoffs` table: credential FK, encrypted one-time
   delivery secret (envelope encrypted with managed server key), delivery ID,
   expiry, delivered/acknowledged/committed/aborted timestamps, superseded
   credential FK, and unique idempotency constraints. Hash-only storage cannot
   return a credential to the device after approval; plaintext storage is not
   acceptable.
4. Retain pairing, assignment, and `audit_logs`; add audited events for
   enrollment challenge, delivery, acknowledgment, rotation prepare/commit,
   timeout, abort, and revocation. Ensure audit metadata excludes secrets.

Before migration, confirm the device hardware/firmware can hold a unique
private key and verify the chosen signature algorithm, TLS CA/hostname and
certificate renewal. This BE-only task cannot provision a trust root onto the
existing SD1/SD2 firmware. Do not deploy the proposed endpoints until that
key-registration path is established.

## Security tests required after approval

- Registered device signs challenge and receives a fresh nonce; UID/MAC alone,
  unknown key, wrong signature, revoked key and malformed proof fail closed.
- Expired/replayed challenge and duplicate delivery ID cannot mint or disclose
  another credential; concurrent delivery yields one credential and one audit
  sequence.
- Owner pairing request is tied to authenticated user and the code's exact
  device; expired/consumed/revoked code, second pending request, forged user ID
  and unapproved device cannot receive a credential.
- Only ADMIN can approve/reject; USER cannot review; only the proven device can
  poll/ack delivery. Rejected or pending requests never release a credential.
- Credential is absent from URLs, logs, errors, list APIs and audit metadata;
  one-time response has no-store. Stored delivery secret is encrypted at rest.
- Rotation keeps old credential valid until correct signed acknowledgment,
  then activates new and revokes old atomically. Timeout/abort preserves old;
  replayed ack and concurrent rotations fail safely.
- Per-device/source throttling, challenge TTL, audit events, rollback behavior,
  and TLS termination/configuration are integration-tested against MySQL.

## Blocker / next action

The user explicitly prohibited self-applying schema changes. The migration and
firmware trust-root requirement need approval/design before implementation.
No API or security tests were added because any partial endpoint would have to
trust UID, pairing code, or shared service credentials and would violate the
stated security requirements. Once the migration and unique-key enrollment
provisioning contract are approved, implement the BE endpoints and integration
tests against an isolated MySQL schema first; no production schema changes are
implied by this report.
