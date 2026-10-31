# D2S204 — AI Configuration & API Key — 2026-10-30

## Requirement / implementation

Implemented Provider list/Admin enabled+default model management, User-level AI
personalization, personal and SYSTEM key metadata/create/replace/revoke, explicit
credential scope and reference-only internal config resolution. Schema was inspected
live: ai_profiles has user_id PK, API credential owner_scope USER/SYSTEM with nullable
owner_user_id, and system_settings stores JSON. No DDL, fixture data, new dependencies,
frontend, firmware or AI Server changes. Existing related modules were empty.

API entry point: `../API_CONTRACT.md` contains all routes, validation, responses,
security requirements and integration blockers across Prompt 1–4.

## Files / dependency reuse

Filled `ai-providers/ai-providers.repository.ts`, `.service.ts`, `.controller.ts`,
`.module.ts`, `ai-profiles/ai-profiles.controller.ts`, `api-keys/api-keys.controller.ts`.
Added `ai-providers/ai.dto.ts`, `ai.guards.ts`, `api-keys/secret-encryption.service.ts`,
`test/ai-configuration.spec.ts`, `test/ai-http.spec.ts`, `scripts/check-ai-readonly.cjs`.
Changed app.module.ts, AccessRoleGuard (optional role for shared Provider list),
.env.example, API_CONTRACT.md and added this report. Other pre-existing empty services
were not filled with duplicate logic: AiProvidersService orchestrates the transaction
across Provider/Profile/Credential operations, with thin controllers in owning folders.

Reuses AccessRoleGuard/UserPairingGuard/AdminDeviceGuard, UsersRepository account/role
locks and audit, DatabaseModule/mysql2. Internal config uses OwnershipTransaction on
the same connection for device/assignment checks. No existing encryption was found;
Node crypto AES-256-GCM added without a dependency. Existing JWT guard roles remain
fixed for existing endpoints; only the new Provider list accepts either persisted role.

## Execution flow / design

Public JWT -> persisted role guard -> DTO/service -> transaction -> recheck/lock actor
-> Provider/model/scope validation -> encrypted credential/profile/settings write ->
audit -> commit. Errors roll back and release connection; generic errors do not echo
SQL, ciphertext or input secret. Prompt/profile text is not written into audit metadata.

Provider defaults use system_settings `ai.provider.<id>.defaults`; explicit scope uses
`ai.user.<id>.credentialScope`, retaining User-level ai_profiles PK. Default scope is
USER; SYSTEM requires explicit stored selection and deployment allowlist permission.
No missing USER key fallback to SYSTEM. LOCAL never queries a cloud key. Models must
be enabled, same provider and LLM. Actual local runtime availability/voice catalog is
supplied by future AI Server integration, not invented in this task.

Cloud keys are GCM encrypted with random per-save nonce and authenticated owner/scope/
provider context. Only redacted metadata is public; hint is literal configured, no raw
suffix. Multiple active keys resolve newest ID deterministically. Revoked keys cannot
be replaced/reactivated; revoke is idempotent. Unsupported legacy ciphertext fails closed.
Master-key rotation/re-encryption tooling is not implemented; keep old key until a
planned re-encryption can be performed. No actual encryption key was generated/saved.

Internal service authentication is separate and flag-gated. With device context,
parent device is locked before actor/provider/credential; approved ownership is
revalidated. Without device context, trusted AI Server must bind requested User to
its authenticated session. Internal response returns persona/provider/model/scope
and a key reference only; no secret-fetch endpoint is added.

## Verification

Final results:

- PASS — `npm.cmd run build`.
- PASS — `npm.cmd test`: 10 suites / 264 tests, including 59 new AI tests and all 205
  existing Prompt 1–3/User/configuration tests.
- PASS — `node scripts/check-ai-readonly.cjs`: actual provider/model/profile/settings/credential
  SELECT and locking SQL with no DML, fixtures, secret output or schema modification.
- PASS — `git diff --check` (only Windows LF/CRLF notices).

Live DB has enabled LOCAL/OPENAI/GEMINI and zero models for all three. No model or
profile/key was inserted to make a test pass. Earlier implementation/schema inspections
printed metadata/provider codes only, never api_credentials secret values.

## Acceptance evidence

| Criterion | Status / evidence |
|---|---|
| Admin Provider update; User denied | PASS service + real HTTP guard tests |
| Enabled/authorized Provider and compatible models | PASS service filtering and mismatch/disabled/capability tests |
| User profile get/create/update and isolation | PASS JWT scope/service tests + SQL user_id PK |
| USER/SYSTEM key isolation | PASS owner-scoped SQL and role/scope tests; explicit SYSTEM permission |
| Key encryption/integrity/redacted responses/audit | PASS randomized GCM round trip, tamper/wrong owner/scope tests and response checks |
| Missing/revoked/corrupt Cloud key handled | PASS active/unrevoked predicates and resolution tests |
| LOCAL works without key; no implicit SYSTEM fallback | PASS service tests |
| Key create/list/replace/revoke APIs | PASS service/repository + HTTP routing/status/role tests |
| Internal unauthorized caller/device rejected | PASS service-token/flag guard and ownership tests |
| Correct User persona/provider/model/reference | PASS simulated approved contract fixture; raw secret excluded |
| Atomic audit/config changes | PASS repository commit/rollback/fault tests; populated live write rollback NOT VERIFIED |
| Prompt 1–3 regressions | PASS in full suite |
| Schema unchanged / no development data writes | PASS executed commands and reviewed diff; live script is SELECT-only |
| Cross-service config/secret delivery agreement | BLOCKED, not approved; default false gate |
| Real provider key validation / populated MySQL profile/key lifecycle | NOT VERIFIED; no external calls/fixtures |

## Blockers / next task

Internal AI config/secure credential delivery is not validated with AI Server. Keys
are not returned plaintext under an unapproved contract. Reference-only code/tests
do not mean Cloud inference can consume the key; agree a secret broker/delivery
protocol first. No remote OpenAI/Gemini key validation integration exists, so stored
key validity means syntax + scope + active state + GCM integrity, not verified billing/
permissions/provider acceptance. A revoked provider-side key still needs revoke or
replacement in Management Backend after an external provider failure.

Model catalog must be provisioned by the responsible developer/operator; encryption
and service secrets and login issuer require local deployment configuration. None
were generated/saved or enabled in this task. Full DoD end-to-end is therefore not
claimed complete. Prompt 7 can build on explicit scope/provider/User metadata and
references; provider usage accounting and ongoing-session key invalidation remain future.

## Recovery

Pre-task HEAD c7ad00e, previous prompt/user changes uncommitted; no commit/push.
Revert only this prompt's AI module/controller/repository/crypto/DTO/guard/test/script/
report additions, AiProvidersModule registration, AI env example/API contract section
and optional-role change (preserve other guard behavior). No development DB rollback
needed: no DML executed. Runtime key revocation uses soft revoke; never delete audit
or credential rows manually to roll back configuration. Protect any deployed master key.
