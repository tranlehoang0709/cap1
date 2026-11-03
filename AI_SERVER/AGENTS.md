# Bản đồ luồng AI_SERVER

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
