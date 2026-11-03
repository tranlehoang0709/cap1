# D2-S2-11 — Xiaozhi Voice Runtime Readiness

## Kết quả

| Hạng mục | Trạng thái | Bằng chứng / giới hạn |
|---|---|---|
| Explicit turn boundary | PASS (unit) | `listen.stop` đóng audio; STT chỉ khởi động sau ranh giới này |
| Half-duplex input gate | PASS (unit/source) | Mic bị loại trước VAD/decode khi không LISTENING |
| WAV→Opus adapter wiring | PASS (unit, encoder giả lập) | Kiểm tra WAV mono PCM16 24 kHz, resample, frame thứ tự; không chứng minh Opus packet thật |
| Native Opus decode/encode | BLOCKED | Windows không tìm thấy libopus (`find_library('opus')` trả `None`) |
| Gemini live trên robot WebSocket | BLOCKED | Không thể đóng gói audio phản hồi Opus hợp lệ khi thiếu libopus; không chạy request Cloud |
| Backend integrated media pipeline | BLOCKED | Integrated authorize/resolve vẫn fail-closed với `AI_PIPELINE_UNAVAILABLE`; quota/credential broker/usage chưa gắn vào media runtime |
| Firmware simulator over real Opus | BLOCKED | Không có native codec và fixture câu hỏi tiếng Việt có nguồn phù hợp |
| ESP32 hardware playback | NOT RUN | Không có board chạy thử trong phiên này |
| Full regression | FAIL (môi trường/đã biết) | 433 passed, 18 failed; danh sách bên dưới |

## Thay đổi runtime

- `AI_SERVER_ROBOT_AI_MODE=mock|gemini` chọn rõ nhánh development; mặc định vẫn `mock`.
- Nhánh Gemini chỉ chạy khi Backend mode là `development-mock` và provider cấu hình chính xác là Gemini. Không fallback mock/OpenAI.
- Chế độ `integrated` tiếp tục authorize/resolve trước khi nhận audio, rồi trả `AI_PIPELINE_UNAVAILABLE`; đây là fail-closed, chưa phải integrated voice.
- Robot Gemini yêu cầu `listen.start` manual và `listen.stop`. Không dùng transcript làm tín hiệu kết thúc audio.
- Audio input hợp đồng firmware: Opus raw packet, mono 16 kHz, frame 60 ms; server decode bằng libopus sang PCM16 trước STT.
- Với protocol v2, timestamp được kiểm tra tăng đơn điệu trong mỗi turn (cho phép wrap uint32); packet out-of-order/repeated bị từ chối. v1/v3 không mang timestamp trong framing.
- TTS adapter nhận WAV mono PCM16 24 kHz, resample sang 16 kHz, pad frame cuối, mã hóa từng Opus 60 ms và giữ sequence. Chỉ phản hồi `playback.complete` khớp scope/count mới cho phép lượt sau. `tts.stop`/socket send/queue rỗng không tạo playback proof.
- Firmware source có `VoicePlaybackGuard` xác nhận số chunk và kiểm tra output drain trước complete. Đây là đối chiếu source, không phải xác minh build/flash/hardware phiên bản hiện hành.

## Kiểm thử thực tế

- `python -m pytest tests\test_orchestrator.py tests\test_robot_gateway.py::test_gemini_wav_tts_transport_resamples_and_encodes_ordered_frames tests\test_robot_gateway.py::test_v2_audio_timestamp_order -q --basetemp=.pytest-d2-s2-11-focused` — **28 passed**. Adapter TTS test thay encoder bằng fixture; không gọi Gemini và không chứng minh Opus.
- `python -m pytest -q --basetemp=.pytest-d2-s2-11-final2` — **437 passed, 18 failed**.
- 18 lỗi gồm: một firmware snapshot hash mismatch có từ trước; lỗi robot gateway không nhận hello vì codec native không khởi tạo; Opus profile/encoder tests fail do thiếu libopus; TCP test fail tiếp và cleanup `SIGINT` không hỗ trợ trên Windows/Python hiện tại. Đây là nhóm blocker đã gặp trong các task trước; không sửa snapshot hash.
- Cloud, simulator audio Opus, Backend-integrated voice và hardware: **BLOCKED/NOT RUN**, không đánh dấu live pass.

## Cài libopus trên Windows

Cài DLL libopus cho đúng kiến trúc Python (x64/x86), thêm thư mục DLL vào `PATH`, mở CMD mới rồi kiểm tra:

```cmd
where opus.dll
where libopus-0.dll
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv-win\Scripts\python.exe -c "import ctypes.util; print(ctypes.util.find_library('opus'))"
```

Tên file phụ thuộc bản phân phối; Python phải có thể nạp đúng DLL. Không đổi tên WAV/raw bytes thành Opus.

## Chạy development

CMD:

```cmd
cd /d E:\learn\AI_Project\cap1\AI_SERVER
copy .env.example .env
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_ROBOT_ENABLED=true
set AI_SERVER_ROBOT_AI_MODE=gemini
set AI_SERVER_ROBOT_TOKEN=<random-token-at-least-32-characters>
set AI_SERVER_ROBOT_ENERGY_THRESHOLD=100
set AI_SERVER_LLM_PROVIDER=gemini
set GEMINI_API_KEY=<key>
set GEMINI_MODEL=gemini-3.5-flash-lite
.venv-win\Scripts\python.exe scripts\run_dev.py
```

Firmware/client cần gửi đúng hello đã thương lượng, Opus 16 kHz mono/60 ms và manual listen start/stop. Gemini mode này là development diagnostic; không được coi là Backend quota-authorized production.

## File

- `app/api/robot_websocket.py`
- `app/core/robot_config.py`
- `app/models/tts.py`
- `app/services/orchestrator.py`
- `app/services/robot_transport.py`
- `app/services/turn_input.py`
- `tests/test_orchestrator.py`
- `tests/test_robot_gateway.py`
- `.env.example`
- `AGENTS.md`
