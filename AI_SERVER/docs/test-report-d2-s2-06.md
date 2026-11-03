
## D2-S2-06 — OpenAI API live probe

`OpenAILLMAdapter` from Task 03 already uses `openai==3.42.1`, `AsyncOpenAI`, and the official Responses API; it intentionally requires its caller to provide the API key. Added `scripts/test_openai_connection.py` as a separate real one-shot probe. It reads `OPENAI_API_KEY`, `OPENAI_MODEL`, and `OPENAI_TIMEOUT_SECONDS` from process environment or AI_SERVER `.env`, disables SDK automatic retries, caps output using the existing `AI_SERVER_LLM_MAX_OUTPUT_TOKENS` setting, and reports response text, request ID, latency, and provider usage without printing secrets or SDK error bodies.

The configured example model is `gpt-6-luna`. OpenAI model documentation currently lists this model and the Responses endpoint, but account/project entitlement can only be confirmed with a real API call. No OpenAI key is configured in this environment; running the script returned `BLOCKED_OPENAI_API_KEY_MISSING` before network access. No live response, request ID, latency, or usage is available.

Unit tests: **10 PASS**. Full AI_SERVER test suite: **375 PASS / 18 FAIL**. The 17 robot/Opus failures stem from missing native `libopus`; TCP cleanup also hits unsupported Windows SIGINT. One additional failure is a historical firmware snapshot hash mismatch. No quota/rate limit behavior was changed. Live status is BLOCKED, not PASS.

Windows CMD:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv-win\Scripts\python.exe -m pip install -r requirements.txt
set OPENAI_API_KEY=REPLACE_WITH_YOUR_OPENAI_API_KEY
set OPENAI_MODEL=gpt-6-luna
set OPENAI_TIMEOUT_SECONDS=30
.venv-win\Scripts\python.exe scripts\test_openai_connection.py
.venv-win\Scripts\python.exe -m pytest tests\test_openai_connection.py -q -p no:cacheprovider
.venv-win\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest-d2-s2-06 --tb=short
```

For local `.env`, add `OPENAI_API_KEY` and `OPENAI_MODEL`; keep the file private and never paste the key into logs, source, or reports. This probe does not wire OpenAI into the device WebSocket or bypass Backend integrated fail-closed behavior.
