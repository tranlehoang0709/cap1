# D2-S2-11C — Gemini voice latency

## Kết quả triển khai

Demo bàn phím vẫn gửi mọi câu hỏi qua `LLMRunner` và Gemini thật. Gemini LLM tiếp tục stream text; khi `LLMRunner` phát một `TextChunk` hoàn chỉnh, demo gọi `GeminiTTSAdapter.stream_pcm()` ngay cho câu đó, đồng thời LLM tiếp tục sinh câu sau. TTS PCM16 mono 24 kHz được gom trong RAM theo thứ tự câu; mặc định không tạo file âm thanh. Chỉ `--export-audio` mới xuất WAV.

Trên Windows, demo gửi PCM chunk qua WinMM với queue tối đa 8 chunk. Nếu thiết bị audio không mở được, demo dùng WAV trong RAM sau khi tổng hợp hoàn tất và không tính đó là streaming playback. API nhận chunk đầu hoặc `waveOutWrite` trả thành công không chứng minh người dùng nghe thấy tiếng ở loa.

Gemini TTS streaming được hỗ trợ theo tài liệu Google cho Interactions API; stream trả raw PCM `audio/l16`, 24 kHz, mono, signed 16-bit. Request schema được đối chiếu với tài liệu và SDK `google-genai` 2.27.0. [Tài liệu Gemini speech generation](https://ai.google.dev/gemini-api/docs/speech-generation?authuser=7) [Python SDK Interactions](https://github.com/googleapis/python-genai/blob/main/google/genai/_gaos/interactions.py).

## Đo latency

| Metric | Kết quả hiện tại |
|---|---|
| LLM TTFT | BLOCKED — API Gemini trả network error |
| LLM total | BLOCKED |
| TTS first audio | BLOCKED — TTS streaming API trả `network_failure` |
| Time to first audio | BLOCKED; không có chunk audio thật |
| Playback submit | NOT RUN; không có PCM để gửi tới WinMM |
| Thời lượng audio / token usage live | BLOCKED |

### Baseline tham khảo trước thay đổi

Ảnh kết quả Interactive Voice Demo trước task có hai lượt: LLM/TTS/total lần lượt `13032/4162/17195 ms` và `28159/4026/32186 ms`. Với đúng hai mẫu gộp, median là `20596/4094/24691 ms`, min/max lần lượt `13032–28159`, `4026–4162`, `17195–32186 ms`; p95 của mỗi metric bằng giá trị lớn nhất trong hai mẫu. Hai câu hỏi không được phân nhóm và không đủ 5 lần mỗi nhóm, vì vậy đây chỉ là baseline tham khảo, không phải benchmark so sánh hợp lệ.

Không có số đo sau thay đổi vì môi trường hiện tại không kết nối được Gemini. Không thể xác nhận mục tiêu 8–10 giây hoặc báo median/p95 sau thay đổi. Script benchmark được tạo để chạy 5 lượt live cho từng nhóm câu ngắn, kiến thức và giải thích khi network hoạt động.

## Kiểm thử thực tế

| Kiểm tra | Kết quả |
|---|---|
| Focused tests LLM/TTS/demo | PASS — 53 passed |
| Python compileall cho file sửa | PASS |
| Session isolation và concurrency 1/5/20 (fixture) | PASS — 1/1, 5/5, 5/20; runner giới hạn 5 request đồng thời, 15 lượt overload được từ chối |
| Python traced peak tại 1/5/20 session (fixture) | `38,789 / 151,003 / 361,913` bytes; không phải process RSS hoặc Cloud audio peak |
| Gemini LLM probe | FAIL — `FAIL_NETWORK`, 71 ms; không có response/token usage |
| Gemini TTS PCM stream probe | FAIL — `network_failure`; không nhận audio |
| Benchmark live 5 × 3 nhóm | BLOCKED — request đầu dừng ở `network_failure`; chưa chạy đủ 15 lượt |
| Windows WinMM playback live | NOT RUN — chưa có PCM thật |
| Integrated Backend / quota / usage | BLOCKED như trạng thái hiện có; demo vẫn từ chối `integrated` |
| ESP32 playback | NOT RUN / ngoài phạm vi |

Full AI_SERVER regression: `474 passed, 18 failed`. Các failure không thuộc task này và cùng nhóm đã tồn tại trong baseline: firmware snapshot SHA mismatch; robot gateway handshake/session tests fail trước khi có `session_id`; Opus tests thiếu `libopus` trên Windows; một subprocess TCP test không hỗ trợ `SIGINT` kiểu POSIX. Không sửa firmware snapshot, Backend hoặc tests này.

Không có PASS live nào được gán từ fixture. LLM và TTS client dùng connection pooling trong phiên interactive, không retry request, đóng adapter client khi thoát. Voice policy V1 giữ nguyên; context giảm còn tối đa 16 lượt/8000 ký tự. Giới hạn output token hiện hành không đổi.

## Lệnh CMD Windows

```cmd
cd /d E:\learn\AI_Project\cap1\AI_SERVER
set AI_SERVER_BACKEND_MODE=development-mock
set AI_SERVER_LLM_PROVIDER=gemini
set AI_SERVER_INTERACTIVE_VOICE_DEMO_ENABLE=true
set GEMINI_API_KEY=<Gemini key>
set GEMINI_MODEL=gemini-3.5-flash-lite
set GEMINI_TTS_MODEL=gemini-3.8-flash-tts
set GEMINI_TTS_VOICE=Kore
.venv-win\Scripts\python.exe scripts\interactive_voice_demo.py --enable
```

Benchmark live, tối thiểu 5 request cho mỗi nhóm:

```cmd
set AI_SERVER_GEMINI_BENCHMARK_ENABLE=true
.venv-win\Scripts\python.exe scripts\benchmark_gemini_voice.py --enable --runs 5
```

Smoke test riêng cho PCM streaming:

```cmd
set AI_SERVER_GEMINI_TTS_STREAM_TEST_ENABLE=true
.venv-win\Scripts\python.exe scripts\test_gemini_tts_stream_live.py --enable
```

Focused tests và regression:

```cmd
.venv-win\Scripts\python.exe -m pytest tests\test_interactive_voice_demo.py tests\test_gemini_tts.py tests\test_gemini_runtime.py -q
.venv-win\Scripts\python.exe -m pytest -q
```

Đặt API key trong environment hoặc file `.env` cục bộ; không đưa key vào source, command history hoặc log. Các script live yêu cầu opt-in riêng và chỉ chạy với `development-mock`; chế độ `integrated` vẫn fail-closed.

## File thay đổi

- `.env.example`, `AGENTS.md`
- `app/clients/gemini_llm.py`, `app/clients/gemini_tts.py`
- `app/clients/provider_factory.py`, `app/clients/tts_factory.py`
- `app/models/llm.py`
- `scripts/interactive_voice_demo.py`
- `scripts/benchmark_gemini_voice.py`, `scripts/test_gemini_tts_stream_live.py`
- `tests/test_gemini_runtime.py`, `tests/test_gemini_tts.py`, `tests/test_interactive_voice_demo.py`
- `docs/test-report-d2-s2-11c.md`
