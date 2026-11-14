# Prompt 02 — Gemma Local LLM integration

## Implementation

The Local process branches before any Cloud route or provider import.
`LlamaServerAdapter` uses `httpx` directly against the configured loopback
llama.cpp API. It discovers the only advertised model ID from `/v1/models`,
then streams `/chat/completions`. It never imports an OpenAI/Gemini adapter.

Requests include system instruction, bounded history and a Vietnamese response
instruction. SSE chunks become the existing `ProviderDelta` and
`ProviderDone` types. Usage becomes the existing `Usage` type when supplied.
The endpoint reports measured end-to-end latency. Timeout, connection retry
(0–2, default 1), authentication, HTTP status, unavailable model, invalid stream
and cancellation have explicit failure paths. There is no Cloud fallback.

`POST /local/chat` requires `LOCAL_LLM_CHAT_TOKEN`, separate from the
llama-server key. History is held only in bounded RAM and keyed by the exact
user/session pair. It commits only complete responses. Defaults are 64 sessions,
20 turns/session, 3600-second TTL, 8192 approximate context tokens, 256 output
tokens and 8000 output characters. Concurrent same-session turns are rejected.
Nothing is written to Backend or MySQL.

The Cloud `/internal/web-chat` contract is untouched. Its Local placeholder
continues to return 503, so Local does not bypass existing BE authentication.

## Configuration and startup

Copy `.env.local.example` to `.env.local`, then provide:

```dotenv
AI_RUNTIME=local
LOCAL_LLM_BASE_URL=http://127.0.0.1:8001/v1
LOCAL_LLM_API_KEY=<the key configured on llama-server>
LOCAL_LLM_CHAT_TOKEN=<a separate random token of at least 43 characters>
```

`LOCAL_LLM_MODEL` is deliberately not an arbitrary override. Runtime uses the
exact ID returned by `/v1/models`, sends it to chat completion, and returns it
in the chat response.

```powershell
& .\AI_SERVER\run_local.cmd
```

Example:

```powershell
$headers = @{ Authorization = "Bearer $env:LOCAL_LLM_CHAT_TOKEN" }
$body = @{ user_id='user-1'; session_id='session-1'; content='Xin chào'; stream=$false } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8002/local/chat -Method Post -Headers $headers -ContentType application/json -Body $body
```

Reuse the same user/session for later turns. Set `stream` to `true` for SSE.

## Validation — 2026-11-14

- PASS: llama-server `GET /health` on 8001 returned HTTP 200 and
  `{"status":"ok"}`. Five loopback probes measured 0.4 ms minimum, 0.5 ms
  median and 4.9 ms maximum. These are health latency, not generation latency.
- BLOCKED: live `/v1/models` returned HTTP 401 without a key. No
  `.env.local` exists and no key was exposed. Automatic approval review
  rejected reading another process command line to recover the credential; no
  workaround was attempted.
- BLOCKED by the same missing configured key: real Gemma completion, Vietnamese
  200 response, three real turns, real isolation, streaming latency and usage.
  Generation latency and usage therefore remain unmeasured.
- PASS: Cloud 8000 and Local 8002 started simultaneously while llama-server
  remained on 8001. Health showed the correct runtimes with no port conflict.
- PASS: with an intentionally invalid test key, Local reported llama-server
  NOT_READY and chat returned HTTP 503 without fallback.
- PASS (protocol, not live model): llama.cpp SSE parsing, returned model ID,
  system/history messages, usage mapping, aggregation and streaming.
- PASS (isolation): three turns retained history in one user/session; another
  session had empty history; unauthenticated chat returned 401.
- PASS: Local import loaded no Gemini/OpenAI client or SDK and no Backend client.
- PASS: 59 focused Local and provider-neutral LLM tests.

No Gemini/OpenAI quality probe, Xiaozhi test, STT/TTS work, PA function, model
download, llama-server modification, commit or push was performed.

## Prompt 03 boundary

A user-provided `.env.local` key is required to finish live acceptance and
record model ID, three-turn output, streaming latency and usage. Local STT/TTS
and Xiaozhi routing remain unimplemented.

Prompt 03 subsequently implemented the Local STT adapter and model readiness.
Its report is `local-stt-prompt03.md`; Local TTS and robot routing remain
unimplemented.
