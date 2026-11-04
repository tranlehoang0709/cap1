# D2-S2-14 — Xiaozhi ESP32 Wi-Fi → AI_SERVER

Status: PARTIAL / NOT ACCEPTED for standalone voice. Date: 2026-11-04.

## What runs

SD2 is `custom/aiva-iot-s3-st7789` (ESP32-S3, ST7789 240x240, NS4168).
SD1 remains `custom/xiaozhi-s3-tft`. Neither board's GPIO mapping was changed.

Firmware `Ota::CheckVersion()` POSTs system information to the URL stored at
NVS `wifi/ota_url`. Its parser consumes `websocket`, `activation`, `server_time`
and optional `firmware` sections. The former public default path is
`/xiaozhi/ota/`; AI_SERVER now IMPLEMENTS this path, rather than assuming an
existing local service. GET is not supported: this firmware sends POST.

The new handler authenticates explicit `Device-Uid` / `Device-Credential`
through BE `POST /internal/devices/authorize`. MAC and Client-Id are metadata,
never an identity mapping. Successful bootstrap returns only:

```json
{
  "websocket": {"url": "ws://<LAN-host>:<env-port>/ws/robot", "version": 1},
  "server_time": {"timestamp": 0, "timezone_offset": 0}
}
```

The timestamp above is a schema illustration; runtime uses current UTC epoch
milliseconds. No fake activation code, shared token or firmware release is
issued. An authorized, already provisioned device needs no activation section.
Missing proof returns 401, denied BE authorization 403, unavailable BE 503.
The bounded body is discarded; responses have `Cache-Control: no-store`.
Firmware image distribution and a new enrollment/activation service are NOT
implemented by this bootstrap. Existing BE firmware metadata APIs are separate.

`/ws/robot` is a new integrated-only LAN control endpoint. `/ws/dev-robot` and
`/ws/dev-echo` retain their existing roles. The LAN endpoint authenticates BE
proof before hello, checks explicit protocol 1/2/3 and Opus mono 16 kHz / 60 ms,
and negotiates `aiva_half_duplex_v1` + `aiva_lan_v1`. Each connection has a new
random session ID; every control event must match it. Silence times out at
45 seconds. Firmware sends a direct heartbeat every 15 seconds while idle;
the server forwards it to BE `/internal/devices/heartbeat` using server receipt
time. WebSocket ping/pong does not mark device presence.

The opt-in `aiva-iot-s3-st7789-lan` variant restores OTA bootstrap, sends device
proof from NVS `device/uid` and `device/credential`, opens the control channel
on the activation worker, and retries bootstrap/control connection on a 15 s
idle cadence after disconnect. Wi-Fi readiness gates retries. Blocking DNS,
connect and hello waits stay off the main/audio loop. Reconnect discards the
old session; a previous voice turn is never replayed. These changes have source
and host-test evidence only; the firmware has not been built/flashed here.

## Actual configuration observed on this machine

- `.env`: `AI_SERVER_HOST=0.0.0.0`, `AI_SERVER_PORT=8000`, reload false.
- `AI_SERVER_LAN_PUBLIC_ORIGIN=http://192.168.0.104:8000` (Ethernet address).
- OTA: `http://192.168.0.104:8000/xiaozhi/ota/`.
- WebSocket: `ws://192.168.0.104:8000/ws/robot`.
- Backend mode remains `integrated`; no auth/quota bypass was enabled.
- Existing service credentials and provider keys were preserved. Native Opus
  DLL was configured with the existing Windows setup script.
- `.env` still has historical duplicate provider/key entries. Effective Gemini
  live configuration is not ready; no live provider request was made.
- The only serial port detected is COM1; SD2 is not visible to this machine.

Update after the user connected USB: SD2 is now present on COM3 (Espressif
USB VID 0x303a/PID 0x1001). A controlled reboot and serial observation confirmed
app version 2.4.2, ESP-IDF 6.0.2, SKU `aiva-iot-s3-st7789-dev-voice`, I2S simplex
initialization, `Network connected`, and `AIVA_STATUS state=3 ws_configured=1`.
This supersedes the serial-absence observation above. Boot and connection to
the saved Wi-Fi are now observed PASS; LAN endpoint, mic capture and speaker
output are not established by those logs. No firmware was flashed.

Local SDK export was investigated further: its Python dependencies pass with
`IDF_TOOLS_PATH=C:\Espressif\tools`, but tool discovery then fails because the
installed compiler/tool directory layout does not match the SDK tool root.
The installed SDK source remains 6.0.3, whereas the running device and the
TX/DMA completion experiment use 6.0.2. No guard was weakened and no unbuilt
image was written over the working firmware.

The address is configuration, not compiled into source. Update the advertised
origin after network changes and rebootstrap devices. Do not use `0.0.0.0` as
a client URL. HTTPS/WSS requires a correctly configured TLS endpoint; the
provided direct Uvicorn command serves HTTP/WS on the trusted LAN.

## Windows CMD

From the workspace root:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv\Scripts\python.exe -m pip install -r requirements-windows.txt
.venv\Scripts\python.exe scripts\setup_windows_audio.py
ipconfig
```

Edit `.env` once per variable: set bind to `0.0.0.0`, reload false, keep the
chosen port, set `AI_SERVER_LAN_PUBLIC_ORIGIN` to the actual LAN origin with
that port. Keep integrated mode and the three distinct BE service tokens.
Do not paste tokens into CMD arguments, screenshots, reports or firmware.

In an **Administrator CMD**, allow the configured port on the Private network
profile, local subnet only (the script reads the port from `.env`):

```bat
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\lan_firewall.ps1
```

The firewall rule has NOT been applied automatically. Confirm Windows treats
the intended LAN as Private. Then start the server in a regular CMD:

```bat
run_lan.cmd
curl --noproxy "*" http://192.168.0.104:8000/health
```

`run_lan.cmd` prints the OTA and WebSocket URLs. Do not start a second instance
when port 8000 already has the server. A hidden instance was started during
this task for local/LAN interface health checks; logs are under
`artifacts/d2-s2-14/`. Health only proves process availability.

## First flash and provisioning

The existing SD2 development firmware skips OTA and lacks BE proof headers.
It therefore needs a first flash of the LAN variant; changing only its OTA URL
cannot add this protocol. Devices already running the LAN variant do not need
a reflash to change SSID/password/OTA URL or rotate their device proof.

Use the project's intended **ESP-IDF 6.0.2** environment, exported in CMD:

```bat
cd /d E:\learn\AI_Project\cap1\xiaozhi-esp32
idf.py --version
python scripts\build.py custom/aiva-iot-s3-st7789 --name aiva-iot-s3-st7789-lan --language vi-VN --wake-word disabled
idf.py -p <SD2_COM_PORT> -b 115200 flash
```

This preserves pins and uses the existing experimental TX/DMA proof. Do not
substitute an unverified SDK: the experiment was scoped to 6.0.2. Current local
6.0.3 export fails because its constraints file/Python environment setup is
incomplete; no successful firmware build is claimed.

Register/pair/approve the device and issue its device credential using the
existing authorized BE admin workflow. Do not use the Gemini key or the old
shared LAN token. No registration or credential rotation was run by this task.
Provision the BE UID and one-time returned device credential over USB:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv\Scripts\python.exe scripts\lan_device.py provision --port <SD2_COM_PORT> --uid <BE_DEVICE_UID>
```

The credential is prompted without echo and never appears in process arguments.
The board must acknowledge `AIVA_PROOF saved`; failures do not report success.
USB is only for the initial flash/proof provisioning, not media transport.
The `wifi` USB command can enter the existing configuration portal if needed.

### Wi-Fi/OTA configuration without USB

With no saved SSID, the existing firmware starts the `Xiaozhi-*` AP. If an old
saved network is unavailable during startup, the existing 60 s connect timeout
also enters configuration mode. Connect a phone to that AP and use the portal
URL displayed by the device. Its existing form configures SSID/password;
Advanced Settings has Custom OTA URL. Enter the LAN OTA URL above, save, exit
configuration and restart. The underlying component uses `/submit` and
`/advanced/submit`; it was inspected but not modified. Do not put credentials
inside the OTA URL. BOOT GPIO is unknown and was not guessed or reassigned.

After provisioning, power SD2 from a suitable independent supply. Merely
unplugging its only power source is not a standalone-power test. The build
command disables wake word; a verified physical-button/wake-word trigger for
standalone voice remains an additional blocker. USB record/stop is diagnostic.

## Simulator and physical acceptance

Once BE is available and the device is approved/provisioned:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv\Scripts\python.exe scripts\lan_device.py simulate --origin http://192.168.0.104:8000 --uid <BE_DEVICE_UID>
```

It prompts for the device credential and checks real HTTP bootstrap, hello,
heartbeat, disconnect and a new session on reconnect. It explicitly reports
that media remains blocked. It is not a microphone, speaker or Wi-Fi simulator.
Offline contract tests use isolated test fixtures, never production mock mode.

For physical tests: confirm boot/Wi-Fi and the server's authorized device ID;
confirm mic Opus frames, decoded STT, Gemini LLM usage, TTS Opus and audible
speaker output; repeat with independent power. Disconnect Wi-Fi during both
idle and speech, restore it and verify a new authenticated session, no replay,
and no old-session playback. These tests are BLOCKED here.

## Integration blockers (BE was NOT modified)

1. BE `/internal/ai/resolve-config` returns `credentialReference`, not a secret
   or an approved mechanism for delivering that credential to the media adapters.
2. `app/services/backend_execution.py::QuotaLLMAdapter` explicitly allows only
   `MockLLMAdapter`; real-provider admission, budgets and usage settlement are
   not implemented as a complete production path. This guard was not removed.
3. Accordingly `/ws/robot` resolves config at `listen.start`, then reports
   `AI_PIPELINE_UNAVAILABLE` and closes before reading mic audio or calling STT,
   LLM or TTS. BE failures close the session; there is no fallback.
4. BE health at the configured origin failed to connect in the live check.
   Positive authorization/heartbeat can currently only be demonstrated with
   isolated contract fixtures, not the unavailable live BE.

The requested Gemini mic-to-speaker integrated runtime cannot be accepted
until those contracts and the physical voice trigger are completed. No audio
or transcript recording was added; rejected media is not decoded or saved.

## Verification and acceptance

See the final result section below for exact executed counts. The tests cover
OTA body limits, missing/denied proof, BE unavailable, source-origin injection,
hello format, session isolation, idle timeout, reconnect, heartbeat revocation,
and rejection of audio before admission. Existing native Opus tests cover v1/2/3
framing, encode/decode, playback proof and multi-session isolation.

Live checks on both loopback and this machine's Ethernet address: health 200,
OTA missing proof 401; missing-proof WebSocket handshake denied. These do not
prove firewall reachability from a second LAN device.

| Acceptance requirement | Result |
| --- | --- |
| ESP32 boot and Wi-Fi | PASS observed on existing dev-voice firmware after USB connection |
| Automatic LAN connection | BLOCKED hardware; firmware implementation added |
| Correct device identity | PASS isolated BE contract tests; BLOCKED live BE |
| Mic → STT → Gemini → TTS → speaker | BLOCKED integration contracts |
| Operate after USB removed with independent power | BLOCKED hardware |
| Recover after Wi-Fi loss | PASS server reconnect/session tests; BLOCKED radio/hardware |

Only `AI_SERVER/` and `xiaozhi-esp32/` were changed in this task. FE, BE, MySQL
and Git were not modified. No firmware was flashed and no production key was
printed or regenerated.

### Executed results

- Full AI_SERVER suite: **524 PASS, 1 FAIL**. The failure is
  `test_protocol.py::test_firmware_snapshot_hashes_match_workspace_sources`,
  at the historical snapshot parent-hash assertion. Historical snapshots were
  not rewritten to hide drift. Result log: `artifacts/d2-s2-14/tests.txt`.
- Focused LAN/bootstrap/provisioning tests: **17 PASS** on the final source.
- Earlier native Opus + robot gateway + BE mode + LAN subset: **58 PASS**.
  Test-only synthetic speech/tone fixtures are not a live Cloud result.
- Firmware host suite: **71 PASS, 2 ERROR** (73 total). The two C++ host tests
  cannot invoke a Windows `clang++` toolchain. Log:
  `artifacts/d2-s2-14/firmware-tests.txt`.
- ESP-IDF build: **BLOCKED**. Exporting local 6.0.3 reports missing
  `C:\Espressif\espidf.constraints.v6.0.txt`; verified 6.0.2 is not available
  in this environment. No generated firmware output was edited manually.
- Python syntax compilation and touched C/C++ clang-format: PASS.
- Live HTTP/LAN health and negative-auth checks: PASS as described above.
- Positive live BE simulator, Gemini, SD2 audio, independent power, physical
  Wi-Fi loss/recovery, and reachability from another LAN client: BLOCKED.

Reproduce the full server suite in CMD (the test fixtures intentionally ignore
the user's `.env`, so native Opus needs the test process DLL search path):

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
set "PATH=%CD%\.venv\Lib\site-packages\pyogg;%PATH%"
.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider --basetemp=.pytest-d2s214-manual
```

### Source changes

- AI_SERVER: added `app/core/lan_config.py`, `app/api/xiaozhi_ota.py`,
  `app/api/lan_robot.py`; registered them in `app/main.py`.
- Added `scripts/lan_device.py`, `scripts/run_lan.py`,
  `scripts/lan_firewall.ps1`, `run_lan.cmd`.
- Added `tests/test_lan_bootstrap.py`, `tests/test_lan_device.py`; isolated
  LAN settings in `tests/conftest.py`.
- Updated `.env.example`, local ignored `.env` (bind/reload/origin/Opus only),
  README, AGENTS and this report.
- Firmware: updated `main/Kconfig.projbuild`, `main/ota.cc`,
  `main/application.cc`, `main/application.h`,
  `main/protocols/protocol.h`, `main/protocols/websocket_protocol.cc`,
  `main/protocols/websocket_protocol.h`; added SD2 LAN variant and USB proof/wifi
  commands in the SD2 board config/source. Added
  `scripts/tests/test_lan_variant.py`, updated board README and AGENTS.

Existing development paths remain opt-in and are not used by the integrated
LAN endpoint. Other pre-existing workspace changes were preserved.

## D2-S2 live audio follow-up (2026-11-04)

Source now wires the authenticated `/ws/robot` turn to the existing Gemini
STT, quota-wrapped Gemini LLM, and TTS adapters. Firmware Opus packets decode
to bounded 16 kHz mono PCM held in RAM until the existing manual stop boundary;
STT runs once on that closed utterance. Gemini's existing Interactions PCM
stream is converted incrementally from 24 kHz to 16 kHz Opus and paced through
the bounded playback queue. The integrated path does not use the unary WAV
adapter, persist audio, replay the mic, or retry a provider request.

The server sends session/turn-scoped `status` events for listening, processing
and failure. SD2 LAN firmware waits for per-turn quota admission before enabling
mic capture and validates the turn ID on status and playback controls. Existing
manual firmware triggers are `record` and `stop` on the SD2 USB diagnostic
console; these carry commands only, never audio.

Verification on this source: AI_SERVER suite **549 PASS, 1 historical snapshot
hash FAIL**; focused live-pipeline, STT/TTS, quota and gateway tests **167 PASS**;
firmware host/config tests **71 PASS**. The host pipeline uses provider/BE test
fixtures. Live Backend/Gemini, TLS/WSS and SD2 mic/speaker were not tested in
this follow-up. ESP-IDF build remains blocked by the missing compatible toolchain.
