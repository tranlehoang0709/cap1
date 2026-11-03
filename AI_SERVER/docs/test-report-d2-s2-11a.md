# D2-S2-11A — Interactive Text-to-Voice Test

## Kết quả

| Bước | Trạng thái | Ghi nhận |
|---|---|---|
| CLI nhiều lượt/context | PASS (unit) | Context được giữ trong một phiên; phiên mới dùng UUID và history rỗng |
| Voice policy + giờ Việt Nam | PASS (unit) | Prompt V1 thêm thời gian hiện tại từng lượt; Windows thiếu tzdata dùng offset UTC+07:00 có nhãn Asia/Ho_Chi_Minh |
| LLMRunner → Gemini adapter | FAIL (live attempt) | Một request live trả `LLM: provider_error`; không có response/token usage |
| Gemini TTS → WAV | BLOCKED | Không chạy do LLM thất bại ở bước trước |
| Windows playback | NOT RUN | Không có WAV mới để mở/nghe |
| Integrated-mode guard | PASS (unit) | `load_live_adapters()` từ chối integrated mode trước provider factory |
| Opt-in guard | PASS (unit) | Cần cả `--enable` và env flag |
| Focused tests | PASS | 37 passed; adapter fixtures là unit test, không phải live evidence |
| Full AI_SERVER regression | FAIL (các blocker đã biết) | 448 passed, 18 failed: firmware snapshot hash mismatch và 17 robot/Opus/TCP tests do thiếu libopus/Windows subprocess cleanup |

Live attempt dùng một câu hỏi tiếng Việt, API key lấy từ environment/.env nhưng không in. Tiến trình kết thúc sau `provider_error`; không có WAV mới, latency/token usage live không khả dụng. Không retry request để tránh phát sinh sử dụng lặp. Vì chưa có kết quả âm thanh thật nên chưa thể xác nhận nghe được.

## Cách chạy trong CMD Windows

```cmd
cd /d E:\learn\AI_Project\cap1\AI_SERVER
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_LLM_PROVIDER=gemini
set AI_SERVER_INTERACTIVE_VOICE_DEMO_ENABLE=true
set GEMINI_API_KEY=<key>
set GEMINI_MODEL=gemini-3.5-flash-lite
set GEMINI_TTS_MODEL=gemini-3.8-flash-tts
set GEMINI_TTS_VOICE=Kore
.venv-win\Scripts\python.exe scripts\interactive_voice_demo.py --enable
```

Nhập câu hỏi liên tục; nhập dòng trống để bỏ qua, `exit` để kết thúc. WAV hợp lệ được lưu trong `AI_SERVER/artifacts/interactive_voice/` rồi gửi tới trình phát Windows mặc định. Nếu shell không mở được file, CLI in đường dẫn để mở thủ công.

Unit/focused tests:

```cmd
cd /d E:\learn\AI_Project\cap1\AI_SERVER
.venv-win\Scripts\python.exe -m pytest tests\test_interactive_voice_demo.py tests\test_voice_file_pipeline.py tests\test_gemini_runtime.py tests\test_gemini_tts.py -q --basetemp=.pytest-d2-s2-11a-focused3
.venv-win\Scripts\python.exe -m pytest -q --basetemp=.pytest-d2-s2-11a-full
```

## Files

- `scripts/interactive_voice_demo.py`
- `tests/test_interactive_voice_demo.py`
- `.env.example`
- `AGENTS.md`
- `docs/test-report-d2-s2-11a.md`

## Giới hạn

Demo standalone chỉ dành cho `development-mock`, không gọi Backend authorize/quota/usage và không thể chạy trong `integrated`. Gemini/OpenAI fallback không có; chỉ Gemini được chọn rõ ràng. PASS unit không chứng minh Cloud, WAV thật hoặc nghe được. Cần kiểm tra lại sau khi khắc phục lỗi Gemini provider/network để có latency, token usage và playback evidence thật.
