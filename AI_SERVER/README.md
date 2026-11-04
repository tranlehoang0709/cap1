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
