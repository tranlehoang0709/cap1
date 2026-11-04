# SD2 OpenAI voice over LAN (local development)

SD2 is `custom/aiva-iot-s3-st7789`. The existing `aiva-iot-s3-st7789-dev-voice`
firmware uses `/ws/dev-robot`, Opus 16 kHz mono/60 ms, manual turn boundaries,
and the existing USB diagnostic console. AI_Server decodes microphone Opus to
PCM in RAM, transcribes each completed utterance, streams LLM text by sentence,
requests WAV speech for each completed sentence, converts it to paced Opus, and
waits for playback completion evidence from the device. Session conversation
history is held in RAM and scoped to one WebSocket session. Audio and transcripts
are not written to disk.

This path is development-only. It uses the configured private-network allowlist
and a server bearer token. Backend user/device authentication and persisted
quota/usage are not involved. The local 12-turns/60-second ceiling is keyed by
the bearer credential; it is not per-user quota. Do not treat this endpoint as
production authorization.

## Configure and run on Windows CMD

The AI_Server LAN address observed on this machine is `192.168.0.104`; confirm
with `ipconfig` before use. Configure `OPENAI_API_KEY` in the server process
environment only. Never put it in firmware, the WebSocket URL, or console logs.

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
set "OPENAI_API_KEY=PASTE_OPENAI_KEY_HERE"
set "AI_SERVER_BACKEND_MODE=development-mock"
set "AI_SERVER_ROBOT_ENABLED=true"
set "AI_SERVER_ROBOT_AI_MODE=openai"
set "AI_SERVER_LLM_PROVIDER=openai"
set "AI_SERVER_ROBOT_ALLOWED_NETWORKS=["127.0.0.0/8","192.168.0.0/24"]"
set "AI_SERVER_ROBOT_ENERGY_THRESHOLD=300"
set "AI_SERVER_ROBOT_TOKEN=SET_A_RANDOM_32_PLUS_CHARACTER_LOCAL_TOKEN"
set "AI_SERVER_HOST=0.0.0.0"
set "AI_SERVER_PORT=8000"
set "AI_SERVER_RELOAD=false"
run_server.cmd
```

The configured OpenAI model remains `OPENAI_MODEL` (current local configuration:
`gpt-6-luna`). `OPENAI_STT_MODEL` defaults to `gpt-transcribe`,
`OPENAI_TTS_MODEL` to `gpt-4o-mini-tts`, and `OPENAI_TTS_VOICE` to `coral`.
`OPENAI_AUDIO_TIMEOUT_SECONDS` defaults to 30. Existing LLM limits remain
`AI_SERVER_LLM_MAX_OUTPUT_TOKENS=256`, output text 500 characters, and at most
5 concurrent LLM requests. The server does not retry provider requests or
fallback to another provider. OpenAI documents `gpt-transcribe` for bounded
recordings and WAV/PCM TTS output; its built-in speech voices are optimized for
English, so Vietnamese pronunciation needs listening tests.

Check the server and Windows firewall before connecting the board:

```bat
curl http://127.0.0.1:8000/health
curl http://192.168.0.104:8000/health
netsh advfirewall firewall add rule name="AIVA AI_SERVER 8000" dir=in action=allow protocol=TCP localport=8000 profile=private
```

## SD2 firmware

No firmware source or GPIO mapping changes are needed for this voice path. The
dev-voice variant already supports the required private WebSocket, Opus framing,
manual record/stop, and output completion protocol. If that variant is already
flashed and Wi-Fi is saved, only configure its server URL and gateway token:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv\Scripts\python.exe scripts\sd2_console.py configure --port COM3 --url ws://192.168.0.104:8000/ws/dev-robot
.venv\Scripts\python.exe scripts\sd2_console.py status --port COM3
.venv\Scripts\python.exe scripts\sd2_console.py record --port COM3 --seconds 5
```

The console reads the local gateway token from `.env`, sends it to firmware
over USB, and firmware stores it in NVS. The OpenAI key never leaves AI_Server.
Close any serial monitor first. If SD2 has only the base variant, build and
flash the existing dev-voice variant from an exported, compatible ESP-IDF shell:

```bat
cd /d E:\learn\AI_Project\cap1\xiaozhi-esp32
python scripts\build.py custom/aiva-iot-s3-st7789 --name aiva-iot-s3-st7789-dev-voice --language vi-VN --wake-word disabled
idf.py -p COM3 -b 115200 flash monitor
```

The first build/flash uses USB; later operation uses Wi-Fi. Use `ipconfig` to
update the address if the server's LAN IP changes. Do not run `erase-flash`.

## Current verification boundary

Fixture tests validate WAV/PCM contracts, secret redaction, adapter cleanup,
OpenAI selection, rate-window behavior, and WebSocket hello/session setup.
They do not send requests to OpenAI. The current local `.env` has no OpenAI key,
local robot bearer token, or energy threshold; a live OpenAI/SD2 turn therefore
cannot currently pass. Real microphone capture, provider STT/LLM/TTS, audible
speaker output, and network-loss recovery require a configured key/token and a
physical SD2 run.
