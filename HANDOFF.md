# AIVA-IoT GitHub handoff â€” owner review

2026-11-05 (Asia/Bangkok). **Source handoff for review; not deployment-ready.**
No commit or push. Repository: https://github.com/tranlehoang0709/cap1
Pinned baseline: main@7b7412d22499b115988548e93313c7e50c7b53a5.
Local isolated branch: handoff/aiva-integration-phase2 (not published).

## Checkout and provenance

Checkout: C:/Users/ADMIN/AppData/Local/Temp/aiva-handoff-phase2-fcfe98c1391a464b8cddcf520a721e41
Local evidence: C:/Users/ADMIN/AppData/Local/Temp/aiva-handoff-phase2-fcfe98c1391a464b8cddcf520a721e41-review

| Original source, read only during assembly | Git relationship | Destination |
|---|---|---|
| E:/captone_be_fix/BE | Linked worktree root E:/captone_be_fix, fix/be-integration-gates@74b9fa6 | BE/ |
| E:/captone_ai/repo/AI_SERVER | Separate shallow clone root E:/captone_ai/repo, main@7b7412d | AI_SERVER/ |
| E:/captone/frontend | Root E:/captone/frontend, main@7a1f6e2; different root layout | frontend/ |

All origins point to cap1; these are not interchangeable working trees.
E:/captone_integrate/BE belongs to another agent. No original source, database,
.env, secret, gate, existing process or remote main was changed. Only test-owned
temporary servers were started and cleaned up by fixtures. Installed dependencies
were reused read-only; node_modules, virtualenvs, build output and logs are not staged.

The review bundle preserves 71 original snapshots and SHA-256 fingerprints.
This assembly selects 33 candidates, excludes 38, additionally migrates two existing
main chat test files, and adds this report: **36 proposed files**. No whole
Frontend directory was replaced.

## Completed integration â€” fixture PASS only

- Frontend keeps main's login, /auth/me, role checks and non-chat pages.
  AI Chat reuses that authenticated session through AuthenticatedChatPortal.
  It creates no second persistent auth store and does not retry generation.
- Public chat accepts content only; Backend binds the user to JWT. The separate
  AIWebChatClient authenticates /internal/web-chat using the BE-to-AI service token.
  Public provider/model/identity overrides are rejected.
- Resolution is left to main's existing resolver and saved AI Profile. Profile
  partial PATCH preserves omitted fields and validates enabled provider/model
  compatibility transactionally. No new provider fallback was added.
- AI request validation accepts user/content. Unsupported runtime or missing
  credentials fails closed. No Mock response was added.
- Timeouts: ordinary portal HTTP 10 s, chat 100 s, BE-to-AI 95 s, AI context 90 s.
  Responses are bounded; errors are sanitized and generation POSTs are not replayed.
- Backend checks that the returned conversation belongs to the JWT user and
  contains the returned assistant message. It writes no duplicate usage row.
- Executable conflict markers in selected AI config/console/tests and .env.example
  were removed using the completed snapshots. Actual .env was never copied.

## Eleven reconciliation decisions

| File | Decision |
|---|---|
| BE/src/modules/ai-providers/ai-providers.module.ts | Keep main; exclude local replacement config module/controller |
| BE/src/modules/ai/ai.service.ts | Integrate completed profile/model/chat changes; retain main provider/key/admin/history/quota APIs |
| BE/src/modules/auth/access-role.guard.ts | Keep main; exclude unrelated auth migration |
| BE/src/modules/monitoring/presence-sweeper.ts | Keep main; no timeout/scheduler decision |
| BE/src/modules/quotas/quotas.module.ts | Keep main; exclude replacement |
| BE/src/modules/quotas/quotas.repository.ts | Keep main; exclude replacement persistence |
| BE/src/modules/quotas/quotas.service.ts | Keep main; exclude behavior changes |
| BE/test/application-wiring.spec.ts | Keep main, including visible baseline failures |
| frontend/app.py | Preserve main entrypoint/navigation; add only authenticated AI Chat dispatch and chat-widget logout cleanup |
| frontend/thanh_phan/bo_cuc/thanh_ben.py | Preserve main navigation/logout; add scoped optional-portal logout hook |
| frontend/thanh_phan/bo_cuc/tieu_de.py | Keep main's Backend API label/layout |

Keeping main config/quota/credential/turn code is not authorization to enable it,
deliver keys, migrate DB or claim V1.5 compatibility. The local reference-only
replacement was excluded because it would discard newer main functionality.

The additional BE/test/live-chat.spec.ts and BE/test/ai.service.spec.ts edits
migrate existing chat fixtures to AIWebChatClient and content-only/conversation
responses. Existing main turn/privacy tests remain. The candidate phase1 test
imports completed chat/model/profile coverage only, not excluded controllers.

## Build/test on the assembled checkout

| Check | Result |
|---|---|
| Backend Nest build and source tsc build, incremental=false | PASS |
| Backend selected chat/model/profile suites | 44 PASS / 3 suites |
| Backend full Jest | 434 PASS, 9 FAIL, 1 skipped; 4 failed suites |
| Untouched main Backend comparison | 399 PASS, same 9 FAIL, 1 skipped; same 4 failed suites |
| Backend typecheck including tests | FAIL: inherited devices/monitoring test interfaces |
| AI selected config/Web Chat/robot/console tests | 97 PASS |
| AI full pytest | 551 PASS, 2 FAIL, 1 skipped, 10 setup errors |
| Frontend portal and actual-main chat adapter | 44 PASS |
| Existing Frontend backend-client tests, separate process | 4 PASS |
| Existing Frontend live-route tests, separate process | 4 PASS, 1 ERROR |
| Combined Frontend discovery without real Streamlit preload | FAIL: 11 errors including 10 due to stub-module contamination |
| Live FE -> BE -> AI -> provider | NOT RUN / BLOCKED |

Offline tests explicitly use fixture doubles/development-mock; none is a live
service, provider, DB-write, quota concurrency or hardware acceptance result.
Dependencies were reused from existing installations; npm ci in a clean environment
was not performed in this task.

### Remaining failures

Backend: monitoring.spec.ts, monitoring.http.spec.ts and devices.spec.ts cannot
compile against their current service/controller/repository interfaces.
application-wiring.spec.ts has nine failed assertions: pairing route order,
admin devices, three profile/credential routes, admin monitoring, heartbeat,
reset claim and admin-role route response. The exact same failure names/suites
appear in the untouched main comparison. No failing tests were deleted or weakened.

AI:
- test_lan_bootstrap.py::test_standalone_wss_requires_local_device_credential_before_hello
  disconnects in its standalone WSS fixture. Runtime identity behavior unchanged.
- test_protocol.py::test_firmware_snapshot_hashes_match_workspace_sources:
  historical firmware hash differs; firmware/snapshot were not edited.
- Ten test_websocket.py setup errors: its child fixture clears the explicit test
  Backend mode and starts integrated without provisioned tokens. No production
  token/gate workaround was added.
- First robot TCP run lacked the fixture-discovered native DLL in its child.
  The candidate test now forwards only that DLL setting; selected rerun is 97 PASS.
  No machine-specific DLL path was hardcoded.
Untouched main AI has Python conflict markers and is not a clean runnable full-suite
comparison. Do not label all AI failures as proven pre-existing.

Frontend: unchanged test_live_routes.py fails in legacy init_demo because the
test Streamlit stub is a dict while source uses attribute access. Existing test
modules also install a fake streamlit module, contaminating AppTest during combined
discovery. Run suites in separate processes; the combined failure remains recorded.

## Runtime blockers

1. Credential delivery remains BLOCKED. Main already contains opt-in decrypted-key
   delivery code; it is preserved unchanged, not newly authorized or enabled.
2. MySQL V1.5 must remain unchanged. Main quota/turn code references an extended
   ledger. No migration was added/run. Limited-V1.5 quota is planning-only:
   RPM/RPD, cross-process locking, pending/actual usage, crash/UNKNOWN recovery
   and one unfinished turn per user need separate approved implementation.
3. With history disabled, never persist conversation content. Main privacy tests
   remain. The selected BE response requires a persisted assistant message, so
   history-disabled end-to-end replies remain BLOCKED (AI_TURN_NOT_PERSISTED).
   Do not enable history to work around this.
4. Matching service credentials, running-process config, TLS trust, provider/model
   readiness, actual quota/usage persistence and ESP32 hardware acceptance are
   unverified. No real generation request was made.
5. Heartbeat discrepancy (120 s source / 60 s documentation) remains undecided.
6. AGENTS.md was not edited. Main's AI_SERVER/AGENTS.md still contains inherited
   historical-document conflict markers and is excluded from staging.
7. GitHub connector previously had pull but no push permission. No successful
   publishing permission or remote write has been established.

## WAV and secret review

Four WAVs are kept byte-for-byte identical to main, outside the staged diff.
All parse as mono PCM16 / 24 kHz and contain fmt, data and C2PA chunks.
No file was deleted, played, transcribed, exported or uploaded.

| File under AI_SERVER/artifacts/ | Seconds | SHA-256 |
|---|---:|---|
| gemini_tts_live.wav | 2.12 | 30f971b973a09fc061bba011796f4d5b641bc0a6a3c06ae4d069ed666cd47688 |
| gemini_voice_demo.wav | 9.04 | c78c03e42d9afa1fcc67860bc537b1de72844f61395d98cf09cb17b75c56bbea |
| interactive_voice/voice-923169a8-0aa04d1e.wav | 6.2 | 104458abcd357da4e0156b46b84887dfd4a6b07e51915b7c212ec5fc6592f0f2 |
| interactive_voice/voice-923169a8-f087ff09.wav | 4.2 | 9b8cb8358b40696703d7bd9270f34da510da81a72e500ab3547538f994dc791c |

Static exact-secret/key-signature scans found no matches in these WAVs.
C2PA metadata is present. Source scripts/docs associate the paths with generated
TTS diagnostics, but static container checks do not prove the actual speech
contains no personal data. **Content privacy remains unverified**; owner must
consider this before publishing a branch that inherits the files and their history.

Changed/new files and index blobs are scanned for known original configuration
secret values, key/JWT/private-key signatures and prohibited paths without printing
values. No real .env, API key, private key, certificate, virtualenv, dependency,
build output, cache, log or new audio is proposed. Only placeholder .env.example
is included. No new outgoing commits exist yet; the clone is shallow. This is
not a full-history secret certification. Any future secret finding blocks push.

Final index review: 36 staged paths; zero configured-secret/key-signature findings; no prohibited newly staged paths; git diff --cached --check PASS. All nine explicitly retained main files and four WAVs are unchanged. Original 71 source fingerprints still match the review snapshots. Index blob hashes and sanitized evidence are in the local staged-review.json bundle. No new commits exist beyond the pinned baseline.

## Reproduce checks

From BE/ with installed lockfile dependencies (npm ci on a clean checkout):

~~~powershell
node node_modules/typescript/bin/tsc --project tsconfig.build.json --incremental false
node node_modules/jest/bin/jest.js --runInBand --no-cache --runTestsByPath test/phase1-ai-integration.spec.ts test/live-chat.spec.ts test/ai.service.spec.ts
npm test -- --no-cache
~~~

From AI_SERVER/, install requirements-dev.txt in a local virtualenv, or
requirements-windows.txt for native Opus tests. Use a fresh test-only shell without
real provider keys or secret environment:

~~~powershell
$env:AI_SERVER_BACKEND_MODE='development-mock'
python -m pytest tests/test_config.py tests/test_live_gemini_integration.py tests/test_robot_gateway.py tests/test_sd2_console.py -q -p no:cacheprovider
python -m pytest tests -q -p no:cacheprovider
~~~

That mode is fixture-only, not runtime integration acceptance. Do not invent
credentials or a dummy .env. Full suites are expected to expose the listed failures.

From frontend/, use the real Streamlit virtualenv and separate processes:

~~~powershell
python -m unittest discover -s checks -p test_portal_api.py -q
python -m unittest discover -s checks -p test_backend_client.py -q
python -m unittest discover -s checks -p test_live_routes.py -q
~~~

For separately authorized runtime, main uses AIVA_BACKEND_URL; set it to
http://127.0.0.1:3001 in the launch shell so all pages/chat share one origin.
AIVA_BACKEND_BASE_URL configures the optional portal/harness, not main.
No environment/process was changed here. Runtime needs securely provisioned
matching BE AI_SERVER_WEB_TOKEN and AI_SERVER AI_SERVER_LIVE_WEB_TOKEN, plus
the approved device/config/quota credentials and contracts. Do not paste values
into Git/chat or apply a schema migration to make this branch pass.

## Approval, rollback and retrieval

Commit/push are not approved. Owner must approve the exact 36 paths below, target
branch, known failures and inherited-audio privacy limitation. Then recheck remote
branch availability/history, index and outgoing history before committing/pushing.
Never push main or rewrite shared history. Verify the actual remote SHA after push.

Before publication, abandon the isolated assembly if needed; original workspaces
and the review bundle remain intact. No reset/stash/revert of another workspace
is needed. After publication, use a reviewed revert commit.

Only after verified publication, teammates can run:

~~~powershell
git clone https://github.com/tranlehoang0709/cap1.git
cd cap1
git fetch origin
git switch --track origin/handoff/aiva-integration-phase2
~~~

The handoff branch is not yet published. No successful push link is claimed.

## Exact proposed file list (36)

- AI_SERVER/.env.example
- AI_SERVER/README.md
- AI_SERVER/app/api/web_chat.py
- AI_SERVER/app/core/config.py
- AI_SERVER/docs/backend-3001-integration.md
- AI_SERVER/docs/backend-3001-security-readiness.md
- AI_SERVER/scripts/sd2_console.py
- AI_SERVER/tests/conftest.py
- AI_SERVER/tests/test_config.py
- AI_SERVER/tests/test_live_gemini_integration.py
- AI_SERVER/tests/test_robot_gateway.py
- AI_SERVER/tests/test_sd2_console.py
- BE/src/common/filters/api-exception.filter.ts
- BE/src/modules/ai/ai.controller.ts
- BE/src/modules/ai/ai.module.ts
- BE/src/modules/ai/ai.repository.ts
- BE/src/modules/ai/ai.service.ts
- BE/src/modules/ai/dto/ai.dto.ts
- BE/src/modules/web-chat/ai-web-chat.client.ts
- BE/test/ai.service.spec.ts
- BE/test/live-chat.spec.ts
- BE/test/phase1-ai-integration.spec.ts
- HANDOFF.md
- frontend/app.py
- frontend/checks/test_portal_api.py
- frontend/giao_dien/xac_thuc/dang_nhap.py
- frontend/thanh_phan/bo_cuc/thanh_ben.py
- frontend/tich_hop/README.md
- frontend/tich_hop/__init__.py
- frontend/tich_hop/cau_hinh.py
- frontend/tich_hop/giao_dien.py
- frontend/tich_hop/http_client.py
- frontend/tich_hop/phien_xac_thuc.py
- frontend/tich_hop/portal.py
- frontend/tich_hop/thiet_bi_dto.py
- frontend/tich_hop/xac_thuc.py

The original 38 excluded candidates are listed in the local selection/manifest
bundle; quota/config replacements, unrelated ownership/auth/monitoring changes,
AGENTS.md, old Frontend entrypoint replacement and header changes are excluded.
