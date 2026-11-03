# D2-S2-11B — RAM-Only Voice Pipeline

## Thay đổi

- `/ws/dev-robot` đã giữ audio trong `BoundedAudioInput`/playback queue; Opus decode, Gemini STT request, Gemini TTS WAV, resample/Opus encode đều chạy qua bytes trong RAM. Luồng production không có thao tác mở/ghi file audio. Integrated Backend authorization/quota behavior không đổi và tiếp tục fail-closed.
- `GeminiOpusTTSAdapter` vẫn giới hạn WAV TTS ở 5 MB, xác nhận mono PCM16 24 kHz, resample frame 60 ms sang 16 kHz và gửi Opus đúng thứ tự. Codec/source được đóng trong `finally` khi success/error/cancel.
- Input robot bị chặn ở giới hạn hiện hành: tối đa 15 giây mỗi lượt (cấu hình được), PCM16 mono 16 kHz trong bounded buffer; queue playback có giới hạn số chunk/bytes; số session mặc định 2, tối đa cấu hình 16.
- Có ngân sách audio RAM tổng mặc định 256 MB. Startup kiểm tra `max_sessions × max(per-session input peak, output peak)` không vượt budget; per-session được ước tính bảo thủ bằng 6× input bound hoặc 3× giới hạn output WAV. Cấu hình vượt budget bị từ chối.
- File diagnostic chỉ ghi WAV nếu có `--export-audio` (giữ `--export-wav` làm alias tương thích). Interactive playback dùng `winsound` với WAV bytes trong RAM. Export/debug là tuỳ chọn riêng, không phải điều kiện chạy pipeline.
- File-based input demo vẫn đọc WAV/Ogg được chọn; response không ghi ra file nếu không bật export.
- Audit source các module robot/orchestrator/STT/TTS/transport: không có filesystem write. WAV normalize trong STT dùng `wave.open(io.BytesIO(...))`, tức buffer memory. `write_bytes()` chỉ nằm trong các script demo và được điều kiện hóa bằng `--export-audio`.
- STT chỉ giữ raw container khi cần Ogg/WAV, dọn raw/PCM buffers sau normalize và trong mọi đường thoát. Transcript/audio không được ghi vào MySQL hoặc log bởi AI_SERVER; integrated media hiện từ chối pipeline sau Backend auth/resolve, nên lưu transcript/usage qua Backend chưa được triển khai.

## Peak RAM benchmark

`tests/test_ram_only_runtime.py` tạo input PCM16 riêng cho từng session, 250 frame/session (15 giây, 480,000 byte audio payload/session), kiểm tra thứ tự frame, buffer overflow, admission cap 16 và dọn buffer sau cancel. `tracemalloc` đo peak Python allocation của audio input buffers; đây **không** phải peak RAM toàn process/Gemini SDK/OS và không phải live Cloud benchmark.

| Session được yêu cầu | Được nhận | Peak Python RAM đo được |
|---:|---:|---:|
| 1 | 1 | 536,452 B (0.51 MiB) |
| 5 | 5 | 2,630,940 B (2.51 MiB) |
| 20 | 16 | 8,402,018 B (8.01 MiB) |

20 yêu cầu còn 4 bị từ chối do ceiling 16 trong benchmark. Server mặc định chỉ cho 2 session đồng thời. Số đo trên là test RAM buffers, không gồm Gemini TTS full WAV (giới hạn 5 MB/session), provider/client, Python runtime hoặc native allocations.

## Kiểm thử

- `python -m pytest tests\test_ram_only_runtime.py tests\test_interactive_voice_demo.py tests\test_voice_file_pipeline.py tests\test_voice_file_demo.py tests\test_gemini_stt.py tests\test_gemini_runtime.py tests\test_gemini_tts.py tests\test_robot_gateway.py::test_gemini_wav_tts_transport_resamples_and_encodes_ordered_frames -q -s --basetemp=.pytest-d2-s2-11b-focused-final2` — **62 passed**.
- Bao gồm RAM-only default không sinh file, explicit WAV export, Windows memory playback/fallback, session history isolation, cancellation, queue overflow/cleanup, audio order, 1/5/20 admission, 429/503 và timeout fixtures.
- Full regression `python -m pytest -q --basetemp=.pytest-d2-s2-11b-final-check` — **456 passed, 18 failed**. Một firmware snapshot hash mismatch và 17 robot/Opus/TCP tests fail do thiếu libopus khiến hello không hoàn tất, codec cases fail, cùng lỗi cleanup subprocess Windows.
- So sánh SHA-256 audio artifacts trước/sau full suite: **4 trước, 4 sau, không thêm/xóa/đổi file**. Đây là artifacts có sẵn từ task trước: `gemini_tts_live.wav`, `gemini_voice_demo.wav` và hai WAV interactive; không có file mới do runtime/tests task này.
- Cloud/device hardware không được gọi trong các benchmark/tests. ESP32 playback-completion proof chưa được xác minh live.

## CMD Windows

```cmd
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv-win\Scripts\python.exe -m pytest tests\test_ram_only_runtime.py tests\test_interactive_voice_demo.py tests\test_voice_file_pipeline.py tests\test_voice_file_demo.py tests\test_gemini_stt.py tests\test_gemini_runtime.py tests\test_gemini_tts.py tests\test_robot_gateway.py::test_gemini_wav_tts_transport_resamples_and_encodes_ordered_frames -q -s --basetemp=.pytest-d2-s2-11b-focused-final2
.venv-win\Scripts\python.exe -m pytest -q --basetemp=.pytest-d2-s2-11b-final-full2
```

Interactive Gemini text voice demo vẫn cần opt-in live; mặc định không export WAV:

```cmd
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_LLM_PROVIDER=gemini
set AI_SERVER_INTERACTIVE_VOICE_DEMO_ENABLE=true
set GEMINI_API_KEY=<key>
set GEMINI_MODEL=gemini-3.5-flash-lite
set GEMINI_TTS_MODEL=gemini-3.8-flash-tts
.venv-win\Scripts\python.exe scripts\interactive_voice_demo.py --enable
```

Chỉ khi cần ghi WAV chẩn đoán, truyền `--export-audio`. `--export-wav` còn là alias tương thích. File STT→LLM→TTS demo cũng yêu cầu cờ này để lưu phản hồi.

## File thay đổi

- `scripts/interactive_voice_demo.py`
- `scripts/gemini_voice_demo.py`
- `scripts/gemini_voice_file_pipeline.py`
- `scripts/test_gemini_tts_live.py`
- `scripts/tts_mock_demo.py`
- `app/clients/gemini_tts.py`
- `app/clients/gemini_stt.py`
- `app/services/voice_file_pipeline.py`
- `app/core/robot_config.py`
- `app/api/robot_websocket.py`
- `tests/test_interactive_voice_demo.py`
- `tests/test_gemini_tts.py`
- `tests/test_ram_only_runtime.py`
- `AGENTS.md`
- `.env.example`
- `docs/test-report-d2-s2-11b.md`

## Trạng thái

RAM-only behavior: PASS trong unit/focused tests. Gemini live và ESP32 hardware: NOT RUN trong task này. Production integrated execution vẫn BLOCKED bởi Backend media/quota/usage contracts hiện có, không được bypass. Không có tuyên bố hardware/live PASS.
