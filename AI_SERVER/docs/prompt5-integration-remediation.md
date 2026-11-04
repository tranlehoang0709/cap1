# Prompt 1–5 integration remediation (SD2)

This note records code-level work and the local checks performed. It does not
claim microphone, speaker, Gemini, or SD2 hardware acceptance.

## Runtime paths

- **Integrated:** `AI_SERVER_BACKEND_MODE=integrated`; `/xiaozhi/ota/` and
  `/ws/robot` authorize through Backend, and robot turns keep Backend quota and
  usage admission. Backend-dependent execution remains fail-closed.
- **Standalone LAN diagnostic:** explicitly set
  `AI_SERVER_BACKEND_MODE=development-mock`, `AI_SERVER_ROBOT_ENABLED=true`,
  `AI_SERVER_ROBOT_AI_MODE=gemini`, and a server-only
  `AI_SERVER_ROBOT_LOCAL_DEVICE_CREDENTIALS` JSON map. `/xiaozhi/ota/` and
  `/ws/robot` require HTTPS/WSS, a private-network allowlist, UID plus a
  per-device credential (43–128 base64url characters), and Gemini configured
  on the server. It never calls Backend and does not represent Backend user
  quota. Its existing local limiter is 12 turns/minute per credential.
- The bearer token path remains for `/ws/dev-robot` diagnostics. It is not a
  per-device identity and must not be presented as the standalone device path.

Do not place `GEMINI_API_KEY`, device credentials, or Wi-Fi passwords in
firmware source, URLs, command-line history, or logs. `.env.example` documents
the variable name only; put real values in the ignored local `.env` or process
environment. The device credential must be independently provisioned on the
server and SD2. The current firmware's `proof <uid> <credential>` USB console
command is a commissioning/debug path; a secure wireless credential issuance
flow is not implemented here.

## Relevant behavior

- Firmware AFE VAD now owns the two-second silence deadline on LAN. It starts
  only after AFE reports speech, resets on speech, uses the monotonic ESP timer,
  and emits one `listen.stop`. LAN listen mode is manual-boundary mode, matching
  the server contract. Buffered wake and post-wake Opus packets are held in a
  bounded RAM queue until admission; overflow/denial clears that turn's audio.
- Server abort requires the active connection session and exact `turn_id`, is
  idempotent, cancels provider/output tasks, rejects stale audio/output ACKs,
  and keeps the WebSocket open. A completed assistant response enters history
  only after playback completion. An interrupted turn records an interruption
  marker; it does not claim all generated text was heard. Backend usage reports
  actual provider usage once; robot `complete_turn` is deferred until playback
  confirmation. Web Chat still completes its Backend turn at HTTP response.
- After playback, SD2 returns to idle/wake detection, not automatic mic capture.
- The SD2 profile's configured WakeNet is “Nihao Xiaozhi”, not “helo”. There is
  no verified local “Im lặng” command model. AFE VAD is not command recognition
  or speaker identification. No replacement word, cloud always-listening path,
  or speculative GPIO was introduced.
- Audio remains bounded in RAM in the runtime pipeline. This change adds no
  audio file persistence.

## LAN setup outline (Windows CMD)

1. In a local ignored `AI_SERVER/.env`, select one path above. For standalone,
   provide a unique device credential map and Gemini server credential. Set
   `AI_SERVER_HOST=0.0.0.0`, `AI_SERVER_PORT`, a private
   `AI_SERVER_ROBOT_ALLOWED_NETWORKS`, `AI_SERVER_LAN_PUBLIC_ORIGIN` as an
   `https://` DNS origin on that port, and absolute TLS cert/key paths.
2. The server certificate must chain to a trust anchor present on ESP32 and its
   SAN must match the configured DNS name. The current firmware uses ESP-IDF's
   built-in certificate bundle; a self-signed LAN certificate is not trusted by
   that bundle. No insecure TLS switch is supported.
3. Discover the current computer LAN address with `ipconfig`; do not advertise
   `localhost` or `0.0.0.0` to SD2. Confirm router/firewall access for the
   configured TCP port.
4. Start from the repository:

   ```bat
   cd /d E:\learn\AI_Project\cap1\AI_SERVER
   run_lan.cmd
   ```

   Check `http://127.0.0.1:<port>/health` on the server. A valid configured
   origin advertises `https://<DNS-name>:<port>/xiaozhi/ota/` and
   `wss://<DNS-name>:<port>/ws/robot`.

Firmware source target remains `custom/aiva-iot-s3-st7789` (SD2); its LAN
variant is generated/configured by the repo build workflow. After installing
ESP-IDF v6.0.2 and exporting its environment in CMD:

```bat
cd /d E:\learn\AI_Project\cap1\xiaozhi-esp32
idf.py --version
python scripts\build.py custom/aiva-iot-s3-st7789 --name aiva-iot-s3-st7789-lan --language vi-VN
idf.py -p <verified-COM-port> flash monitor
```

Do not substitute an unverified COM port. Current machine inspection in this
run found no `idf.py` on PATH and no serial device, so no build/flash/monitor
was attempted.

## Verification evidence

- Focused AI_SERVER selection: `187 passed` across robot gateway, LAN bootstrap,
  live integration fixture, live robot fixture, orchestrator, LLM, TTS and
  dotenv tests; after the last additions rerun those modules for final count.
- Full AI_SERVER suite before latest additions: `552 passed, 1 failed`; the
  sole failure is the pre-existing `test_firmware_snapshot_hashes_match_workspace_sources`
  snapshot mismatch. Earlier suite runs showed this same failure before the
  remediation; the snapshot was not changed to hide it.
- Firmware Python host/source tests: `83` pass; `2` C++ host tests cannot run
  because `clang++` is absent (`WinError 2`). These do not compile the ESP-IDF
  firmware.
- Live Gemini, real ESP32 audio, Wi-Fi loss/recovery and speaker playback were
  not run in this verification. The “helo” and “Im lặng” behaviors remain
  blocked on compatible recognition models and hardware validation.
- Current local environment is integrated mode with robot standalone disabled,
  no local device credential entries, no Gemini credential, and no TLS cert/key
  files configured. The advertised HTTPS origin alone is insufficient to run
  `run_lan.cmd`; do not switch to plaintext WSS or skip device authorization.
