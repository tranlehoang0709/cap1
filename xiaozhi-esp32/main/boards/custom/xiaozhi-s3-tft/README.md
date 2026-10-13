# XiaoZhi ESP32-S3 N16R8 + 2.4-inch TFT (provisional)

This is a separate board identity for the user-provided schematic. It uses the
schematic's stated ESP32-S3 N16R8, INMP441, MAX98357A, 4 ohm/2 W speaker, and
240x320 ST7789 TFT.

## Pin mapping

The audio pin mapping below is transcribed from the schematic but has not been
verified on physical hardware:

| Module | Signal | ESP32-S3 GPIO |
| --- | --- | --- |
| INMP441 | WS / SCK / SD | 4 / 5 / 6 |
| MAX98357A | DIN / BCLK / LRC | 7 / 15 / 16 |

The TFT GPIO labels cannot be read clearly in the supplied image. `config.h`
currently has temporary display pin guesses copied from the unrelated Bread
Compact Wi-Fi + LCD board. Confirm these six connections (SCK, MOSI, CS, DC,
RESET, LED/BL) and the panel orientation/color inversion before flashing. Also
confirm power rails, INMP441 L/R channel selection, and MAX98357A SD/EN and GAIN.
Do not treat this provisional mapping as hardware validated.

## Build

From the repository root, with ESP-IDF 6.0.2 configured:

```powershell
python scripts/build.py custom/xiaozhi-s3-tft
```

The build variant selects ST7789 240x320 and targets ESP32-S3. This board uses
the framework's `NoAudioCodecSimplex` I2S path; no external audio codec driver
is needed for INMP441/MAX98357A.
