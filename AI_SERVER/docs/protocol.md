# AIVA-IoT — Giao thức firmware ↔ AI Server

**Phiên bản tài liệu: 0.1.0-draft · D2-S1-05 · 22/10/2026**

**Trạng thái: DỰ THẢO, PENDING xác nhận giao thức Dev 3.** Người dùng đã
xác nhận dùng snapshot firmware hiện có để đối chiếu và lập dự thảo.
Điều này không đồng nghĩa Dev 3 đã duyệt endpoint, schema hoặc phiên bản wire.
Không dùng tài liệu này để tuyên bố AI Server tương thích robot thật.

## 1. Nguồn chính xác và cách đọc trạng thái

Firmware khai báo `PROJECT_VER="2.4.2"` trong
[`CMakeLists.txt`](../../xiaozhi-esp32/CMakeLists.txt). Checkout workspace hiện
đang ở commit `97c008f02ab23bf98b7f959ec18b0519aac907fb`; chưa có bằng chứng
commit/board/sdkconfig/build này chính xác là bản Dev 3 dùng.
**Commit firmware Dev 3, board/sdkconfig/build thực tế: PENDING.**
Định danh snapshot bằng đường dẫn và SHA-256 của **15 file nguồn** trong
[`firmware-snapshot-d2-s1-05.json`](firmware-snapshot-d2-s1-05.json).
Kiểm tra snapshot khi source thay đổi; không suy ra version từ tên folder.

Firmware release `2.4.2`, phiên bản tài liệu `0.1.0-draft` và wire protocol
`version=1/2/3` là ba khái niệm riêng. `WebsocketProtocol` mặc định wire 1;
cấu hình có thể override. **Version wire cho triển khai AIVA-IoT: PENDING.**

Nhãn trong tài liệu:

- **SOURCE**: hành vi quan sát được ở snapshot, chưa phải hợp đồng Dev 3.
- **ĐÃ CHỐT**: người dùng đã xác nhận trong chat; ghi riêng trạng thái code.
- **PENDING**: chưa có quyết định/hợp đồng/kiểm tra cần thiết.
- **ĐỀ XUẤT**: phần mở rộng để thảo luận, chưa được triển khai hay bắt buộc.

| Nguồn | Function / phần làm căn cứ |
| --- | --- |
| [`websocket_protocol.cc`](../../xiaozhi-esp32/main/protocols/websocket_protocol.cc) | `Start`, `OpenAudioChannel`, `GetHelloMessage`, `ParseServerHello`, `SendAudio`, `SendText`, `CloseAudioChannel` |
| [`websocket_protocol.h`](../../xiaozhi-esp32/main/protocols/websocket_protocol.h) | `version_=1`, event chờ hello |
| [`protocol.h`](../../xiaozhi-esp32/main/protocols/protocol.h) | `BinaryProtocol2/3`, enum listening, mặc định sample rate/frame duration phía server |
| [`protocol.cc`](../../xiaozhi-esp32/main/protocols/protocol.cc) | `SendWakeWordDetected`, `SendStartListening`, `SendStopListening`, `SendAbortSpeaking`, `SendMcpMessage`, `IsTimeout`, `AddTextFontCapabilities` |
| [`application.cc`](../../xiaozhi-esp32/main/application.cc) | `InitializeProtocol`, `ContinueWakeWordInvoke`, `StartListeningAudio`, xử lý incoming JSON/audio và ngắt mạng |
| [`audio_service.h`](../../xiaozhi-esp32/main/audio/audio_service.h) | `OPUS_FRAME_DURATION_MS=60`, cấu hình encoder mono 16 kHz |
| [`audio_service.cc`](../../xiaozhi-esp32/main/audio/audio_service.cc) | `OPUS_DEC_CFG`, `SetDecodeSampleRate`, gói âm thanh đưa vào queue |
| [`ota.cc`](../../xiaozhi-esp32/main/ota.cc) | `Ota::CheckVersion`: nhận cấu hình websocket và ghi Settings |
| [`text_glyph_payload.cc`](../../xiaozhi-esp32/main/protocols/text_glyph_payload.cc), [`assets.cc`](../../xiaozhi-esp32/main/assets.cc) | Capability và extension glyph tùy điều kiện |

## 2. Transport, endpoint và định danh

**SOURCE:** WebSocket chuẩn, không phải Socket.IO. URL được lấy từ
Settings namespace `websocket`, key `url`. `Ota::CheckVersion` có thể nhận
section `websocket` từ phản hồi OTA rồi lưu URL/token/version. Không có path
robot hardcode trong `OpenAudioChannel()`. Ứng dụng ưu tiên MQTT nếu có cấu
hình MQTT; có cấu hình WebSocket mới chọn `WebsocketProtocol` nếu không có MQTT.

| Thành phần | Firmware SOURCE | Hợp đồng AIVA-IoT |
| --- | --- | --- |
| URL/path | Lấy toàn bộ URL từ Settings | Endpoint robot PENDING; hiện chỉ có `/ws/dev-echo` local |
| Scheme | `Connect(url)` giao cho thư viện mạng | Quyết định `wss`/TLS cho robot PENDING |
| `Authorization` | Có token thì gửi; tự thêm `Bearer ` nếu token không có dấu cách | Issuer/format/validation/TTL/revocation PENDING |
| `Protocol-Version` | Chuỗi của `version_` | Chưa chốt 1/2/3 được phép |
| `Device-Id` | MAC qua `SystemInfo::GetMacAddress()` | Không coi header là identity đã xác thực; ánh xạ sang DB device_id PENDING |
| `Client-Id` | `Board::GetUuid()` | Ý nghĩa identity/reconnect của server PENDING |
| Subprotocol | Không thấy đặt `Sec-WebSocket-Protocol` tại lớp protocol | Source `web_socket.h` có trong managed component; Dev 3 xác nhận build thực tế |
| Origin | Không thấy lớp protocol đặt Origin | Policy server cho robot PENDING |

Không dùng token thật trong ví dụ, log hoặc tài liệu. Không tự coi MAC,
Client-Id, session_id hay pairing code là Device Token.

**ĐÃ CHỐT task 03, CHƯA TRIỂN KHAI:** bảo vệ `/ws/dev-echo` trước accept;
401 cho token thiếu/sai/hết hạn/thu hồi; 403 cho robot không được phép hoặc
identity không khớp; 503 cho timeout/lỗi/response kiểm chứng sai. Hợp đồng
Backend hoặc JWT chưa có nên auth vẫn rỗng; endpoint hiện tại vẫn chỉ echo
local không auth. Không hướng dẫn robot sử dụng endpoint này trong thực tế.

## 3. Trình tự kết nối, session và kết thúc

**SOURCE — luồng firmware quan sát được:**

1. `Start()` chưa mở kết nối; kênh âm thanh được mở khi cần tương tác.
2. `OpenAudioChannel()` lấy URL/token/version, đặt header rồi gọi Connect.
3. Sau Connect thành công, firmware gửi client `hello` text JSON.
4. Firmware đợi server `hello` tối đa **10.000 ms**. Nhận `type=hello` thì
   `ParseServerHello()` kiểm tra `transport=websocket`, đọc session/audio
   nếu có, rồi đặt event cho kênh mở. Không thấy kiểm tra trường server
   `version`, `format` hay `channels` trong function này.
5. Sau khi kênh mở, ứng dụng chuyển sang listening, gửi control và audio
   tùy thao tác/config. Có thể tái sử dụng kênh đang mở cho lượt tương tác khác.
6. Khi nhận `tts.start`, firmware lên lịch chuyển sang speaking. Audio
   incoming chỉ đưa vào decode queue khi state hiện tại là speaking.
7. `CloseAudioChannel()` reset socket, bỏ qua đối số `send_goodbye`;
   WebSocket path này **không gửi JSON goodbye**. Callback đóng đưa ứng
   dụng về idle; ngắt mạng cũng đóng kênh ở các trạng thái hội thoại.

Không suy ra rằng firmware đã enforce toàn bộ thứ tự: callback incoming
có thể chuyển message chưa phải hello cho Application ngay lúc đang chờ hello.
`ParseServerHello()` chỉ cập nhật session_id khi nó là string; nếu thiếu
thì giữ giá trị trước đó (ban đầu rỗng), không tự xác thực identity.

**PENDING — luồng server robot cần Dev 1/Dev 3 chốt:**

`handshake → xác thực token/quyền/identity → reserve session → accept →
client hello → server hello → control/audio → close → cleanup`.

Đây là **luồng mục tiêu**, chưa có runtime auth/session/hello. Cần chốt
thời điểm cấp session_id và timeout hello của server; không tự bật state
machine theo sơ đồ này. Không tạo session trước xác thực.

**ĐÃ CHỐT task 04, CHƯA TRIỂN KHAI:** 1 kết nối/robot; duplicate từ chối
HTTP 409 trước accept; 1 worker, registry riêng tiến trình; shutdown tối đa
10 giây, close 1001 Going Away. Uvicorn hiện tại đóng socket 1012 trước
lifespan shutdown. Cần thiết kế shutdown sớm hơn trước khi coi 1001 đã chạy.

## 4. Quy ước field và JSON

`R-send` = field firmware thực sự tạo khi gửi. `R-handle` = field parser
cần để thực hiện hành vi được mô tả. `O` = tùy chọn hoặc có fallback.
Chúng mô tả source, **không phải schema Pydantic đã duyệt**. Type `number`
là kiểm tra cJSON; source không luôn kiểm tra số nguyên/giới hạn như một
schema nghiêm ngặt. Các ví dụ dùng `s-demo` là session giả, không phải token.

Mỗi JSON dưới đây là **một text WebSocket message**; không thêm JSON vào
binary audio nếu wire version và type chưa được chốt. Không có envelope
chung `request_id`, `timestamp`, `device_id` cho tất cả message trong source.

### 4.1. Kết nối — client hello (robot → server)

| Field | Type | SOURCE |
| --- | --- | --- |
| `type` | string `hello` | R-send |
| `version` | number | R-send, mặc định 1; Settings override |
| `transport` | string `websocket` | R-send |
| `features` | object | R-send; `mcp: true`; `aec: true` chỉ khi server AEC được build bật; `glyph_push` lấy từ capability |
| `audio_params` | object | R-send |
| `audio_params.format` | string `opus` | R-send |
| `audio_params.sample_rate` | number `16000` | R-send, Hz |
| `audio_params.channels` | number `1` | R-send |
| `audio_params.frame_duration` | number `60` | R-send, ms theo macro snapshot |
| `text_font` | object | O, chỉ khi glyph_push capability bật; `bundle/charset`: string, `size/bpp`: number |

Ví dụ khi glyph push không có capability, không bật server AEC:

<!-- example: client-hello -->
```json
{"type":"hello","version":1,"features":{"mcp":true,"glyph_push":false},"transport":"websocket","audio_params":{"format":"opus","sample_rate":16000,"channels":1,"frame_duration":60}}
```

### 4.2. Kết nối — server hello (server → robot)

| Field | Type | SOURCE |
| --- | --- | --- |
| `type` | string `hello` | R-handle cho dispatch |
| `transport` | string `websocket` | R-handle, thiếu/sai không đặt event hello |
| `session_id` | string | O với parser hiện tại; yêu cầu bắt buộc phía AIVA-IoT PENDING |
| `audio_params` | object | O |
| `audio_params.sample_rate` | number | O; mặc định phía Protocol là 24000 Hz |
| `audio_params.frame_duration` | number | O; mặc định 60 ms |
| `audio_params.format/channels` | string / number | Parser hello không kiểm tra; có thể mô tả Opus/mono nhưng chưa là negotiation đã enforce |

Ví dụ phù hợp nhánh parser đã đọc; đây chưa phải response đang được AI Server gửi:

<!-- example: server-hello -->
```json
{"type":"hello","transport":"websocket","session_id":"s-demo","audio_params":{"format":"opus","sample_rate":24000,"channels":1,"frame_duration":60}}
```

### 4.3. Listening / trạng thái thu — robot → server

Text JSON, `type=listen`, `session_id`: string R-send (có thể rỗng nếu chưa
nhận session_id). `state` là `detect`, `start` hoặc `stop` theo function gửi:

| State | Field bổ sung R-send | Ý nghĩa SOURCE |
| --- | --- | --- |
| `detect` | `text`: string | Wake word từ `SendWakeWordDetected()` |
| `start` | `mode`: string `auto`, `manual`, `realtime` | `SendStartListening()`; realtime phụ thuộc chế độ/AEC của ứng dụng |
| `stop` | Không có field bổ sung | `SendStopListening()` |

<!-- example: listen-detect -->
```json
{"session_id":"s-demo","type":"listen","state":"detect","text":"Xin chào"}
```
<!-- example: listen-start -->
```json
{"session_id":"s-demo","type":"listen","state":"start","mode":"auto"}
```
<!-- example: listen-stop -->
```json
{"session_id":"s-demo","type":"listen","state":"stop"}
```

Khi `CONFIG_SEND_WAKE_WORD_DATA` bật, `ContinueWakeWordInvoke()` gửi binary
wake-word trước `listen.detect`, rồi chuyển mode listening và gửi start.
Không áp đặt quy tắc chung “không audio trước listen.start” lên firmware này.

### 4.4. Điều khiển hủy lời nói — robot → server

Text JSON: `type=abort`, `session_id`: string R-send; `reason` O, chỉ thêm
`wake_word_detected` khi abort do wake word. Abort thường không có reason.
Chính sách server ngắt pipeline/ack/replay là PENDING; task này không chạy AI.

<!-- example: abort -->
```json
{"session_id":"s-demo","type":"abort","reason":"wake_word_detected"}
```

### 4.5. Trạng thái phát — server → robot

Text JSON `type=tts`, `state`: string R-handle. Source xử lý `start`, `stop`,
`sentence_start`; state khác không có action trong nhánh này. `session_id`
không được parser Application kiểm tra tại đây.

- `start`: lên lịch speaking, reset cờ aborted.
- `stop`: nếu đang speaking thì về idle ở manual, hoặc listening ở mode khác.
- `sentence_start`: `text` string R-handle để hiển thị; `glyph_push` object O.

<!-- example: tts-start -->
```json
{"type":"tts","state":"start"}
```
<!-- example: tts-sentence -->
```json
{"type":"tts","state":"sentence_start","text":"Chào bạn."}
```
<!-- example: tts-stop -->
```json
{"type":"tts","state":"stop"}
```

Thứ tự được đề xuất cho server: `tts.start → [sentence_start/audio]* →
tts.stop`; cần tránh race vì firmware Schedule chuyển state bất đồng bộ.
Đây chưa phải state machine được triển khai/enforce ở AI Server.

### 4.6. Kết quả nhận dạng và cảm xúc — server → robot

| Type (text JSON) | Field R-handle | Field O | Hành vi SOURCE |
| --- | --- | --- | --- |
| `stt` | `text`: string | `glyph_push`: object | Hiển thị lời người dùng |
| `llm` | `emotion`: string | Không có field bắt buộc khác tại nhánh này | Đặt biểu cảm màn hình; không phải response chứa nội dung chat LLM |

<!-- example: stt -->
```json
{"type":"stt","text":"Xin chào"}
```
<!-- example: llm -->
```json
{"type":"llm","emotion":"happy"}
```

### 4.7. MCP — hai chiều

Text JSON `type=mcp`. Robot gửi `session_id` string và `payload` là JSON
được nhúng nguyên từ `SendMcpMessage()`. Khi nhận, Application chỉ gọi
`McpServer::ParseMessage()` nếu `payload` là object. Schema JSON-RPC/MCP bên
trong, capabilities/methods/tool authorization và giới hạn riêng: PENDING
cho AIVA-IoT; không tự triển khai hoặc thực thi tool trong task này.

<!-- example: mcp-envelope -->
```json
{"session_id":"s-demo","type":"mcp","payload":{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}}
```

Ví dụ chỉ minh họa envelope; không khẳng định params rỗng hoàn thành MCP initialize.

### 4.8. Điều khiển hệ thống, thông báo lỗi — server → robot

| Type (text JSON) | Field | Quy tắc SOURCE |
| --- | --- | --- |
| `system` | `command`: string R-handle | Chỉ thấy action cho `reboot`; command khác log warning |
| `alert` | `status`, `message`, `emotion`: string, cả ba R-handle | Đủ kiểu mới hiển thị cảnh báo; thiếu/sai log warning |

<!-- example: system-control -->
```json
{"type":"system","command":"reboot"}
```
<!-- example: alert -->
```json
{"type":"alert","status":"Thông báo","message":"Dịch vụ chưa sẵn sàng","emotion":"sad"}
```

Ví dụ reboot chỉ để đặc tả; script client không gửi lệnh này cho robot.
Không thấy type `error` tổng quát hoặc error-code envelope trong nhánh
WebSocket/Application này. Không tự gọi `alert` là response lỗi có request
correlation, retry hoặc semantics xác thực. Lỗi mạng/hello timeout còn được
firmware hiển thị nội bộ qua callback, không nhất thiết là message trên wire.

### 4.9. Extension có trong snapshot — chưa chốt dùng cho AIVA-IoT

- `notify` (server → robot, text): `audio_url` string không rỗng R-handle;
  `subtitles` O là array. Mỗi item có `start_ms` number trong 0..UINT32_MAX
  và `text` string; item sai bị bỏ qua. Source ép số sang uint32, không xác
  nhận bắt buộc integer. Đây là phát media qua URL, không đồng nhất audio
  binary của hội thoại.
- `custom` (server → robot, text): chỉ compile khi
  `CONFIG_RECEIVE_CUSTOM_MESSAGE`; `payload` object R-handle để hiển thị.
- `glyph_push` nằm trong message `stt`/`tts.sentence_start`: object có `v=1`,
  `bundle` string, `size/bpp` number khớp capability, `glyphs` array tối đa 64.
  Item có codepoint, adv_w, box_w/h, ofs_x/y (number), bitmap (base64 string).
  Chi tiết giới hạn và bitmap ở `TextGlyphPayload::Parse`; lỗi extension bị
  bỏ glyph, text hợp lệ vẫn được hiển thị. Không đưa extension này thành
  schema bắt buộc của mọi robot; board/build/capability cần Dev 3 xác nhận.

<!-- example: notify -->
```json
{"type":"notify","audio_url":"https://example.invalid/demo.ogg","subtitles":[{"start_ms":0,"text":"Ví dụ"}]}
```
<!-- example: custom -->
```json
{"type":"custom","payload":{"message":"Ví dụ"}}
```

## 5. Âm thanh và binary layout

**SOURCE:** luồng WebSocket hội thoại dùng **Opus**, không phải PCM/WAV/OGG
container. Encoder capture là **16000 Hz, mono, frame 60 ms**, PCM đầu vào
encoder 16 bit; 16 bit này không biến payload Opus trên wire thành PCM16.
Hello quảng bá format/sample_rate/channels/frame_duration như mục 4.1.

Downlink mặc định phía Protocol **24000 Hz, 60 ms**; hello server có thể
override sample_rate/frame_duration. Decoder cấu hình mono. Chưa build robot
để xác nhận sample rate loa/board hoặc các giá trị negotiation khác. Không
suy ra bitrate cố định hay số byte cố định cho gói Opus VBR/DTX.

### 5.1. Wire version 1

Một binary WebSocket message chứa bytes Opus trực tiếp, không header
BinaryProtocol2/3, không timestamp/length riêng do application thêm.
`SendAudio()` dùng nhánh else cho mọi version ngoài 2/3; đây là hành vi
fallback source, không phải quyết định server phải chấp nhận version lạ.

### 5.2. Wire version 2 — header packed 16 byte

| Offset byte | Độ rộng | Field | Byte order / giá trị SOURCE |
| --- | --- | --- | --- |
| 0 | 2 | `version` uint16 | Big-endian, gửi 2 bằng htons |
| 2 | 2 | `type` uint16 | Parser ntohs; sender audio chỉ ghi 0 (Opus) |
| 4 | 4 | `reserved` uint32 | Sender ghi 0; chưa có semantics giá trị khác |
| 8 | 4 | `timestamp` uint32 | Big-endian, ms theo comment, htonl/ntohl; giá trị packet do nguồn audio cấp |
| 12 | 4 | `payload_size` uint32 | Big-endian, số byte Opus, không gồm header |
| 16 | N | `payload` | Opus bytes |

Comment trong struct ghi type 1 là JSON, nhưng sender WebSocket audio chỉ
gửi type 0 và receive callback không dispatch JSON theo binary type. **Không
coi binary type 1 là đã được hỗ trợ end-to-end.**

Ví dụ layout: version 2, type 0, reserved 0, timestamp 1000 ms, N=3.
Ba byte `01 02 03` là **payload giả để kiểm tra header**, không phải mẫu Opus
đã được giải mã hay dữ liệu được phép phát cho robot.

<!-- binary-example: v2-header -->
```hex
00 02 00 00 00 00 00 00 00 00 03 e8 00 00 00 03 01 02 03
```

### 5.3. Wire version 3 — header packed 4 byte

| Offset byte | Độ rộng | Field | Byte order / giá trị SOURCE |
| --- | --- | --- | --- |
| 0 | 1 | `type` uint8 | Sender audio 0 |
| 1 | 1 | `reserved` uint8 | Sender 0 |
| 2 | 2 | `payload_size` uint16 | Big-endian qua htons/ntohs, không gồm header |
| 4 | N | `payload` | Opus bytes |

Không có version/timestamp trong header version 3; version lấy từ cấu hình
kết nối. Callback gán timestamp=0. Minh họa N=3 với payload giả như trên:

<!-- binary-example: v3-header -->
```hex
00 00 00 03 01 02 03
```

Độ rộng uint16/uint32 không phải giới hạn payload đã duyệt cho AIVA-IoT.
Receive callback firmware cast struct và đọc payload_size mà không thấy
kiểm tra đủ độ dài/header/type/version tại đây. **Không gửi binary malformed
để dò parser robot.** Server bounds, fragment/reassembly và chính sách length
mismatch cần Dev 3 chốt trước khi có validator binary. Task này không decode audio.

## 6. Message order, input sai và mã đóng

| Tình huống | SOURCE firmware | Server hiện có / quyết định còn thiếu |
| --- | --- | --- |
| Text không JSON hoặc thiếu type string | Callback không dispatch; log missing type | Echo hiện tại không parse JSON, vẫn echo nếu text hợp lệ; robot parser PENDING |
| Type không biết | Application log warning, không có action | Chính sách ignore/error/close cho server robot PENDING |
| State tts không biết | Không thấy action | Chính sách server PENDING |
| Thiếu/sai field | Tùy nhánh kiểm tra cJSON, thường bỏ hành vi/log warning; có nhánh hello không an toàn với type sai | Không được gọi đây là schema strict; server validation PENDING |
| Control/audio trước hello | Source không có state gate chung; hello có thời hạn 10 s | ĐỀ XUẤT server reject trước READY, nhưng mã/lỗi/state gate PENDING |
| Sai session_id | Các nhánh Application không validate session_id tổng quát | Server phải đối chiếu session đã xác thực theo task 03/04; chưa có runtime |
| Binary length/header sai | Chưa thấy bounds check tại callback | Hợp đồng server PENDING; không thử malformed trên robot thật |
| Message quá lớn | Không xác định limit thư viện firmware từ source có sẵn | Echo server đã chốt max 4096 byte sau ghép fragment, 1009; không áp dụng mặc định cho audio robot |
| Đóng bình thường | Reset socket, không JSON goodbye trên WebSocket | Mã close firmware do dependency chưa xác định; client echo đóng 1000 |
| Lỗi kết nối | Callback đóng/network error; ứng dụng idle/alert | Server echo xử lý disconnect, lỗi nội bộ thử close 1011; robot policy PENDING |

Task 02 đang có quy tắc riêng: binary 1003, text rỗng 1008, UTF-8 sai 1007,
vượt giới hạn 1009, lỗi nội bộ 1011, sai endpoint/peer nonlocal HTTP 403.
`1006` là quan sát khi mất kết nối, **không được gửi như close code**.
Không tự thay những quy tắc này để chạy audio trong task 05.

**ĐỀ XUẤT, PENDING:** message lỗi có correlation/request ID, type `error`,
chuẩn status online/offline, sequence ID, ACK, flow control hoặc resume/replay.
Chưa có schema/field/codes bắt buộc cho các extension này; phải thống nhất
hai phía trước khi đưa vào runtime, không gửi chúng cho firmware như đã hỗ trợ.

## 7. Heartbeat, timeout và reconnect

**SOURCE:** `Protocol::IsTimeout()` so sánh thời điểm nhận cuối cùng:
`duration_cast<seconds>(now-last_incoming_time).count() > 120`. Đây là
kiểm tra khi `IsAudioChannelOpened()` được gọi, không phải timer heartbeat
định kỳ. Callback OnData cập nhật mốc nhận; chưa thấy app-level `ping`/`pong`
message trong WebSocket protocol đã đọc. Đừng đổi “>120 giây, kiểm tra khi
được gọi” thành cam kết ngắt socket chính xác tại 120 giây.

WebSocket `Start()` không mở socket hoặc tạo reconnect timer. Channel được
mở theo tương tác khi cần; callback đóng đưa về idle. Không suy diễn backoff
MQTT/reconnect Wi-Fi thành retry WebSocket có bảo đảm.

**SOURCE — khả năng của dependency có trong workspace:** `main/idf_component.yml`
khai báo `78/esp-ml307 ~3.6.6`; managed component hiện có là 3.6.7,
repository commit `40d99e50367034832a6790c17832ca2cb5b91f8b`. `WebSocket::OnTcpData()`
tự phản hồi control Ping opcode `0x9` bằng Pong `0xA` cùng payload. API `Ping()`
và `OnPong()` cũng có. Tuy vậy `WebsocketProtocol` hiện không gọi `Ping()` hoặc
đăng ký `OnPong()`; chưa có timeout checker cho Pong trong protocol layer. Đây là
bằng chứng capability của dependency trong workspace, không xác nhận board/build Dev 3.

**CẤU HÌNH DEVELOPMENT ĐỀ XUẤT — người dùng cung cấp, Dev 3 chưa xác nhận:**
server gửi control Ping mỗi **20 s**, đợi Pong **10 s**; firmware trả Pong tự động;
telemetry dự kiến **30 s** và độc lập với heartbeat. Source ở trên hỗ trợ nhánh
server-originated Ping/Pong tại dependency; chưa thấy firmware application phát
telemetry mỗi 30 s hoặc xác nhận telemetry schema/được phép tính là hoạt động.
Không coi các giá trị đề xuất này là contract của firmware Dev 3 trước khi họ
xác nhận đúng board, sdkconfig và build.

| Khoản | Hiện trạng | Trạng thái hợp đồng robot |
| --- | --- | --- |
| Firmware chờ hello | 10.000 ms SOURCE | Cần Dev 3 xác nhận giữ nguyên |
| Firmware inactivity | Điều kiện >120 s khi query channel SOURCE | Cần chốt tính liveness/timeout server |
| AI Server echo ping tự động | Tắt trong `scripts/run_dev.py` (`ws_ping_interval=None`) | Cấu hình Development đề xuất 20 s/10 s; chưa tích hợp, firmware build cần Dev 3 xác nhận |
| Telemetry | Chưa có server telemetry/runtime | Đề xuất 30 s, tách heartbeat; schema/nguồn firmware PENDING |
| Client script timeout | Mặc định 5 s từng thao tác, tổng hữu hạn, không tự reconnect | Chỉ client Development, không phải robot contract |
| Retry/backoff/jitter/max attempts | Chưa xác định cho WebSocket robot | PENDING |
| Resume phiên cũ / session mới khi reconnect | Firmware có session_id nhưng không chứng minh resume semantics | PENDING |

## 8. Đối chiếu task 02–04 và phạm vi schema

| Mục | Đã chốt | Code thực tế lúc lập tài liệu | Điểm cần thống nhất |
| --- | --- | --- | --- |
| Task 02 | Echo local, text UTF-8 không rỗng, 4096 byte, không hello/auth | Đã có và đã kiểm tra client TCP trong task 02 | Không tương thích hello/audio robot; không đổi trong task 05 |
| Task 03 | Bảo vệ `/ws/dev-echo`, HTTP 401/403/503 trước accept | `device_auth.py` và Backend client còn rỗng | Thiếu issuer/format/verifier/response/timeout/revocation và ánh xạ MAC/device_id |
| Task 04 | 1 connection/robot, reject mới 409, single worker, shutdown ≤10 s close 1001 | Session model/manager còn rỗng; Uvicorn hiện shutdown 1012 | Cần auth trước register; sửa thứ tự shutdown chỉ sau thiết kế/tích hợp |
| Task 05 | Dùng snapshot workspace để lập dự thảo, phần chưa chốt PENDING | Tài liệu và kiểm tra snapshot/ví dụ | Không coi user chọn source là Dev 3 đã duyệt giao thức |

**Schema runtime robot: PENDING, chưa triển khai.** Giữ `messages.py` và
`validator.py` chưa có model/parser robot thay vì dựng schema strict từ parser C++ vốn permissive
rồi tự áp vào hai phía. Chưa có `parse_message()/validate_message()` robot,
state machine hoặc xác nhận “valid/invalid robot message” bằng Pydantic.
`tests/test_protocol.py` chỉ kiểm tra SHA-256 nguồn firmware trong snapshot và
cú pháp JSON của ví dụ; kết quả đó **không phải kiểm thử validator hoặc robot thật**.
Client script giữ nguyên echo, không tự gửi hello/reboot/audio.

## 9. Checklist xác nhận Dev 3 / Dev 1

Tất cả ô dưới là **PENDING**, chưa ghi nhận xác nhận từ Dev 3:

- [ ] Dev 3 đối chiếu snapshot SHA-256, cung cấp commit nếu có, board/sdkconfig
      và build thực sự sử dụng; chốt wire version 1/2/3.
- [ ] URL/path robot, `ws/wss`, TLS, subprotocol, Origin, cấu hình OTA ưu tiên
      MQTT/WebSocket và các header bắt buộc.
- [ ] Dev 1/Dev 3 chốt issuer/format token, verifier Backend/JWT, service auth,
      timeout, quyền robot, expiry/revoke và MAC → trusted device identity.
- [ ] Xác nhận schema hello hai chiều, field bắt buộc/tùy chọn, unknown fields,
      capabilities, cấp session_id và deadline của server.
- [ ] Chốt sample rate/frame duration/mono, Opus framing version, timestamp,
      byte order, max payload/message, fragment và độ dài header hợp lệ.
- [ ] Chốt thứ tự listen/abort/tts/audio, wake-word audio trước listen.start,
      full duplex/realtime/AEC, error response và hành vi out-of-order.
- [ ] Quyết định message status/error và extension MCP/glyph/notify/custom
      nào được bật; không mặc định mọi board hỗ trợ.
- [ ] Chốt heartbeat/task 06, native ping/pong, inactivity, retry/backoff,
      session mới/resume, duplicate và mã đóng trong từng trường hợp.
- [ ] Thống nhất chuyển từ echo sang robot protocol và kiểm thử task 03/04;
      không coi các quyết định chưa triển khai là tính năng hiện có.
- [ ] Chạy client hợp đồng đã chốt, sau đó robot thật; ghi firmware hash,
      cấu hình, trace đã che token và kết quả riêng từng nền tảng.

## 10. Lệnh kiểm tra và giới hạn nghiệm thu

Từ `AI_SERVER` trên macOS:

```bash
.venv/bin/python -m pytest tests/test_protocol.py -v
.venv/bin/python -m pytest tests/test_health.py tests/test_config.py tests/test_websocket.py tests/test_protocol.py -k 'not real and not cli_real' --basetemp=.test-artifacts/pytest-task05 -v
```

Windows tương đương: thay `.venv/bin/python` bằng
`.\.venv\Scripts\python.exe`. **Windows và robot thật: NOT RUN** trong task 05.
Các test TCP task 02 có lệnh trong README; không dùng lại kết quả lịch sử
để khẳng định đã chạy TCP hoặc robot trong task này.

DoD phần tài liệu/snapshot được báo riêng trong
[`test-report-d2-s1-05.md`](test-report-d2-s1-05.md). Schema runtime, auth,
session, heartbeat, close policy robot và tương thích phần cứng còn PENDING;
**D2-S1-05 chưa được nghiệm thu như một giao thức robot hoàn chỉnh**.
