# AIVA-IoT local integration report — D4-S1-08

Verified: 2026-11-06 (Asia/Saigon). Workspace `D:\cap1-latest`, branch context `dev/aiva-next-integration`. Proposal, previous report, existing contracts and source were reviewed before changes. Current scope explicitly preserves Streamlit and MySQL V1.5. No firmware, Proposal, database schema, existing secrets or Admin credentials were changed. No commit/push or paid provider call was performed.

## Actual service and feature status

| Item | Status | Evidence / limit |
|---|---|---|
| Frontend | RUNNING | http://127.0.0.1:8501 HTTP 200, verified launcher-owned process |
| Backend | RUNNING | http://127.0.0.1:3000/health HTTP 200, loopback listener, verified ownership |
| AI Server | RUNNING | http://127.0.0.1:8000/health HTTP 200, loopback listener, verified ownership |
| MySQL V1.5 | PASS | aiva_iot at 127.0.0.1:3306; complete metadata equal to previous official-baseline audit |
| Admin/User login | PASS | Existing real accounts via official login/me/refresh/logout and Streamlit AppTest; no new account/reset |
| FE → BE | PASS | Real Admin/User UI and HTTP against Backend/MySQL; configured Backend URL 3000 |
| BE ↔ AI transport | PASS | Existing matched service-token calls traverse actual services; URLs 8000/3000 correct |
| BE ↔ AI feature contract | BLOCKED | resolve-config returns genuine 403 CONTRACT_NOT_APPROVED; gate remains OFF |
| Quota/History | Candidate implemented; activation BLOCKED | Optional V1.5 ledger adapter and exact settled-history binding; neither selected nor approved; no real admission/history mutation |
| Local AI/model | BLOCKED | No Ollama/vLLM/llama.cpp runtime/model found; no enabled LOCAL model in DB; Local execution adapter unavailable |
| Web Chat LIVE inference | BLOCKED / NOT TESTED | Real User → BE → AI → BE denial verified, then controlled 503; no generated answer or paid fallback |
| Monitoring/Heartbeat | Routes implemented; guards PASS | Admin monitoring reaches DB and returns domain 404 for absent device; User denied403. Internal heartbeat absent token401, matching token403 at retained contract gate |
| WebSocket | Transport PASS | Actual dev-echo round trip; unauthenticated/plaintext robot endpoint rejects403. No robot/audio inference acceptance |
| Email verification | Local mechanism tested; outbound BLOCKED | Signed-proof/audience/type/expiry tests and FE private token-entry flow; no external email sent or delivery transport configured |

HTTP health, process running, authenticated transport and successful inference are separate results. Unit SQL/provider fixtures are not LIVE evidence.

## Changes and root causes

1. **Contract denial is intentional.** Valid config service token reaches the existing approval check; `AI_CONFIG_CONTRACT_APPROVED=false` yields403. Prior safe-denial propagation fixes are retained. Regression checks cover exact denial and no arbitrary SQL/secret error disclosure. Device/config/quota approvals remain false; no authentication, RBAC or contract bypass was added.
2. **Monitoring routes were not wired.** Added existing-contract `/admin/devices/:id/monitoring`, `/user/devices/:id/monitoring` and `/internal/devices/heartbeat` controllers using original role/device guards and OwnershipService. Presence/credential/ownership checks share a transaction and device lock; optional bounded telemetry persists atomically. Future heartbeats reject, stale/duplicate events do not revive a device. Monitoring projections omit proof/payload/secrets. Per-device monitoring may conditionally mark its stale presence offline according to the existing canonical contract; dashboard stays read-only. No devices exist locally and no fake device was inserted. All sweepers remain disabled/unregistered. Distinct instance DTO name also removes the duplicate HeartbeatDto registration.
3. **Quota/history previously depended on seven absent columns.** Implemented an optional V1.5 adapter using existing usage_records and reserved system_settings JSON metadata, plus the original conversations/messages/session storage. It preserves locking, policy checks, global limits, reservations, duplicate/replay behavior, actual settlement and exact history binding. Missing reports keep budget reserved; legacy unknown pending rows block token-limited requests. Ordinary settings APIs cannot expose/write ledger keys, including case variants. New-admission approval can be revoked without stranding authenticated settlement of existing requests. No migration, admission, quota policy, ledger row or history was created in the real DB. See [candidate contract](BE/docs/v15-quota-history-contract.md) for review, retention/scaling/rollback limits and activation prerequisites. This persistence change requires separate approval; it was not silently enabled.
4. **Windows native Opus dependency was missing.** Installed the already declared `PyOgg==0.6.14a1` Windows wheel only (no dependency/model download). Installer now uses requirements-windows.txt. Launcher validates the project-venv Opus DLL and supplies its path to child environment without editing .env. AI was stopped gracefully through its verified owned console and restarted with run_all; BE/FE were reused. Native codec availability does not imply STT/LLM/TTS readiness.
5. **Launcher readiness is explicit.** Existing owned healthy listeners are reused, foreign/unhealthy ports remain errors, and contracts/storage/model/email blockers are printed separately. --check and normal startup returned0 while honestly retaining feature blockers. Launcher never seeds, migrates, installs, approves contracts or probes paid providers.
6. **Email scope.** Existing official verification API and private FE token-entry form remain. New backend tests cover correct verification proof plus wrong-audience/access/refresh/expired/tampered rejection before user mutation. No new email endpoint/provider or automatic proof disclosure was introduced. There is no verified outbound email channel.

## Build and automated tests

| Check | Result |
|---|---|
| Production TypeScript noEmit, incremental disabled | PASS |
| npm run build (Nest) | PASS |
| Full BE Jest | 539 PASS, 1 skipped; 28 suites PASS, 1 suite FAIL to compile |
| Targeted quota/config regression after final admission-revocation fix | 119 PASS (subset of full suite, not additive) |
| Full AI pytest, non-loopback connections blocked | 572 PASS, 1 FAIL |
| FE registration/routes/safe-error unittest | 10 PASS |
| FE portal unittest, separate process | 44 PASS |
| Launcher regressions | 4 PASS |
| Real Streamlit AppTest against actual Backend/MySQL | 5 PASS |
| run_all.bat startup and --check | PASS; 3 actual services healthy, feature blockers printed |
| AI environment pip check | PASS |

The FE tests use standard unittest; frontend venv has no pytest, so no unnecessary pytest dependency was installed. Fixture FE tests are distinct from the five real UI checks.

Remaining test failures were not hidden or weakened:

- `BE/test/devices.spec.ts`: legacy Admin device-list/read-model contract references missing DevicesRepository.list and DeviceRecord.owner/currentAssignment. Current runtime uses `/devices/admin/all` and its existing snake_case device model. This is a separate API/read-model reconciliation, not a failing monitoring route. No replacement API or type cast was invented to silence compilation. The completed monitoring canonical tests and full application wiring pass.
- `AI_SERVER/tests/test_protocol.py::test_firmware_snapshot_hashes_match_workspace_sources`: existing source hashes differ and managed_components/78__esp-ml307 files are absent. Firmware/snapshot approval is outside this task; neither was changed to force green. No hardware/firmware LIVE PASS is claimed.

## Actual non-destructive integration checks

- Official existing Admin/User login and identity, User refresh/logout, Admin dashboard and User RBAC rejection: PASS.
- Both real Streamlit role dashboards and AI configuration pages load via actual Backend/MySQL; unconfigured User Chat submission stays disabled: PASS.
- AI config token → Backend resolve-config gives exact403 CONTRACT_NOT_APPROVED; actual AI callback preserves it; authenticated public Web Chat returns actionable503 without fabricating text: PASS for fail-closed behavior, not successful inference.
- Client-supplied identity override rejected400; denied chat leaves conversations/messages/usage_records unchanged.
- Admin monitoring non-existent device gives domain404 rather than route404; User Admin-route access403; heartbeat missing-token401 and approved-token/unapproved-contract403. Accepted device heartbeat/telemetry is NOT LIVE tested because no authorized physical device/contract exists.
- Actual WebSocket echo PASS; unauthenticated robot handshake denied403. No microphone, TTS, robot or Local LLM was simulated as acceptance evidence.
- V1.5 adapter metadata readiness and zero accounting were queried through a READ ONLY transaction on actual MySQL. Write, concurrency and failure-path tests use isolated SQL harnesses; real financial/history acceptance remains BLOCKED.

## Preservation checks

INFORMATION_SCHEMA tables, columns (types/nullability/defaults), indexes and FKs exactly equal the prior official SQL/DBML baseline audit: **32 tables = 31 business tables + schema_migrations**, **228 columns**, **57 FK constraints**, **97 indexes**. The seven quota extension columns remain absent. No DDL or migration was run.

Current data: users2 (existing Admin1, User1); providers3; models0; API credentials0; devices/assignments/telemetry0; conversations/messages/AI sessions/usage_records0; quota policies0; system_settings0. Existing roles/privacy settings remain. Login checks create/rotate/revoke normal auth sessions and update login timestamps through official APIs; no account/password was reset, business rows deleted or real model/history data fabricated.

SHA-256 comparison confirms BE/.env, AI_SERVER/.env and baseline SQL are byte-for-byte unchanged. Existing four paired tokens/JWT/encryption key/Admin credentials were preserved. Secrets remain ACL protected and Git ignored/excluded. Temporary backups and count-only evidence are outside the repository; no credential values or row contents are included here.

## Local AI resources and proposed next configuration

Checked local command discovery, Windows services/processes, common loopback ports (11434/8080/8001/5000), standard model/cache locations and installed Python packages. No usable Ollama/vLLM/llama.cpp installation/model was found; WSL/Docker runtime was not available in the inspected environment. No large model was downloaded.

Hardware: i7-13620H (10 cores/16 threads), 15.7 GiB RAM, RTX4050 Laptop **6141 MiB VRAM from nvidia-smi** (WMI's reported4GiB is inaccurate), roughly5.3GiB free VRAM at inspection; D drive roughly177.5GiB free. Available memory varies.

Proposals, not performance guarantees or installed assets:

- LLM: [Ollama qwen3:4b](https://ollama.com/library/qwen3:4b), official Q4_K_M asset approximately2.5GB. Start with short2048 context/concurrency1 and benchmark Vietnamese/latency before acceptance on6GiB GPU.
- STT: [Systran faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small), multilingual model; initially CPU int8 to avoid GPU contention.
- TTS: [Piper vi_VN-vais1000-medium](https://huggingface.co/rhasspy/piper-voices/tree/main/vi/vi_VN/vais1000/medium), approximately63MB voice weights, CPU candidate; review voice license/quality before provisioning.

After explicit provisioning, the installed loopback runtime URL/model identity, matching enabled LOCAL configuration and actual STT/LLM/TTS execution adapters are still required. Current code does not implement that Local inference adapter. No Cloud fallback, actual paid request, large download or speculative model registration was performed.

## Remaining decisions / BLOCKED

- Review and approve device/config/quota contracts and V1.5 ledger/history persistence/retention contract independently. Existing OFF flags remain authoritative; do not flip them merely to clear403.
- Provision an authorized Local runtime/model and implement/accept its STT → LLM → TTS execution with real resources. No installed model means no LIVE Web Chat inference acceptance.
- Define legitimate quota policy and history/credential-delivery behavior before actual model admission; no policy or accounting approval was invented.
- Reconcile the separate legacy Admin device list/read-model contract and obtain firmware/hardware snapshot acceptance; failing suites remain reported.
- Choose approved email delivery/proof handoff for use beyond local signed-token API testing; no external email was sent.

## Files changed in D4-S1-08

- `BE/docs/v15-quota-history-contract.md`
- `BE/src/config/configuration.ts`
- `BE/src/modules/ai-providers/ai-providers.service.ts`
- `BE/src/modules/devices/devices.module.ts`
- `BE/src/modules/monitoring/monitoring.controller.ts`
- `BE/src/modules/monitoring/monitoring.module.ts`
- `BE/src/modules/monitoring/monitoring.repository.ts`
- `BE/src/modules/monitoring/monitoring.service.ts`
- `BE/src/modules/monitoring/presence-sweeper.ts`
- `BE/src/modules/quotas/quotas.module.ts`
- `BE/src/modules/quotas/quotas.repository.ts`
- `BE/src/modules/quotas/v15-quota-ledger.ts`
- `BE/src/modules/system-settings/system-settings.service.ts`
- `BE/test/email-verification-contract.spec.ts`
- `BE/test/v15-quota-ledger.spec.ts`
- `INTEGRATION_LOCAL_REPORT.md`
- `install_all.bat`
- `tools/real_launcher/README.md`
- `tools/real_launcher/check_backend.cjs`
- `tools/real_launcher/launch.py`

Earlier integration fixes remain in the working tree and were not reset/overwritten. run_all.bat itself already delegates to the real launcher and needed no edit in this task. AI application/firmware/business schema and secret files were not edited.

## Run / stop

From any CMD directory:

```bat
D:\cap1-latest\run_all.bat
```

Check without starting missing services: `D:\cap1-latest\run_all.bat --check`. Stop safely with Ctrl+C in each AI Server, Backend or Frontend CMD window. No force kill or administrator elevation is required for normal local startup. Core services currently run; successful model inference remains BLOCKED for the reasons above.
