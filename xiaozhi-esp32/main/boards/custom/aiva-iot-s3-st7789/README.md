# SD2: AIVA-IoT ESP32-S3 ST7789 240x240

The opt-in `aiva-iot-s3-st7789-lan` variant adds authenticated OTA bootstrap,
device proof, heartbeat and LAN control reconnection. See
[`D2-S2-14`](../../../../../AI_SERVER/docs/d2-s2-14-lan.md) for first-flash,
Wi-Fi provisioning and current integration/hardware blockers. It is not an
accepted standalone voice build.

The `aiva-iot-s3-st7789-funnel` variant uses the ESP-IDF full public CA bundle
for `desktop-m27leua.tail022082.ts.net`. TLS connects with the parsed hostname,
and compilation fails if certificate verification is disabled. Provision the
gateway with `ws wss://desktop-m27leua.tail022082.ts.net/ws/robot - 1`; this
also saves `https://desktop-m27leua.tail022082.ts.net/xiaozhi/ota/` for the OTA
bootstrap. The existing `wifi` USB command re-enters Wi-Fi provisioning without
erasing NVS.

Project naming: SD1 is `custom/xiaozhi-s3-tft`; SD2 is this board.
Each board has its own firmware identity and pin configuration.

## Hardware reference

Source: user-supplied `AIVA_IoT_ESP32S3_Hardware_Spec.md` (4 November 2026).
LCD, microphone, speaker and PSRAM passed the user's PlatformIO/Arduino tests.
Those results do not establish ESP-IDF firmware or AI Server acceptance.

| Peripheral | Configuration |
| --- | --- |
| Module | ESP32-S3-WROOM-1, 16 MB flash, 8 MB OPI PSRAM |
| LCD | ST7789 240x240; SCK 42, MOSI 41, RST 2, DC 1, BL 17; CS disconnected |
| LCD transport | SPI mode 3, 10 MHz, inverted colors |
| I2S microphone | WS 4, BCLK 5, data 6; 16 kHz, 32-bit RX, port 1 |
| NS4168 amplifier | Data 7, BCLK 15, LRCK 16; 24 kHz, 32-bit TX, port 0 |
| Console | Native USB Serial/JTAG, 115200 baud |

Microphone model, channel selection and supply are unverified. BOOT/P0 GPIO,
amplifier enable, battery and other optional GPIOs are unverified and are not
assigned. The disabled BOOT button has no click action. Do not infer GPIO0 from
the PCB button label. Gain/clamp values from the Arduino loopback are experimental
and are not copied into the shared ESP-IDF codec.

## First flash: build, write, boot

The first acceptance gate is a successful flash followed by identifiable Xiaozhi
boot logs, without a panic or repeated reset. AI Server and Backend connectivity,
wake word, audio quality and OTA are separate later acceptance gates.

Windows CMD, using the SDK installation found on this machine:

```bat
set "IDF_TOOLS_PATH=F:\ngonnguvisual\Espressif"
call "F:\ngonnguvisual\v6.0.2\esp-idf\export.bat"
cd /d F:\cap1-dev2\xiaozhi-esp32
idf.py --version
python scripts\build.py custom/aiva-iot-s3-st7789 --name aiva-iot-s3-st7789 --language vi-VN --wake-word disabled
idf.py -p COM3 -b 115200 flash monitor
```

Confirm the connected SD2 port before flashing; COM3 is this machine's observed
port, not part of the hardware identity. Exit the monitor with Ctrl+]. Do not
run `erase-flash` for this check. The build helper generates `sdkconfig` and
`build/`; do not copy SD1's generated configuration or edit these outputs manually.
The build must select `CONFIG_BOARD_TYPE_AIVA_IOT_S3_ST7789=y` and USB Serial/JTAG
console. Defaults supply 16 MB flash and OPI PSRAM. Wake word is disabled by the
command above; no AI token is required for this flash/boot gate.

For the LAN voice variant, select the Vietnamese display locale explicitly.
Wake-word recognition remains the English `hello` model configured by the
variant; the recognition language and display locale are independent:

```bat
python scripts\build.py custom/aiva-iot-s3-st7789 --name aiva-iot-s3-st7789-lan --language vi-VN
idf.py -p COM3 -b 115200 flash monitor
```

For the public Funnel hostname, build the dedicated trust variant:

```bat
python scripts\build.py custom/aiva-iot-s3-st7789 --name aiva-iot-s3-st7789-funnel --language vi-VN
```

## Verification

```bat
python -m unittest discover -s scripts/tests -p test_build.py -v
```

Check that the build identifies `aiva-iot-s3-st7789`, fits the application
partition, and that flashing reports successful verification. After reset,
capture the `Board` SKU log and application/network startup on USB Serial.
Observe for at least 30 seconds to check for panic/reset loops. A Wi-Fi setup
screen or access point is expected on an unprovisioned board and does not prove
AI connectivity. Record the actual build/flash/boot results before marking PASS.

On 4 November 2026, the build, five flash-region hash verifications and a
40-second USB boot observation passed on SD2/COM3. The firmware logged the
correct SKU and 8 MB PSRAM, initialized LCD and I2S, and reused existing Wi-Fi
settings. No panic or reset loop was observed. Visual display/audio acceptance
and connection to the project's AI Server were not tested. See
[`docs/sd2-flash-check-2026-11-04.md`](../../../../docs/sd2-flash-check-2026-11-04.md).


## Private Gemini voice diagnostic

The explicit `aiva-iot-s3-st7789-dev-voice` variant adds private WebSocket and
USB `ws`/`record`/`stop`/`status`/`reboot` commands without assigning BOOT GPIO.
Use the guide at `AI_SERVER/docs/sd2-gemini-lan.md` in the workspace root.
The API key stays on the server. Native TX/DMA proof remains experimental.
The real trial produced audible Gemini output but was interrupted by provider
rate_limited; full-turn/repeated-conversation acceptance is still pending.

### LAN and WIFI_INTERNET profiles

The `aiva-iot-s3-st7789-funnel` build keeps the historical LAN profile intact and
adds an explicit `WIFI_INTERNET` profile. A missing mode key always means `LAN`;
the firmware never migrates endpoints or falls back between modes.

- `mode lan` selects LAN NVS (`wifi/ota_url`, `websocket/*`).
- `mode wifi_internet` selects the independent Funnel profile (`aiva_iota/*`,
  `aiva_iws/*`) with the compiled HTTPS/WSS hostname.
- `wifi` enters the existing SoftAP Wi-Fi provisioning flow. It does not ask for
  an AI server address and does not change the selected connection profile.
- `status` reports the selected profile. Reboot after changing it.

Both profiles use the same provisioned per-device UID/credential and fail closed
when it is absent. Changing mode never erases either profile or Wi-Fi NVS.
The Funnel build combines ESP-IDF's full public CA bundle with the existing AIVA
LAN root, so hostname verification remains enabled for both profiles.
