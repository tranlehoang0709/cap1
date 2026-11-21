# Bản đồ luồng AI_SERVER

## D2-S2-15 integrated Gemini (2026-11-04)

| Từ | Qua | Ghi chú |
|---|---|---|
| BE Web Chat | `/internal/web-chat` | Service token |
| resolve-config | SecretStr | Nội bộ, no-store |
| quota admission | credentialId | Ràng buộc key |
| Gemini countTokens | Token budget | Trước generation |
| Gemini metadata | BE usage | Actuals, no retry |
| Settled success | turns/complete | Privacy + dedupe |
| `/ws/robot` | real Gemini media | Auth trước audio |

The hardcoded media blocker is removed for integrated Web Chat and `/ws/robot`.
Readiness is now checked through BE auth/config/admission. The seven quota
columns were verified necessary, tested in an isolated DB, then added to the
empty working ledger under the user's conditional schema authorization.
The working DB still lacks ready Gemini user/model/credential configuration;
contract flags remain disabled. No LIVE Gemini or working-DB persistence PASS
is claimed. See `../BE/docs/d2-s2-15-live-gemini.md`. Do not run the existing
manual schema migration blindly or against a nonempty ledger. No Git commit.

## D2-S2-14 LAN control (2026-11-04)

| Từ | Qua | Ghi chú |
|---|---|---|
| `POST /xiaozhi/ota/` | BE authorize | Proof bắt buộc |
| `LanSettings` | OTA websocket URL | Origin từ env |
| `/ws/robot` | BE authorize | Integrated only |
| LAN hello | session mới | Không dùng MAC |
| direct heartbeat | BE heartbeat | Không Ping/Pong |
| listen.start | resolve config | Media vẫn chặn |
| `run_lan.cmd` | `.env` port | Bind 0.0.0.0 |

See `docs/d2-s2-14-lan.md`. LAN bootstrap/control is implemented; integrated
Gemini audio remains BLOCKED by credential delivery and live quota execution.
The prior development endpoint is unchanged. Hardware/independent-power/Wi-Fi
recovery are not accepted without a real SD2 test. User forbids Git operations
for D2-S2-14; do not commit this task automatically.

## D2-S2-19 secure LAN gateway (2026-11-04)

| From | Through | Note |
|---|---|---|
| `run_lan.py` | TLS cert/key validation | HTTPS origin required |
| `run_dev.py` | Uvicorn SSL settings | TLS 1.2 server context |
| `POST /xiaozhi/ota/` | HTTPS-only guard | HTTP receives 426 |
| `/ws/robot` | WSS-only guard | Plain WS closed before auth |
| `/ws/robot` | BE authorize/config/quota | Audio fail-closed before admission |

See `docs/d2-s2-19-secure-wifi-gateway.md`. The source is TLS-capable, but no
TLS certificate/trust anchor is configured. An existing port-8000 listener
still has old plaintext behavior and Windows denied process stop/inspection;
do not report the deployed gateway as secure. D2-S2-18 enrollment endpoints
remain unimplemented in BE; AI_SERVER must not invent them.

Tài liệu này ghi luồng chạy hiện có trong mã nguồn. Cột **Ghi chú** tối đa 20 ký tự.

## Luồng chạy

| Từ | Qua | Ghi chú |
|---|---|---|
| `scripts/run_dev.py` | `app.main:app` | Chạy Uvicorn |
| `app.main:create_app()` | `app.core.config` | Nạp cấu hình |
| `app.main:create_app()` | `app.api.health` | Gắn router health |
| `app.main:create_app()` | `app.api.device_profiles` | Gắn router hồ sơ |
| `app.main:create_app()` | `app.api.websocket` | Gắn router WS |
| `app.main:lifespan()` | `app.core.logging` | Log vòng đời |
| `GET /health` | `app.api.health:health()` | Trả trạng thái |
| `GET /device-profiles` | `app.api.device_profiles:list_profiles()` | Liệt kê board |
| `GET /device-profiles/{id}` | `app.api.device_profiles:read_profile()` | Đọc hồ sơ board |
| `api.device_profiles` | `app.devices.catalog` | Tra catalog |
| `app.devices.catalog` | `DeviceProfile.display` | Profile màn hình |
| `app.devices.catalog` | `DeviceProfile.microphone` | Profile mic I2S |
| `app.devices.catalog` | `DeviceProfile.speaker` | Profile loa I2S |
| `app.devices.catalog` | `DeviceProfile.audio_loopback` | Profile loopback |
| `app.devices.catalog` | `DeviceProfile.memory` | Profile bộ nhớ |
| `app.devices.catalog` | `DeviceProfile.usb_serial` | Profile USB serial |
| `app.devices.catalog` | `DeviceProfile.buttons` | Profile nút bấm |
| `app.devices.catalog` | `esp32-s3-n16r8-tft-240x320` | Sơ đồ SD2 |
| `WS /ws/dev-echo` | `app.api.websocket:websocket_endpoint()` | Echo text local |
| `websocket_endpoint()` | `app.core.logging` | Log kết nối |
| `websocket_endpoint()` | `app.core.config.Settings` | Byte tối đa |
| `scripts/ws_client.py` | `WS /ws/dev-echo` | Thử echo local |

## Chưa thuộc luồng chạy

Các bảng foundation bên dưới ghi bối cảnh trước Task 05. Hiện `/ws/dev-robot`
(OFF mặc định, private development) gọi pipeline foundation với mock AI và native
Opus. Backend/OpenAI clients không được route này gọi. Xem bảng cập nhật cuối file.

### Foundation độc lập Sprint 2 Task 02

Các cạnh sau chỉ được gọi trực tiếp/test, chưa gắn vào endpoint:

| Từ | Qua | Ghi chú |
|---|---|---|
| `validate_audio_frame()` | `FramingConfig` | Chọn v1/v2/v3 |
| `validate_audio_frame()` | `AudioFrame` | Kiểm tra envelope |
| `BoundedAudioInput.feed()` | `AudioMetadata` | Ràng buộc format |
| `BoundedAudioInput.read()` | `AudioContext.run()` | Deadline/cancel |
| `AudioContext.cancel()` | `BoundedAudioInput._discard()` | Xóa buffer |
| `transcribe()` | `stream_transcription()` | Lấy final |
| `stream_transcription()` | `STTAdapter.transcribe()` | Adapter độc lập |
| `stream_transcription()` | `AudioInput.aclose()` | Dọn input |

Không coi validator framing là robot schema/codec decoder; không chọn version,
provider hoặc metadata mặc định cho robot thật. Mock STT chỉ có trong test.

### Foundation độc lập Sprint 2 Task 02B

Các cạnh này chỉ chạy qua caller/test, không gắn vào endpoint:

| Từ | Qua | Ghi chú |
|---|---|---|
| `TurnDetector.speech()` | `TurnDetector._decision()` | VAD event giả |
| `TurnDetector.transcription()` | `TextRules.classify()` | Luật thử nghiệm |
| `HalfDuplexTurn.microphone()` | `TurnPhase` | Chặn mic sớm |
| `HalfDuplexTurn.microphone()` | `BoundedAudioInput.feed()` | Chỉ LISTENING |
| `HalfDuplexTurn._apply()` | `BoundedAudioInput.finish()` | END một lần |
| `HalfDuplexTurn._apply()` | `TurnEnded` | Sink inject |
| `HalfDuplexTurn._apply()` | `TurnTimedOut` | Không END |
| `HalfDuplexTurn.cancel()` | `AudioContext.cancel()` | Dọn turn |

Ngưỡng được người dùng duyệt thử nghiệm là 700/300/15000 ms (silence/stability/
max duration); bắt buộc cấu hình, không mặc định cho runtime/robot. Timeout hủy
turn với UNCERTAIN, không tự END đang speech. Luật ngôn ngữ chưa được duyệt
production; VAD chỉ là callback mock cho đến khi có decoder/VAD thật.

### Foundation độc lập Sprint 2 Task 03

Chỉ caller/test/demo gọi, chưa gắn endpoint hoặc startup:

| Từ | Qua | Ghi chú |
|---|---|---|
| `LLMRunner.stream()` | `Conversation.claim()` | Cô lập context |
| `LLMRunner.stream()` | `asyncio.Semaphore` | Giới hạn request |
| `LLMRunner.stream()` | `LLMAdapter.stream()` | Provider độc lập |
| `OpenAILLMAdapter.stream()` | `AsyncOpenAI.responses.create()` | SDK chính thức |
| `LLMRunner.stream()` | `SentenceOutput` | Giữ ranh giới câu |
| `LLMRunner.stream()` | `Conversation.commit()` | Chỉ complete |
| `HalfDuplexTurn.aclose()` | `AudioContext.cancel()` | Hủy LLM cùng turn |
| `scripts/llm_mock_demo.py` | `MockLLMAdapter` | Offline demo |

Cấu hình ban đầu đã duyệt: gpt-6-luna, reasoning none, 256 output tokens,
500 output code points, 5 request đồng thời, tiếng Việt và streaming. Giữ
configurable; không tự đọc key hoặc bật live API. Secret delivery còn BLOCKED.
Không viết lại AudioInput/STT/Turn Detection, không tích hợp TTS/robot endpoint.

### Foundation độc lập Sprint 2 Task 04

Chỉ caller/test/demo gọi, không thêm endpoint hoặc gắn vào startup:

| Từ | Qua | Ghi chú |
|---|---|---|
| `PlaybackScheduler.play()` | `TTSAdapter.synthesize()` | Từng đoạn theo câu |
| `PlaybackScheduler._produce()` | `AudioQueue.put()` | Bounded/backpressure |
| `PlaybackScheduler._consume()` | `HalfDuplexTurn.speaking()` | Chặn mic |
| `PlaybackScheduler._consume()` | `AudioOutput.write()` | Phát đúng thứ tự |
| `AudioOutput.finish()` | `wait_playback_complete()` | Không suy ACK |
| `PlaybackScheduler.play()` | `PlaybackReceipt` | Cần proof riêng |
| `PlaybackScheduler.play()` | `HalfDuplexTurn.aclose()` | Đóng turn cũ |
| `scripts/tts_mock_demo.py` | `MockTTS/MockAudioOutput` | Fixture offline |

Người dùng chưa duyệt provider/model/voice/codec/sample rate/queue limits TTS;
chỉ làm interface + mock, mọi giới hạn do caller cấp. Không có robot conversion
hoặc ACK thật. Chỉ proof mock-only được chấp nhận trong foundation này.
LLM stream đang chạy được tiếp tục ở SPEAKING cho cùng turn; claim turn mới vẫn
chặn. Sau lỗi/cancel không tự trở lại LISTENING hoặc suy playback xong.

### Orchestrator và Backend client độc lập

Các module sau chỉ caller/test gọi; không tự gắn vào endpoint:

| Từ | Qua | Ghi chú |
|---|---|---|
| `AIOrchestrator.start_turn()` | `BoundedAudioInput` | Input mỗi turn |
| `AIOrchestrator._run()` | `stream_transcription()` | STT độc lập |
| `AIOrchestrator._run()` | `LLMRunner.stream()` | END rồi final |
| `AIOrchestrator._run()` | `PlaybackScheduler.play()` | Chờ proof riêng |
| `authorize_device()` | `BackendClient.authorize()` | Backend quyết định |
| `AuthorizedSession.resolve()` | `BackendClient.resolve_config()` | Scope Backend |
| `AuthorizedSession.heartbeat_received()` | `BackendClient.heartbeat()` | Không Ping/Pong |
| `AuthorizedSession.invalidate()` | `AIOrchestrator.control()` | Hủy pipeline |
| `QuotaLLMAdapter.stream()` | `BackendClient.admit()` | Chỉ mock execution |
| `UsageReporter.submit()` | `BackendClient.report_usage()` | Dedupe trong RAM |

Không suy ra approval từ code/client hoặc mock test. Device/config/quota gates,
MAC mapping, provisioning, Cloud secret delivery và robot ACK chưa được duyệt.
Không thêm robot endpoint hoặc reset ACK giả. Task 06 chưa có source/report riêng
được xác minh trong docs hiện tại; không tự đánh dấu đã hoàn thành.

## Quy tắc cập nhật

Khi thêm, sửa hoặc xóa chức năng làm đổi luồng chạy, hãy cập nhật bảng này trong cùng thay đổi mã nguồn: thêm/bỏ các cạnh liên quan, kiểm tra đường dẫn và tên hàm, giữ mỗi ghi chú không quá 20 ký tự. Cập nhật cả khi đổi endpoint, cấu hình hoặc điểm khởi chạy. Bảng này được duy trì cùng các thay đổi do tác nhân lập trình thực hiện; nó không tự quét thay đổi ngoài quy trình đó.

## Quy tắc sơ đồ Dev 1 / Sprint 1

- Cập nhật từng mục theo thứ tự người dùng yêu cầu; profile SD2 được thêm riêng.
- Chỉ thêm dữ liệu hoặc chức năng cho mục mới; không xóa, ghi đè hay thay thế chức năng đã chạy.
- Nhiều sơ đồ phải cùng tồn tại trong một AI Server. Mỗi board dùng `profile_id` riêng; thành phần mới được thêm vào profile liên quan, không biến thành cấu hình chung áp lên mọi board.
- Giữ nguyên trạng thái và thông số trong sơ đồ đầu vào. Phân biệt rõ `reported_pass`, `pending` và `not_tested`; không tự tuyên bố đã kiểm thử phần cứng.
- Thêm hoặc sửa test cho mục mới, giữ test cũ chạy; cập nhật README và bảng luồng này nếu thay đổi API hoặc luồng thực thi.
- Nếu thiếu thông số cần thiết hoặc sơ đồ mâu thuẫn, đánh dấu pending và hỏi người dùng trước khi suy đoán hành vi phần cứng.


## Task 05 — Gateway development hiện hành

| Từ | Qua | Ghi chú |
|---|---|---|
| `/ws/dev-robot` | `RobotSettings` | OFF, private token |
| `robot_endpoint` | `validate_audio_frame` | Version 1/2/3 |
| `robot_endpoint` | `OpusCodec.decode` | PCM16 trước VAD |
| `robot_endpoint` | `AIOrchestrator` | Riêng mỗi session |
| `AIOrchestrator` | `MockStreamingSTT` | Không ASR thật |
| `LLMRunner` | `MockLLMAdapter` | Không Cloud |
| `PlaybackScheduler` | `OpusTTSAdapter` | Mock tone → Opus |
| `RobotAudioOutput` | `playback` evidence | Scope/count chặt |

Không dùng Backend ở task dual-board hiện tại. Chỉ có một profile trong
`boards/custom/`; mapping hai board, ESP-IDF build và driver DMA completion còn
BLOCKED. `IsOutputDrained()` fail closed mặc định false, không giả ACK bằng
software drain. Xem `docs/test-report-d2-s2-05.md` trước khi tuyên bố hardware PASS.


## D2-S2-05-FIX — Readiness

| Từ | Qua | Ghi chú |
|---|---|---|
| `RobotAudioOutput.write` | `transport lock` | Recheck cancel |
| `OpusTTSAdapter` | `encoder.close` | Cleanup lỗi vẫn đóng |
| `test_protocol` | Snapshot FIX | Source audit only |
| `restore_firmware_dependency` | Archive checksum | Không sửa vendor |

Baseline hiện hành `docs/firmware-snapshot-d2-s2-05-fix.json` giữ parent checksum
của snapshot cũ, không tự cập nhật khi drift. ML307 restore đúng archive 3.6.6;
manifest lịch sử có nguồn UNKNOWN, không ép hash bằng sửa vendor. Firmware có
NoAudioCodec EOF experiment OFF mặc định; base/driver khác vẫn fail closed.
Hardware, board mapping và Cloud vẫn BLOCKED. Xem báo cáo FIX, không suy hardware
PASS từ unit tests hoặc source hashes.
# Cập nhật tích hợp Backend — 03/11/2026

| Từ | Qua | Ghi chú |
|---|---|---|
| `create_app()` | `BackendSettings` | Chọn mode rõ ràng |
| `robot_endpoint()` | `backend_settings.mode` | Chặn integrated |
| `BackendSettings.create_client()` | `BackendClient` | Factory chưa nối |
| `QuotaLLMAdapter.stream()` | `UserRateLimit.claim()` | 12/user/60 giây |
| `isolated_settings` | `BackendSettings` | Bỏ env file test |

Internal auth controller có source nhưng không được DevicesModule đăng ký;
AiProvidersModule/QuotasModule rỗng. Integrated chặn trước accept/audio, chưa
gọi Backend. Factory không tự chạy khi startup. Quota bridge vẫn mock-only;
limiter chia sẻ qua reporter, không thay admission global. Xem
`docs/backend-integration-report.md` về các blocker và kết quả test thực tế.


## Runtime integration audit update (2026-11-03)

The historical integration notes above are superseded by `docs/runtime-integration-audit.md`. `AI_SERVER_BACKEND_MODE` defaults to `integrated`; use of mocks requires explicit `development-mock`. Integrated `/ws/dev-robot` calls Backend device authorization and resolve-config before accepting audio, then fails closed before audio because real STT/TTS, approved secret delivery, quota-ready persistence, and firmware proof headers are unavailable. Do not report fixture success as live service or hardware success.

## D2-S2-06 — OpenAI live probe update

`OpenAILLMAdapter.stream()` remains the Task 03 Responses streaming foundation. `scripts/test_openai_connection.py` is an isolated one-request live probe that reads `OPENAI_API_KEY`/`OPENAI_MODEL` from environment or `.env`; it uses the OpenAI SDK with zero retries and the existing LLM output-token setting. It does not connect this adapter to WebSocket runtime and does not alter quota/rate limits. Live probe is BLOCKED until a real key is configured. Details: `docs/test-report-d2-s2-06.md`.

## D2-S2-06G — Gemini API

`GeminiLLMAdapter` dùng SDK chính thức `google-genai` và cùng provider-neutral LLM contract với OpenAI; không sửa `OpenAILLMAdapter` và không fallback giữa provider. `scripts/test_gemini_connection.py` chỉ thực hiện một request thật, dùng model từ `GEMINI_MODEL`, giới hạn token LLM hiện có, timeout và retry attempts=1. Gemini free-tier model example: `gemini-3.8-flash`. Live run ngày 03/11/2026 nhận HTTP 503; không có response/usage live để xác nhận quyền truy cập. Backend integrated fail-closed và quota không thay đổi. Xem `docs/test-report-d2-s2-06g.md`.


## D2-S2-07 ? Gemini provider adapter diagnostic

| From | Via | Note |
|---|---|---|
| `AI_SERVER_LLM_PROVIDER` | `provider_factory` | Selects one provider |
| `provider_factory` | `GeminiLLMAdapter` | No fallback |
| `GeminiLLMAdapter` | `LLMRunner` | Streaming/context/usage |
| `scripts/gemini_adapter_demo.py` | `LLMRunner` | Explicit dev-only live probe |
| `QuotaLLMAdapter` | `MockLLMAdapter` | Still mock-only |

Gemini is callable through standalone diagnostics, not robot integrated
runtime. Integrated execution stays fail-closed while Backend admission,
secret delivery, durable usage/idempotency, real STT/TTS and firmware playback
proof remain unavailable. Local 12/minute limiter is not Backend policy.


## D2-S2-08 - Gemini STT Adapter

| From | Via | Note |
|---|---|---|
| `AudioInput` | `GeminiSTTAdapter` | Bounded stream |
| Raw Opus packet | `OpusCodec.decode` | PCM16 decode |
| PCM16 | WAV encoder | Mono 16 kHz |
| Ogg Opus file | Ogg parser | Preserve container |
| `GeminiSTTAdapter` | `Gemini API` | Transcript only |
| `scripts/gemini_stt_demo.py` | `transcribe()` | Live file demo |

The adapter is independent and is not wired into `/ws/dev-robot`; Gemini unary
STT emits a final result after consuming audio, while the current half-duplex
turn detector requires a transcript before it ends the input turn. Avoid changing
that contract in this task. Robot playback and WebSocket behavior are unchanged.

## D2-S2-09 - Gemini TTS and voice policy

| From | Via | Note |
|---|---|---|
| Voice demo answer | `GeminiTTSAdapter` | Gemini 3.8 TTS WAV |
| `GeminiTTSAdapter` | `Gemini API` | Explicit model/voice |
| `voice_system_prompt()` | Voice demo LLM | No text demo change |
| `scripts/gemini_voice_demo.py` | LLMRunner then TTS | Standalone only |

This adapter is not wired to robot playback; firmware output codec/sample-rate
and real playback-completion proof require a separate approved integration.
Backend auth/quota/usage and integrated runtime remain unchanged and fail-closed.

## D2-S2-10 - File voice pipeline

| From | Via | Note |
|---|---|---|
| WAV/Ogg file | `FileAudioInput` | Completed utterance |
| `FileAudioInput` | `GeminiSTTAdapter` | Real STT interface |
| `GeminiSTTAdapter` | `VoiceFilePipeline` | Final transcript |
| `VoiceFilePipeline` | `LLMRunner` | Voice policy/history |
| `VoiceFilePipeline` | `GeminiTTSAdapter` | WAV artifact |
| `scripts/gemini_voice_file_pipeline.py` | `VoiceFilePipeline` | Explicit opt-in |

The file diagnostic is standalone and does not call Backend auth/quota/usage;
it requires development-mock plus an explicit opt-in and never invokes mocks.
Only completed file turns are supported; microphone, VAD and robot playback
remain unchanged. `Conversation` instances must remain isolated per user/session.


## D2-S2-11 - Robot Gemini voice runtime

| From | Via | Note |
|---|---|---|
| `/ws/dev-robot` | Device authorize/resolve | Integrated mode remains fail-closed |
| `/ws/dev-robot` | Gemini STT | Only after explicit manual `listen.stop` |
| Opus 16 kHz/60 ms | Native libopus | Decode to mono PCM16 16 kHz |
| Gemini TTS WAV 24 kHz | `GeminiOpusTTSAdapter` | Resample and encode 16 kHz Opus |
| Firmware playback events | `RobotAudioOutput` | Complete requires matching drained count |

Gemini robot mode requires `AI_SERVER_ROBOT_AI_MODE=gemini`, Gemini provider and
explicit development-mock Backend mode. It is diagnostic only: Backend auth/config/quota/
usage is not integrated into the media path, so integrated mode returns unavailable.
Missing libopus fails closed. No hardware or Cloud live pass is implied by unit tests.


## D2-S2-11A - Interactive text voice diagnostic

| From | Via | Note |
|---|---|---|
| CMD keyboard | `process_question()` | Empty input skipped |
| `process_question()` | `LLMRunner` | Gemini only, per-session history |
| `LLMRunner` | Voice policy + local clock | Recomputed each turn |
| Gemini answer | `GeminiTTSAdapter` | WAV validated before save |
| WAV artifact | Windows shell | Default player launch is best effort |

Run only with `--enable`, `AI_SERVER_INTERACTIVE_VOICE_DEMO_ENABLE=true`,
`AI_SERVER_BACKEND_MODE=development-mock`, and Gemini provider. Every process
gets a random session ID. This diagnostic does not authenticate/admit/report usage
to Backend; integrated mode is rejected. Unit fixtures are not live evidence.


## D2-S2-11B - RAM-only audio defaults

| From | Via | Note |
|---|---|---|
| Robot Opus input | `BoundedAudioInput` | Capped PCM RAM buffer |
| Gemini STT | PCM/WAV bytes | In-memory provider request |
| Gemini TTS WAV | `GeminiOpusTTSAdapter` | Bounded bytes then Opus frames |
| WebSocket output | Playback queue | Bounded, ordered, per session |
| File voice diagnostics | `--export-wav` | No audio file by default |
| Interactive voice | RAM + `winsound` | Export is explicit only |

No runtime audio is written to disk. File-based input demos only read the
chosen source file; response export requires `--export-wav`. Demo WAV writes are
explicitly separated from provider/playback execution. Default robot session cap
is 2 (configurable, maximum 16); integrated Backend auth/quota behavior is unchanged.


## D2-S2-11B runtime scope update

The current D2-S2-11B report supersedes earlier notes that described runtime WAV
exports. Robot media remains memory-only; diagnostics use `--export-audio` (legacy
`--export-wav` alias). `RobotSettings` validates max sessions, per-session input/output
limits and aggregate audio-memory budget before startup. Default aggregate budget is
256 MB, default session cap is 2; the configured product of session count and
conservative per-session peak must fit the budget. Gemini STT clears raw/PCM buffers
after normalization and on every exit path. No transcript/audio persistence is wired
to MySQL; integrated media stays unavailable until the approved Backend contract exists.


## D2-S2-11C - Gemini low-latency diagnostic

| From | Via | Note |
|---|---|---|
| `ProviderDelta` | `LLMRunner` | TTFT measured |
| First safe sentence | `GeminiTTSAdapter.stream_pcm` | Early TTS |
| Gemini Interactions | PCM16 24 kHz | RAM chunks |
| PCM chunk | Windows WinMM | Bounded queue |
| CLI adapters | Reused async client | Closed at exit |
| `benchmark_gemini_voice.py` | 3 query classes | 5 real turns each |

The 8-10 second target is not a live pass unless a real Gemini response and
audio chunk are observed. WinMM submission is not proof of audible hardware
playback. Interactive mode remains restricted to explicit development-mock;
integrated Backend authorization/quota/usage stays fail-closed. Unary TTS
remains supported by existing callers; the keyboard demo uses Interactions
streaming when selected. See `docs/test-report-d2-s2-11c.md`.


## D2-S2-11D - Gemini live diagnostics

| From | Via | Note |
|---|---|---|
| `diagnose_gemini_network.py` | DNS/TCP/TLS | No API secret |
| Gemini LLM stream | `LLMRunner` | Live verified |
| TTS `AudioDelta` | PCM adapter | Missing MIME accepted |
| `_WaveFormat` | WinMM | PCM tag included |
| TTS sentences | Semaphore | Ordered streams |

Sandbox outbound TCP may be denied even when the host network works. The live
TTS provider has shown successful streams and independent request timeouts;
benchmark results require five completed turns per class before reporting
percentiles. WinMM submission is a playback API signal, not acoustic proof.
See `docs/test-report-d2-s2-11d.md`.


## D2-S2-11E - TTFT and TTS stability

`compare_gemini_prompt_latency.py` permits at most two explicit Gemini requests
through `LLMRunner`; it never retries and refuses integrated Backend mode. One
prompt pair is diagnostic only, not a percentile benchmark. Metadata model
listing does not prove project billing tier or generation entitlement. Prior
consecutive TTS timeouts are not retried; inspect provider quota/usage before
another live TTS run. See `docs/test-report-d2-s2-11e.md`.


## D2-S2-11F - Interactive TTS timing

Set `AI_SERVER_TTS_DIAGNOSTICS=true` for content-free segment timing. The
interactive first segment has zero measured queue wait and a per-segment
AudioContext deadline; do not increase it or retry to hide provider stalls.
Compare with the standalone call path in `docs/test-report-d2-s2-11f.md`.

## SD2 Gemini LAN voice diagnostic (2026-11-04)

| From | Via | Note |
|---|---|---|
| `.env` | `RobotSettings` | Read gateway config |
| `Settings.opus_library` | `OpusCodec` | Explicit native DLL |
| `run_server.cmd` | `scripts/run_dev.py` | Local process PATH |
| `sd2_console.py` | SD2 USB console | LAN token, not key |
| SD2 manual stop | `/ws/dev-robot` | Gemini STT/LLM/TTS |
| `RobotAudioOutput` | Opus pacing | 60 ms per packet |
| SD2 DMA evidence | Playback complete | Scope/count required |

Current user naming supersedes old diagram labels: SD1=`xiaozhi-s3-tft`,
SD2=`aiva-iot-s3-st7789`. The local `.env` was normalized without changing the
user's Gemini key; secrets and backups remain ignored. The Windows venv has
the declared dependencies plus PyOgg native Opus and pyserial. The explicit
DLL setting avoids relying on a broken global PATH. Integrated Backend mode
remains unchanged; the live test explicitly uses development-mock plus Gemini.
User-selected knowledge answers do not enable Internet search.

Live LLM probe, LAN HTTP/WebSocket, SD2 connection/input, Gemini STT/LLM/TTS,
and audible output were observed. User confirmed hearing output; provider
rate_limited interrupted the last turn, so full-turn/repeated-conversation
acceptance remains pending quota. No automatic retry. Firmware DMA completion
worked with mock tone; do not infer production acceptance from that result.
Server tests: 507 PASS and one pre-existing historical snapshot hash FAIL;
do not overwrite historical snapshots to force approval. Firmware host build
and asset tests: 70 PASS. See `docs/sd2-gemini-lan.md`.

## D2-S2 robot live audio follow-up (2026-11-04)

| From | Via | Note |
|---|---|---|
| `/ws/robot` | `lan_robot.robot()` | WSS + BE admission |
| Binary Opus | `OpusCodec.decode()` | 16 kHz mono PCM |
| Explicit stop | `GeminiSTTAdapter` | Bounded RAM utterance |
| `quota_gemini()` | Gemini LLM | Existing BE budget |
| Gemini PCM deltas | `PCMOpusFrames` | 24k to 16k Opus |
| Playback queue | `RobotAudioOutput` | Bounded + paced |
| Empty/STT error | usage settlement | Zero only pre-LLM |

The LAN route wires existing STT/LLM/TTS adapters after WSS identity, config and
per-turn quota admission. Integrated Gemini TTS uses Interactions PCM streaming;
unary WAV remains for adapters without a stream method. Firmware waits for the
scoped `status/listening` acknowledgement before mic capture. No audio file is
written. Status events carry session and turn IDs. Real BE, TLS, Gemini
credential readiness and SD2 hardware remain separate acceptance gates.


## Prompt 01 - Local runtime foundation (2026-11-14)

| From | Via | Note |
|---|---|---|
| `scripts/run_local.py` | `AI_RUNTIME=local` | Port 8002 |
| `create_app()` | Local route branch | No cloud imports |
| `/health` | runtime + readiness | Liveness retained |
| `/ready` | `local_readiness()` | Voice NOT_READY |
| `LlamaServerAdapter` | `/v1/models` | Env key, no retry |
| Local voice routes | 503 / WS 1013 | No cloud fallback |

See `docs/local-foundation-prompt01.md`. Local STT/TTS and generation are
unimplemented seams; model metadata readiness does not imply voice readiness.

## Prompt 02 - Local Gemma text chat (2026-11-14)

| From | Via | Note |
|---|---|---|
| `/local/chat` | Local bearer auth | Text only |
| Local chat | `LlamaServerAdapter` | Thinking disabled |
| Adapter | `/v1/models` | Real model ID |
| Adapter | `/chat/completions` | No cloud fallback |
| Local LLM calls | shared HTTP client | Reuse connection |
| Local shutdown | `LlamaServerAdapter.aclose` | Close HTTP client |
| user + session | bounded RAM history | TTL isolation |
| disconnect | `AudioContext.cancel` | Close HTTP stream |

Local `/internal/web-chat` remains blocked because it is the Cloud BE-only
contract. Local voice, STT/TTS, Xiaozhi and PA functions remain out of scope.
See `docs/local-gemma-prompt02.md`.

## Prompt 03 - Local Vietnamese STT (2026-11-14)

| From | Via | Note |
|---|---|---|
| raw Opus | `OpusCodec.decode` | 16k mono PCM |
| PCM frames | `LocalSTTAdapter` | RAM only |
| Local STT | faster-whisper small | CUDA float16 |
| STT result | `TranscriptionResult` | UTF-8 vi |
| silence | RMS + VAD 2000 ms | Empty final |
| Local runtime | one model cache | No cloud |

The existing robot routes and WebSocket protocol are unchanged. Local STT is
runtime-ready, but Local voice stays NOT_READY because TTS and gateway routing
are outside Prompt 03. See `docs/local-stt-prompt03.md`.

## Prompt 04-FIX - Local Vietnamese TTS (2026-11-14)

| From | Via | Note |
|---|---|---|
| Gemma text | Piper VAIS1000 | Offline CPU |
| Piper chunks | PCM16 22.05k | RAM only |
| PCM stream | `PCMOpusFrames` | Resample 16k |
| Opus encoder | 60 ms packets | Xiaozhi format |
| Local readiness | cached Piper voice | TTS READY |

The Piper voice is loaded once per process from the user cache outside Git.

## Prompt 05-FIX / 06-A - Local robot routing (2026-11-14)

| From | Via | Note |
|---|---|---|
| Gateway WSS | Backend resolve | Device-owned |
| `GEMINI` | Cloud app | Existing path |
| `LOCAL` | Loopback `8002` | No fallback |
| Robot Opus | Local STT | 16 kHz mono |
| Transcript | Gemma | Backend quota |
| Local model bind | HF cache path | Repo + quant exact |
| Gemma text | Piper + Opus | Playback ACK |

The public robot endpoints remain the single OTA/WSS funnel. A Local route is
opened only after Backend authentication, provider resolution, and Local voice
readiness; Cloud and Local processes reject a provider/runtime mismatch.
The optional `AI_SERVER_GATEWAY_LOCAL_*` deployment settings select explicit
device UIDs and ask Backend to resolve the configured Local provider/model;
unlisted devices continue to use their Backend profile unchanged.

## H-01 - PA-09 intent understanding

| From | Via | Note |
|---|---|---|
| Local internal analyze | Local bearer auth | Analysis only |
| user + session | LocalChatSessions | Bounded RAM locks |
| IntentUnderstanding | LlamaServerAdapter | Same Gemma runtime |
| Adapter stream | JSON schema grammar | Complete only |
| Interpretation | proposal guards | No business writes |
| Temporal raw date | calendar validation | D/M/YYYY or ISO |
| validated Analysis | H-02/H-03 caller | No execution |

`POST /internal/personal-assistant/analyze` exists only in Local runtime.
It accepts user_id, session_id, content and an IANA timezone. Reference time
comes from the server. H-02 now retains pending dialogue using the existing
session implementation for isolation, TTL and busy locks in a separate
namespace. No Backend method is called. PA-05's definition arrived
in H-06 and is now handled as read-only personalization; PA-09 and PA-23 are
capabilities, never invented Backend APIs. The Group II amendment
takes precedence for plan end-date changes: preserve the existing schedule.

## H-03 - Proposed PA contracts

| From | Via | Note |
|---|---|---|
| validated Analysis | `plan_tools` | Proposal only |
| operation + action | Tool registry | Allowlist |
| tool arguments | Pydantic contracts | Strict schema |
| application identity | TrustedToolContext | Never LLM-owned |
| WRITE approval | Bound call hash | User/session scoped |
| execution boundary | Availability gate | NOT_IMPLEMENTED |

The analyze route now uses these contracts for workflow planning; tool
execution remains separate from HTTP/voice integration.
All Backend tool contracts are NOT_IMPLEMENTED without endpoint bindings.
PA-05/09/23 have separate DISABLED capability descriptors. ToolPlan reports
READY for trusted H-02 readiness, and a context without trusted dialogue readiness
cannot execute. The boundary makes no HTTP/SQL call for an unimplemented tool.
The existing device/config/quota Backend credentials are not repurposed for PA.

### H-03 PA-04 contract extension

| From | Via | Note |
|---|---|---|
| Memory proposal | ToolPlan.proposals | No executable step |
| Approved proposal | exact call key | Context consent |
| Record/topic scope | MemoryAuthorization | Owner + revision |
| Memory query | response use gates | Consent + expiry |
| Management lookup | trusted proof | Never profile use |
| Memory workflow | versioned arguments | Existing lifecycle |
| Memory WRITE ACK | owner/revision check | No false success |

Five memory contracts remain NOT_IMPLEMENTED; memory.propose is a local-only
proposal descriptor and cannot dispatch or become an executable workflow step.
Revision/target/mode and consent are supplied by trusted application context,
never LLM entities. Update content is the new text with append/replace mode;
readback still shows complete before/after. Writes retain the existing stable
call-key/idempotency mechanism; no retry guarantee is invented without Backend
support. Record revisions absent from legacy reads cannot authorize mutations.

## H-04 - PA-23 workflow core

| From | Via | Note |
|---|---|---|
| ToolPlan | WorkflowOrchestrator | Direct caller only |
| dependency graph | topological check | Reject cycles |
| event interval | conflict READ step | Before event WRITE |
| user/session/correlation | WorkflowStore | Owner + busy gate |
| exact step arguments | approval hash | Invalidate on edit |
| succeeded parent | dependency record ID | Backend receipt only |
| ready step | ToolExecutionBoundary | Existing allowlist |
| unknown WRITE outcome | retry gate | Real idempotency |

Workflow state is bounded RAM with TTL, not a new conversation runtime.
No route/startup/voice integration is added. H-02 is still absent, and the
trusted dialogue_ready default remains false. All PA Backend tools remain
NOT_IMPLEMENTED. A workflow cannot succeed through the unavailable adapter.
Successful steps are retained on partial failure; no automatic rollback or
WRITE retry is performed. Memory payloads require trusted sensitive-data
review before workflow retention and separate readback/consent before WRITE.
Only test adapters advertise AVAILABLE/idempotent successful Backend behavior.

## H-05 - Backend execution safety

| From | Via | Note |
|---|---|---|
| tool metadata | availability gate | Four API states |
| verified adapter | endpoint/auth/schema | No PA bindings yet |
| Backend invocation | AudioContext | Deadline + cancel |
| Backend acknowledgement | scoped receipt | Validate identity |
| ambiguous WRITE | UNKNOWN outcome | Reconcile first |
| explicit WRITE retry | verified idempotency | Retain original key |

The Backend source audit found no registered PA controllers/modules. No PA
endpoint or authentication credential is configured. BackendClient remains
the existing HTTP/auth transport with zero automatic retries; H-05 adds no
second HTTP client and does not repurpose device/config/quota credentials.
The adapter protocol accepts the existing cancellation scope and operation ID
for future verified Backend methods. AVAILABLE requires verified endpoint,
contract and authentication as well as an enabled registry entry.
Success requires a real scoped Backend receipt and validated output. Unknown
WRITE results carry PENDING_RECONCILIATION at both step and workflow levels;
an adapter's boolean idempotency claim alone cannot enable retry. RAM state
is not a durable Backend deduplication or reconciliation ledger.

### H-05 PA-04 safety completion

| From | Via | Note |
|---|---|---|
| Memory WRITE | verified idempotency | Before first send |
| Memory update/delete | verified CAS | No stale overwrite |
| Adapter input | call snapshot | Immutable payload |
| Memory explicit retry | existing workflow | Same key + consent |
| Lost ACK | pending reconciliation | Until valid ACK |
| Dialogue result | receipt validation | No false failure |
| Confirmed step | notification event | Stable per-write ID |
| Optional channel hook | scoped ACK | No default sender |

Memory retries now use the existing memory lifecycle; completed steps are never
replayed. Unknown state survives retry preparation, capability changes and
subsequent non-confirming attempts. Known Backend rejection requires fresh
scope/review rather than an automatic revision change. New revision_verified
capability means atomic Backend compare-and-swap, not just a response version.
The optional notification hook has no production bindings: Website/Xiaozhi
remain NOT_CONNECTED until authenticated ACK/idempotency contracts are verified.
Channel failures do not undo a confirmed Backend change. No Backend API, URL,
database table, new HTTP runtime or notification outbox is created.

## H-06 - PA-05 read-only personalization

| From | Via | Note |
|---|---|---|
| Local chat opt-in | PA-09 understanding | Same Gemma adapter |
| scoped memory query | H-05 read boundary | PA-04 unavailable |
| receipt + ownership | consent/expiry filter | No default profile |
| query relevance | bounded context | Up to 3 records |
| current user facts | category override | No memory update |
| memory context | user-role JSON data | Never system rules |
| PA-04 proposal/answer | handoff status | No WRITE call |

`/local/chat` accepts personalize=true. The default text/voice/Cloud paths are
unchanged. PA-05 has no memory cache, database, WRITE API or workflow creation.
Its reader uses the existing memory.query contract/boundary; missing PA-04
returns MEMORY_UNAVAILABLE and Gemma answers without memory. Request-specific
enable_thinking=false is used for PA-05 response generation and ordinary
Local text chat, without changing the runtime/model or voice/Cloud paths.
Backend search must return a query digest and relevance scores alongside
ownership, consent, sensitivity review and validity metadata. Invalid/mixed
owner responses fail closed. Prior assistant memory claims are not reused
as current authorization. Full H-02 dialogue state and live PA-04 integration
remain blocked; memory save/forget requests are proposals/handoffs only.

## H-07 - PA integration checks

| From | Via | Note |
|---|---|---|
| all workflow steps | availability preflight | Block missing APIs |
| PA-04 storage refusal | deferred operation | Preserve event plan |
| PA-04 unsaved status | safe history status | No false delete |
| live readiness probe | Local 8002 + Gemma | No success doubles |

H-07 adds component integration tests and a stdout-only live probe, not a new
dialogue manager or automatic workflow hook. PA-04 cancel of a storage proposal
is deferred as MEMORY_STORAGE_DECLINED, never a nonexistent Backend cancel API.
Every unavailable workflow step is marked BLOCKED without dispatch. Fixed
application handoff statuses can remain in prompt history; arbitrary old
assistant memory facts still cannot provide current authorization.

## H-02 - Pending dialogue integration

| From | Via | Note |
|---|---|---|
| Analyze route | LocalChatSessions | Claimed owner pair |
| Pending + new turn | Gemma structured turn | Patch one intent |
| Entity patch | proposal guards | Preserve old dates |
| Conflicting patch | clarification state | Consent required |
| Complete dialogue | plan_tools | Trusted readiness |
| Changed proposal | workflow.revise | Same workflow ID |
| Confirm/reject | dialogue + workflow | No execution call |
| Session cleanup | pending cleanup | Bounded RAM TTL |
| Memory update | dialogue.memory_modes | Replace or append |
| Memory mutation | verified lookup gate | No invented before |
| Uncertain data | clarification state | Restatement needed |

The analyze route now retains H-02 state; older H-03/H-04/H-07 notes about
missing pending integration describe those stages before this change.
User/session ownership is supplied by the authenticated internal caller and
bound server-side, never chosen by Gemma. A dialogue revision and correlation
persist across follow-ups; optional expected_revision rejects stale turns.
Corrections revoke old confirmation. No Backend execution is wired here;
unimplemented tools remain BLOCKED/NOT_IMPLEMENTED with executed=false.
Local chat personalization and voice are separate callers, not automatically
connected to this pending dialogue namespace.

## H-01 - Group III memory interpretation

| From | Via | Note |
|---|---|---|
| PA-04 utterance | Gemma memory metadata | Intent distinction |
| Memory evidence | original_text | Verbatim only |
| Classified risks | memory guards | Block storage |
| Uncertain facts | missing information | H-02 clarification |
| Other PA intents | existing guards | Dates/deps unchanged |

Memory metadata distinguishes statements, proposals, explicit save/update,
query/delete, refusal and confirmation. Statement action=propose is retained
for compatibility and is not consent to store. Seven prohibited categories
block storage even after consent; query/delete remain distinct from storage.
Original evidence is preserved and no free summary is generated. Uncertainty,
unusual facts and possible STT errors are flagged without silently repairing
the content. This is H-01 interpretation only; no PA-04 API or persistence.

## H-04 - Group III memory workflows

| From | Via | Note |
|---|---|---|
| Memory-only dialogue | sync_memory | Stable workflow ID |
| Memory proposal | policy guards | No prohibited data |
| Update/delete | memory.query | Verified scope only |
| Verified records | select_memory | Item/group + mode |
| Before/after preview | memory_readback | Revision bound |
| Explicit consent | confirm_memory | No repeated writes |
| run_memory | ToolExecutionBoundary | ACK required |
| Unknown write result | reconciliation gate | No automatic retry |

Group III stages are stored on the existing owner-scoped WorkflowStore. The
analyze route syncs memory-only proposals, mode changes and consent; it never
executes tools. Trusted callers explicitly run lookup, select verified records,
show readback, confirm the same revision and run writes. Missing PA-04 APIs keep
workflows BLOCKED. Schedule/reminder algorithms and their existing guards are
unchanged. Focused fixture tests do not prove live Backend availability.

## PA-01 voice integration

| From | Via | Note |
|---|---|---|
| Xiaozhi session | device proof | Same as PA-04 |
| Calendar workflow | scoped delegation | Per operation |
| Calendar proposal | prepare endpoint | Bound payload |
| Voice confirmation | confirm endpoint | HMAC proof |
| Calendar mutation | Backend adapter | Commit ACK |
| Create ACK | schedule.query | Read-after-write |
| Voice create state | draft state | Fail is terminal |
| Calendar query intent | schedule.query | Supersedes draft |
| Chiều mai | 12:00–18:00 | User timezone |

The Local robot transcript handler reuses the authenticated PA-04 session,
Backend client, WebSocket response and TTS path. Calendar writes remain disabled
unless the process-local Calendar write flag and Backend write gate are both enabled.

## H-06 - Group III personalization additions

| From | Via | Note |
|---|---|---|
| Scoped memory receipt | consent/owner gates | Backend read only |
| Memory content | Group III policy | Censored categories |
| Expiry/configured age | clarification | No stale reuse |
| Eligible records | Gemma use review | Conflict/uncertainty |
| Record category | memory_groups | Existing schema only |
| Local update/delete | H-02/H-04 pending | Same user/session |
| Verified write ACK | workflow_reply | Exact change text |
| Notification envelope | delivery status | No transport send |

PA-05 still never writes memory or grants tool permission. Local chat now stores
update/delete dialogue in its own claimed session namespace; analyze sessions
remain independent. Optional LOCAL_PA05_MAX_AGE_SECONDS controls read freshness;
no default business lifetime, repetition threshold or arbitrary topic schema is
invented. Website/Xiaozhi integration is a prepared envelope only, sent=false.
Group III undecided items 10, 13 and 23 receive no additional business rules.
