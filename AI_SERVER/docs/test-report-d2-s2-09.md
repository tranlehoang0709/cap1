# D2-S2-09 — Gemini TTS and Voice Response Policy V1

## Provider and format

The adapter uses the official `google-genai` SDK and Gemini 3.8 Flash TTS (`gemini-3.8-flash-tts`), voice `Kore`. Google's official model documentation lists Vietnamese among 130 supported languages and the pricing page lists standard requests in the Free Tier. Free-tier limits are account/project dependent, not guaranteed capacity; Google states free-tier content may be used to improve its products. Unary output is WAV, mono, 24 kHz, signed 16-bit PCM.

There is no standalone open-source model license for this hosted TTS API. Use is governed by Google's Gemini API terms. Google says unpaid-tier prompts and outputs may be used to improve products and may be reviewed; do not submit sensitive/confidential data on unpaid service. No paid endpoint or billing upgrade was intentionally selected.

## Implementation

- `GeminiTTSAdapter` implements the existing `TTSAdapter` contract; no mock fallback, retries, secret logging, or robot protocol changes.
- Provider errors are sanitized and classified as authentication, permission, rate limit, service unavailable, timeout, cancellation, invalid audio, or provider failure.
- Voice response system instruction exists as an opt-in helper and is used only by `gemini_voice_demo.py`. The existing text demo and runtime prompts are unchanged.
- Policy explicitly covers short answers, explanatory and requested-detail cases, conclusion first, no Markdown/table/list/emoji, no unnecessary greeting/closing/follow-up, context, real-time factuality, and no mid-sentence token truncation.
- The standalone demo runs Gemini through `LLMRunner`, then passes its output through the TTS adapter and writes `artifacts/gemini_voice_demo.wav`.
- No Backend auth/quota/usage is performed by the standalone diagnostic. The adapter is not wired into integrated robot runtime. No ESP32 playback-completion proof is asserted.

## Verification

- Focused adapter and foundation tests after D2-S2-09-FIX: **106 passed** (`test_gemini_tts.py`, `test_tts.py`, `test_llm.py`).
- Full suite after D2-S2-09-FIX: **422 passed, 18 failed**. Failures: firmware snapshot hash (1); robot WebSocket/gateway (8 connection/close cases, 5 codec-profile cases, missing-completion and overload cases, and 1 TCP subprocess shutdown issue); and `test_partial_pcm_padding_and_invalid_profiles` because native `libopus` is absent. No tests were altered to mask failures.
- Live demo: **BLOCKED**. Gemini LLM request failed with sanitized `provider_error`; the independent Gemini connection probe reported `FAIL_NETWORK`. TTS request therefore did not run. No live WAV, latency, or Vietnamese acoustic quality was verified.
- D2-S2-09-FIX TTS-only smoke: **BLOCKED** with sanitized `network_failure`; configured model is `gemini-3.8-flash-tts`, voice `Kore`. The API pricing table lists its Free Tier, but this project’s entitlement could not be verified because the request could not reach Google. No retry or paid fallback occurred; no WAV was written and Windows playback was not attempted.
- The full LLM → TTS live demo was not rerun because the task requires a successful TTS-only smoke first.
- Hardware playback: **NOT RUN**.

## Run on Windows CMD

From `AI_SERVER`:

```cmd
copy .env.example .env
notepad .env
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_LLM_PROVIDER=gemini
set AI_SERVER_VOICE_DEMO_ENABLE=true
.venv-win\Scripts\python.exe -m pytest tests\test_gemini_tts.py tests\test_tts.py tests\test_llm.py -q --basetemp=.pytest-d2-s2-09
.venv-win\Scripts\python.exe scripts\test_gemini_tts_live.py --play
.venv-win\Scripts\python.exe scripts\gemini_voice_demo.py
```

Configure real `GEMINI_API_KEY` locally in `.env` (never in source/log/report). Keep the provider model values explicit. The opt-in demo is standalone only and does not establish integrated Backend quota or hardware readiness.
