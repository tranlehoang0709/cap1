# D2-S2-17 — Wireless pairing, provisioning and OTA

Status: **BLOCKED / not accepted** (2026-11-04). This is a source and contract
audit; no source or database schema was changed, no firmware was built/flashed,
and no SD1/SD2 hardware test was performed.

## Reused existing paths (no duplicate implementation)

- Firmware LAN bootstrap: `POST /xiaozhi/ota/` (AI_SERVER), then authenticated
  `ws://<configured-origin>/ws/robot`. OTA URL is entered in the existing
  XiaoZhi Wi-Fi hotspot portal and saved under NVS `wifi/ota_url`.
- AI_SERVER validates `Device-Uid` + `Device-Credential` by calling BE
  `POST /internal/devices/authorize`. It doesn't infer identity from MAC.
- BE device registration: `POST /devices/admin` (ADMIN).
- One-time pairing-code issue: `POST /devices/admin/:id/pairing-codes` (ADMIN).
- Owner pairing request: `POST /devices/pairing-requests` (USER in the devices
  module; separate newer pairing module also exposes
  `POST /user/devices/pairing-requests`).
- Admin review: `POST /devices/admin/pairing-requests/:id/approve` (or the newer
  `/admin/pairing-requests/:id/approve`).
- Credential issuance/rotation: `POST /devices/admin/:id/credential` (ADMIN),
  plaintext returned once to the authenticated admin. No API returns it to the
  device after approval. These routes are existing contracts, not newly added.
- Firmware registry: `POST /admin/firmware`, `POST /admin/firmware/:id/release`,
  `GET /firmware/device/check`, and `POST /firmware/device/updates/:id/status`.
  These are separate from `/xiaozhi/ota/`; the current bootstrap does not look
  up a release or supply an image URL.

## Security and implementation findings

- Enrollment has no device root identity: LAN firmware expects a previously
  issued UID/credential in NVS before it can call OTA bootstrap. Sending a
  pairing code through an open AP or polling with UID alone would let a nearby
  party claim a device. The existing owner approval flow can't securely bind
  that request to an unprovisioned physical ESP32.
- Credential delivery contract is missing. Existing issuance is admin-only and
  one-time to the admin response; nothing binds delivery to an approved request
  and device, supports authenticated poll/ack, or protects against replay.
  Rotation revokes the active credential immediately, with no atomic device
  handover path.
- The general partition table contains a normal `nvs` partition. The checked-in
  `sdkconfig.defaults*` do not enable NVS encryption or flash encryption.
  Therefore NVS Wi-Fi and device credentials cannot be claimed encrypted at
  rest. This must be verified against actual generated SD1/SD2 sdkconfig and
  provisioning/fuse state before enablement; turning encryption on requires a
  compatible key-provisioning/manufacturing plan and can make existing NVS
  unreadable.
- `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y` is present, and
  `MarkCurrentVersionValid()` calls `esp_ota_mark_app_valid_cancel_rollback()`.
  OTA writes to the inactive slot and `esp_ota_end()` checks ESP image format
  integrity. The current path uses HTTP GET and does not verify a trusted
  signature or an expected SHA-256 before selecting the new boot partition.
  The defaults do not enable Secure Boot. Structural image validation and
  rollback are not authenticated firmware provenance.
- Existing LAN deployment uses HTTP/WS; device proof is sent as headers. It is
  visible to a network observer. No TLS trust chain is installed/configured.
- Generic firmware enters the hotspot portal with no saved SSID or after a
  connection timeout. Runtime re-entry requires a board interaction. SD2
  `BOOT_BUTTON_GPIO` is `GPIO_NUM_NC` (unverified); SD1 is GPIO0 in its
  provisional profile. No pin mapping was changed. SD1 display GPIOs remain
  explicitly provisional.
- The LAN worker already performs fresh-session reconnect and doesn't replay
  the interrupted voice turn; this remains source evidence only. Audio uses the
  existing RAM streaming path; no audio flash path was introduced.

## Acceptance matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| AP `Xiaozhi-*` and Wi-Fi/OTA portal | PARTIAL | Existing firmware portal; no physical validation for these profiles. |
| Registration + owner request + approval | PARTIAL | Existing BE routes above; bootstrap can't initiate it securely from device. |
| Credential after approval via protected channel | BLOCKED | No device root identity or delivery/poll/ack contract. |
| NVS encryption | BLOCKED | Not enabled by checked-in defaults; generated device configs/fuses not verified. |
| Authenticated WS and heartbeat | SOURCE PASS | Existing AI_SERVER route and BE authorization; no physical LAN image test. |
| Reconnect with no session replay | SOURCE PASS | Existing reconnect creates fresh session; hardware interruption test absent. |
| Change Wi-Fi and rotate credential over Wi-Fi | BLOCKED | Portal is conditional; secure credential rotation path absent. |
| OTA release, authenticity, integrity, rollback | FAIL/PARTIAL | Slot integrity and rollback exist; no trusted signature/hash verification. |
| RAM-only audio | SOURCE PASS | Existing streaming implementation; no physical conversation test. |
| SD1 and SD2 GPIO/profile tests | BLOCKED | No firmware build/flash or board-specific physical tests. |
| Mic → live Gemini → speaker | BLOCKED | No live/physical test; D2-S2-15 live configuration blocker remains. |

## Minimal contract/design changes needed

1. Manufacturing provisions a unique device key/certificate (or an equivalent
   protected root) and immutable UID. Do not derive it from MAC or a shared
   fleet secret. Configure secure boot/flash encryption and NVS encryption
   before production credentials are stored.
2. Add BE enrollment endpoints that authenticate this device root over TLS,
   issue a short-lived one-time pairing code/display challenge, and expose
   status only to that device. User submits the code while authenticated;
   Admin approves using existing workflow. After approval, the device polls
   with its root proof, receives one credential once, acknowledges installation,
   and the server expires the delivery window. Add rate limits, replay
   protection, audit and revocation. Reuse current pairing tables only if
   transaction semantics and authorization are preserved; otherwise request
   explicit schema review before any migration.
3. Add authenticated credential rotation prepare/commit/ack so the old key is
   revoked only after the device confirms durable storage of the replacement.
4. Serve firmware over HTTPS, require TLS certificate validation, and verify a
   signed manifest/image (hardware model, version, size, SHA-256 and signature)
   against a provisioned trust anchor before boot selection. Keep rollback and
   mark-valid health checks; report update status to BE using the registered
   OTA update contract.
5. Verify SD2 control input electrically and expose a user-confirmed portal
   gesture; do not assign an unknown GPIO. Verify SD1 provisional TFT wiring
   separately.

Until these items exist, do not add a UID-only credential endpoint, send
credentials through the open provisioning AP, or mark pairing/OTA PASS. No
tests were run because this audit made no code changes. Windows build/test
commands remain those in `docs/d2-s2-14-lan.md`; they cannot demonstrate secure
pairing or OTA until the missing contracts and trust roots are implemented.
