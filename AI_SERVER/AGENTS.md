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
<<<<<<< HEAD
=======

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
>>>>>>> 8656999 (Update AIVA IoT integration and SD2)


## D4-S1-05 isolated mock diagnostic

| From | Via | Note |
|---|---|---|
| `tools/mock_chat/run.py` | Explicit mock children | Loopback only |
| `scripts/mock_chat.py` | `/internal/web-chat` | Fixture token |
| Nest mock runtime | FastAPI mock reply | RAM only |

The standalone mock app is never imported by `app.main`. It requires explicit
development/test opt-in, uses no provider key or database, and does not replace
production authentication, Local routing, quota, history/privacy or TLS behavior.
See `../../tools/mock_chat/README.md`. Cross-process mock evidence is not a live
provider or hardware acceptance result.
