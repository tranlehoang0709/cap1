# AI_SERVER runtime integration audit (2026-11-03)

Scope: AI_SERVER changes only. Backend and firmware were inspected read-only.
`REAL` means an implementation/source exists; it does not mean live service or
hardware validation passed. No Backend, Cloud, or ESP32 live credentials were
available for this audit.

## Runtime function inventory

| Function | Current mock / state | Real source | Required API / source | Status |
|---|---|---|---|---|
| Device identity/authentication | Development gateway uses a local bearer token and caller-supplied metadata | Backend `POST /internal/devices/authorize`; AI_SERVER now invokes it before accepting audio | Backend authorize contract plus firmware-provided device UID and provisioned credential | BLOCKED live: firmware does not send proof headers; test fixture covers the call path |
| User/device owner binding | Mock path creates local-development identity | Backend authorize response binds `deviceId`, `ownerUserId`; `AuthorizedSession` creates its own opaque conversation key | `POST /internal/devices/authorize` | REAL code, live NOT RUN |
| AI profile/provider/model/voice | Development branch hardcodes mock profile; no integrated use of these values | AI_SERVER validates Backend resolve-config response before refusing unavailable media pipeline | `POST /internal/ai/resolve-config` | REAL code, live NOT RUN; only LLM profile fields, no STT/TTS setup |
| Cloud credential/key | No real runtime secret handoff; reference is metadata | Backend returns credential reference only | Approved secret broker or workload identity, not present | BLOCKED; never turn reference into a secret |
| STT | `MockStreamingSTT` returns fixed transcript in explicit development-mock mode | STT protocol interface and Opus decoder exist | Configured Cloud STT implementation, permitted model, credential delivery | BLOCKED; no provider adapter/secret source |
| LLM | `MockLLMAdapter` in development mode; separate `OpenAILLMAdapter` exists but is not wired into robot runtime | Async OpenAI Responses adapter reports provider usage | Backend config plus secure key delivery, provider allowlist and quota admission | BLOCKED integrated execution |
| TTS | `MockTTS` and synthetic tone in development mode | TTS protocol interface and Opus encoding exist | Configured Cloud TTS adapter, allowed voice/model, secure credential delivery | BLOCKED; no real TTS adapter |
| Request admission / token budget | In-process limiter is development-only | Backend client can call admission API; not wired into integrated robot turn | `POST /internal/ai/authorize-request` | BLOCKED runtime; Backend reports quota schema not ready |
| Usage settlement | Development/test usage reporter is in-process | Backend client can call usage endpoint; not wired to integrated turns | `POST /internal/ai/usage` with stable idempotency request ID | BLOCKED runtime; no provider execution/no live settlement |
| Request rate 12/user/60s | Sliding-window test/dev limiter only | Backend policy is intended global source | Backend atomic admission endpoint | BLOCKED production policy until DB quota schema and live route are ready |
| Backend DB session | WebSocket session ID is local and distinct from Backend IDs | No AI_SERVER/Backend create/close session route in current contract | Backend session lifecycle API if required | BLOCKED / API missing |
| Heartbeat/device status | WebSocket ping/pong only; never treated as device heartbeat | Backend client and authorized-session heartbeat method exist | `POST /internal/devices/heartbeat` plus real device heartbeat signal | BLOCKED runtime; firmware WebSocket protocol has no mapped heartbeat event |
| Audio input | Development gateway decodes incoming Opus | Native Opus codec and wire framing | Supported firmware WebSocket framing | REAL code; live hardware NOT RUN |
| Playback completion | Development gateway consumes simulated playback control messages in tests/dev path | Firmware has a half-duplex playback guard and emits playback events when feature is enabled | Actual firmware negotiated capability and physical output-drained evidence | BLOCKED live; no hardware playback test |
| `/ws/dev-echo` | Local text echo, deliberately not an AI result | Existing echo endpoint | None | REAL utility; preserved |

## Runtime safety changes

- `integrated` is the default mode. It requires three distinct Backend service
  tokens. The repo-local `.env` explicitly opts into `development-mock`; use of
  that file is a local development choice and must not be used in production.
- Integrated `/ws/dev-robot` requires exactly one `device-uid` and
  `device-credential` header. It authorizes and resolves config before accepting
  audio. Invalid/missing proof, denied Backend calls, timeout, malformed schema,
  and Backend failures do not enter the mock pipeline.
- After successful auth/config, the server returns `AI_PIPELINE_UNAVAILABLE`
  and closes before receiving audio. This is intentional fail-closed behavior
  while there is no secure provider secret delivery, real STT/TTS, live quota
  admission, or hardware-ready credential protocol.
- Development mocks remain usable only when `AI_SERVER_BACKEND_MODE` is
  explicitly `development-mock`; they are not evidence of Cloud or hardware
  success. `/ws/dev-echo` is unchanged.
- Backend routes documented in `BE/API_CONTRACT.md` are present in source, but
  quota admission and usage require a Backend quota schema reported as
  `QUOTA_SCHEMA_NOT_READY`. `credentialReference` is not an API key. There is no
  Backend session create/close route.

## Test and live evidence

- Mock Backend/client contract, integrated gate, and `/ws/dev-echo` tests: **PASS**, 71 tests.
- Full AI_SERVER suite after changes: **FAIL**, 365 passed / 18 failed. The
  failures are environment/baseline-related: 16 robot/Opus tests cannot load
  native `libopus` (and the TCP cleanup then encounters unsupported Windows
  SIGINT); one historical firmware snapshot hash is stale. The unrelated
  `/ws/dev-echo` tests passed in the full run.
- Backend HTTP, Cloud provider, ESP32 hardware and physical playback: **NOT
  RUN**. No live service credentials or connected device were available.
- No live integration test is marked PASS based on fixtures.

## Windows CMD

Backend terminal (requires its own configured `.env` and provisioned schema):

```bat
cd /d E:\learn\AI_Project\cap1\BE
npm ci
npm run build
npm run start:dev
```

AI_SERVER terminal, offline development mocks (explicit opt-in):

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
py -m venv .venv-win
.venv-win\Scripts\python.exe -m pip install -r requirements-dev.txt
copy .env.example .env
set AI_SERVER_BACKEND_MODE=development-mock
.venv-win\Scripts\python.exe scripts\run_dev.py
```

Integrated startup (will fail configuration validation until three real,
distinct tokens are supplied; the WebSocket still blocks audio without the
missing provider/hardware capabilities):

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
set AI_SERVER_BACKEND_MODE=integrated
set AI_SERVER_BACKEND_URL=http://127.0.0.1:3000
set AI_SERVER_BACKEND_ALLOW_LOCAL_HTTP=true
set AI_SERVER_BACKEND_DEVICE_TOKEN=REPLACE_WITH_DEVICE_SERVICE_TOKEN
set AI_SERVER_BACKEND_CONFIG_TOKEN=REPLACE_WITH_CONFIG_SERVICE_TOKEN
set AI_SERVER_BACKEND_QUOTA_TOKEN=REPLACE_WITH_QUOTA_SERVICE_TOKEN
.venv-win\Scripts\python.exe scripts\run_dev.py
```

Fixture tests and full regression suite:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv-win\Scripts\python.exe -m pytest tests\test_backend_integration_mode.py tests\test_backend_client.py tests\test_device_auth.py -q -p no:cacheprovider
.venv-win\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest-runtime-audit --tb=short
```

## Remaining dependencies / contracts

1. Firmware must securely provision and send a device UID and credential
   matching the Backend proof contract. Current firmware sends a generic
   `Authorization` token plus MAC/device metadata, not these proof headers.
2. Backend must make quota schema/policy available, confirm global sliding
   window behavior (12 requests/user/60s), and support admission/idempotent
   settlement end to end before the server can execute a Cloud request.
3. An approved secret broker/workload identity is required to resolve a
   credential reference without exposing raw secrets to logs or clients.
4. Provider catalogs/configuration for STT/TTS, real adapters, and safe
   cancellation/usage capture must be supplied and validated.
5. Backend session lifecycle APIs and a firmware heartbeat contract are absent
   if persistent DB sessions/status are required.
6. A firmware build with the negotiated playback-completion feature and a real
   device test are required to claim actual playback completion.
