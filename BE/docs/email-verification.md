# Email verification recovery

Scope: local development, existing V1.5 schema. No migration/seed/account creation.

- `POST /auth/resend-verification`, body `{ "email": "..." }`, returns 202 with
  `Nếu tài khoản đủ điều kiện, hướng dẫn xác minh sẽ được gửi.` for unknown,
  ineligible and email-rate-limited addresses as well as eligible requests.
- DTO rejects unknown fields and malformed/overlong email (400). IP throttle is
  5 requests/minute (429). Single-process RAM limiter: 60s cooldown, rolling 3/hour,
  atomically claimed before await. Restart resets RAM limits. No cluster guarantee.
- Requires explicit `NODE_ENV=development`,
  `EMAIL_VERIFICATION_DELIVERY=development-console`,
  `EMAIL_VERIFICATION_FRONTEND_URL=http://127.0.0.1:8513`, and interactive stdout.
  Missing channel, redirected stdout and production console are refused (503 or
  startup configuration rejection). No token is written through Nest Logger.
- Existing active, unverified, single-role USER only. Lookup never reads password/hash.
- Reuses the existing verification signer: issuer `aiva-iot`, audience
  `aiva-email-verification`, purpose `email_verification`, TTL 900s. No new token table.
- A link uses `#verify-email=...`, never a token query parameter. Frontend removes
  the fragment before passing its value to RAM, masks the input and requires an
  explicit Verify button. GET does not verify anything. No token is persisted by FE.
- `POST /auth/verify-email` remains the only route updating verification. Existing
  valid links remain valid until expiry; after verification repeat confirmation is
  idempotent. Do not claim single-use token invalidation or revocation on resend.
- Registration/Admin-create response contract is unchanged, including its existing
  `verification_token` field. Frontend never displays that response token. This
  compatibility requirement is NOT production delivery/security approval.

## Production remains unavailable

No SMTP/provider credentials or production transport was provisioned. Resend fails
closed outside the explicit local console mode. Production needs a real mail adapter,
shared atomic rate-limit store, deployment logging review and explicit owner approval
for registration-token response hardening. No durable outbox or automatic delivery
retry is claimed. Do not run console mode behind log collectors or screen recording.

## Owner action for User ID 2

In a private local terminal, from BE run `node scripts/prepare-user-e2e.cjs`.
The helper requests at most one resend for the existing User ID 2 if needed. Open
its link from the dedicated Backend console and explicitly verify in the Frontend.
Then return to the helper, press Enter and provide the existing User password using
hidden input. It verifies account eligibility read-only and saves only the approved
E2E email/password variables in ignored BE/.env. It cannot reset/create accounts.
Never paste a link, password or token into chat. Account ownership remains an owner action.
