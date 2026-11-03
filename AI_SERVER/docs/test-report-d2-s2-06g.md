# D2-S2-06G — Gemini API

Ngày kiểm tra: 03/11/2026. Phạm vi: chỉ AI_SERVER.

## Tích hợp

- Giữ nguyên `OpenAILLMAdapter`; bổ sung `GeminiLLMAdapter` theo cùng `LLMAdapter` contract, stream text/usage, mapping lịch sử assistant sang role `model`, timeout qua `AudioContext` và HTTP timeout.
- Client Gemini là riêng biệt, dùng `google-genai==2.27.0`. Retry SDK được đặt `attempts=1` (không retry); không có fallback OpenAI.
- `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_SECONDS` được đọc từ process environment hoặc `AI_SERVER/.env`. API key dùng `SecretStr`, không in qua repr/log/exception output.
- `.env.example` chọn `gemini-3.8-flash` làm ví dụ. Tài liệu Google xác nhận model này có Free Tier; điều đó không xác nhận entitlement của một project cụ thể.
- `scripts/test_gemini_connection.py` gửi một request thật `Xin chào AIVA`, giới hạn output theo `AI_SERVER_LLM_MAX_OUTPUT_TOKENS` đã có, in model/latency/response/usage khi thành công và phân loại lỗi HTTP, timeout, network khi thất bại.
- Adapter không được gắn vào robot WebSocket trong task này. Backend integrated fail-closed được giữ nguyên; chưa thay đổi quota/rate-limit.

## Kết quả thật

- Key được đọc từ `.env` (chỉ xác minh trạng thái có/không; không hiển thị giá trị).
- Model cấu hình: `gemini-3.8-flash`.
- Live request đã tới Gemini API và trả **HTTP 503** ở cả hai lần được phép truy cập mạng. Lần chạy ban đầu trong sandbox bị chặn outbound network.
- Kết quả live: **FAIL (HTTP 503)**, model `gemini-3.8-flash`, latency lần gần nhất **2354 ms**. Không có model response, request ID hoặc token usage để báo cáo. Vì vậy project/model entitlement chưa được xác nhận qua API thật; không tự retry hoặc chuyển sang OpenAI.

## Kiểm thử

- `pip check`: **PASS**, không có dependency conflict.
- Gemini + OpenAI connection/provider/backend focused tests: **74 PASS**.
- Full AI_SERVER suite: **389 PASS / 18 FAIL**. Các 18 lỗi đã tồn tại trước phần Gemini: 17 nhóm robot/Opus do môi trường thiếu native `libopus` (TCP cleanup cũng gặp SIGINT không hỗ trợ trên Windows), và một firmware historical snapshot hash mismatch.
- SDK `google-genai==2.27.0`, `websockets==16.0` đã cài vào `.venv-win`; SDK yêu cầu `websockets<17`.

## Lệnh CMD Windows

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv-win\Scripts\python.exe -m pip install -r requirements-dev.txt
set GEMINI_API_KEY=YOUR_GEMINI_API_KEY
set GEMINI_MODEL=gemini-3.8-flash
set GEMINI_TIMEOUT_SECONDS=30
.venv-win\Scripts\python.exe scripts\test_gemini_connection.py
.venv-win\Scripts\python.exe -m pytest tests\test_gemini_connection.py tests\test_llm.py -q -p no:cacheprovider
.venv-win\Scripts\python.exe -m pip check
.venv-win\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest-d2-s2-06g --tb=short
```

Có thể đặt key trong `.env` thay vì lệnh `set`; không chia sẻ file này. Nếu API tiếp tục trả 503, kiểm tra trạng thái dịch vụ và thử lại thủ công sau; script không tự retry.
