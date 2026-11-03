# D2-S2-11D — Gemini network and streaming validation

## Kết luận

- Mạng sandbox: outbound TCP bị chặn trước TLS. Chạy live ngoài sandbox trên host Windows: DNS/TCP/TLS và HTTPS tới Google hoạt động; không cần sửa endpoint, proxy hay certificate.
- Gemini LLM streaming: **LIVE PASS**.
- Gemini TTS PCM streaming: **LIVE PASS từng request**, nhưng nhiều request TTS liên tiếp timeout không ổn định.
- Full Gemini LLM → TTS → PCM → WinMM: **LIVE PASS một lượt**.
- Mục tiêu time-to-first-audio 8–10 giây: **FAIL** trên lượt full duy nhất (25,319 ms).
- Benchmark 5 lượt × 3 nhóm: **BLOCKED/INCOMPLETE**; TTS timeout trước khi có đủ mẫu, đã dừng sau các timeout lặp để tránh tạo thêm usage không hữu ích.

## Chẩn đoán mạng

| Bước | Trong sandbox | Trên host ngoài sandbox |
|---|---|---|
| DNS `generativelanguage.googleapis.com` | PASS, 16 address records | PASS, 16 address records |
| TCP outbound :443 | FAIL `PermissionError` | PASS |
| TLS | Chưa tới được TLS | PASS TLS 1.3, certificate verified |
| Proxy | Không cấu hình | Không cấu hình |
| HTTPS root không xác thực | `ConnectError` | PASS HTTP 404; root path không phải API/model endpoint |
| SDK | `google-genai` 2.27.0 | `google-genai` 2.27.0 |

Vì DNS hoạt động nhưng TCP bị từ chối trong sandbox, lỗi ban đầu `FAIL_NETWORK` không phải bằng chứng sai API key, certificate hay model. Khi request được phép ra mạng, Gemini `gemini-3.5-flash-lite` trả phản hồi thật. Không thấy 401/403/404/429/503 từ endpoint model trong các request thành công; timeout TTS là timeout, không có HTTP status để khẳng định rate limit hay sai model.

`scripts/test_gemini_connection.py` nhận response live và usage thật nhưng lần đầu lỗi ở bước in tiếng Việt do stdout CP1252. Đã cấu hình UTF-8 cho stdout; LLM streaming được xác minh riêng bằng adapter ở dưới. Không có key hoặc token nào được in ra.

## TTS và Windows playback fixes

1. Gemini Interactions audio event thực tế không có `mime_type`, dù request đặt `response_format=audio/l16`. Adapter trước đó từ chối event hợp lệ. Adapter hiện cho phép MIME bị lược khi trường đó là `None`, nhưng tiếp tục kiểm tra sample rate 24 kHz, mono, base64 hợp lệ, PCM16 và giới hạn audio. Những MIME khác vẫn fail closed.
2. `waveOutOpen` trả `32` vì `WAVEFORMATEX` thiếu trường đầu `wFormatTag`. Đã bổ sung PCM format tag và kiểm tra offsets. Sau sửa, mở WinMM device thành công; full pipeline ghi PCM chunks vào output queue.
3. TTS từng câu được serialize theo semaphore, LLM vẫn stream song song. Điều này giữ thứ tự câu và ngăn nhiều Interactions TTS streams cùng lúc trên một lượt.

Mở WinMM và `waveOutWrite` thành công chứng minh OS nhận PCM để phát; không có microphone hay phép đo âm học tại loa, vì vậy không khẳng định đã nghe thấy âm thanh vật lý.

## Kết quả live và latency

### LLM streaming riêng

`scripts/gemini_adapter_demo.py` chạy LLMRunner → Gemini adapter thật và nhận câu trả lời tiếng Việt.

| Metric | Kết quả |
|---|---:|
| Model | `gemini-3.5-flash-lite` |
| TTFT | 15,349 ms |
| Total LLM | 15,431 ms |
| Tokens | input 38, output 16, total 54 |
| Status | LIVE PASS |

### TTS PCM streaming riêng

Sau khi sửa schema, smoke test adapter nhận 30 PCM chunks (97,920 bytes), PCM16 mono 24 kHz, duration 2.04 s; first audio 5,075 ms, total 7,101 ms. Status: **LIVE PASS** cho request này.

### Full pipeline + WinMM

Input `Thủ đô Việt Nam là gì? Hãy trả lời một câu.` → Gemini LLMRunner → Gemini TTS adapter → WinMM.

| Metric | Kết quả |
|---|---:|
| Answer | “Thủ đô của Việt Nam là Hà Nội.” |
| Models | LLM `gemini-3.5-flash-lite`; TTS `gemini-3.8-flash-tts/Kore` |
| LLM TTFT / total | 18,631 / 19,923 ms |
| LLM usage | input 279, output 10, total 289 tokens |
| TTS first chunk / total | 5,395 / 7,672 ms |
| API time-to-first-audio | 25,319 ms |
| WinMM submit | 25,365 ms |
| Tổng xử lý | 27,596 ms |
| Audio | 2.32 s, 24 kHz mono; không xuất WAV |
| Playback API | WinMM chunk mode; PCM được gửi tới audio device queue |
| Status | LIVE PASS; mục tiêu 8–10 giây FAIL |

LLM TTFT đơn lẻ đã khoảng 15–19 giây, nên mục tiêu 8–10 giây hiện không đạt ngay cả trước khi tính TTS. Không đổi provider/model hoặc chọn model khác để giả cải thiện.

## TTS timeout và benchmark

- Sau các stream TTS thành công, có request tiếp theo timeout. Một lượt benchmark timeout ở TTS với ngưỡng 30 giây; lượt tăng timeout lên 60 giây cũng timeout ở TTS.
- Sau khi serialize TTS, hai lượt đầu nhóm short tiếp tục timeout ở TTS với ngưỡng 45 giây; benchmark được dừng, không retry request.
- Chẩn đoán riêng hai request tuần tự: client reused timeout ở TTS request đầu (35,015 ms). Với client mới mỗi stream, segment 0 PASS (6,322 ms, 26 chunks, 84,480 bytes), segment 1 timeout (35,010 ms). Vì vậy chỉ tắt pooling không khắc phục ổn định.
- Kết quả này chưa đủ để phân biệt provider transient, project quota/capacity hay một điều kiện đầu vào cụ thể. Không có mã HTTP 429 để kết luận rate limit. Cần benchmark lại ở môi trường API ổn định và kiểm tra usage/quota trong Google AI Studio.
- Không đủ 5 mẫu hoàn tất cho bất kỳ nhóm benchmark nào; median/p95/min/max benchmark **NOT AVAILABLE**. Không tuyên bố percentile từ fixture.

## Kiểm thử regression

| Kiểm tra | Kết quả |
|---|---|
| Focused LLM/TTS/interactive tests | PASS — 55 passed |
| WAVEFORMATEX layout unit test | PASS |
| WinMM device-open check | PASS — `waveOutOpen` ready sau sửa |
| Full AI_SERVER suite | FAIL — 476 passed, 18 failed |
| Thay đổi so với 11C | 18 failure vẫn cùng nhóm |

18 failure còn lại: firmware historical snapshot SHA mismatch; robot gateway handshake/session tests không nhận `session_id`; Opus tests thiếu `libopus`; TCP subprocess test gửi `SIGINT` không hỗ trợ trên Windows. Các test này không được sửa trong task.

## Chế độ và file

Integrated mode vẫn fail-closed. Live diagnostic yêu cầu `development-mock` cùng cờ opt-in, không gọi Backend authorize/quota/usage và không được xem như production. Voice Response Policy V1, token limits, LLM history isolation và OpenAI adapter giữ nguyên. Audio không ghi file mặc định; full live run không tạo WAV.

File được sửa/tạo:

- `AGENTS.md`
- `app/clients/gemini_tts.py`
- `scripts/interactive_voice_demo.py`
- `scripts/test_gemini_connection.py`
- `scripts/benchmark_gemini_voice.py`
- `scripts/diagnose_gemini_network.py`
- `tests/test_gemini_tts.py`
- `tests/test_interactive_voice_demo.py`
- `docs/test-report-d2-s2-11d.md`

## Lệnh CMD Windows

```cmd
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv-win\Scripts\python.exe scripts\diagnose_gemini_network.py
```

LLM streaming live riêng:

```cmd
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_LLM_PROVIDER=gemini
set AI_SERVER_LLM_DEMO_ENABLE=true
.venv-win\Scripts\python.exe scripts\gemini_adapter_demo.py
```

TTS PCM streaming live riêng:

```cmd
set AI_SERVER_GEMINI_TTS_STREAM_TEST_ENABLE=true
.venv-win\Scripts\python.exe scripts\test_gemini_tts_stream_live.py --enable
```

Full pipeline, UTF-8 trong CMD:

```cmd
chcp 65001
set PYTHONUTF8=1
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_LLM_PROVIDER=gemini
set AI_SERVER_INTERACTIVE_VOICE_DEMO_ENABLE=true
.venv-win\Scripts\python.exe scripts\interactive_voice_demo.py --enable
```

Benchmark live (chỉ khi TTS endpoint ổn định; mỗi lần timeout là một lần thử riêng, không tự retry):

```cmd
set AI_SERVER_GEMINI_BENCHMARK_ENABLE=true
set GEMINI_TIMEOUT_SECONDS=60
set GEMINI_TTS_TIMEOUT_SECONDS=45
.venv-win\Scripts\python.exe scripts\benchmark_gemini_voice.py --enable --runs 5
```

Focused tests và full suite:

```cmd
.venv-win\Scripts\python.exe -m pytest tests\test_interactive_voice_demo.py tests\test_gemini_tts.py tests\test_gemini_runtime.py -q
.venv-win\Scripts\python.exe -m pytest -q
```
