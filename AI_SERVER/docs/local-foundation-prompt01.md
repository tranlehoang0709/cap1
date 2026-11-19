# Prompt 01 — Local AI foundation

Only AI_SERVER changed. Existing uncommitted changes were preserved; no commit,
push, model download, llama-server change or hardware test was performed.

## Source audit

| Module | Finding |
|---|---|
| api/robot_websocket.py | Development Gemini/OpenAI voice construction is provider-specific; framing/control reusable. |
| api/lan_robot.py | Integrated voice calls create_live_robot after BE gates; Gemini-specific execution. |
| clients/provider_factory.py | Existing Gemini/OpenAI selection retained; local metadata factory added; cloud factory guarded. |
| clients/stt_factory.py | Gemini-specific; lazy import and runtime guard added; local STT seam added. |
| clients/tts_factory.py | Gemini-specific; lazy import and runtime guard added; local TTS seam added. |
| core/config.py | Existing server settings retained unchanged by this task. |
| core/provider_config.py | Cloud credentials/models retained; local settings kept separate. |
| core/stt_config.py | Gemini-only settings; not instantiated in Local. |
| core/tts_config.py | Gemini-only settings; not instantiated in Local. |
| services/orchestrator.py | Injected STT/LLM/TTS, bounded per-turn RAM; reusable later. |
| services/live_robot.py | Direct Gemini factories, Gemini audio conversion and quota wrapper. Not imported in Local. |
| services/live_gemini.py | Server Gemini credential and quota construction. Not imported in Local. |
| services/backend_execution.py | Gemini type enforcement for live quota; BE contract unchanged. Not imported in Local. |
| services/opus_codec.py | Native Opus and PCM conversion reusable; no AI dependency. |
| services/playback.py | Injected TTS/output, bounded queue and playback proof reusable; includes Gemini-oriented scheduling comments. |
| services/session_manager.py | Empty file; no implementation to reuse. Sessions currently live in route/orchestrator objects. |

## Runtime behavior

`AI_RUNTIME` is process environment only: `cloud` (default) or `local`.
Cloud keeps its existing routers, factories, Backend integration and startup
scripts. Health adds `runtime` while retaining `status: ok` and HTTP 200.

Local takes an early branch before importing cloud routes/services. It does not
construct Backend clients, cloud providers, sessions or audio buffers. Separate
OS processes have separate Python heaps; no shared session/audio store is added.
Cloud factories explicitly reject calls when `AI_RUNTIME=local`.

Local voice sockets close with 1013; web-chat/OTA return 503. These are intentional
foundation blockers, not usable Local voice or changes to Backend API contracts.
Local has no fallback, retry or generation request. STT/TTS placeholders follow
existing async iterator method contracts and fail closed.

The local llama adapter uses HTTP directly, not the OpenAI SDK. It queries the
configured loopback `/v1/models` with an env Bearer key and bounded timeout.
Exactly one nonempty model ID is required; zero/multiple models fail closed.
No arbitrary ID is hardcoded. Redirects, proxy environment and retries are disabled.
Errors expose safe codes, never response bodies or credentials.

`/health` includes local dependency readiness. `/ready` returns 503 NOT_READY.
llama-server can be READY independently while voice and generation remain
NOT_READY/NOT_IMPLEMENTED. An absent key, unreachable server, HTTP error or invalid
metadata never activates Cloud. Health metadata probes do not generate tokens.

## Startup

From the repository root in PowerShell:

```powershell
Copy-Item AI_SERVER/.env.local.example AI_SERVER/.env.local
# Set LOCAL_LLM_API_KEY in .env.local to match your existing llama-server.
& .\AI_SERVER\run_local.cmd
```

Equivalent: `AI_SERVER\.venv\Scripts\python.exe AI_SERVER\scripts\run_local.py`.
The script sets Local runtime and binds 127.0.0.1:8002 without cloud startup.
It loads only `.env.local`; environment overrides that file. Cloud `.env` and
startup scripts are unchanged. Existing llama-server at
`C:\Users\troc\llama-b12283-bin-win-cuda-12.4-x64` remains separately managed.

## Validation (2026-11-14)

- PASS: spawned Cloud 8000 and Local 8002 simultaneously; both HTTP health calls
  returned 200 and correct runtime. Stopped only the spawned test processes.
- PASS: separate Python process imported Local app without loading Gemini,
  OpenAI, live_robot or their SDKs, and without creating Backend client.
- PASS: Local cloud-factory rejection, missing-key readiness, route blocking,
  model discovery with real response ID, timeout, HTTP 401, invalid metadata,
  ambiguous metadata, and Cloud health/lifespan unit tests.
- Combined targeted run: **48 PASS, 1 FAIL**. Existing
  `tests/test_config.py::test_confirmed_defaults` expects log level `warning`,
  while the pre-task working source uses `info`. Config was not overwritten.
  Cloud health test now specifies its desired warning level explicitly.
- Initial temp-directory errors resolved by using a workspace basetemp directory.
- BLOCKED: actual authenticated llama-server readiness; no Local API key was
  configured in the smoke-test environment. No live model/generation claim.
- Not run: Gemini/OpenAI API probes, Xiaozhi and firmware tests, full suite.

Command used:

```powershell
.\AI_SERVER\.venv\Scripts\python.exe -m pytest AI_SERVER/tests/test_local_runtime.py AI_SERVER/tests/test_health.py AI_SERVER/tests/test_config.py -q -p no:cacheprovider --basetemp=AI_SERVER/.test-artifacts/prompt01-final
```

## Remaining for Prompt 02 / later authorized work

Supply the existing llama-server key and verify authenticated metadata readiness.
Implement generation/streaming through the existing LLMAdapter contract using
the discovered model ID and Local error policy. STT/TTS still require a separately
authorized implementation; no model is installed by Prompt 01. Local robot media
and end-to-end voice must remain blocked until those components work. Resolve the
existing config-test expectation separately from runtime isolation.

Prompt 02 subsequently implemented Local text generation and `/local/chat`.
See `local-gemma-prompt02.md`; Prompt 01's `NOT_IMPLEMENTED` generation status
describes its original validation point, not the current source.

Prompt 03 subsequently implemented Local STT. See `local-stt-prompt03.md`.
