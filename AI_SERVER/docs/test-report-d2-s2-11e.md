# D2-S2-11E — Gemini TTFT & TTS stability

Ngày chạy: 03/11/2026. Phạm vi thay đổi: chỉ `AI_SERVER/`.

## Kết luận

- Mục tiêu 8–10 giây đến audio đầu tiên: **FAIL**. Pipeline live trước đó đạt API TTFA 25.319 giây; LLM TTFT một mình là 18.631 giây.
- Gemini LLM vẫn dùng `gemini-3.5-flash-lite`. Không đổi model.
- Hai lần đo prompt qua `LLMRunner` đều LIVE PASS, nhưng chỉ có một cặp mẫu nên không đại diện median/p95.
- TTS PCM streaming có một lần PASS lịch sử; các lần gần đây có timeout liên tiếp ở 35–60 giây. Không gửi thêm request TTS trong task này để tránh lặp yêu cầu có thể tính usage.
- Integrated Backend tiếp tục fail-closed; script đo prompt chỉ chạy explicit `development-mock` và không dùng Backend auth/quota/usage.

## Kết quả live LLM và prompt

| Biến thể | Model | Prompt chars | Lịch sử | Input tokens | TTFT | Tổng LLM | Output tokens |
|---|---|---:|---:|---:|---:|---:|---:|
| Policy V1, không kèm thời gian | `gemini-3.5-flash-lite` | 907 | 0 | 234 | 15.750 s | 15.862 s | 10 |
| Policy V1 + giờ Việt Nam hiện tại | `gemini-3.5-flash-lite` | 966 | 0 | 268 | 13.051 s | 13.205 s | 30 |

Cùng câu hỏi và cùng model; mỗi biến thể chỉ chạy một lần, không retry. Cả hai trả lời đúng “Thủ đô của Việt Nam là Hà Nội.” Biến thể hiện tại dùng thêm 34 input tokens nhưng mẫu đó nhanh hơn 2.699 giây; chênh lệch ngược kỳ vọng này cho thấy dao động mạng/provider lớn hơn tác động prompt có thể chứng minh. Không thể quy nguyên nhân 15–19 giây cho độ dài prompt từ dữ liệu hiện có.

Số đo pipeline Task 11D (một lượt): LLM TTFT 18.631 s; TTS first chunk 5.395 s kể từ lúc gọi TTS; API time-to-first-audio 25.319 s; pipeline tổng 27.596 s. Không đủ 5 lượt cho median/p95. Không có phép đo TTS trong Task 11E.

## Mạng, client và TTS timeout

Probe trong sandbox: DNS PASS 43.9 ms, 16 địa chỉ; TCP direct FAIL với `PermissionError`; HTTPS direct thất bại trước TLS; không cấu hình proxy; SDK `google-genai` 2.27.0. Điều này xác nhận giới hạn outbound của sandbox, không phải lỗi DNS/TLS/model/API key. Host probe trước đó ở Task 11D đã xác nhận TLS 1.3 và chứng thư hợp lệ. Request Gemini live ở Task 11E thành công khi chạy được ngoài sandbox.

Chưa đo được DNS/TCP/TLS/request-handshake overhead ngay trong một request Google API thật; probe HTTP tới root không phải API inference và không thể thay cho phần đó. Mốc từ request start đến delta đầu tiên bao gồm mạng, queue/provider, inference và stream SDK; không có trace đủ để tách từng phần.

TTS: có các timeout lặp lại ở 30, 35, 45 và 60 giây trong Task 11D; request khác lại thành công (một lượt fresh-client 6.322 giây, một lượt stream 7.101 giây). Thử client mới không loại bỏ hiện tượng, vì vậy chưa có bằng chứng pooling là nguyên nhân. Không ghi nhận HTTP status 429/503 trong các timeout, nên chưa thể kết luận quota, provider capacity, SDK hay network. Không tự retry. TTS timeout hiện tại được giữ nguyên; cần xem quota/usage và request logs phía Google AI Studio/Google API để phân loại chính xác.

## Model và Free Tier

SDK model listing của project trả 19 model có metadata, gồm model hiện tại `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.1-flash-lite`, cùng các biến thể Gemini TTS 3.8. Listing/metadata chỉ xác nhận tên có thể tra cứu; không xác nhận quyền generate cho mọi model hay billing tier của API key. Hai live generation chứng minh model hiện tại hoạt động. Bảng giá Google hiện liệt kê Free Tier cho `gemini-3.5-flash-lite` và `gemini-3.6-flash`; tuy nhiên không xác minh được project/key này đang ở Free Tier hay Paid Tier. Vì user không cho phép phát sinh phí, **không benchmark model thay thế** tới khi tier của project được xác nhận. Mục tiêu không đổi model vẫn được giữ.

Nguồn chính thức: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini 3.5 Flash-Lite model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [Gemini models](https://ai.google.dev/gemini-api/docs/models).

## Mã và kiểm thử

- `scripts/compare_gemini_prompt_latency.py`: so sánh tối đa hai lượt thật, qua Gemini adapter + `LLMRunner`, cấm retry và yêu cầu explicit opt-in/development-mock.
- `scripts/diagnose_gemini_network.py`: thêm thời gian DNS/TCP/TLS/HTTPS; không đọc hay in key, không gọi API generation.
- `docs/test-report-d2-s2-11e.md`: báo cáo này.

Focused regression: **100 passed** (`test_interactive_voice_demo.py`, `test_gemini_tts.py`, `test_gemini_runtime.py`, `test_llm.py`). Full AI_SERVER suite: **476 passed, 18 failed**, đúng các nhóm lỗi baseline Task 11D: firmware historical snapshot SHA mismatch; robot handshake thiếu `session_id`; Opus tests thiếu `libopus` trên Windows; subprocess TCP test gặp `SIGINT` không hỗ trợ sau lỗi setup/codec. Không sửa các lỗi này trong task.

## Chạy trên Windows CMD

```cmd
cd /d E:\learn\AI_Project\cap1\AI_SERVER
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_LLM_PROVIDER=gemini
set AI_SERVER_GEMINI_PROMPT_COMPARE_ENABLE=true
.venv-win\Scripts\python.exe scripts\compare_gemini_prompt_latency.py
```

Probe mạng và test:

```cmd
.venv-win\Scripts\python.exe scripts\diagnose_gemini_network.py
.venv-win\Scripts\python.exe -m pytest -p no:cacheprovider --basetemp .pytest-11e-focused tests\test_interactive_voice_demo.py tests\test_gemini_tts.py tests\test_gemini_runtime.py tests\test_llm.py -q
.venv-win\Scripts\python.exe -m pytest -p no:cacheprovider --basetemp .pytest-11e-full tests -q
```

## Trạng thái

- LLM hiện tại live: **PASS** (2/2 prompt samples).
- Network sandbox diagnostic: **FAIL/BLOCKED** tại TCP egress; DNS PASS. Host live Gemini LLM: **PASS**.
- TTS live stability: **BLOCKED/INCONCLUSIVE** do timeout lặp lại trước đó; không gọi lại trong task.
- Prompt comparison: **PASS**, nhưng kích thước mẫu chưa đủ để kết luận tối ưu.
- Alternate model Free Tier verification: **BLOCKED** theo quyền/tier project chưa xác nhận.
- 8–10 giây TTFA: **FAIL** theo pipeline đo được 25.319 giây.
