# D2-S2-03 — OpenAI LLM Adapter

Ngày kiểm tra: 03/11/2026. macOS, Python 3.14.3. Phạm vi thay đổi chỉ AI_SERVER.

## 1. Đã làm

- `LLMAdapter` độc lập provider: typed request với transcript, system prompt,
  history snapshot, User/Session/Device/Turn identity và model config; output là
  delta + terminal result/usage. Có thể viết Gemini/Local adapter sau này mà
  không thay AudioInput/STT/Turn Detection.
- `OpenAILLMAdapter` dùng SDK chính thức `openai==3.42.1`, AsyncOpenAI Responses
  API và streaming SSE. Model/limits được truyền qua config; không gọi API thật.
- Cấu hình người dùng đã duyệt: **gpt-6-luna**, reasoning **none**, output token
  **256**, output code point **500**, concurrency **5**, streaming bật, tiếng Việt.
  Có validation và environment override; không gắn vào startup.
- `LLMRunner` dùng semaphore, reject overload ngay, không có hàng đợi/retry tự
  động. SDK có `max_retries=0`; request tạo stream đúng một lần mỗi attempt.
- Context riêng theo User/Session/Device, turn claim một lần. Chỉ chấp nhận STT
  final khi turn hiện tại PROCESSING; không nhận partial để gọi LLM sớm.
  Không claim turn mới khi conversation còn PROCESSING/SPEAKING.
- Chunk text theo thứ tự và ranh giới dấu câu, có index/tts_safe. Final result
  có text, complete/reason và usage nếu có. Không tích hợp TTS.
- Typed errors cho timeout, cancellation, overload, rate limit, provider error,
  invalid stream, empty response, context limit. Close stream/client và trả slot
  khi xong/lỗi/cancel. Disconnect được mô phỏng bằng close turn/context.
- MockLLMAdapter, offline demo, test unit và test SDK bằng HTTP transport giả.

Không viết lại foundation Task 02/02B, không đổi echo, không thêm robot endpoint,
không đọc DB, không bật Backend gate và không sửa Firmware/Frontend/Database.

Chưa làm: secret delivery, live OpenAI, auth/session runtime/Orchestrator wiring,
TTS hay giọng nói end-to-end. Không tự push Git.

## 2. Files

| File tạo/sửa trong Task 03 | Vai trò |
|---|---|
| `app/core/llm_config.py` | LLMSettings, config đã duyệt và validation |
| `app/models/llm.py` | Identity, request/message, usage, provider events, output, lỗi |
| `app/clients/openai_llm.py` | Official SDK adapter, Responses SSE, cleanup/no retry |
| `app/services/llm.py` | LLMAdapter, Conversation, SentenceOutput, LLMRunner/semaphore |
| `app/services/mock_llm.py` | Scripted provider, không inference/API |
| `scripts/llm_mock_demo.py` | Demo offline có thời gian nhận chunk/final |
| `tests/test_llm.py` | 45 test cases |
| `requirements.txt` | Thêm openai==3.42.1 |
| `README.md`, `AGENTS.md` | Hướng dẫn, bảng luồng foundation |
| `docs/test-report-d2-s2-03.md` | Báo cáo này |

File/report của Task 02/02B đã có trong working tree được giữ nguyên.

## 3. Luồng chạy và policy

Luồng caller/test hiện tại:

```text
TurnEnded -> input.finish -> STT drain/finalize -> STT final text
 -> LLMRunner (context deadline/cancel + semaphore)
 -> Conversation.claim(User/Session/Device/Turn, immutable history)
 -> OpenAILLMAdapter -> official Responses streaming
 -> ordered ProviderDelta -> SentenceOutput -> TextChunk(index, tts_safe)
 -> ProviderDone -> close remote stream/client
 -> complete result: commit history -> LLMResult(text, usage)
```

Demo dùng MockLLMAdapter thay cho OpenAI. App runtime chưa gọi đường này.

SDK gửi system prompt qua `instructions`, thêm yêu cầu trả lời tiếng Việt;
history user/assistant và transcript nằm trong `input`. Không gửi internal IDs
hoặc API key trong text. Không dùng previous_response_id hoặc provider-side
shared conversation, và đặt `store=False`. Key được truyền bắt buộc qua constructor
từ caller tin cậy; adapter không tự tìm key trong DB/environment. Endpoint SDK
cố định là OpenAI chính thức, không nhận OPENAI_BASE_URL từ môi trường.

### Context và half-duplex

Conversation chỉ chứa scope key bất biến và history của scope đó. Snapshot đưa
vào request là tuple bất biến. History chỉ commit khi response hoàn tất thành
công; lỗi/cancel/incomplete không lưu cặp hội thoại dở. Context key khác bị reject.
Turn ID đã attempt không được chạy lại tự động trong cùng conversation.

Caller phải giữ một Conversation cho mỗi authenticated scope, dùng chung một
LLMRunner trong một process và lấy identity từ auth tin cậy, không từ payload
robot. Đây chưa phải authentication/session registry hoặc distributed lock.
Orchestrator phải giữ conversation busy qua SPEAKING; chỉ `release(turn)` sau
khi turn đã CLOSED. `HalfDuplexTurn` cũ vẫn chặn mic; không tạo turn mới trong LLM.

Retention `max_turns` và `max_history_chars` là tham số bắt buộc, không có default
production được tự đoán. Budget đầy thì reject trước Provider, không auto trim.
Test/demo dùng budget giả được ghi ngay tại callsite. Việc chọn retention budget
production và context window/input-token policy vẫn cần duyệt trước wiring.

### Streaming, Unicode và incomplete

- `SentenceOutput` chờ dấu kết câu `. ! ? …` và whitespace tiếp theo; đuôi cuối
  được xử lý khi có terminal result. Có thể phát câu đầu trước final response.
- Không slice text tại vị trí 500 để ép đủ ký tự: chỉ giữ các đoạn hoàn chỉnh
  nằm trong budget; phần câu còn dở bị bỏ khi cap. Emoji ZWJ và combining marks
  trong test không bị xé do cắt giữa chuỗi. Limit tính Unicode code points,
  không phải byte hoặc grapheme count.
- `tts_safe=True` là dấu hiệu kết câu theo heuristic, không bảo đảm ngữ nghĩa.
  Đuôi không dấu của response completed có thể xuất text nhưng `tts_safe=False`;
  consumer TTS tương lai không được phát đoạn đó tự động.
- `response.incomplete` vì max_output_tokens -> reason `token_limit`,
  complete=False; chỉ giữ các câu đã đủ, bỏ đuôi dở, không commit history.
- App character cap -> đóng stream sớm, reason `output_limit`, complete=False.
  Usage có thể None vì chưa nhận terminal usage; không tự bịa token/cost.
- Khi đã phát câu trước rồi Provider lỗi, không thể thu hồi chữ/audio mà consumer
  đã dùng. Caller phải dừng output của turn lỗi; không retry gây phát trùng.
- SSE sequence_number giảm/trùng bị reject; không tự reorder hoặc phát lại.

Consumer phải dùng `contextlib.aclosing(runner.stream(...))` nếu có thể dừng sớm.
Disconnect phải cancel/close turn để AudioContext chung hủy request. Adapter
phải hợp tác với asyncio cancellation; code đồng bộ block loop hoặc consumer
giữ iterator không close không được đảm bảo cleanup tức thời.

Official OpenAI documentation được đọc và đối chiếu cùng SDK cài thực tế:
[Python SDK](https://developers.openai.com/api/reference/python),
[streaming events](https://developers.openai.com/api/docs/guides/streaming-responses),
[Responses create](https://developers.openai.com/api/reference/python/resources/responses/methods/create).
Trang [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna) xác nhận
model và reasoning none. Tài liệu/API support không chứng minh tài khoản đã có
quyền truy cập model; điều đó chưa được live test.

## 4. Hướng dẫn chạy/test macOS

Tạo/cài môi trường từ root repo (nếu chưa có venv):

```bash
cd AI_SERVER
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pip check
```

Config không chứa secret, có thể thay đổi qua environment:

```bash
export AI_SERVER_LLM_MODEL=gpt-6-luna
export AI_SERVER_LLM_REASONING_EFFORT=none
export AI_SERVER_LLM_MAX_OUTPUT_TOKENS=256
export AI_SERVER_LLM_MAX_OUTPUT_CHARS=500
export AI_SERVER_LLM_MAX_CONCURRENT_REQUESTS=5
export AI_SERVER_LLM_RESPONSE_LANGUAGE=vi
```

LLMSettings đọc environment, không tự nạp `.env` như Settings của server cũ.
Thiếu các override thì dùng cấu hình ban đầu người dùng đã duyệt ở mục 1.
Giá trị sai bị validation error; integer không chấp nhận bool/float/âm/0.
Không ghi hoặc paste key vào source, command line, report hay log. Không dùng
credential reference Backend làm API key. Chỉ thêm wiring secret sau contract
được duyệt và credential được cấp hợp lệ; live test hiện BLOCKED.

Demo và test offline:

```bash
.venv/bin/python scripts/llm_mock_demo.py
.venv/bin/python -m pytest tests/test_llm.py -q
.venv/bin/python -m pytest tests -q --tb=short
```

Khởi động server như trước (terminal khác để gọi health/echo):

```bash
.venv/bin/python scripts/run_dev.py
```

```bash
curl -i http://127.0.0.1:8000/health
.venv/bin/python scripts/ws_client.py --message 'Xin chào AIVA'
```

Các lệnh startup/health/echo được regression suite chạy bằng TCP loopback thật.
Server startup không tự gọi LLM; không có route LLM/robot mới để demo qua mạng.

## 5. Demo thực tế đã chạy — MOCK ONLY

Lệnh đã thực thi từ AI_SERVER:

```bash
/private/tmp/aiva-stt-task02-venv/bin/python scripts/llm_mock_demo.py
```

Output quan sát được:

```text
MOCK ONLY; STT input: Chào AIVA.
0.31s chunk[0] tts_safe=True: 'Xin chào.'
0.62s chunk[1] tts_safe=True: ' Mình có thể giúp gì cho bạn?'
0.62s final complete=True: 'Xin chào. Mình có thể giúp gì cho bạn?'; usage=MOCK Usage(input_tokens=12, output_tokens=15, total_tokens=27)
```

Transcript và câu trả lời được script cố định, không có STT hoặc OpenAI inference.
Delay được mock tạo; số token cũng giả, không phải billing hay latency OpenAI.
Để kiểm tra streaming, nhìn chunk index tăng dần và chunk đầu tới trước final.
Test `test_streaming_order_before_final_and_history_commit` cũng đọc từng chunk
trước final và kiểm tra history chưa commit giữa stream.

## 6. Tests đã chạy

Môi trường thực thi: Python 3.14.3, venv tạm từ Task 02,
openai 3.42.1 + httpx2 2.16.0. Không có API key thật hoặc lời gọi live OpenAI.
Các lệnh dưới chạy từ AI_SERVER:

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `/private/tmp/aiva-stt-task02-venv/bin/python -m pytest tests/test_llm.py -q --tb=short` | PASS: 45 passed |
| `/private/tmp/aiva-stt-task02-venv/bin/python -m pytest tests -q --tb=short` | FAIL: 235 passed, 1 failed |
| `/private/tmp/aiva-stt-task02-venv/bin/python scripts/llm_mock_demo.py` | PASS: output mock ở mục 5 |
| `/private/tmp/aiva-stt-task02-venv/bin/python -m pip check` | PASS: No broken requirements found |
| `git diff --check` | PASS |
| Live OpenAI | BLOCKED: chưa có secret delivery/credential hợp lệ |
| TTS, robot Cloud Voice end-to-end | NOT RUN, ngoài scope |

Full suite chạy ngoài sandbox để bind TCP loopback. Tất cả test echo,
AudioInput/STT/Turn Detection và LLM mới đều PASS. FAIL duy nhất là lỗi cũ:
`test_firmware_snapshot_hashes_match_workspace_sources` không tìm thấy
`xiaozhi-esp32/managed_components/78__esp-ml307/idf_component.yml`.
Hai file dependency khác trong snapshot cũng thiếu như các report trước.
Không sửa/skip test hoặc dựng dependency ngoài scope; **không tuyên bố full suite PASS**.

Lần chạy LLM ban đầu có 1 timeout trong fixture request bình thường khi SDK
khởi tạo schema lần đầu với deadline 2 giây. Đã nâng budget fixture bình thường
lên 10 giây; các test timeout riêng vẫn dùng deadline ngắn và đều PASS.

Nhóm kiểm tra:

- Mock streaming đúng thứ tự, chunk đến trước final, optional usage.
- Bốn scope User/Session/Device tách biệt; turn tiếp theo nhận đúng history.
- Validation config/environment; history/turn budget reject trước Provider.
- Năm request thực sự giữ slot cùng lúc; request thứ sáu overload; cancel trả
  slot để request mới chạy, active không vượt 5; không có waiting queue.
- Timeout/cancel/disconnect/task cancellation, early close và không orphan task.
- Duplicate request, SPEAKING/PROCESSING busy; không gọi lại Provider sau lỗi.
- Empty response, invalid/late stream events, failure, character/token limits.
- Emoji ZWJ/combining marks không bị cắt dở để đạt cap; unfinished tail không
  phát thành tts_safe hoặc commit vào history.
- SDK AsyncOpenAI thật + httpx2.MockTransport/SSE giả: đúng request parameters,
  429/401/500/503 không retry; rate-limit/API error được chuẩn hóa.
- HTTP stream/client đóng khi xong, timeout, disconnect, char cap, refusal/error
  và SSE sequence sai; key/payload không lộ qua error string hoặc DEBUG log test.

SDK mock PASS chỉ xác minh adapter/serialization/stream lifecycle ở local,
**không phải live model/access/billing/quality PASS**.

## 7. Chưa hoàn thành và bước tiếp theo

1. Backend secret delivery còn chưa có: resolve-config chỉ trả reference. Cần
   duyệt kênh cấp key, scope USER/SYSTEM, rotation/revocation và credential thật.
   Không nối trực tiếp DB hoặc bypass gate để chạy live test.
2. Sau khi có credential hợp lệ, chạy live smoke có giới hạn theo cấu hình đã
   duyệt, kiểm tra model access/none, tiếng Việt, actual usage, stream/cancel và
   cleanup. Chỉ ghi live PASS khi thực sự thành công. Không có live CLI ở task này.
3. Cần Orchestrator/authenticated session registry giữ một Conversation mỗi
   scope, một LLMRunner dùng chung mỗi process, nối STT final và disconnect.
   Semaphore 5 không phải quota toàn cluster; nhiều worker cần budget/phối hợp
   được duyệt. In-memory turn dedupe không đảm bảo exactly-once qua restart.
4. Duyệt retention/input-context budgets và policy token hóa/trimming trước
   production. Hiện constructor bắt buộc budget rõ ràng, test/demo dùng giá trị
   giả; không âm thầm áp retention production mới.
5. Nối Backend config/quota/usage reporting sau khi contract được duyệt. Usage
   khi cancel sớm có thể không có, cần accounting policy thay vì giả token.
6. TTS tương lai chỉ nhận đoạn được phép; sentence punctuation heuristic cần
   đánh giá thêm với viết tắt/số thập phân/câu tiếng Việt. Task này không phát âm
   hoặc chứng minh semantic sentence completion/latency thoại thật.
7. Khôi phục snapshot firmware dependency trong phạm vi được phép rồi chạy lại
   full suite. Đạt unit/echo DoD; nghiệm thu toàn suite và live còn BLOCKED.
