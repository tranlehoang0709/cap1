# D2-S2-20 — Wireless Provisioning & Secure OTA

Date: 2026-11-04

## Current result

This change hardens the existing SD2 LAN variant against credential disclosure and
unauthenticated transport. It does **not** complete secure enrollment or signed OTA.
Those flows remain blocked by missing firmware/Backend contracts and hardware key
provisioning. No SD1/SD2 GPIO mapping was changed.

## Firmware changes

- `main/secure_url.h`: small absolute-URL validator; rejects user-info and malformed
  authorities.
- `main/ota.cc`: the LAN build requires HTTPS for OTA bootstrap, WSS in the OTA
  response, and HTTPS for image download. LAN image activation is refused unless
  Secure Boot is enabled. This is intentional: TLS plus ESP image checksum does not
  authenticate who signed an image.
- `main/protocols/websocket_protocol.cc`: LAN device proof is not sent to `ws://`;
  only `wss://` is accepted.
- `main/main.cc`: lowers the managed `HttpClient` log level before networking; its
  debug request dump otherwise includes the device credential header.
- `main/application.cc`: no longer logs the complete OTA URL.
- `main/boards/custom/aiva-iot-s3-st7789/config.json`: enables the IDF certificate
  bundle for the explicit `aiva-iot-s3-st7789-lan` variant only.
- `scripts/tests/test_lan_variant.py`: source-level regression checks for those
  requirements.

The CA bundle verifies public CA certificates. It does not establish a private LAN
CA or make an IP-literal endpoint valid; use a DNS name covered by a trusted server
certificate and configure that HTTPS OTA URL. The requested plain HTTP URL
`http://192.168.0.104:8000/xiaozhi/ota/` is rejected by this secure LAN variant.

## SD1 / SD2 and security configuration

- SD1 profile: `custom/xiaozhi-s3-tft`, target ESP32-S3. It has no LAN variant in
  its profile; do not flash the SD2 LAN build to SD1.
- SD2 profile: `custom/aiva-iot-s3-st7789`; the LAN variant keeps the existing board
  identity and pin map.
- The checked-in generated `sdkconfig` currently selects SD1 and IDF 6.0.3. It is
  generated state and was not edited. The inspected config has certificate bundle
  and OTA rollback enabled, while Secure Boot, flash encryption, and NVS encryption
  are disabled. The partition table has OTA slots but no dedicated NVS key
  partition.
- `main/main.cc` initializes ordinary NVS and erases it on the documented
  no-free-pages/new-version errors. Enabling NVS/flash encryption or Secure Boot
  without device-specific key generation, eFuse policy, recovery, and data migration
  would risk making installed devices unbootable or losing credentials. No security
  fuses/configuration were enabled here.
- Source supports OTA rollback (`esp_ota_mark_app_valid_cancel_rollback`), but no
  signed manifest/image validation, model/version/hash/signature contract, trusted
  signing key, or rollback hardware test exists. LAN image OTA therefore fails
  closed.

## Provisioning and enrollment status

Existing firmware can start the Wi-Fi provisioning portal when no SSID is saved or
after its connection timeout; it saves SSID/password and a custom OTA URL in NVS.
This is not equivalent to a secure first-time device enrollment. Current LAN device
proof is UID plus operational credential; the first proof is provisioned via USB.
The existing Backend contract does not provide a cryptographic root identity,
short-lived enrollment challenge, authenticated credential delivery/ACK, or staged
rotation prepare/commit/ack. UID/MAC alone cannot safely replace these. Therefore
USB-free initial enrollment, re-enrollment, credential rotation, and safe encrypted
NVS persistence are **BLOCKED**. SD2's BOOT GPIO is unverified/NC in its profile, so
do not promise a physical-button route back into provisioning. No credential is
placed in an OTA URL or printed by the adjusted HttpClient logging path.

## Validation

| Check | Result |
| --- | --- |
| `python -m unittest scripts.tests.test_lan_variant -v` | PASS, 2 tests |
| `python -m unittest discover -s scripts/tests -v` | 74 run; 2 errors because `clang++` is missing; remaining tests passed |
| ESP-IDF build | BLOCKED: `idf.py` not installed/available in this environment; no SD1/SD2 build claimed |
| SD1/SD2 flash and physical provisioning | BLOCKED: no board test performed in this task |
| HTTPS/WSS certificate validation on device | Source/config verified only; live endpoint certificate test not performed |
| Signed OTA, rollback, credential enrollment/rotation | BLOCKED: required trust chain and Backend contracts are absent |

## Windows build and first-flash commands

Install/source ESP-IDF 6.0.2 as required by this repository and check `idf.py
--version` first. Run each build from `xiaozhi-esp32` in a separate clean worktree
or preserve the generated config because the canonical script updates build state.

```powershell
# List exact profile/variant names
python scripts/build.py --list-boards

# SD2 LAN bootstrap firmware, compile before flashing
python scripts/build.py custom/aiva-iot-s3-st7789 --name aiva-iot-s3-st7789-lan --language vi-VN --wake-word disabled

# Flash only after a successful build and confirming the actual COM port
idf.py -p COMx -b 115200 flash monitor
```

SD1 has no corresponding LAN variant; its board profile is
`custom/xiaozhi-s3-tft`. Do not use the SD2 board identity for it. First flash is
currently needed to install/provision the LAN firmware and device proof. After
boot, connect a phone to the device's `Xiaozhi-*` setup AP and use its portal to
enter Wi-Fi and the trusted HTTPS OTA URL. This configures Wi-Fi but does not mint
or deliver an operational credential. Without that credential and the missing
enrollment contract, authenticated AI_SERVER operation cannot be completed.

No changes were made outside `xiaozhi-esp32/`; no Git commit/push was run.
