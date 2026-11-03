# SD2 first flash and boot check — 4 November 2026

## Scope and result

**PASS: build, write firmware, verify flash and boot SD2.** This gate follows the
user's request to establish that firmware can be flashed before implementing
other features. It does not establish full product or AI Server acceptance.

SD1 is `custom/xiaozhi-s3-tft`; SD2 is `custom/aiva-iot-s3-st7789`.
The connected SD2 was identified as ESP32-S3 revision v0.2, native USB
Serial/JTAG on COM3, with 16 MB flash and 8 MB PSRAM. COM3 is host-specific.

The existing SD2 board addition was completed with USB console selection,
sorted Kconfig placement, a build-selection regression test and board
documentation. The new board source was formatted using the repository settings,
then rebuilt for the final flash. SD1 pins, shared audio logic and AI_SERVER
code were unchanged.

## Build and flash evidence

SDK: ESP-IDF v6.0.2, Python 3.14.7 from the installed SDK environment.

```text
python scripts/build.py custom/aiva-iot-s3-st7789 --name aiva-iot-s3-st7789 --language vi-VN --wake-word disabled
```

Effective configuration includes SD2 board selection, USB Serial/JTAG console,
16 MB flash, OPI PSRAM, and disabled wake word. `CONFIG_AIVA_DEV_VOICE` is off.
The build helper generated the configuration and artifacts; generated/vendor
files were not hand-edited.

Application `build/xiaozhi.bin`: 2,797,856 bytes (`0x2ab120`); the smallest
application partition is `0x3f0000`, leaving 32% free.

Application SHA-256:
`d11d6ed12d568d030916736470071bbedc0543052b676636d1c77155959ed323`.

Merged image `build/merged-binary.bin`: 9,761,752 bytes, offset 0x0.
Its SHA-256 is
`542e433da6675c3b3330b0d4c80d1dfeb1a830734f9ada68d57c702bb6fddfec`.

Before writing, the previous 16 MB flash contents were backed up locally to
`.cache/sd2-before-flash-20261104.bin`. The backup is ignored by Git and may
contain device settings; do not commit or publish it.

The following command ran from `build/`, using the installed SDK Python:

```text
python -m esptool --chip esp32s3 --port COM3 --baud 115200 --before default-reset --after hard-reset write-flash @flash_args
```

| Offset | Generated image | Result |
| --- | --- | --- |
| 0x0 | bootloader/bootloader.bin | Hash verified |
| 0x8000 | partition_table/partition-table.bin | Hash verified |
| 0xd000 | ota_data_initial.bin | Hash verified |
| 0x20000 | xiaozhi.bin | Hash verified |
| 0x800000 | generated_assets.bin | Hash verified |

The flash command exited 0 and reset the device. No whole-chip erase was run.
The local flash output is `.cache/sd2-flash-recovery-20261104.log`.

A reflash after source formatting initially lost its USB connection while writing
the application. The next attempt hit Windows port error 22. After the user
reconnected USB, the final image was successfully reflashed at nominal baud
115200 and all five regions were verified again. The boot evidence below is
from that final recovered flash, not the earlier image.

## Boot evidence

A separate reset through esptool's USB reset strategy was followed by 40.0
seconds of USB serial capture at 115200 baud. The capture contained 8,190 bytes,
one `ESP-ROM:` boot marker, and no panic/backtrace/assertion or repeated boot.
Selected lines, with device identifiers omitted:

```text
esp_psram: Found 8MB PSRAM device
esp_psram: Speed: 80MHz
app_init: Project name:     xiaozhi
app_init: App version:      2.4.2
app_init: ESP-IDF:          v6.0.2
Board: [device UUID omitted] SKU=aiva-iot-s3-st7789
LcdDisplay: Turning display on
LcdDisplay: Initialize LVGL library
LcdDisplay: Adding LCD display
NoAudioCodec: Simplex channels created
Application: Network connected
Application: Activation done
```

The board reused existing Wi-Fi settings. These logs establish that the
application executes; they do not prove a connection to this workspace's
AI_SERVER. No Wi-Fi credentials were newly provisioned. Raw boot evidence is
local at `.cache/sd2-boot-20261104.log`; it is not committed because it includes
device and network metadata.

## Tests and limits

- `python -m unittest discover -s scripts/tests -p test_build.py -v`: 67 PASS.
  Includes replacing a prior SD1 build selection with SD2 while retaining the
  USB console, and Kconfig/CMake consistency. The initially observed menu-order
  failure was corrected by moving the new AIVA entry into sorted position.
- `python -m unittest scripts.tests.test_build_default_assets -v`: 2 PASS.
- ESP-IDF build and packaging: PASS; five flash-region hash checks: PASS.
- Physical SD2 flash and 40-second boot observation: PASS for this gate.
- The two other C++ host tests, TX drain fence and voice playback guard, remain
  unexecuted successfully: no working Windows host compiler/CRT is installed.
  The available Espressif clang targets embedded chips by default; an attempted
  Windows target could not find an installed Visual Studio C++ toolchain. These
  are environment errors, not passing tests. Their source and the experimental
  TX-drain feature were unchanged and that feature remains disabled.

No visual LCD, audible playback, microphone capture, loopback, wake word,
AI_SERVER conversation, reconnect, power-cycle or OTA acceptance is claimed.
BOOT/P0 GPIO, microphone model/channel and amplifier enable remain unverified;
they are not prerequisites for this USB flash/boot gate. Future work must retain
the tested pin mapping and resolve unknown pins only when needed.
