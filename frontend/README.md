# AIVA-IoT Frontend

Streamlit + Three.js r180. The presentation restores the c7ad00e baseline while
keeping Backend authentication, eight User destinations, eight Admin destinations
and the existing REST contracts. No demo state or fabricated AI replies are used
by app.py. The legacy demo store remains guarded by an explicit DEMO opt-in and
is not called by the production entrypoint.

## Run

Use an existing Python environment containing requirements.txt. From frontend/:

~~~powershell
python -m streamlit run app.py --server.port 8512
~~~

Choose a free port; do not stop another agent's service. AIVA_BACKEND_URL defaults
to http://127.0.0.1:3000 and is also used by the authenticated chat adapter. Set a
different public origin in the launch environment only when appropriate. No
Frontend .env is required. Do not copy Backend secrets into Frontend settings.

Login/register/verify-email/refresh/logout remain Backend operations. No demo
credentials or automatic email verification are provided. Access/refresh tokens
stay in the Streamlit session; secret inputs are never printed or written by
the Frontend.

## UI and API coverage

- Split login with interactive Xiaozhi, custom header/sidebar and light/dark theme.
- Dashboard cards use API totals and complete verified paginated collections;
  an API failure is displayed rather than replaced with zero/sample figures.
- Chat workspace uses AuthenticatedChatPortal and a content-only POST. History
  opens read-only with owner validation. New chat clears the current display;
  the Backend controls persisted conversations. Generation POST is never replayed.
- Device cards use existing r180 assets, expression preview, rotate/zoom/reset,
  pause/reduced-motion and four-card pagination. Decorative models are labeled;
  connection status comes from Backend data.
- Model/provider selection, partial profile updates, personal API keys, searchable
  paginated history, confirmed deletion, privacy preferences and profile/password.
- Admin users/devices/providers, system-key metadata/submission/revocation, quota
  policy metadata/create/deactivate, monitoring/logs, OTA metadata/release and
  settings retain Backend authorization and use explicit write confirmations.

The UI does not certify real AI execution, quota enforcement, device reset or
MySQL readiness. Credential delivery, quota/usage runtime and history-disabled
end-to-end AI replies can remain blocked by Backend/AI contracts. Memory,
knowledge, conversation rename/end/resume and new reset/handover flows are not
invented. No schema migration or Backend/AI/firmware change accompanies this UI.

## Verification

Use real Streamlit, in an isolated test process without real credentials:

~~~powershell
python -B -m unittest discover -s checks -p "test_*.py" -q
python -B -m unittest discover -s checks -p robot_components.py -q
~~~

Existing robot unit tests are in ui/assets/aiva3d/. They require the declared
Three.js 0.180.0 dependency; do not change its version or rebuild the bundle just
to make a test pass.

The explicit browser fixture creates its own loopback HTTP server and Streamlit
process, then cleans up only those processes. It never connects to a real
Backend, database or provider:

~~~powershell
python -B checks/preview_restored.py --fixture --artifacts <directory-outside-repository>
~~~

It uses installed Chrome and the already declared @playwright/test dependency.
AIVA_PLAYWRIGHT_MODULE may point to an existing installation when needed. Generated
screenshots/logs remain outside the repository. This matrix checks 390/768/1024/
1440 px, User/Admin navigation, themes and real WebGL. Fixture PASS is not live PASS.
Historical browser suites that require demo accounts or frozen camera-environment
receipts are separate from this authenticated API restoration matrix.


## Email verification recovery and live User E2E

The verification tab accepts the official resend/verify endpoints. Fragment links
are consumed locally, removed from the URL, kept in RAM and masked. A confirmation
button is required; GET never verifies an account. No token is placed in query
parameters, screenshots or test traces by the provided runner.

Backend development delivery requires an explicitly enabled private interactive
console; redirected stdout and production console delivery are refused. See
`../BE/docs/email-verification.md`. Registration response compatibility is preserved;
production email delivery and registration response hardening remain deployment work.

Owner preparation: in a private terminal run `node scripts/prepare-user-e2e.cjs`
from BE. This uses existing User ID 2 only and stores its owner-provided credentials
in ignored BE/.env (`AIVA_E2E_USER_EMAIL`, `AIVA_E2E_USER_PASSWORD`). No account/password
creation or reset is performed. Never paste verification links or secrets into chat.

Run `node checks/user_live_e2e.cjs` from frontend after owner preparation. Provide
`AIVA_PLAYWRIGHT_MODULE` for an existing Playwright installation and
`AIVA_E2E_PYTHON` for the existing Streamlit Python environment. The runner creates
its own live test host (default port 8514) executing the real app and two read-only
role-denial probes through the standard FE client. It uses real Backend 3000,
never mocks or exports browser credentials, and stops only its own test host.
It checks readiness before login and reports ACCOUNT ACTION REQUIRED when absent.
Auth writes (last_login_at/session creation/revocation) are the only permitted writes;
no AI generation or business mutations are executed. Artifacts go outside the repo.
