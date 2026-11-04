# D2-S2-19 — Secure Wi-Fi gateway

Status: **PARTIAL / deployment and enrollment BLOCKED** (2026-11-04).
AI_SERVER now refuses plaintext OTA/WebSocket gateway traffic and its LAN
entrypoint requires direct TLS. No production TLS certificate is configured,
no TLS listener was started, and no physical ESP32 test was run.

The existing `0.0.0.0:8000` listener returned HTTP 401 to a local POST with no
device headers (no credential was sent), which identifies it as the prior
plaintext app behavior. It was not launched by this task. The process was
identified as PID 9828 (`python.exe`); Windows denied process inspection via
CIM and denied `Stop-Process`, so it could not safely be restarted or stopped.
The old listener therefore remains a deployment security blocker; current
source changes do not retroactively secure an already-running process.

## Contract currently implemented

- `POST https://<LAN-host>:<port>/xiaozhi/ota/`
  - Requires exactly one `Device-Uid` and `Device-Credential` header.
  - Validates them through existing BE `POST /internal/devices/authorize` using
    the BE service token held only by AI_SERVER.
  - Returns `Cache-Control: no-store` and the configured
    `wss://<LAN-host>:<port>/ws/robot` URL. It never returns credential material.
  - HTTP requests receive `426 HTTPS_REQUIRED`.
- `wss://<LAN-host>:<port>/ws/robot`
  - Plain `ws://` closes before BE authorization or hello.
  - WSS requires existing device authorization, config resolution and existing
    quota admission before a microphone turn. Audio before an admitted turn is
    rejected. Heartbeat is an authenticated application event; sessions are
    newly generated on reconnect and old voice turns are not replayed.
- Audio continues through the existing bounded in-memory Opus pipeline; this
  change adds no disk/flash audio storage.
- Integrated mode and BE unavailable/error behavior remain fail-closed.

AI_SERVER itself does not authenticate firmware using TLS client certificates;
device credential verification remains delegated to BE. TLS encrypts the
device proof only when the client actually validates the server certificate.

## Runtime TLS configuration

`AI_SERVER_LAN_PUBLIC_ORIGIN` must be an `https://` origin matching
`AI_SERVER_PORT`; the WebSocket URL is always `wss://`. Set absolute file paths:

```text
AI_SERVER_TLS_CERTFILE=C:\path\to\lan-server-chain.pem
AI_SERVER_TLS_KEYFILE=C:\path\to\lan-server.key
```

`scripts/run_lan.py` rejects HTTP origins, absent/relative cert/key paths,
missing files and certificate/key pairs that Python/OpenSSL cannot load. The
TLS context requires TLS 1.2 or newer. The normal `run_dev.py` passes the same
optional cert/key settings to Uvicorn; route-level HTTPS/WSS enforcement keeps
the LAN device endpoints closed if it is accidentally launched without TLS.

The current private deployment still advertises HTTP and has no TLS file paths.
`run_lan.cmd` will therefore exit with a safe configuration error. Do not put a
device credential in an HTTP header while testing this server. Configure a
certificate whose SAN matches the LAN DNS name/IP, and ensure the ESP32 firmware
trusts its issuing CA and validates hostname/SAN. A self-signed certificate
that the device does not trust is not a working secure gateway. Firmware is
out of scope and its CA-bundle/hostname verification is not confirmed here.

## Enrollment blocker

D2-S2-18's enrollment endpoints were proposed, not implemented. The only real
device auth contract remains `POST /internal/devices/authorize` with an already
issued credential. No enrollment challenge, signed device proof, credential
delivery/ack or safe rotation endpoint exists. AI_SERVER did not invent or call
those paths. A device without an operational credential cannot enroll here.

## Tests

Updated `tests/test_lan_bootstrap.py` and `tests/test_live_robot_pipeline.py` to
exercise the gateway with HTTPS/WSS ASGI scopes. Coverage includes plaintext
HTTP/WS rejection before BE auth, valid/invalid BE proof, bounded bootstrap,
session isolation, disconnect/reconnect IDs, unauthorized audio, admission and
BE configuration failure. TLS entrypoint tests check missing and unloadable
certificate/key fail closed. These are application/config tests; they do not
prove a real TLS handshake or firmware certificate validation.

Windows CMD, after installing a certificate chain and private key using a
trusted certificate-management process:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
set AI_SERVER_HOST=0.0.0.0
set AI_SERVER_RELOAD=false
set AI_SERVER_LAN_PUBLIC_ORIGIN=https://<LAN-DNS-NAME>:<PORT>
set AI_SERVER_TLS_CERTFILE=<ABSOLUTE_CERT_CHAIN_PATH>
set AI_SERVER_TLS_KEYFILE=<ABSOLUTE_PRIVATE_KEY_PATH>
run_lan.cmd
```

Configure equivalent values in the private `.env` for normal use. Keep the
private key out of the repository and logs. Check HTTPS and certificate
validation from a client that trusts the intended CA, then WSS; do not use
`curl -k`, insecure SSL contexts, or certificate-verification bypasses. Firewall
must expose only the TLS listener port. `run_lan.cmd` prints the HTTPS OTA and
WSS URLs after validating settings.

## Results and remaining blockers

- Focused test command (PowerShell):
  `$env:PATH = (Resolve-Path .venv\Lib\site-packages\pyogg).Path + ';' + $env:PATH; .venv\Scripts\python.exe -m pytest tests/test_lan_bootstrap.py tests/test_live_robot_pipeline.py tests/test_backend_integration_mode.py tests/test_config.py -q -p no:cacheprovider -k "not dotenv"`
- Result: **62 passed, 2 deselected**. The deselected dotenv tests require the
  pytest temp directory, which is denied by this environment's Windows ACL.
- Full `pytest tests` result: **499 passed, 1 failed, 34 errors, 7 deselected**.
  The failure is the pre-existing firmware snapshot hash assertion. Errors are
  from denied `C:\Users\troc\AppData\Local\Temp\pytest-of-troc` access for
  tests needing `tmp_path`/real TCP. Collection initially included a binary
  `artifacts/d2-s2-14/tests.txt`; restricting discovery to `tests/` avoids that.
- No real certificate files/trust anchor are configured, so TLS handshake,
  certificate failure against an actual socket, and physical ESP32 certificate
  verification are BLOCKED.
- Running `scripts/run_lan.py` with the existing deployment configuration exits
  before binding because `AI_SERVER_LAN_PUBLIC_ORIGIN` is HTTP. The existing
  plaintext process could not be stopped due Windows access denied (PID 9828).
- Enrollment/replay/credential delivery tests are BLOCKED until BE implements
  and approves D2-S2-18. Existing credential rejection/revocation and reconnect
  tests exercise only the current already-provisioned proof flow.
- No tests were performed against Gemini/live MySQL or physical microphone and
  speaker. No BE, firmware or FE files were modified.
