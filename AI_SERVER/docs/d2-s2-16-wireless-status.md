# D2-S2-16 — Fully wireless Wi-Fi status

Status: **BLOCKED / not accepted** (2026-11-04). No firmware was built or flashed
for this task, and no physical ESP32 acceptance test was run.

## Existing flow confirmed from source

- SD2 LAN variant is `aiva-iot-s3-st7789-lan` in
  `xiaozhi-esp32/main/boards/custom/aiva-iot-s3-st7789/config.json`.
- `WifiBoard` uses the XiaoZhi hotspot provisioning portal when no SSID exists
  or after its 60-second connection timeout. The portal saves Wi-Fi settings
  and supports a custom OTA URL. `Ota::CheckVersion()` reads
  `wifi/ota_url`, POSTs system info, sends `device/uid` and
  `device/credential`, and consumes the returned WebSocket URL.
- AI_SERVER constructs the advertised URL from
  `AI_SERVER_LAN_PUBLIC_ORIGIN`; its current deployment value is
  `http://192.168.0.104:8000`, which yields:
  `http://192.168.0.104:8000/xiaozhi/ota/` and
  `ws://192.168.0.104:8000/ws/robot`.
- `/xiaozhi/ota/` and `/ws/robot` validate the explicit UID/credential with BE.
  Heartbeats are direct application events; connection loss requires a fresh
  bootstrap and WebSocket session.
- Audio uses the existing RAM buffers and WebSocket Opus frames; this task did
  not modify audio or persistence paths.

## Acceptance blockers

1. The current SD2 firmware variant seen on hardware was
   `aiva-iot-s3-st7789-dev-voice`, not the LAN variant. The LAN variant has not
   been rebuilt/flashed or tested on hardware.
2. The SD2 `BOOT_BUTTON_GPIO` is explicitly `GPIO_NUM_NC` pending board-level
   verification. Firmware has no confirmed user control to re-enter the
   portal while running. The portal is available at first boot without a saved
   network and after startup connection timeout, but that does not fulfill
   reliable user-triggered Wi-Fi changes.
3. Device proof can currently be provisioned only through the development USB
   console. BE has pairing-code, owner request, admin approval, and one-time
   credential issuance APIs, but there is no approved protocol that delivers
   the issued secret to an unauthenticated ESP32 over Wi-Fi. Firmware contains
   no per-device root key/certificate or authenticated enrollment challenge.
   Issuing a credential through the open provisioning AP/HTTP would permit
   theft or takeover; it is deliberately not implemented.
4. The configured LAN origin uses HTTP/WS. Thus the current firmware sends
   device credential in cleartext at OTA and WebSocket transport. A network
   attacker on that path could capture/replay the credential. Requirements
   prohibit sending secrets on an unprotected network; a trusted-LAN assumption
   is not transport protection. HTTPS/WSS certificate validation and a secure
   trust-anchor provisioning path are not configured.
5. The board configuration sets button GPIOs to NC and wake word is disabled
   on the known development build. There is no physical full-voice PASS.

## Acceptance matrix

| Criterion | Result | Evidence / remaining work |
| --- | --- | --- |
| Auto-join saved Wi-Fi | PARTIAL | Generic firmware source does this; SD2 LAN image not physically verified. |
| Phone configures SSID/password and OTA URL | PARTIAL | Existing portal and OTA form; runtime SD2 access/re-entry not verified. |
| Configurable OTA and WS URLs | SOURCE PASS | Derived from NVS OTA URL and explicit `AI_SERVER_LAN_PUBLIC_ORIGIN`; no source IP hardcoded. |
| Backend authenticates device UID/credential | SOURCE PASS | OTA and WS call BE authorization; no physical current-LAN image test. |
| Opus mic → Gemini → speaker over Wi-Fi | BLOCKED | No physical/LIVE test; current SD2 firmware is the USB dev-voice build and runtime Gemini readiness is separately blocked. |
| Heartbeat/reconnect | SOURCE PASS | Existing LAN worker rebootstrap/reconnect; no Wi-Fi interruption hardware test. |
| No USB for use/configuration | BLOCKED | LAN firmware not flashed; current device proof and image installation need USB. |
| RAM-only conversation audio | SOURCE PASS | Existing WebSocket streaming pipeline has no audio-to-flash path; hardware test absent. |
| Change Wi-Fi without computer | PARTIAL | Portal exists, but board BOOT pin is NC and runtime user entry is unavailable/unverified. |
| Secure pairing/credential delivery without USB | BLOCKED | No device-root proof and no BE-to-device secure enrollment contract. |
| No secrets over unprotected LAN | FAIL for current deployment | Current origin is HTTP/WS; HTTPS/WSS and certificate validation are absent. |

## Required next design/deployment work

- Verify SD2 button wiring before mapping a long-press to portal entry; otherwise
  add a confirmed display/touch interaction or hardware reset gesture.
- Define enrollment around a per-device protected identity (factory-injected
  key/certificate, secure element, or equivalent), an owner-authenticated
  pairing/approval challenge, one-time credential delivery, replay protection,
  revocation, and audit. Do not use an unprotected AP as the authority to issue
  credentials. This likely requires BE contract and device manufacturing
  provisioning changes.
- Configure HTTPS/WSS using a certificate chain the firmware can validate and
  provision/rotate trust anchors safely. Until then, do not claim secure LAN
  credential transport.
- Build and flash the LAN variant with the supported ESP-IDF 6.0.2 toolchain,
  then test on independent power: provisioning, OTA bootstrap, BE authorization,
  microphone Opus, real Gemini usage, TTS playback, Wi-Fi loss/recovery, network
  change, and secure re-pairing.

No source change was made in this task because the missing enrollment root of
trust and unverified board input prevent a safe, reviewable implementation;
inventing a Wi-Fi credential endpoint or assigning an unverified GPIO would
create a device takeover or board safety risk.
