# D2-S2-08 - Real Speech-to-Text

## Provider/model verification

- Official Google model docs identify `gemini-3.5-flash-lite` as accepting audio input. Official Gemini audio docs list Opus and WAV MIME types and describe transcription as a supported audio task.
- Official pricing lists Flash-Lite audio input in the Free Tier at no charge. The dedicated `gemini-3.5-transcribe` model also lists Vietnamese (`vi-VN`) support and Free Tier pricing, but this implementation uses Flash-Lite inline audio to keep one bounded request path in `google-genai`.
- A live request with the configured account key succeeded on `gemini-3.5-flash-lite`; account access is therefore verified for the tested input.

References: [Flash-Lite model capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [Gemini audio input, transcription and formats](https://ai.google.dev/gemini-api/docs/audio), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini Transcribe languages](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe).

## Implementation

- Added `GeminiSTTAdapter` for the current `STTAdapter` interface. It reads bounded `AudioInput`, produces one final `TranscriptionResult`, observes `AudioContext` timeout/cancel, closes decoder/client resources and maps provider 429/503 to typed errors. Provider retry attempts are one; no billable retry occurs.
- Raw Opus packets are decoded to PCM16 with `OpusCodec`, normalized to mono 16 kHz and wrapped as WAV. Complete Ogg Opus files remain Ogg/Opus. WAV input is validated and normalized. Raw packets are never mislabeled as an Ogg container.
- Input defaults are capped at 5,000,000 bytes and 120 seconds; timeout defaults to 30 seconds. All can be configured by environment.
- Added a file demo that routes an actual audio file through `STTAdapter` and `transcribe()`. No fixed transcript or MockSTT is involved.
- No changes were made to LLM adapter, WebSocket, half-duplex or hardware behavior. The adapter is not wired into `/ws/dev-robot`: unary file transcription only returns a final result after consuming audio, while the current turn detector waits for transcript input before finishing the turn. Resolving that contract needs a separate half-duplex/live-stream design decision.

## Live test

Input: existing Vietnamese firmware voice asset `xiaozhi-esp32/main/assets/locales/vi-VN/welcome.ogg` (Ogg Opus, 2,929 bytes, parsed duration 1.59 s).

- Status: **PASS: LIVE GEMINI STT**
- Model: `gemini-3.5-flash-lite`
- Latency: 2,332 ms
- Transcript: `Xin ch?o b?n c?a t?i.`
- Result language: `vi`

This was a real audio request and real Gemini transcript, not a fixture. It proves the tested account/model/input path, not robot hardware integration or general Vietnamese accuracy.

## Tests and environment

- `tests/test_gemini_stt.py`: 12 passed, covering valid Ogg audio, empty input, invalid format/container, raw Opus to WAV conversion, missing libopus, size/duration caps, cancellation, disconnect, 429 and 503.
- Combined STT + Audio Input foundation regression: 84 passed. Full AI_SERVER suite: 404 passed, 18 failed (firmware snapshot hash mismatch and robot/Opus tests failing with absent libopus or legacy WebSocket fixtures).
- Windows `ctypes.util.find_library("opus")` currently returns `None`; raw Opus packet decode is BLOCKED locally without `opus.dll`. The live Ogg container demo needs no decoder.
- A Python wrapper such as `opuslib` alone does not install the native DLL. Install `opus:x64-windows` with vcpkg and prepend `%VCPKG_ROOT%\installed\x64-windows\bin` to `PATH` for this Python process; see vcpkg package and Microsoft DLL layout docs.

Free Tier terms currently mark request content as potentially used to improve Google products. Do not use this tier for sensitive recordings without reviewing Google's terms.
