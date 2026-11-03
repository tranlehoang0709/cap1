# AIVA private development voice extension

Status: implemented protocol/guard foundation with OFF-by-default TX EOF
experiment, **not hardware accepted**. See `../../AI_SERVER/docs/test-report-d2-s2-05-fix.md`. No
Backend or Cloud AI is contacted by the AI Server development gateway.

`CONFIG_AIVA_DEV_VOICE` defaults to n. With it disabled, MQTT/legacy WebSocket
selection and TTS state behavior remain on the existing branch. With it enabled,
activation/OTA bootstrap is skipped and WebSocket NVS `url`, `token`, `version`
are required. This flag does not provision Wi-Fi or NVS and contains no secret.
Use only a controlled private LAN, explicit AI Server allowlist and random local
development token. Do not expose the gateway publicly or use a Cloud API key.

## Negotiation and audio

Firmware advertises `features.aiva_half_duplex_v1=true` in hello. The development
server requires it, explicit matching `Protocol-Version` header/hello 1/2/3,
Opus 16000 Hz, one channel, 60 ms frames, and returns the same feature/profile.
Server session_id is fresh for each connection. Device-Id/Client-Id are metadata,
not Backend-authenticated identity. Both board types use the shared protocol
layer; do not replace board-specific source or pins to use this extension.

Binary framing remains raw Opus (v1), network-endian `HHIII` header (v2), or
network-endian `BBH` header (v3). Decode validation rejects malformed envelopes.
No turn IDs are added to binary packets. Sender must serialize one turn's audio
and may not send data before scoped readiness.

## Scoped control sequence

1. Server sends `type=tts,state=start` with session_id, turn_id and playback_id.
   IDs are opaque strings (turn/playback <=64 ASCII alphanumeric, underscore or
   hyphen); playback_id is generation, not a numeric notification playback ID.
2. Firmware creates a guard, enters SPEAKING, disables mic processing/wake barge-in
   and resets decoder. Once old software output is idle it sends `type=playback,
   state=ready` with the same IDs and `audio_chunks=0`.
3. Server sends ordered binary audio and then scoped `tts.stop` with the exact
   positive integer `audio_chunks` count. This only marks end of input.
4. Guard counts accepted packets and successful complete sample writes, with an
   internal per-generation serial to reject late output callbacks. Decode/write/
   count failures never generate completion.
5. `playback.complete` requires stop + exact packet/write counts + empty software
   queues/no in-flight work + **driver output-drained evidence**. Only then may
   firmware and server return to listening. No estimate or `tts.stop` ACK.
6. A scoped `tts.abort` cancels/reset software output; disconnect cancels guard.
   It is not an abort-complete/drain proof or permission to open a new turn.

`VoicePlaybackGuard` is host-tested. `AudioCodec::OutputDataChecked()` checks
sample count; **this is not DMA drain**. `AudioCodec::IsOutputDrained()` returns false by default. NoAudioCodec now has
an experimental override gated by CONFIG_AIVA_I2S_TX_DRAIN_PROOF (default n),
S3 and exact ESP-IDF 6.0.2. It registers on_sent, arms after a successful full
write, and requires two complete sets of the six actual DMA buffer addresses.
The first pass is auto-cleared by the SDK, the second witnesses subsequent TX.
New writes/disable invalidate it; repeated or wrong buffers cannot establish proof.
This source-based design and ISR/IRAM integration remain hardware/build BLOCKED. As a
result, current hardware cannot emit complete from the software-only callback;
it stays SPEAKING and AI Server deadline closes the failed session. This is a
known BLOCKED integration dependency, not successful robot playback.

Driver integration must correlate actual TX completion (for example verified
I2S sent/DMA events), reset/abort and the latest submitted output. Do not replace
this seam with unconditional true, elapsed audio duration, queue emptiness or
successful `i2s_channel_write()`. See official ESP-IDF
[v6.0.2 I2S API](https://github.com/espressif/esp-idf/blob/v6.0.2/components/esp_driver_i2s/include/driver/i2s_common.h).

## Verification and boards

```sh
python3 -m unittest discover -s scripts/tests -v
python3 scripts/build.py --list-boards
```

Host tests include C++ guard compilation; they do not build the Application,
ESP-IDF driver/ISR integration, MQTT/UDP runtime or hardware peripherals.
`idf.py` and vendor components are unavailable in the current environment.

Only one custom profile exists: `main/boards/custom/xiaozhi-s3-tft`. Its TFT pins
are still documented as provisional. The other metadata profile D1 240×240/
NS4168 has not been matched to an ESP-IDF board-directory. Nologo/Spotpear/etc.
1.54-inch profiles exist elsewhere, but their pins are not a physical match
merely because resolution is 240×240. Do not guess a second board or serial port.
Keep variants independent through their own config.json/Kconfig/CMake selection;
canonical build currently shares generated sdkconfig/build state, so use
sequential builds or separate checkouts. Do not flash before matching hardware.

Full Vietnamese report and macOS commands:
`../../AI_SERVER/docs/test-report-d2-s2-05.md`.
