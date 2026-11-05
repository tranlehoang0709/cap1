# AIVA-IoT real local launcher

From any CMD directory:

```bat
D:\cap1-latest\run_all.bat
```

Starts missing FastAPI, NestJS and Streamlit services in separate CMD windows. A healthy listener is reused only if its launcher ancestry is verified. Unknown/unhealthy port owners are BLOCKED; nothing is killed. Stop each service with Ctrl+C in its CMD; windows remain open after failure.

- `run_all.bat --check`: dependencies, local configuration, URLs/token equality and existing listener ownership/HTTP health. Free ports are READY TO START, not HTTP PASS.
- `run_all.bat --status`: requires all three services running and healthy.
- Feature readiness is separate from launcher exit status; OFF contracts, absent models or storage readiness never mean LIVE inference PASS.

Actual endpoints: FE http://127.0.0.1:8501; BE http://127.0.0.1:3000/health; AI http://127.0.0.1:8000/health. Loopback hosts are required. The launcher does not install packages, edit `.env`, seed users, run migrations, approve contracts or call providers.

BE uses `BE/.env`; AI uses `AI_SERVER/.env`. Preserve existing secrets. The persistent local User credential file is `.aiva-local-private/user-account.json`, ACL protected and Git excluded; never print or commit it. Admin credentials remain in the protected BE config.

On Windows `install_all.bat` uses the declared `AI_SERVER/requirements-windows.txt`, including PyOgg. The launcher validates the compatible Opus DLL in this project's AI virtualenv and passes its path to children; explicit configured paths take precedence. No `.env` rewrite is needed. Native codec availability is not STT/LLM/TTS inference readiness.

No usable Ollama/vLLM/llama.cpp runtime/model was found. LOCAL has no active model or implemented execution adapter, and there is no paid-provider fallback. Config/device/quota contracts remain OFF. The optional V1.5 JSON-ledger adapter is implemented but NOT selected or approved; see `BE/docs/v15-quota-history-contract.md`. Do not enable contracts or run a quota migration just to make checks green.

Read `INTEGRATION_LOCAL_REPORT.md` for actual test evidence, remaining failures and model proposals. HTTP health, authenticated transport and successful inference are separate results.
