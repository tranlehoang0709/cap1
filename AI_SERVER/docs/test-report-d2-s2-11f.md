# D2-S2-11F — Interactive TTS timeout investigation

Ngày kiểm tra: 03/11/2026. Chỉ sửa trong `AI_SERVER/`.

## Đối chiếu hai call path

| Mục | TTS standalone | Interactive segment 0 |
|---|---|---|
| Caller | `scripts/test_gemini_tts_stream_live.py` | `process_question()` trong `scripts/interactive_voice_demo.py` |
| Cloud path | `GeminiTTSAdapter.stream_pcm()` | Cùng `GeminiTTSAdapter.stream_pcm()` |
| Text | Câu fixture cố định | Câu đầu hoàn chỉnh từ `LLMRunner` |
| Client | Mặc định tạo client riêng cho call | Reuse một client của adapter suốt interactive session |
| Concurrent work | Không có LLM call cùng lúc | TTS được khởi chạy ngay khi sentence-safe; LLM có thể tiếp tục stream song song |
| Queue | Không có queue, trực tiếp gọi adapter | `asyncio.Semaphore(1)`; chờ queue trước khi tạo TTS deadline |
| Deadline | `GEMINI_TTS_TIMEOUT_SECONDS + 2` giây | `GEMINI_TTS_TIMEOUT_SECONDS` giây, mặc định 30 |
| SDK timeout | `GEMINI_TTS_TIMEOUT_SECONDS`, 30 giây mặc định, retries=1 attempt | Cùng thiết lập |
| Audio | PCM16 mono 24 kHz trong RAM | PCM16 mono 24 kHz trong RAM, gửi dần sang WinMM khi có sink |

Hai đường dùng cùng adapter và định dạng request. Khác biệt có thể ảnh hưởng là TTS chạy đồng thời với LLM và reuse client; call 11F này không chứng minh yếu tố nào gây provider stall. Queue chờ đo được bằng 0 ms nên queue không gây timeout trong lượt live.

## Live interactive có diagnostic

Chạy một câu hỏi duy nhất, không retry, không xuất audio xuống file:

| Mốc | Kết quả |
|---|---:|
| Segment created | 17.717 s từ đầu pipeline; text 60 ký tự, không rỗng, nằm trong giới hạn |
| Segment queued → dequeued | 0 ms |
| Deadline được đặt | 30.000 s từ lúc tạo context segment |
| SDK request bắt đầu | 18.090 s từ đầu pipeline; 373 ms sau khi tạo segment |
| PCM đầu tiên | Không nhận được |
| Timeout | 30.012 s sau khi tạo segment; `AudioContext` deadline hết hạn |
| Cleanup/cancel | Context cancel được gọi sau timeout; task kết thúc, không retry |

**Nguyên nhân được xác minh:** lỗi interactive do `AudioContext` chạm deadline 30 giây trước khi adapter nhận được PCM đầu tiên. Queue wait không liên quan; segment text hợp lệ; không thấy lỗi validation, cancellation từ user, HTTP status hay `TimeoutError` của SDK. SDK timeout cũng được đặt 30 giây, trong khi context bắt đầu sớm hơn (trước đoạn gọi SDK), nên context timeout thắng race và hủy thao tác đang chờ. Đây chứng minh tầng timeout báo lỗi; chưa chứng minh vì sao Gemini/transport không đưa PCM trong 30 giây.

Standalone theo bằng chứng user cung cấp PASS với first audio 4.889 ms và tổng 7.019 ms/37 chunks. Đơn vị ms có vẻ không tương thích với thời gian thực của API; chưa xác minh lại standalone trong lượt này vì trước đó đã có TTS timeout liên tiếp. Vì thế không so sánh trực tiếp các số ấy với live interactive mới. Live interactive mới: **FAIL TTS**. Không tăng timeout để che lỗi.

Không có HTTP status trong exception đã map. Chưa phân biệt được SDK/network/provider scheduling; cũng chưa thể kết luận reuse-client hay LLM/TTS overlap là nguyên nhân. Request được bắt đầu nhưng không có PCM trước deadline. Các mốc mới tiếp theo sẽ ghi `llm_stream_completed` cùng số TTS segment còn chạy để xác nhận overlap.

## Code và an toàn

- `scripts/interactive_voice_demo.py`: log tùy chọn theo segment cho created/queued/dequeued, queue wait, deadline, text length/validity, request start, PCM đầu tiên, LLM complete, timeout và cleanup. Bật bằng `AI_SERVER_TTS_DIAGNOSTICS=true`. Không log key hay text.
- `app/clients/gemini_tts.py`: hook diagnostic báo ngay trước request Interactions, PCM đầu tiên, SDK timeout hoặc context cancel/deadline; callback lỗi không ảnh hưởng pipeline.
- `scripts/test_gemini_tts_stream_live.py`: cùng mốc an toàn cho standalone.
- `tests/test_gemini_tts.py`: kiểm tra event hook ở success, timeout và cancel.
- `docs/test-report-d2-s2-11f.md`: báo cáo này.

Không thay timeout, retry, provider, model, Voice Response Policy, playback, RAM-only audio, connection reuse hoặc Backend fail-closed. Không có bug logic cụ thể đủ chứng cứ để thay đổi hành vi runtime; timeout live là deadline thực sự không có audio trả về.

## Test

- `py_compile`: PASS.
- Focused TTS + interactive: **46 passed**.
- TTS standalone live mới: **NOT RUN** (dùng evidence user cung cấp; không gửi thêm request TTS sau các timeout liên tiếp).
- Interactive Gemini live: **FAIL** tại context deadline sau 30.012 giây; một lượt, không retry.
- Hardware/acoustic playback: **NOT TESTED**; lỗi xảy ra trước audio PCM.

## CMD Windows

```cmd
cd /d E:\learn\AI_Project\cap1\AI_SERVER
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_LLM_PROVIDER=gemini
set AI_SERVER_INTERACTIVE_VOICE_DEMO_ENABLE=true
set AI_SERVER_TTS_DIAGNOSTICS=true
set PYTHONUTF8=1
.venv-win\Scripts\python.exe scripts\interactive_voice_demo.py --enable
```

TTS standalone một lượt (không tự retry):

```cmd
set AI_SERVER_GEMINI_TTS_STREAM_TEST_ENABLE=true
.venv-win\Scripts\python.exe scripts\test_gemini_tts_stream_live.py --enable
```

Test local:

```cmd
.venv-win\Scripts\python.exe -m pytest -p no:cacheprovider --basetemp .pytest-11f-focused tests\test_gemini_tts.py tests\test_interactive_voice_demo.py -q
```
