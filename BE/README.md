# AIVA-IoT Backend

NestJS REST API with MySQL persistence through `mysql2` and parameterized SQL. The V1.5 schema is the contract in `src/database/AIVA_IoT_V1_5_DATABASE_BASELINE.dbml`; `synchronize` is not used. Device protocol/runtime work is outside this service and must follow the separately reviewed Xiaozhi protocol draft.

## Setup

Requirements: Node.js 20.19+ and MySQL 8. Copy `.env.example` to `.env`, set database credentials, and replace the two JWT secrets with different random values of at least 32 characters. Set a strong `ADMIN_PASSWORD` before first startup. Do not commit `.env`.

```powershell
npm ci
npm run migration:run
npm run start:dev
```

`migration:run` applies `001-v15-baseline` only to an empty `aiva_iot` database (it creates the database if the MySQL user is allowed). It refuses an untracked non-empty database; back it up and reconcile its schema before proceeding. The original SQL baseline seeds roles and AI providers. On application startup, the configured Admin account is created only if the email does not exist. Existing credentials are never overwritten. Registration marks email verified because this phase intentionally supports immediate sign-in and no email delivery service exists.

## Configuration

See `.env.example` for all settings:

- `DB_*`: MySQL connection (`DB_NAME` is restricted to `aiva_iot`).
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`: separate signing secrets (32+ chars).
- `ACCESS_TOKEN_TTL_SECONDS` (default 900) and `REFRESH_TOKEN_TTL_SECONDS` (default 2592000).
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_DISPLAY_NAME`: initial Admin seed.
- `CORS_ORIGINS`: comma-separated exact HTTP(S) origins; empty disables browser CORS.

Refresh JWTs are stored as SHA-256 hashes and rotated on use. Passwords use bcrypt. Login is throttled to 5 requests per minute per client IP by the in-memory Nest throttler; production multi-instance deployments should use a shared throttler store.

## API

Swagger UI: `GET /api/docs`; OpenAPI JSON: `GET /api/docs-json`. The Nest process health endpoint is `GET /health` and checks process readiness only, not MySQL health.

| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Register a USER account |
| POST | `/auth/login` | Public, throttled | Issue access and refresh JWTs |
| POST | `/auth/refresh` | Public | Rotate refresh JWT; previous token is invalidated |
| POST | `/auth/logout` | Authenticated | Revoke the caller's refresh token |
| GET | `/auth/me` | Authenticated | Current identity and role |
| PATCH | `/auth/password` | Authenticated | Change password; revoke all refresh sessions |
| GET | `/users/me` | Authenticated | Read own profile |
| PATCH | `/users/me` | Authenticated | Update own display name |
| GET/PATCH | `/users/me/privacy` | Authenticated | Read/update history preference |
| POST | `/users` | Admin | Create a USER account |
| GET | `/users` | Admin | Search and paginate users |
| GET | `/users/{id}` | Admin | Read user and role |
| PATCH | `/users/{id}/role` | Admin | Change role; protects last active Admin |
| PATCH | `/users/{id}/status` | Admin | Change account status and revoke sessions when disabled |
| DELETE | `/users/{id}` | Admin | Soft-disable account; preserves audit/FK records |
| GET | `/health` | Public | Process health |

### Devices and pairing

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/devices` | User/Admin | List caller-owned devices |
| PATCH | `/devices/{id}` | Owner | Rename a device |
| DELETE | `/devices/{id}/assignment` | Disabled | Returns 403 `ADMIN_RECOVERY_REQUIRED`; use Admin revoke/reset |
| POST | `/devices/pairing-requests` | User/Admin | Consume a one-time code and request pairing |
| GET | `/devices/pairing-requests/mine` | User/Admin | List caller pairing requests |
| POST | `/devices/admin` | Admin | Register a physical device |
| GET | `/devices/admin/all` | Admin | List all devices |
| POST | `/devices/admin/{id}/pairing-codes` | Admin | Issue a one-time code; plaintext returned once |
| POST | `/devices/admin/{id}/credential` | Admin | Rotate credential; plaintext returned once |
| GET | `/devices/admin/pairing-requests` | Admin | List all pairing requests |
| POST | `/devices/admin/pairing-requests/{id}/approve` | Admin | Assign device after review |
| POST | `/devices/admin/pairing-requests/{id}/reject` | Admin | Reject request after review |
| GET | `/devices/device/me` | Device credential | Verify credential and return device identity |
| POST | `/devices/device/heartbeat` | Device credential | Record heartbeat and current telemetry |

Device credentials and pairing codes are generated with cryptographically secure randomness. Only their SHA-256 hashes are stored. Pairing codes are one-use and expire after 1–60 minutes; they are not device credentials. See `docs/TODO-protocol.md` before connecting an AI Server or Xiaozhi firmware.

### AI, personal keys, and web chat

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/ai/providers` | Authenticated | List configured providers |
| PATCH | `/admin/ai/providers/{id}` | Admin | Enable/disable a provider |
| GET/PATCH | `/ai/profile` | Authenticated | Read/update caller assistant profile |
| GET/POST | `/api-keys` | Authenticated | List/create personal provider key |
| DELETE | `/api-keys/{id}` | Owner | Revoke personal provider key |
| POST | `/web-chat/messages` | Authenticated | Returns 503 while real provider execution and approved quota/usage settlement are unavailable |
| GET | `/conversations` | Owner | Paginated caller conversation list |
| GET/DELETE | `/conversations/{id}` | Owner | Read or soft-delete conversation |
| GET | `/quotas` | Authenticated | Read caller quota policies |
| GET | `/admin/quotas` | Admin | List all quota policies |
| POST | `/admin/quotas` | Admin | Create a quota policy |

Personal API keys are encrypted at rest with AES-256-GCM using `APP_ENCRYPTION_KEY`; only a final-four hint is returned. The chat route is fail-closed and does not persist fabricated assistant messages or estimated token usage. Live chat is unavailable until real provider execution, approved quota admission, and actual usage settlement are ready.

### Admin operations and OTA

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/admin/dashboard` | Admin | Live user, device, conversation and usage counters |
| GET | `/admin/logs` | Admin | Paginated system logs with severity/component filters |
| GET | `/admin/audit-logs` | Admin | Paginated audit log records |
| GET | `/admin/monitoring/instances` | Admin | AI Server instance health records |
| GET/PUT | `/admin/system-settings/{key}` | Admin | Read and update non-secret JSON settings |
| GET/POST | `/admin/firmware` | Admin | List and register firmware metadata |
| POST | `/admin/firmware/{id}/release` | Admin | Release a firmware version |
| GET | `/firmware/device/check` | Device credential | Check the latest released version for a hardware model |
| POST | `/firmware/device/updates/{id}/status` | Device credential | Report OTA progress |

Firmware storage is represented by a controlled `file_uri`; the API validates the SHA-256 checksum format but does not accept binary uploads yet. Device wire protocol and AI Server runtime work remain pending the approved Xiaozhi contract in `docs/TODO-protocol.md`.

Roles are loaded from the database for each authenticated request, so role/status changes take effect without waiting for an access token to expire. Admin routes also enforce the active, verified Admin constraint in the users service.

## Checks

```powershell
npm run build
npm run lint
npm test
npm run test:e2e
```

The current `lint` script runs TypeScript's no-emit type check. Run the migration only against an intentionally empty development/test database.
# D2-S2-15 integration update

See [live Gemini contract, Windows commands and readiness](docs/d2-s2-15-live-gemini.md).
Web Chat now delegates to authenticated AI_SERVER execution; live acceptance
still requires the existing quota schema, model, credential, policy and gates.


Robot registration/handover changes, existing-DB migration and verification: [docs/robot-handover.md](docs/robot-handover.md).
