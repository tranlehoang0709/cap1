# AIVA-IoT AI Server — D2-S1-01 đến D2-S1-07

Current LAN bootstrap/control work: [D2-S2-14 setup, commands and acceptance](docs/d2-s2-14-lan.md).
Integrated Gemini execution: [D2-S2-15 contract, tests and deployment blockers](../BE/docs/d2-s2-15-live-gemini.md).
Secure LAN gateway status and TLS setup: [D2-S2-19](docs/d2-s2-19-secure-wifi-gateway.md).
The historical foundation notes below do not imply integrated media readiness.

Server độc lập bằng Python/FastAPI: cấu hình, vòng đời, `GET /health`
và WebSocket echo Development. Health xác nhận ứng dụng đang chạy;
không kiểm tra MySQL, Backend, thiết bị hoặc AI provider.

Chưa tích hợp giao thức robot, device authentication, session, heartbeat,
STT/LLM/TTS hoặc API AI vào ứng dụng. Sprint 2 Task 02 bổ sung foundation
Audio Input/STT độc lập, chỉ được gọi trong test; xem mục bên dưới.
Log ứng dụng hiện chỉ hỗ trợ sự kiện vòng đời và
WebSocket Development; không coi đó là log/auth/session/heartbeat đầy đủ cho robot.

## Sprint 2 Task 02 — Audio Input & STT foundation

Không thêm robot endpoint hoặc provider thật. `/ws/dev-echo` giữ nguyên.

- `app/models/audio.py`: metadata không có default codec/rate, frame bất biến,
  partial/final transcript và lỗi typed với thông điệp cố định.
- `app/protocol/audio_framing.py`: `FramingConfig(version, max_payload_bytes)`
  bắt buộc chọn version; `validate_audio_frame()` nhận một binary message đã
  ghép fragment. V1 payload trực tiếp; v2 header network-order 16 byte;
  v3 header network-order 4 byte. Chỉ nhận audio type 0/reserved 0 như firmware
  đang gửi; kiểm tra size chính xác và giới hạn trước khi tách payload.
  Đây là policy foundation bám source, chưa phải protocol approval.
- `app/services/audio_input.py`: interface `AudioInput` và `BoundedAudioInput`,
  giới hạn cả số frame lẫn byte payload; overflow bị từ chối, không âm thầm drop.
  Metadata của một input cố định, mỗi instance dành riêng một turn/single consumer.
  `finish()` cho drain rồi EOF; `aclose()`/cancel xóa buffer ngay.
- `app/services/audio_context.py`: `AudioContext` dùng absolute monotonic deadline
  và cancellation event, không reset deadline giữa partials; đóng input khi thao tác
  phát hiện hết hạn. Context/input dùng cùng event loop, không thread-safe.
- `app/services/stt.py`: `STTAdapter`, `stream_transcription()` (optional partials,
  đúng một final), `transcribe()` (chỉ lấy final); cleanup trong `finally`.
  Khi consumer dừng sớm, dùng `contextlib.aclosing(stream_transcription(...))`.
  Adapter phải hợp tác với asyncio cancellation, cleanup không được block vô hạn.

Buffer/framing không decode Opus, không chuyển PCM/resample và không xác minh
bitstream codec. Audio metadata do caller cung cấp, không suy từ wire bytes.
Caller tương lai phải ràng buộc metadata với hello/profile đã duyệt và áp
transport message limit trước khi nhận toàn bộ message. Không truyền PCM cho STT
trừ khi format/conversion của adapter được xác nhận.

`tests/test_audio_foundation.py` chứa mock STT trả text cố định và fixture envelope
nhị phân tổng hợp, **không phải nhận dạng giọng nói thật hoặc audio Opus được decode**.
Không có mock/provider nào được gắn vào runtime app. Lệnh test từ `AI_SERVER/`:

```bash
python -m pytest tests/test_audio_foundation.py -q
python -m pytest tests -q --tb=short
```

Xem [báo cáo Task 02](docs/test-report-d2-s2-02.md) về kết quả thực thi,
snapshot dependency thiếu và các quyết định chờ duyệt trước STT thật.

## Sprint 2 Task 02B — Turn Detection foundation

`app/services/turn_detection.py` nhận speech activity và partial/final transcript,
trả `WAIT`, `END` hoặc `UNCERTAIN`. `TurnDetector` không nhận audio bytes và không
chạy VAD/STT. `TextRules` nhận danh sách dấu kết câu/từ đuôi do caller cấp; đây là
heuristic thử nghiệm, không phải mô hình hiểu câu tiếng Việt. Thiếu bằng chứng
ngôn ngữ thì không END dù có final transcript hoặc im lặng dài.

`app/services/turn_input.py` cung cấp bridge một turn `HalfDuplexTurn`: khi END,
gọi `BoundedAudioInput.finish()` rồi emit một `TurnEnded` cho sink Orchestrator
được inject. PROCESSING/SPEAKING/CLOSED drop mic trước VAD và input.feed, không
có replay buffer hoặc tự mở turn mới. Chưa có Orchestrator/robot endpoint thật.

Người dùng duyệt **thử nghiệm**: silence 700 ms, stability 300 ms, max duration
15000 ms; không phải thông số Xiaozhi chính thức. Không có default startup.
Để caller thử nghiệm nạp `TurnDetectionConfig.from_env()`, cần đủ ba biến:

```bash
export AI_SERVER_TURN_MIN_SILENCE_MS=700
export AI_SERVER_TURN_TRANSCRIPT_STABILITY_MS=300
export AI_SERVER_TURN_MAX_DURATION_MS=15000
```

Chỉ export không bật detector trong ứng dụng. Tăng silence lên 1000 ms là biến
thể thử nghiệm khi có cắt lời; chưa có dữ liệu robot để quyết định thay cấu hình.
Config không đầy đủ/sai bị từ chối, không fallback. Luật ngôn ngữ phải inject rõ.

Caller cung cấp monotonic `at_ms` và tick định kỳ khi im lặng; khi cùng timestamp,
cập nhật VAD trước khi tick/ra quyết định. Không dùng timestamp wire thay trực tiếp
cho clock này. Khi tới 15000 ms, policy là UNCERTAIN + `TurnTimedOut`, hủy input
và context, không END/gọi LLM/tự mở turn mới, kể cả mic đang có speech.
Deadline `AudioContext` hết trước thì giữ typed error/cancellation của Task 02.

Lệnh test từ `AI_SERVER/`:

```bash
python -m pytest tests/test_turn_detection.py tests/test_audio_foundation.py -q
python -m pytest tests/test_turn_detection.py::test_synthetic_endpoint_metrics -q -s
python -m pytest tests -q --tb=short
```

Xem [báo cáo tiếng Việt Task 02B](docs/test-report-d2-s2-02b.md): test chỉ dùng
mock speech events, chưa đo tỷ lệ cắt câu/latency trên mic, decoder hoặc VAD thật.

## Sprint 2 Task 03 — OpenAI LLM adapter

Foundation độc lập, chưa gắn vào robot endpoint/app startup. `LLMAdapter` dùng
typed request/delta/done; `OpenAILLMAdapter` dùng SDK OpenAI chính thức Responses
SSE, `store=False`, `max_retries=0`. API key là tham số bắt buộc từ caller tin cậy;
không tự đọc DB, credential reference hoặc secret từ `.env`. Không có live CLI
để bypass secret delivery contract đang chờ duyệt.

Cấu hình ban đầu được người dùng duyệt; `LLMSettings` đọc environment, có
validation, không chứa key và không tự bật OpenAI khi server startup:

```bash
export AI_SERVER_LLM_MODEL=gpt-6-luna
export AI_SERVER_LLM_REASONING_EFFORT=none
export AI_SERVER_LLM_MAX_OUTPUT_TOKENS=256
export AI_SERVER_LLM_MAX_OUTPUT_CHARS=500
export AI_SERVER_LLM_MAX_CONCURRENT_REQUESTS=5
export AI_SERVER_LLM_RESPONSE_LANGUAGE=vi
```

`LLMRunner` dùng semaphore, fail-fast khi hết slot (không queue/retry), giới hạn
theo một runner dùng chung trong một process. `Conversation` riêng theo
User/Session/Device, snapshot history bất biến; caller phải truyền retention
budgets `max_turns`/`max_history_chars` rõ ràng, chưa có default production được
duyệt. Không auto trim history. Khi session PROCESSING/SPEAKING, không claim turn
mới hoặc retry cùng turn; phải close turn rồi release conversation rõ ràng.

Text chunks được buffer tới ranh giới dấu câu, giữ thứ tự; đây là heuristic,
chưa phải parser ngữ nghĩa. `tts_safe=True` chỉ cho đoạn có dấu kết câu; đuôi
không dấu của response hoàn tất có `tts_safe=False`. Khi tới character/token
limit, bỏ đuôi chưa hoàn chỉnh, trả final `complete=False`, không commit history.
Character limit tính code point Unicode, không slice giữa word/grapheme để ép
đủ 500. Usage có thể là `None` nếu stream bị đóng trước khi Provider báo số liệu.

Từ `AI_SERVER/`, sau khi cài `requirements-dev.txt`:

```bash
.venv/bin/python scripts/llm_mock_demo.py
.venv/bin/python -m pytest tests/test_llm.py -q
.venv/bin/python -m pytest tests -q --tb=short
.venv/bin/python scripts/run_dev.py
```

Server vẫn chỉ phục vụ các endpoint cũ; start server không gọi LLM. Demo là text
scripted + usage giả, không phải OpenAI inference. Khi consumer dừng streaming
sớm, dùng `contextlib.aclosing(runner.stream(...))`; disconnect phải close/cancel
turn để context chung hủy request. Adapter phải hợp tác asyncio cancellation.

Xem [báo cáo Task 03](docs/test-report-d2-s2-03.md) về test SDK với HTTP mock,
kết quả regression, cách xem streaming và blockers trước live API.

## Sprint 2 Task 04 — TTS & playback foundation

Chưa chọn Cloud TTS provider/model/voice/audio profile; người dùng duyệt chỉ
interface + mock. `TTSAdapter` stream audio có metadata và định dạng dữ liệu;
`AudioConverter`/`AudioOutput` là interface cho conversion/output được duyệt sau.
Không có Opus converter hoặc robot transport mới, không tự gọi Cloud.

`PlaybackScheduler` nhận các `TextChunk.tts_safe` đã chia câu ở Task 03, kiểm tra
index/final để tránh lặp/thiếu đoạn. Một synthesis stream và một output consumer
chạy đồng thời; tổng hợp tuần tự, phát tuần tự. Queue giới hạn cả byte/chunk,
đầy thì backpressure tới producer. Caller bắt buộc truyền TTSConfig/PlaybackLimits,
không có profile hoặc queue limit production mặc định.

Khi có audio đầu, chuyển turn sang SPEAKING; mic bị chặn bởi HalfDuplexTurn cũ.
Stream LLM đã chạy được phép tiếp tục cho cùng turn trong SPEAKING; claim request
LLM mới vẫn bị chặn. Gửi hết audio/`finish()` không có nghĩa playback hoàn tất.
Scheduler đợi bằng chứng riêng, ràng buộc User/Session/Device/Turn/generation.
Hiện chỉ chấp nhận proof `mock-only`; `tts.stop`/queue drain/send success không
được chấp nhận làm ACK. Robot ACK contract chưa có nên robot playback BLOCKED.

Sau proof hợp lệ, đóng turn cũ và trả receipt cho phép Orchestrator tạo turn
LISTENING mới; không reset detector cũ hoặc tự tạo turn. Nếu timeout/cancel/lỗi,
clear queue, hủy context/output, giữ scheduler blocked; không dùng hết timeout
làm bằng chứng playback xong. Recovery/drain policy thật còn chờ duyệt.

Từ AI_SERVER, trong venv đã cài requirements-dev:

```bash
.venv/bin/python scripts/tts_mock_demo.py
.venv/bin/python -m pytest tests/test_tts.py tests/test_llm.py -q
.venv/bin/python -m pytest tests -q --tb=short
```

Demo tạo `.test-artifacts/tts-mock-demo.wav`: tone tổng hợp PCM 8 kHz/mono/s16le,
chỉ là audio fixture, không phải production format hoặc firmware PCM wire.
MockAudioOutput không phát loa; xác nhận playback là thao tác mock riêng trong
demo. Xem [báo cáo Task 04](docs/test-report-d2-s2-04.md) về cấu hình fixture,
queue bounds, trạng thái test và các blocker Cloud/codec/ACK/robot.

## D2-S2-API — Backend integration foundation

Chỉ thay đổi AI_SERVER; Backend/Firmware chỉ được đọc để đối chiếu. Không thêm
robot WebSocket path, không bật contract gates và không tự chọn MAC mapping.

- `app/clients/backend.py`: async HTTPX client dùng chung connection pool, timeout
  tổng, concurrency/response-size bounds, TLS verification, không redirect/proxy
  theo environment và không retry. HTTP local chỉ cho loopback khi caller opt-in.
- `app/models/backend.py`: request/response typed theo DTO/service thực tế; BIGINT
  IDs là string, credential là SecretStr, reject extra fields/duplicate JSON keys.
- `app/services/device_auth.py`: Backend allow mới tạo AuthorizedSession; bind
  deviceId/ownerUserId từ response vào key nội bộ mới. Không dùng wire session ID.
  Session facade chặn start/mic sau invalidate; bind Orchestrator theo đúng key.
- `app/services/backend_execution.py`: mock-only quota wrapper chạy admission trước
  delegate, no replay execution; UsageReporter coalesce report giống nhau, reject
  conflict. Unknown actual usage giữ pending, không tự báo 0. State này bounded
  nhưng chỉ trong RAM, chưa phải durable report outbox.

Client hỗ trợ POST authorize/heartbeat/resolve-config/authorize-request/usage theo
BE/API_CONTRACT.md và source. Reset/conversation/Cloud secret chưa được nối vì
không có firmware proof, conversation API hoặc secret delivery contract phù hợp.
Config/voice/model được trả về typed; mock binding kiểm tra đúng model/prompt,
không tự fallback provider/key. Gate false/network/response lỗi -> fail closed.

Lệnh từ AI_SERVER (venv đã cài requirements-dev):

```bash
.venv/bin/python -m pytest tests/test_backend_client.py -q --tb=short
.venv/bin/python -m pytest tests -q --tb=short
```

Test Backend dùng HTTPX MockTransport và HTTP server giả qua TCP loopback thật,
không gọi BE/Nest/MySQL/Cloud thật. App startup vẫn giữ các endpoint cũ và không
tự tạo client/đọc service token. Caller phải truyền service tokens riêng, budgets
và base origin rõ ràng; không đặt secret literal vào source/command line/log.

Xem [báo cáo API integration](docs/test-report-d2-s2-api.md) về bảng contract,
runbook macOS và các blocker để kết nối firmware thật.

## Hồ sơ phần cứng theo sơ đồ

AI Server giữ catalog profile riêng theo `profile_id`, để bổ sung nhiều sơ đồ
thiết bị mà không biến một board thành cấu hình mặc định cho mọi robot. Mục đầu
`D1S1-01` là `esp32-s3-wroom-1`; xem [catalog](app/devices/catalog.py) và API
`GET /device-profiles` hoặc `GET /device-profiles/esp32-s3-wroom-1`. Catalog chỉ
cung cấp metadata board, không thay đổi luồng `/health` hay WebSocket echo.
Profile hiện cũng có mục D1S1-02 cho ST7789: SPI mode 3, 10 MHz, GPIO42/41/2/1/17,
240×240 và invert color. Đồng bộ AI được ghi `not_tested`.
Mục D1S1-03 bổ sung microphone I2S trên GPIO4/5/6, 16 kHz, 32-bit,
`I2S_NUM_1`. Model và nguồn mic vẫn `pending`; khử tiếng ồn là `not_tested`.
Mục D1S1-04 bổ sung loa NS4168 trên GPIO7/15/16, 24 kHz, 32-bit,
`I2S_NUM_0`, gain x4. Chân CTRL/Enable và nguồn chưa xác định (`pending`);
chống hú là `not_tested`.
Mục D1S1-05 ghi loopback mic 16 kHz → loa 24 kHz, buffer 160000 byte trong
PSRAM, thời lượng thu 5 giây. Thu/phát liên tục và full duplex là `not_tested`;
profile chỉ mô tả sơ đồ, không giải mã hay truyền audio trên AI Server.
Mục D1S1-06 ghi flash 16 MB, PSRAM OPI 8 MB (`qio_opi`), cấu hình
`BOARD_HAS_PSRAM` bật và dung lượng 8388608 byte. Stress test là `not_tested`.
Mục D1S1-07 ghi USB-C, COM3, 115200 baud, USB CDC bật và USB mode 1. Serial
print/input, lệnh `r`, build và upload là `reported_pass` theo sơ đồ đầu vào.
Mục D1S1-08 ghi BOOT vật lý tại GPIO0, nhưng chưa xác minh trên PCB và chưa test
input. Nút POWER có mặt nhưng GPIO và chức năng vẫn `pending`.

Giá trị `COM3` được ghi rõ là quan sát trên máy Development, không phải cổng cố
định của board. Trạng thái `reported_pass` phản ánh sơ đồ người dùng cung cấp;
AI Server chưa kiểm tra trực tiếp phần cứng (`server_hardware_tested=false`).
Khi thêm sơ đồ mới, thêm entry profile mới và test tương ứng; không ghi đè profile
đã có.

Profile `esp32-s3-n16r8-tft-240x320` mô tả sơ đồ **SD2** ESP32-S3 N16R8 riêng: INMP441
trên GPIO4/5/6, MAX98357A trên GPIO7/15/16 và ST7789 240×320 trên
GPIO21/40/41/42/45/47. Mic loopback trước đó là `reported_pass`; MAX98357A,
TFT, cảm ứng và microSD là `not_tested`. Mode/tốc độ SPI, invert color, VIN thật
của MAX98357A và cấu hình I2S output là `pending`. Với wiring SD2 đã xác nhận,
INMP441 L/R nối GND, MAX98357A SD/VIN nối 3V3 và GAIN nối GND. Bring-up hiện
được báo cáo là màn tối và chưa có audio output; đây chưa phải kết quả test pass.

## Cấu hình đã xác nhận

| Biến | Giá trị Development | Kiểm tra |
| --- | --- | --- |
| `AI_SERVER_HOST` | `127.0.0.1` | Địa chỉ IPv4/IPv6 hoặc hostname DNS, không chứa URL/port |
| `AI_SERVER_PORT` | `8000` | Số nguyên 1–65535 |
| `AI_SERVER_LOG_LEVEL` | `warning` | `critical`, `error`, `warning`, `info`, `debug`, `trace` |
| `AI_SERVER_RELOAD` | `true` | Boolean, khuyến nghị `true`/`false` |
| `AI_SERVER_WS_MAX_MESSAGE_BYTES` | `4096` | Số nguyên 1–4096 byte/message; có thể giảm giới hạn |

Biến môi trường của tiến trình ưu tiên hơn `.env` ở root `AI_SERVER`.
Đường dẫn `.env` cố định theo source, không phụ thuộc thư mục terminal.
Settings được cache trong mỗi tiến trình. Sau khi sửa `.env`, dừng rồi chạy
lại server; auto-reload theo dõi code Python trong `app/`, không theo dõi `.env`.
Không cần API key, Device Token, model AI hoặc database.

## macOS — cài từ môi trường sạch

Dùng Python 3.14; phiên bản thực tế và dependency đã kiểm tra được ghi trong
`docs/test-report-d2-s1.md`. Không cài package global.

```bash
cd /Users/mac/Downloads/cap1-main/AI_SERVER
python3 --version
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
```

Nếu chưa có `.env`, tạo từ mẫu bằng lệnh dưới. Lệnh không ghi đè file sẵn có:

```bash
test -f .env || cp .env.example .env
```

Chạy Development:

```bash
.venv/bin/python scripts/run_dev.py
```

Terminal khác kiểm tra:

```bash
curl -i http://127.0.0.1:8000/health
```

Kết quả HTTP 200, body JSON chính xác `{"status":"ok"}`.
Nhấn **Ctrl+C** trong terminal chạy server để dừng; đợi dòng
`AI Server shutdown` rồi chạy lại cùng lệnh trên, cùng port.

Đổi cấu hình tạm bằng môi trường (không sửa `.env`):

```bash
AI_SERVER_HOST=localhost AI_SERVER_PORT=8001 AI_SERVER_RELOAD=false .venv/bin/python scripts/run_dev.py
```

Địa chỉ kiểm tra lúc này là `http://localhost:8001/health`. Lệnh entrypoint
đọc settings và truyền vào `uvicorn.run()`, gồm cả giới hạn WebSocket. Chạy trực tiếp
`uvicorn app.main:app` sẽ không tự áp dụng host/port/reload từ Settings,
vì vậy hãy dùng `scripts/run_dev.py`.

## WebSocket Development — hai Terminal trên macOS

Endpoint đã xác nhận: **`ws://127.0.0.1:8000/ws/dev-echo`**.
Chỉ nhận peer loopback; không xác thực thiết bị và chưa cho robot sử dụng.
Handshake HTTP Upgrade chuẩn, trả 101; không cần custom header, token,
Origin hoặc subprotocol. Server không chọn subprotocol và không tự gửi `hello`.
Đây là echo transport thử nghiệm, **chưa xác nhận tương thích Xiaozhi**.

Nếu đã cài task 01, cài lại requirements để bổ sung `websockets==17.3` vào
`.venv`. Thư viện thuộc runtime vì Uvicorn dùng nó để xử lý WebSocket;
client thử nghiệm dùng cùng thư viện, không cần cài global.

Terminal 1:

```bash
cd /Users/mac/Downloads/cap1-main/AI_SERVER
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/run_dev.py
```

Terminal 2:

```bash
cd /Users/mac/Downloads/cap1-main/AI_SERVER
.venv/bin/python scripts/ws_client.py --message 'Xin chào AIVA 🤖'
curl -i http://127.0.0.1:8000/health
```

Client gửi một message text, nhận echo, so sánh chính xác rồi đóng 1000.
Output thành công có `Handshake OK`, `Echo OK` và
`Connection closed cleanly (1000)`. Không in nội dung payload/header.
Client có timeout mặc định 5 giây cho connect/send/receive/close và giới hạn
tổng thời gian, không tự reconnect; `--timeout 2` thay timeout thử nghiệm.
Proxy tự động, compression và keepalive ping được tắt ở client; server cũng
tắt compression và ping định kỳ. Chưa làm heartbeat ứng dụng.

Chạy client cho port khác bằng `--url ws://localhost:8001/ws/dev-echo`.
Client chỉ chấp nhận URL `ws://` loopback, đúng path, không chứa credentials,
query hoặc fragment. Ctrl+C ở Terminal 1 dừng server.

Hợp đồng message:

| Message / tình huống | Hành vi |
| --- | --- |
| Text UTF-8 không rỗng, tối đa 4096 byte | Echo nguyên văn cùng kiểu text; không parse JSON |
| Text UTF-8 phân mảnh hợp lệ | Ghép thành message rồi echo; giới hạn tính tổng byte |
| Binary trong giới hạn | Close `1003` |
| Text rỗng | Close `1008` |
| Text có UTF-8 lỗi ở tầng transport | Close `1007` |
| Message vượt giới hạn byte đã cấu hình | Close `1009` ở tầng transport; ưu tiên trước kiểm tra kiểu |
| Lỗi nội bộ khi socket còn mở | Thử close `1011`, log thông điệp cố định |
| Client close bình thường | Không gửi thêm message; kết thúc handler |
| Mất TCP / gửi lỗi do disconnect | Cleanup handler; không gửi thêm data; peer có thể thấy `1006` |
| Peer không phải loopback hoặc sai endpoint | Từ chối handshake HTTP `403` |

4096 là byte payload UTF-8 sau ghép fragment, không phải số ký tự;
`🤖` chiếm 4 byte. Giới hạn có thể giảm bằng
`AI_SERVER_WS_MAX_MESSAGE_BYTES`, không được vượt 4096 trong hợp đồng này.
Giới hạn được truyền vào Uvicorn `websockets-sansio`, kiểm tra thêm trong
handler; không chỉ dựa vào giới hạn của client. `proxy_headers=False` để
header Forwarded/X-Forwarded-For không thay địa chỉ peer dùng cho kiểm tra local.

Thử lỗi có chủ đích; hai lệnh dưới phải thoát code 1 và in mã đóng:

```bash
.venv/bin/python scripts/ws_client.py --message ''
.venv/bin/python scripts/ws_client.py --binary
```

Đọc [giao thức dự thảo](docs/protocol.md) và
[báo cáo task 02](docs/test-report-d2-s1-02.md) để xem căn cứ firmware,
kết quả TCP thực tế, DoD và các điểm chờ Dev 3. Schema runtime robot chưa được
triển khai vì hợp đồng firmware vẫn chờ Dev 3 xác nhận. Kiểm tra snapshot và cú
pháp ví dụ tài liệu bằng lệnh:

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_protocol.py -v
```

## Windows — PowerShell

Cài sẵn Python 3.14, chạy từ thư mục `AI_SERVER` trong bản checkout Windows:

```powershell
py -3.14 --version
py -3.14 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe scripts\run_dev.py
```

Terminal PowerShell khác:

```powershell
curl.exe -i http://127.0.0.1:8000/health
.\.venv\Scripts\python.exe scripts\ws_client.py --message 'Hello AIVA'
```

Đổi cấu hình tạm, sau đó chạy lại entrypoint:

```powershell
$env:AI_SERVER_HOST = '127.0.0.1'
$env:AI_SERVER_PORT = '8001'
$env:AI_SERVER_RELOAD = 'false'
.\.venv\Scripts\python.exe scripts\run_dev.py
```

Ctrl+C dừng server. Dùng `Remove-Item Env:AI_SERVER_PORT` (tương tự các biến
khác) để bỏ override và đọc lại `.env` ở lần chạy sau. Windows chưa được chạy
thử trong phiên triển khai này; các lệnh trên là hướng dẫn, không phải bằng
chứng đã kiểm tra Windows.

## Kiểm thử

macOS:

```bash
.venv/bin/python -m pytest tests/test_health.py tests/test_config.py tests/test_websocket.py --basetemp=.test-artifacts/pytest-task02 -v
.venv/bin/python -m pytest tests/test_logging.py tests/test_health.py tests/test_websocket.py -v
.venv/bin/python -m pip check
```

Windows:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_health.py tests/test_config.py tests/test_websocket.py --basetemp=.test-artifacts/pytest-task02 -v
.\.venv\Scripts\python.exe -m pytest tests/test_logging.py tests/test_health.py tests/test_websocket.py -v
.\.venv\Scripts\python.exe -m pip check
```

### Kiểm thử tích hợp D2-S1-08 trên macOS

Chạy sau khi Dev 1/Dev 3 cung cấp protocol/client đã xác nhận, backend hoặc mock
được duyệt, test credentials an toàn và concurrency target. Không đặt token literal
trong source, command line hoặc report; cung cấp bằng secret store của môi trường.

```bash
cd /Users/mac/Downloads/cap1-main/AI_SERVER
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests/test_health.py tests/test_config.py tests/test_websocket.py tests/test_device_auth.py tests/test_sessions.py tests/test_heartbeat.py tests/test_logging.py tests/integration/test_realtime.py -v
```

`/ws/dev-echo` chỉ kiểm tra local transport. Nó không xác thực robot và không thể
được dùng làm bằng chứng auth/session/heartbeat hoặc tương thích firmware. Xem
[ma trận task 08](docs/test-report-d2-s1.md#d2-s1-08--kiểm-thử-kết-nối-realtime-tích-hợp)
để biết những case chưa thể chạy.

Test cô lập `.env` cá nhân và các biến `AI_SERVER_*` của shell. Bao gồm
health, startup/shutdown, host/port hợp lệ và sai, log level/reload,
ưu tiên môi trường hơn `.env`, lỗi an toàn và tham số entrypoint.
Tests bao gồm JSON logging, redaction và WebSocket Development.
`tests/test_websocket.py` có test ASGI và test mạng TCP thật. Test TCP khởi
động `run_dev.py` ở port loopback tạm, timeout hữu hạn, dừng tiến trình khi
kết thúc. Cần môi trường cho phép bind socket loopback. Không thay thế các
test này bằng TestClient rồi coi là đã kiểm tra transport.

## Vòng đời và lỗi

`lifespan()` ghi startup trước khi phục vụ và shutdown khi thoát. Không có
tài nguyên database hoặc client AI cần cleanup. Application logger ghi JSON
console-only; event WebSocket bình thường ở INFO, còn cảnh báo/lỗi ở mức tương
ứng. Mức cấu hình mặc định `warning` vẫn hiển thị startup/shutdown. Log Uvicorn
vẫn theo đúng `AI_SERVER_LOG_LEVEL`.
Uvicorn 0.54.0 ghi ERROR và traceback cho UTF-8 sai đã được xử lý ở tầng
transport, sau đó đóng `1007`. Đây là lỗi input có chủ đích trong test;
không phải exception thoát khỏi handler và không làm dừng server.

Cấu hình sai: entrypoint thoát code 2, báo tên biến và điều kiện hợp lệ,
không in input, settings hoặc traceback. Hostname hợp lệ về cú pháp nhưng
không tồn tại trên máy/mạng, port đang bị chiếm hoặc địa chỉ không thể bind
sẽ bị hệ điều hành/Uvicorn từ chối lúc khởi động. Giải phóng port hoặc chọn
host/port hợp lệ rồi chạy lại; không tự dừng tiến trình khác.

## Logging Development

Ứng dụng ghi **console-only**; không tạo file log, rotation, retention hay audit log.
Mỗi dòng ứng dụng là JSON với `timestamp` UTC, `level`, `event`, `message` và
reference an toàn như `connection_id` nếu có. Kết nối WebSocket Development có ID
ngẫu nhiên để ghép các dòng connect/disconnect; session/device reference được hash,
không phải danh tính thiết bị.
Đặt `AI_SERVER_LOG_LEVEL=info` để xem kết nối và ngắt kết nối bình thường; mức mặc
định `warning` chỉ hiện startup/shutdown và cảnh báo/lỗi. Lỗi bất ngờ có traceback
stack nội bộ, nhưng nội dung exception bị ẩn để tránh lộ payload.

Ví dụ tìm nhanh:

```powershell
.\.venv\Scripts\python.exe scripts\run_dev.py
```

Không ghi Authorization, Device Token, API key, audio hoặc nội dung cuộc hội thoại.
Auth, session và heartbeat chưa có runtime nên event tương ứng chưa được phát.

## Mapping source

| File | Function/class | Vai trò |
| --- | --- | --- |
| `app/main.py` | `create_app()`, `lifespan()`, `app` | Factory, vòng đời và ASGI app cho Uvicorn |
| `app/core/config.py` | `Settings`, `get_settings()`, `ConfigurationError` | Đọc/validate cấu hình và lỗi an toàn |
| `app/api/health.py` | `router`, `health()` | `GET /health` |
| `app/api/websocket.py` | `router`, `websocket_endpoint()` | Echo local, kiểm tra message và cleanup socket |
| `app/core/logging.py` | `configure_logging()`, `get_logger()`, `redact_sensitive()`, `log_event()` | JSON console logger, redaction và event có allowlist context |
| `scripts/run_dev.py` | `main()` | Chạy Uvicorn theo cấu hình |
| `scripts/ws_client.py` | `main()`, `exchange()`, `local_url()`, `positive_timeout()` | Client local có timeout và báo lỗi |
| `tests/conftest.py` | `isolated_settings`, `dotenv_file` | Cô lập settings/test dotenv |
| `tests/test_health.py` | `test_health_and_lifespan()` | HTTP health và hai sự kiện vòng đời |
| `tests/test_logging.py` | `test_*` | JSON format, redaction, traceback an toàn và handler idempotence |
| `tests/test_config.py` | `test_*` | Validation, ưu tiên cấu hình, entrypoint |
| `tests/test_websocket.py` | `test_*`, `live_server`, `drive_endpoint()` | ASGI, TCP thật và timeout client |

Không tìm thấy Proposal/Feature List xác nhận phiên bản V1.5. Có tài liệu
Proposal cũ trong `../xiaozhi-esp32/` nhưng không xác nhận đó là V1.5.
Phạm vi triển khai theo yêu cầu D2-S1-01 của người dùng.

## D2-S2-05 — Private robot development gateway

`/ws/dev-robot` đã nối các foundation hiện có với native libopus và mock
STT/LLM/TTS; OFF mặc định, private-IP allowlist + token local bắt buộc, không
sử dụng Backend hoặc Cloud API. Hai session TCP đồng thời đã được kiểm thử.
Mock TTS chỉ là tone, mock ACK không phải robot playback.

Hướng dẫn cài libopus, export cấu hình, chạy server/demo, test và tình trạng hai
board: [báo cáo Task 05](docs/test-report-d2-s2-05.md).

```bash
.venv/bin/python -m pytest tests/test_robot_gateway.py -q --tb=short
.venv/bin/python scripts/robot_mock_client.py
.venv/bin/python scripts/audit_firmware_boards.py
```

Trong `xiaozhi-esp32/main/boards/custom/` hiện chỉ có `xiaozhi-s3-tft`; chưa
xác định profile thứ hai/serial. Firmware completion ACK còn chờ driver TX/DMA
evidence (`IsOutputDrained` fail closed). ESP-IDF build/hai robot/Cloud chưa đạt
DoD. Kết quả lịch sử Task 05 là 375 PASS, 1 FAIL snapshot; FIX bên dưới đã xử lý
source baseline/dependency có provenance, không skip test.


## D2-S2-05-FIX — Readiness hiện hành

Xem [báo cáo FIX](docs/test-report-d2-s2-05-fix.md): dependency ML307 3.6.6 được
khôi phục từ archive chính thức, snapshot nguồn có provenance riêng và giữ
snapshot lịch sử. Có NoAudioCodec TX EOF proof thử nghiệm, OFF mặc định, chỉ
SDK 6.0.2/S3; chưa build/kiểm thử phần cứng. Gateway vẫn mock AI, private/OFF
mặc định. Cancel khi chờ socket lock và native encoder cleanup đã có regression.

```bash
python3 scripts/audit_firmware_snapshot.py
.venv/bin/python -m pytest tests -q --tb=short
```

Không coi source snapshot PASS là protocol/board/hardware approval. Chưa có hai
board đã xác minh, ESP-IDF active hoặc Cloud credentials; không flash/gọi Backend.

Kết quả FIX cuối: **384 pytest PASS**, **70 firmware host tests PASS**. Hardware/Cloud vẫn BLOCKED.
# Tích hợp Backend (03/11/2026)

Xem [báo cáo API và kiểm thử](docs/backend-integration-report.md).
`AI_SERVER_BACKEND_MODE=development-mock` giữ gateway development hiện có.
`integrated` hiện fail closed trước audio vì Backend chưa đăng ký đầy đủ internal API;
không có fallback mock. Không coi fixture tests là Backend/Cloud/hardware live PASS.


## Current runtime integration state (2026-11-03)

The older D2-S2-05 notes above describe the original development gateway and are historical. Current behavior and verified limitations are in [docs/runtime-integration-audit.md](docs/runtime-integration-audit.md).

- `integrated` is the default and requires distinct Backend device/config/quota service tokens.
- The integrated WebSocket authorizes the device and resolves its user/device AI configuration before accepting audio. It then fails closed with `AI_PIPELINE_UNAVAILABLE` because no approved Cloud credential broker, real STT/TTS runtime, live quota readiness, or firmware device-proof headers are available.
- Mock STT/LLM/TTS and simulated tone remain available only after explicitly selecting `development-mock`. They are not Cloud or hardware evidence.
- Backend authorization/config routes exist in source, but quota schema readiness, provider secret delivery, session lifecycle, and hardware playback remain unverified or missing.

## D2-S2-06 — OpenAI API probe

The Task 03 `OpenAILLMAdapter` already uses the official Responses API but does not discover credentials. The new `scripts/test_openai_connection.py` reads a real `OPENAI_API_KEY` and `OPENAI_MODEL` from environment or `.env`, makes exactly one request with automatic retry disabled, applies the configured existing output-token cap, and prints returned usage/request ID/latency. No key is currently configured, so the script is BLOCKED before network access. This does not connect OpenAI to robot runtime and does not modify quota/rate-limit behavior. See [Task 06 report](docs/test-report-d2-s2-06.md).

## Gemini API — Prompt 06G

Added `GeminiLLMAdapter` alongside the existing `OpenAILLMAdapter`, using `google-genai` and no provider fallback. `GEMINI_API_KEY`, `GEMINI_MODEL`, and timeout load from environment or `.env`. The separate live test sends one request and preserves the existing output-token ceiling; quota behavior is unchanged. `gemini-3.8-flash` is documented with a Free Tier, but the configured project entitlement is not live-verified: the real request returned HTTP 503. Report: `docs/test-report-d2-s2-06g.md`.

## D2-S2-09 — Gemini TTS and voice response policy

The standalone `scripts/gemini_voice_demo.py` streams text through `LLMRunner`, then synthesizes the final answer using `GeminiTTSAdapter` and saves `artifacts/gemini_voice_demo.wav`. `scripts/test_gemini_tts_live.py --play` tests TTS independently with a fixed Vietnamese phrase. Configure `GEMINI_TTS_MODEL=gemini-3.8-flash-tts`, `GEMINI_TTS_VOICE=Kore`, and `GEMINI_API_KEY`. Google lists a Free Tier, with project-specific rate limits. Latest TTS-only live request was blocked by network; project entitlement and generated voice are not confirmed. The voice policy is applied only to the voice demo; regular text demo behavior is unchanged. This does not connect the adapter to integrated robot runtime or claim physical playback completion. See [D2-S2-09 report](docs/test-report-d2-s2-09.md).

## D2-S2-10 — File voice pipeline

`scripts/gemini_voice_file_pipeline.py` accepts completed WAV/Ogg Opus utterances and calls Gemini STT adapter, `LLMRunner` with Voice Response Policy V1, then Gemini TTS adapter. Repeat `--audio` for consecutive turns; user/session identity is explicit. It writes validated outputs to `artifacts/`. The diagnostic requires both `--enable` and `AI_SERVER_VOICE_PIPELINE_DEMO_ENABLE=true`, plus `AI_SERVER_BACKEND_MODE=development-mock`; it invokes real adapters only and does not bypass production integrated auth/quota because it is not a runtime route. The workspace has no supplied recording of a user question and current Gemini access failed with network error, so no live pipeline PASS is claimed. See [D2-S2-10 report](docs/test-report-d2-s2-10.md).


## SD2 Gemini LAN diagnostic

See [SD2 Gemini LAN setup and test results](docs/sd2-gemini-lan.md) for the local
`.env`, Windows native audio, USB configuration and observed quota limitation.


### Local AI foundation (Prompt 01)

Cloud startup scripts remain unchanged (default runtime `cloud`, port 8000).
Run `run_local.cmd` for a separate Local process on 127.0.0.1:8002.
Copy `.env.local.example` to `.env.local` and supply `LOCAL_LLM_API_KEY`
matching the separately managed llama-server on port 8001. Local startup reads
`.env.local`, never cloud `.env`. It does not launch or alter llama-server.
`/health` retains `status: ok` and adds runtime/readiness; local `/ready` returns
503 until generation and voice are implemented. See
[Prompt 01 audit and validation](docs/local-foundation-prompt01.md).

### Local Gemma text chat (Prompt 02)

Local text chat is available at `POST /local/chat` after configuring
`LOCAL_LLM_API_KEY` and a separate `LOCAL_LLM_CHAT_TOKEN` (at least 43
characters) in `.env.local`. The runtime discovers the exact model ID from
llama-server `/v1/models`; it does not hardcode or select a cloud model.
Send `user_id`, `session_id`, `content`, and `stream`. With `stream: true`,
the response is Server-Sent Events containing `delta`, then `done`.
Conversation history is bounded, process-local, and isolated by user/session.
Voice remains unavailable.

### Local Vietnamese STT (Prompt 03)

Local runtime loads `Systran/faster-whisper-small` once per process with
CTranslate2 CUDA/float16. Model files stay in the configured Hugging Face cache
outside this repository. The adapter accepts mono PCM16 or raw Opus, converts
to 16 kHz PCM in memory, applies silence/VAD handling, and emits the existing
`TranscriptionResult` contract. Local TTS and robot routing remain disabled.
See [Prompt 03 report](docs/local-stt-prompt03.md).

### PA-09 H-01: analysis only

Local runtime exposes `POST /internal/personal-assistant/analyze` for internal
testing, using the same `Authorization: Bearer LOCAL_LLM_CHAT_TOKEN` as Local
chat. Send `user_id`, `session_id`, `content` and optionally `timezone` (default
`Asia/Bangkok`). The service token authenticates a trusted internal caller;
user/session identifiers are supplied by that caller, not public user auth.
The server supplies the current reference time and returns a validated
`Analysis` with operations, entities, missing fields, questions, confirmations
and topologically ordered dependencies. `mode` is always `analysis_only` and
`executed` is always false. No Backend or MySQL access occurs.

The existing Gemma adapter streams internally with a JSON schema grammar;
only a complete validated result is returned. Structured analysis uses a
separate bounded 2048-token output budget without changing ordinary chat or
voice generation limits. `LOCAL_PA_TIMEOUT_SECONDS` (default 300, maximum 300)
and `LOCAL_PA_MAX_OUTPUT_TOKENS` (default 2048, maximum 4096) control analysis
budgets. Structured requests allow up to 300 seconds for transport reads;
the cancellation scope enforces the configured total analysis deadline.
Invalid/truncated output fails closed with HTTP 502.
Windows requires the included `tzdata` dependency for IANA timezones.
Pending dialogue is now supplied by H-02 below. Backend target lookup, conflict
detection and execution remain unavailable. H-06 defines and implements PA-05's
read-only personalization core without adding a Backend operation.

Unit checks: `python -m pytest tests/test_pa_understanding.py`.
Real Gemma checks: `python scripts/test_pa_gemma_live.py` with Local AI_SERVER
running on 8002 and llama-server on 8001. The probe prints each result, never
creates a report or business data, and must be run separately from unit tests.

### PA-09 H-03: proposed tool contracts

`app.personal_assistant.tool_registry.TOOLS` is an immutable allowlist of
proposed Backend operations. `ToolSpec.contract()` exposes READ/WRITE access,
confirmation/preconditions, required fields, validation rules and Pydantic
input/output schemas. Every Backend entry is `NOT_IMPLEMENTED`; no endpoint
is assigned. PA-05/09/23 are separate disabled capability descriptors, rather
than fabricated Backend operations.

`plan_tools(analysis, trusted_context)` maps validated H-01 operations to tool
proposals and preserves dependency IDs. Missing arguments and unresolved
targets remain validation errors. Target IDs can only come from the trusted
caller; they are never invented from a target query. An operation reference
such as `op1` is not a Backend record ID. H-03 does not resolve references or
execute a multi-step workflow.

`ToolExecutionBoundary` accepts one allowlisted call with a `TrustedToolContext`
provided by application code. Identity, permissions, resolved targets,
confirmation keys and dependency evidence are separate from LLM arguments.
Confirmation/idempotency keys bind the exact arguments, dependencies, user,
session and proposal correlation ID. Correlation IDs must be retained for a
proposal's confirmation/retry and changed for a new proposal. READ calls do
not carry write idempotency keys. Backend ownership/transaction checks remain
authoritative. No PA tool dispatches until a real binding is available.

H-02 connects the authenticated analyze route to pending state and workflow
planning. The readiness flag in other callers' trusted contexts still defaults
to false. Production uses the explicit unavailable
adapter and never synthesizes Backend success. The adapter protocol is a seam
for real authenticated PA methods after their routes, credentials and response
contracts are agreed; existing device/config/quota methods are unchanged.

Verify these contracts with `python -m pytest tests/test_pa_tools.py`.

### PA-23 H-04: workflow core

`WorkflowOrchestrator` accepts an H-03 `ToolPlan` and a trusted application
context. It validates the graph, inserts a conflict check before event creation
or time changes, and runs through the existing `ToolExecutionBoundary`. It has
no endpoint and does not replace the conversation, voice or Cloud pipeline.
H-02 supplies `dialogue_ready` from validated server state; other callers default
to false. It is never supplied by LLM JSON. No Backend tool is enabled.

Workflow states are PLANNED, WAITING_FOR_INFORMATION,
WAITING_FOR_CONFIRMATION, READY, RUNNING, PARTIALLY_COMPLETED, COMPLETED,
FAILED, CANCELLED and BLOCKED. Steps use PENDING, READY, RUNNING, SUCCEEDED,
FAILED, SKIPPED and BLOCKED. SUCCEEDED requires a validated H-03 Backend ACK.
An unavailable API produces BLOCKED/UNAVAILABLE rather than a synthetic result.

Use `create`, `confirm(revision=...)`, `run`, `revise`, `retry`, `cancel` and
`decide_conflict` from authenticated application code. `confirm` records user
approval of the current snapshot; it does not execute a tool. Revisions reset
affected approvals, checks and downstream steps. Completed or uncertain writes
cannot be edited into a fresh attempt. Snapshots are copies, and user/session/
correlation ownership is checked on every operation. Old snapshot revisions
cannot confirm a changed plan.

A reminder's logical `linked_operation_id` is resolved only from a SUCCEEDED
parent's validated record ID. The boundary verifies the resulting
`linked_record_id` against trusted dependency receipts. Approval/idempotency
remain bound to the logical call; an arbitrary substituted record ID fails
authorization. Conflict lists retain their full time details. Recurring
overlaps above 30% carry a warning, and every affected occurrence needs an
explicit decision. Existing events are never automatically overwritten.

Partial failure retains successful receipts and asks how to continue. `retry`
only requeues failed/blocked steps; it does not execute or replay successful
steps. Unknown WRITE outcomes require reconciliation unless the actual Backend
adapter advertises real idempotency support. Retry retains the original key.
Cancellation stops subsequent steps, preserves completed receipts, and keeps
uncertain outcomes visible. An in-flight request may still finish before the
cancellation takes effect; it is not rolled back.

`WorkflowStore` defaults to 32 workflows, a 3600-second idle TTL and a bounded
state budget. Active leases are not expired or executed concurrently. State
is process-local and does not survive restart; durable recovery/idempotency
must come from Backend. Reuse the same correlation ID for retry of a proposal,
and use a new one for a new proposal. Memory arguments require a trusted
`sensitive_data_checked` proof before retention; workflow code does not invent
a privacy classification, consent, readback or Backend credentials.

Run `python -m pytest tests/test_pa_workflow.py tests/test_pa_tools.py` for the
workflow contracts. Success adapters exist only in tests. Natural-language
multi-turn planning is now connected through the H-02 analyze route. Real PA
writes and Xiaozhi E2E remain blocked by missing Backend APIs and hardware
verification. Plan creation still needs real Backend scheduling
and conflict evidence; changing only a plan end date adds no rescheduling steps.

### PA-23 H-05: execution safety boundary

The source audit of Backend controllers and `AppModule` found no PA API
bindings. All 36 proposed Backend tools remain NOT_IMPLEMENTED; actual
integration is BLOCKED. No endpoint, PA token or new HTTP client is configured.
Existing `BackendClient` HTTPS/origin checks, private service credentials,
bounded responses, zero retries and error types remain unchanged.

The existing `BackendToolAdapter` interface now accepts a validated argument
model, trusted context, operation ID, idempotency key and the shared
`AudioContext` cancellation/deadline scope. A future adapter must delegate to
verified methods of the existing Backend transport after endpoint, wire
contract and authentication have been checked. The unavailable production
adapter makes no HTTP request. Do not fill this gap with guessed routes or a
success double.

Availability is AVAILABLE, NOT_IMPLEMENTED, DISABLED or UNAVAILABLE. A contract
declaration is not evidence of an endpoint. Dispatch requires both an enabled
registry entry and adapter evidence that endpoint, contract and authentication
were verified. Temporary outages remain distinct from disabled/missing APIs.

`BackendReceipt` describes a normalized real Backend acknowledgement; its
tool/operation, user/session, correlation and idempotency key must match the
invocation. Actual wire fields remain subject to the real API contract.
Copying request identity into an invented receipt is not Backend evidence.
Boolean success without this acknowledgement, wrong output schema or a
mismatched receipt cannot produce SUCCESS. Receipt identity is excluded from
public result/workflow JSON.

Execution outcomes are NOT_EXECUTED, CONFIRMED, REJECTED and UNKNOWN. Ambiguous
WRITE timeouts, cancelled requests and invalid/unbound acknowledgements carry
UNKNOWN/PENDING_RECONCILIATION. A deadline that expires before dispatch remains
NOT_EXECUTED. Step/workflow state retains reconciliation status separately
from FAILED/PARTIALLY_COMPLETED so uncertainty is not hidden.

There is no automatic WRITE retry. Explicit retry of an uncertain write needs
verified Backend idempotency support and retains the original key. Successful
steps are not replayed and failed dependencies are not skipped. The local RAM
lease only prevents concurrent execution in this process; durable exactly-once
effects, deduplication and outcome reconciliation require Backend support.
No live Backend integration PASS is claimed while API bindings are absent.

Changed-path checks: `python -m pytest tests/test_pa_execution.py
tests/test_pa_tools.py tests/test_pa_workflow.py` (run as a single command).
Available/acknowledging adapters in these tests are unit doubles only.

### PA-05 H-06: read-only personalization

Opt in with `personalize: true` on the existing authenticated `POST /local/chat`.
The normal request/response fields remain, with `personalization` metadata:
memory_status, used_memory_ids, memory_action, intent_status and executed=false.
PA-09 understanding and the existing Gemma adapter are reused. There is no new
LLM runtime, memory database, training step, Backend credential or endpoint.
The existing bounded user/session history is reused. This personalization path
does not consume the H-02 pending state of the separate analyze endpoint.

`PersonalizationEngine` has a stateless `MemoryReader` interface. Its production
`BackendMemoryReader` only proposes a READ through H-05's `memory.query` boundary.
The real PA-04 API is missing, so the default result is MEMORY_UNAVAILABLE,
with no fabricated profile. Gemma continues without stored-memory context.
Actual integration additionally needs authenticated caller/readiness wiring;
PA-05 does not set dialogue_ready or grant tool permissions itself.

The proposed PA-04 search contract now contains query_digest (SHA-256 of the
exact UTF-8 query) and up to eight records. Each record includes id, owner,
category, content, consent_to_store/use, active, sensitivity_reviewed,
query-specific relevance and optional timezone-aware updated_at/expires_at.
Categories are addressing, communication_style, preference, habit and
personal_information. This is a proposed contract, not an existing API.

Before prompt construction, the engine verifies the Backend receipt, query
digest and every record's owner. It excludes missing consent, inactive/expired
or unreviewed records, low relevance and recognized injection/sensitive content.
At most three qualifying records enter the response request. Memories are
quoted JSON in the user message, never system instructions or execution rights.
Memory relevance must come from a scoped query response; the engine does not
send an entire profile to an additional LLM selector. Missing consent/validity
metadata fails validation rather than being assumed true.

Current-turn facts identified by PA-09 suppress related old memory categories.
User conversation remains higher priority, and prior assistant memory claims
are replaced in the prompt history to avoid reusing expired/revoked context.
Only proposal questions grounded in the previous user's own text are retained.
Recognized sensitive current input is not appended to personalized RAM history.
Memory contents and retrieval exceptions are not logged.

PA-04 proposals ask whether to save; refusal saves nothing; agreement currently
returns SAVE_UNAVAILABLE. Save/update/forget requests are not executed by PA-05.
The service never calls memory WRITE tools or PA-23. Existing authoritative
PA-04/H-02 flows must perform any future confirmation and persistence.

Personalized generation requests disable thinking per request to fit the
existing response-token budget. Model/server configuration and ordinary chat
defaults are unchanged. Opt-in SSE returns a validated buffered response as a
delta followed by done. Usage is null for this multi-generation path rather
than presenting response-only usage as a full total.

Unit checks: `python -m pytest tests/test_personalization.py`.
Explicit real Gemma/no-memory probe: `python scripts/test_personalization_live.py`.
The probe reads `.env.local`, creates no memory rows or report files, and prints
PASS/FAIL separately. Live PA-04 success must not be claimed without its API.

### H-07: integration readiness checks

`tests/test_pa_integration.py` joins parsed intent fixtures, H-03 planning,
PA-04 consent handoff and H-04's production unavailable boundary. It does not
simulate successful Backend execution. API availability is checked for every
workflow step, including independent branches. Storage refusal is recorded as
a deferred decision without turning the remaining event/reminder intents into
unsupported business operations. Safe, fixed application notices that a memory
was not saved remain available to subsequent consent/refusal understanding.

Run the PA-specific test files for intent, tools, execution, workflow,
personalization and component integration. For real Gemma checks, start the
existing Local AI_SERVER on 8002 and run `python scripts/test_pa_readiness_live.py`.
Use `--case` to repeat an affected case. The probe verifies extracted content,
relative dates, mapping, blocked workflow planning, Local chat behavior and
consent/refusal. It creates no memory rows, uses no successful Backend double,
and prints statuses without writing a report. Infrastructure failures are
BLOCKED; schema/semantic mismatches are FAIL. The log probe uses a synthetic
per-run canary, not personal data.

The H-07 live workflow probe composes components directly. The H-02 analyze
route now retains pending dialogue and plans workflows as described below;
neither probe is evidence of Backend/hardware E2E.
Real memory retrieval, Backend partial execution and durable idempotency remain
blocked by the absent PA APIs. Hardware E2E is separate from these probes.

### PA-09 H-02: pending dialogue and workflow planning

Reuse the same internal analyze endpoint and bearer authentication. Send the
same trusted `user_id`, `session_id` and timezone on follow-up turns. The added
`dialogue` object returns status, questions, confirmation, correlation ID,
dialogue revision and workflow ID/revision/status/code. `raw_input` retains
bounded conversation evidence, while operations preserve entity ownership and
dependencies. Corrections invalidate prior consent; implicit conflicting values
require clarification. A confirmed dialogue is not a completed business action.
Omitting timezone on follow-ups inherits the pending timezone. Clients may send
`expected_revision` to reject stale replies with HTTP 409 before calling Gemma.

Pending state shares `LocalChatSessions` isolation, busy locks and configured
session TTL/capacity. It is retained only in this process's RAM and disappears
on expiry/restart. Cleanup is lazy on access and available through `cleanup()`;
in-flight sessions remain locked until their deadline/cancellation finishes.
The maximum turn count and retained character budget also apply to pending
dialogue. Workflow storage uses the same configured TTL/capacity. Expired
workflow handles and timezone changes return HTTP 409; concurrent turns for
the same user/session return HTTP 409 `session_busy`.

Gemma classifies each follow-up and extracts only a patch for the selected
intent, using the existing adapter/structured transport. The server merges and
revalidates it, anchors supplied dates and checks event intervals. A complete
proposal maps through `plan_tools` into the existing orchestrator. Corrections
revise the same workflow; repeated confirmation preserves its identity.
This endpoint never calls workflow execution or Backend APIs. Missing APIs
produce `BLOCKED`/`NOT_IMPLEMENTED`, always `executed=false`. Memory WRITE
planning additionally awaits trusted privacy review. `/local/chat` and voice
are not wired to this pending-state endpoint by this change.

Focused checks: `python -m pytest tests/test_pa_dialogue.py` (Gemma doubles in
unit tests; live Gemma verification must be reported separately).

### H-01 Group III: memory interpretation metadata

PA-04 operations add `memory.interaction`: statement, proposal, save_request,
update_request, query_request, delete_request, decline or confirmation. The
existing action mapping remains; a statement uses propose as a candidate,
never as implied consent. Preference/habit/personal_information remain in
entities.category, including when another intent creates a schedule/reminder.

`memory.original_text` quotes the exact source clause. `summary` is null:
this path does not generate a paraphrase whose meaning cannot be verified.
New-memory content is kept verbatim; update extraction retains its existing
new-value fields and original evidence for readback rather than replacing it.
`prohibited_categories` covers OTP, passwords, payment, identity documents,
medical, business secrets and other sensitive data. Gemma's semantic labels
are reinforced by conservative server guards. Such storage operations are
unsupported and cannot be approved into a save; viewing/deleting is still
recognized separately. No Backend capability is granted by metadata.

`issues` can contain ambiguous, unusual, possible_stt_error or
update_mode_unclear. `requires_clarification`, `storage_policy` and questions
are derived by the server for H-02. Numbers, negation and uncertain content are
not silently corrected. This adds no memory writer, database or PA-04 API.
Check `tests/test_memory_understanding.py` separately from live Gemma tests.

### H-03 PA-04 registry contracts

The existing registry now describes five memory phases; no HTTP binding or
database schema is added. Backend source currently has no PA-04 controller/API.

| Contract | Scope and safety |
|---|---|
| memory.query | Eligible owner-scoped memories for personalization by default |
| memory.propose | Local proposal only; ToolPlan.proposals, deferred until consent |
| memory.create | Confirmed content and proposal_revision; trusted storage consent |
| memory.update | One memory_id or topic_group, expected_revision, append/replace, new content |
| memory.delete | One memory_id or topic_group, expected_revision and exact confirmation |

`MemoryAuthorization` is immutable application context bound to authenticated
user/session/correlation, proposal revision, verified target revision, consent
and the exact confirmed call hash. LLM entities cannot supply these authorities.
Unconfirmed proposals never enter executable calls. Exact consent can promote
a proposal to memory.create; explicit create/update/delete calls still cross
the same boundary. Confirmation of an old payload or revision cannot approve
changed arguments. Proposal revision may remain absent while drafting, but is
mandatory and trusted before a WRITE. Unknown IDs or revisions are not filled.

Query results retain the existing MemoryRecord schema, with optional revision
and topic_group for compatibility. Missing revision cannot authorize a write.
Personalization rejects foreign, unconsented, inactive, expired or unreviewed
rows. Management lookup is separate in purpose, requires an application-issued
proof and never grants consent to use its contents for personalization.

Write arguments contain no user ID, token, URL or LLM-supplied consent flags.
The existing context call hash is the stable idempotency key, reused on retry;
safe WRITE retry still requires verified Backend idempotency. Responses must
match owner, proposal revision and target, and advance the record/group revision.
Invalid write acknowledgements are UNKNOWN/PENDING_RECONCILIATION, not success.

`topic_group` is a proposed opaque Backend scope, not a new table or an automatic
alias for category. Bulk group writes need a verified group revision and Backend
authorization/transaction checks over every member. The existing memory workflow
can still delete selected verified records individually with their own revisions.
Its lookup/readback/confirmation stages are reused; routing/sync never execute.
Append sends only new text; Backend applies it atomically against expected_revision.

All five contracts advertise NOT_IMPLEMENTED until real endpoints, authentication
and request/response mappings are verified. Proposal rendering needs no Backend;
attempting to execute its descriptor returns PROPOSAL_ONLY_NO_EXECUTION. These
schemas are proposed integration contracts, not assertions that PA-04 APIs exist.
Focused checks: `tests/test_memory_tool_contracts.py` plus memory/workflow regressions.

Memory proposals read back the exact proposed content before consent. Memory
updates ask whether to replace or append and retain that choice per operation.
Update/delete dialogue asks for an item or topic and shows the proposed after
content. Because Backend memory lookup is absent, the actual before content and
target cannot be verified: these requests remain BLOCKED with
`MEMORY_LOOKUP_NOT_IMPLEMENTED`; a yes reply cannot authorize an unverified
mutation. No user-supplied description is treated as an actual stored record.
Uncertain important information requires a restatement before confirmation.
Run `python scripts/test_h02_gemma_live.py` to exercise the current route source
in-process using the real configured Gemma, without restarting a shared server.

### H-04: Group III memory workflow stages

Memory-only analyze dialogues now retain a workflow ID even while preparing a
proposal or awaiting unavailable lookup. `Workflow.memory_operations` records
the policy result, verified candidates, selected scope, replace/append choice,
readback revision and ACK stage. Repeated habits remain proposals until an
explicit consent turn. Prohibited storage is blocked before content retention.

The trusted application API is `sync_memory(analysis, context, workflow_id=...,
modes=...)` on `WorkflowOrchestrator`. It preserves the ID and dependencies;
changes increment revision and invalidate readback/consent. `run()` reads current
records through `memory.query` for updates/deletes. The caller uses
`select_memory(..., revision=..., operation_id=..., record_ids=..., mode=...)`
to select verified records (one for update, one or more for delete).
`memory_readback(..., revision=...)` returns the exact proposed save content or
before/after and deletion scope. Show this preview before calling
`confirm(..., revision=...)`; `run()` then dispatches through the existing tool
boundary and checks the scoped Backend receipt. Append combines the verified
old content and the explicit new content; replace uses the new content alone.

Successful steps are retained and skipped on repeated confirmation/run. Missing
ACK, cancellation during a write or mismatched ACK target requires
reconciliation and cannot trigger automatic replay. Tool permissions, ownership,
dependencies and availability gates remain in force. The production registry
still has no PA-04 HTTP binding: these workflows remain `BLOCKED` and no Backend
mutation executes. `/analyze` performs preparation only. Mixed schedule/memory
execution and the existing schedule/reminder workflows are not changed here.

Focused tests: `python -m pytest tests/test_pa_memory_workflow.py`.

### H-06: Group III personalization additions

PA-05 keeps the existing MEMORY_UNAVAILABLE fallback and read-only behavior.
Only scoped Backend reads with a matching query receipt, correct owner,
store/use consent, active state and sensitivity review can supply memory.
Group III's existing prohibited-data policy also filters records and proposals.
Current prohibited input is not retained in personalized session history or
new pending dialogue. Habit statements produce a content readback and proposal;
explicit consent still cannot save anything while PA-04 is unavailable.

`expires_at` is always enforced. Optional `LOCAL_PA05_MAX_AGE_SECONDS` requires
an `updated_at` within that age; missing, old or future timestamps prompt for
restatement. The unset setting imposes no invented maximum age. Expired values
are withheld from both model review and answer generation. Eligible records
undergo a bounded Gemma review for conflicts, uncertainty and prohibited meaning
before use; failed review asks for clarification. Confirmation does not renew a
record's Backend expiry or consent. Existing category values provide
`memory_groups`; arbitrary topic hierarchies are not supported by this schema.

Personalized `/local/chat` update/delete turns now use H-02/H-04 pending state
in the local-chat session store, preserving workflow ID and mode selection.
They ask for replace/append and exact item/group scope. Real before/after
confirmation remains blocked until verified current Backend records exist.
For a trusted H-04 caller, `PersonalizedAssistant.workflow_reply(workflow,
context)` formats readback questions before execution and concise exact changes
after matching ACKs, including accurately reported partial changes. It does not
confirm or execute the workflow. Missing ACK never produces success text.

That formatter prepares a stable `memory.changed` notification identity.
`delivery.website` and `delivery.xiaozhi_voice` remain NOT_CONNECTED with
`sent=false` by default; no real notification/audio transport is bound. The
optional H-05 hook below does not claim delivery without a verified channel ACK.
Group III items 10, 13 and 23 remain undecided; no new rules, DB tables, proactive
notification schedules or repetition thresholds are supplied for them.

Tests: `tests/test_personalization_group3.py`. Real-Gemma probe:
`python scripts/test_h06_group3_gemma_live.py` (optional `--case consent`).
The probe explicitly labels synthetic expiry/conflict/consent read fixtures;
they validate Gemma interaction and selection safety, not live PA-04 reads or
persistence. Production PA-04 remains unavailable and all mutation attempts
remain `executed=false`.

### H-05 PA-04 adapter hardening

PA-04 endpoints are still absent from Backend source. The existing unavailable
adapter and registry keep these contracts BLOCKED/NOT_IMPLEMENTED; no routes,
authentication fields or database tables are guessed. Real API integration
requires supplied and verified create/read/update/delete wire contracts,
authentication/ownership rules, idempotency and atomic revision enforcement.

Memory writes require verified Backend idempotency before their first dispatch.
Update/delete additionally require `ToolAvailability.revision_verified`, meaning
Backend atomically checks expected_revision before changing the selected record
or group. A version in a response alone does not prove this capability. Input
calls are copied before asynchronous dispatch; ownership, exact consent, target
snapshot and proposal revision remain bound by the existing H-03 guards.

Explicit memory retry reuses the same workflow, confirmed arguments and
idempotency key, preserving completed steps. An UNKNOWN write remains
PENDING_RECONCILIATION during retry preparation and until a valid authenticated
ACK resolves it. No automatic retry is added. Retry rechecks current capabilities;
missing idempotency prevents dispatch. A rejected stale-version/permission
request requires renewed lookup/review/confirmation, never an automatic rebase.
Safe read retry does not create a write. RAM state is not proof of exactly-once
Backend execution; real reconciliation/idempotency support remains a dependency.

`workflow_reply` now exposes actual step outcomes, codes, workflow state and
reconciliation state. It never says a write did not happen when its ACK is lost,
nor declares COMPLETED from a corrupt/unverified snapshot. Partial replies and
notifications describe only steps with matching confirmed Backend receipts.
Adapter payloads, replies and exceptions are not logged; sensitive data is
hidden from their normal representations as an additional safeguard.

`PersonalizedAssistant.workflow_notification` / `deliver_memory_notification`
extend the existing notification envelope. Application code may explicitly
supply a Website or Xiaozhi voice binding with verified authenticated transport,
owner/session/correlation scope, positive ACK and persistent idempotency support.
No binding is installed by default, no endpoint is introduced, and LLM output
cannot choose a destination/token. Each confirmed write has a stable event key;
partial retries do not create new event keys for already confirmed changes.
No notification is sent for unconfirmed/UNKNOWN-only results. Wrong/missing
channel ACK or timeout leaves sent=false/UNKNOWN; Backend success is unchanged.
Transport ACK is not a claim that the user read/heard a message. Delivery tests
use unit-only fixtures; real Website/Xiaozhi integration remains BLOCKED.

Focused checks: `tests/test_memory_execution_safety.py` and the existing execution,
memory workflow, notification formatter and contract regression tests. These are
not live Backend persistence or hardware E2E evidence.
