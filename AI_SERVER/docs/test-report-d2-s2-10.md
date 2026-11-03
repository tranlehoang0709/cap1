# D2-S2-10 — Full Voice Pipeline Integration (No Hardware)

## Implementation

- Added `VoiceFilePipeline`: injected `STTAdapter` → `LLMRunner` with Voice Response Policy V1 → injected `TTSAdapter`. No direct Google SDK calls in the pipeline and no mock fallback.
- Added a file CLI accepting one or more completed WAV/Ogg Opus utterances. Each `--audio` argument is a consecutive turn under a caller-provided user/session/device key; each session owns its own `Conversation` object. Outputs are checked WAV files under `AI_SERVER/artifacts/`.
- The CLI requires `AI_SERVER_BACKEND_MODE=development-mock`, `AI_SERVER_VOICE_PIPELINE_DEMO_ENABLE=true`, and `--enable`. This is explicit standalone diagnostic mode, not integrated Backend auth/quota/usage. Production remains fail-closed.
- Existing adapters, OpenAI provider, robot VAD/turn detector, WebSocket and playback behavior are unchanged.

## Live status

- Live pipeline: **BLOCKED / NOT RUN**. The workspace has no supplied recording of a Vietnamese user question. Firmware `welcome.ogg` is a pre-recorded welcome phrase, not a user question, so it was not substituted as input. Existing WAV files in `artifacts/` are output-shaped files with no verified provenance and were not treated as source recordings or this task's results.
- The latest Gemini TTS-only live attempt in D2-S2-09-FIX reported `network_failure`; project access is therefore not currently verified. No new TTS request was made in this task. Without a valid input recording and reachable APIs there is no live transcript, answer, token usage, per-stage latency, or new output WAV to report.
- Existing D2-S2-08 STT report records a prior live success on a firmware welcome Ogg, but that is not an end-to-end question pipeline test.
- Audio playback and ESP32/hardware: **NOT RUN**.

## Tests

- Focused voice pipeline + file parsing + Gemini STT/TTS + TTS/LLM foundation: **127 passed**. The added pipeline tests use fixture adapters and only verify orchestration, cleanup, errors, multi-turn history and isolation; they are not live PASS.
- Full suite was not rerun for D2-S2-10. The previous full run (D2-S2-09-FIX) was 422 passed, 18 failed: firmware snapshot hash, legacy WebSocket/gateway behavior, missing native `libopus`, and a Windows subprocess shutdown issue.

## Windows CMD

From `AI_SERVER`, configure a real `GEMINI_API_KEY` locally, but do not enable billing just to run the diagnostic. Use a real Vietnamese question recording you have permission to send to the provider.

```cmd
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_LLM_PROVIDER=gemini
set AI_SERVER_VOICE_PIPELINE_DEMO_ENABLE=true
.venv-win\Scripts\python.exe -m pytest tests\test_voice_file_pipeline.py tests\test_voice_file_demo.py tests\test_gemini_stt.py tests\test_gemini_tts.py tests\test_tts.py tests\test_llm.py -q --basetemp=.pytest-d2-s2-10
.venv-win\Scripts\python.exe scripts\gemini_voice_file_pipeline.py --enable --audio D:\recordings\question-1.wav --audio D:\recordings\question-2.ogg --user-id user-a --session-id session-a
```

Multiple files in one invocation are consecutive turns in one conversation. To verify identity isolation, run with different `--user-id`/`--session-id` values; never reuse one `Conversation` instance between identities.

No command here starts a backend service or robot. A live PASS requires a genuine question recording, successful real STT/LLM/TTS calls, returned token usage, and a newly written WAV artifact.
