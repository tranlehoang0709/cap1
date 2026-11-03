# D2-S1-02 — WebSocket Development transport

Ngày kiểm tra: **22/10/2026**, macOS ARM64, Python **3.14.3**.
Thực hiện trong `AI_SERVER`, kế thừa task 01. Chỉ thử với client phần mềm
trên loopback; **robot thật: NOT RUN; tương thích Xiaozhi: chưa xác nhận**.

## Kiểm tra trước khi code

- Baseline health/config: **32 passed in 0.23s**.
- Chạy `scripts/run_dev.py` từ source task 01, GET `/health` thật tại port
  8000: **HTTP 200**, `{"status":"ok"}`. Ctrl+C: shutdown, exit 0.
- Không có AGENTS riêng tại root dự án/AI_SERVER. Không sửa source firmware.
- `docs/protocol.md`, `app/protocol/messages.py`, `app/protocol/validator.py`
  còn rỗng; chưa có hợp đồng Dev 3/task 05 được cung cấp trong workspace.
- Chưa tìm thấy Proposal/Feature List xác nhận là V1.5; không khẳng định
  đã đối chiếu V1.5. Giữ nguyên giới hạn này từ báo cáo task 01.
- Đã báo căn cứ firmware và hỏi hợp đồng trước khi code. Người dùng xác nhận
  toàn bộ hợp đồng echo Development dưới đây trong chat.
- Lưu checkpoint các file dự kiến sửa ở
  `.test-artifacts/d2-s1-02-before/`, không commit/push.

## Căn cứ firmware

| File / function | Kết quả đọc source |
| --- | --- |
| `../xiaozhi-esp32/main/protocols/websocket_protocol.cc:79`, `WebsocketProtocol::OpenAudioChannel()` | Đọc URL/token/version từ Settings namespace `websocket`; URL bao gồm endpoint do cấu hình quyết định; không hardcode path |
| Cùng file, dòng 97–106 | Header Authorization khi có token, Protocol-Version, Device-Id, Client-Id |
| Cùng function, dòng 168–188 | Connect URL, gửi hello, chờ server hello tối đa 10 giây |
| Cùng file, dòng 198, `GetHelloMessage()` | JSON `type=hello`, version, features, transport=websocket, audio_params: Opus/16000 Hz/mono/frame_duration |
| Cùng file, dòng 224, `ParseServerHello()` | Kiểm tra transport, đọc session_id/audio_params nếu có, đánh dấu đã nhận hello |
| `../xiaozhi-esp32/main/protocols/websocket_protocol.h:27` | Protocol version mặc định 1, có thể được cấu hình override |
| `../xiaozhi-esp32/main/ota.cc:167–183` | Cấu hình websocket từ phản hồi OTA được ghi vào Settings |
| `../xiaozhi-esp32/docs/websocket.md` | Tài liệu mô tả luồng hello và text JSON/binary audio, được đối chiếu với source trên |

Không thấy `Sec-WebSocket-Protocol` được đặt trong code protocol đã đọc.
Thư viện `web_socket.h` được include nhưng implementation dependency không
có sẵn trong workspace; **chưa kết luận tuyệt đối rằng mọi build firmware
không dùng subprotocol**. Cần Dev 3 xác nhận cùng build/transport cụ thể.

Echo Development không trả server hello, không parse JSON/Opus và không
triển khai hành vi firmware ở trên. Không đổi cấu hình robot sang endpoint
này để sử dụng thực tế.

## Hợp đồng thử nghiệm đã xác nhận

- URL: `ws://127.0.0.1:8000/ws/dev-echo`.
- Handshake WebSocket chuẩn; thành công HTTP 101, không custom header/token
  và không chọn subprotocol. Không gửi message chào tự động.
- Chỉ cho peer loopback. Peer khác bị từ chối trước accept (HTTP 403).
  Không tin X-Forwarded-For vì entrypoint đặt `proxy_headers=False`.
- Message hợp lệ: text UTF-8 không rỗng; echo nguyên văn, cùng kiểu text.
  Khoảng trắng và JSON dạng text không được diễn giải hay sửa đổi.
- Giới hạn mặc định 4096 byte/message sau ghép fragment. Emoji 4 byte vẫn
  tính theo byte; không dùng số ký tự. Biến `AI_SERVER_WS_MAX_MESSAGE_BYTES`
  cho phép giảm xuống 1–4096, không nâng quá hợp đồng hiện tại.
- Binary trong giới hạn: close 1003. Text rỗng: 1008. UTF-8 sai: 1007.
  Quá giới hạn: 1009. Lỗi nội bộ khi còn mở: thử close 1011.
- Tầng transport kiểm tra giới hạn trước handler, nên quá giới hạn luôn
  có thể bị 1009 trước kiểm tra kiểu message.
- Client bình thường đóng 1000. Khi mất TCP có thể nhận 1006; không gửi
  thêm data sau disconnect, không giả định còn có thể gửi close frame.
- Không có session manager, Device Token, heartbeat, audio pipeline hay AI.
- Uvicorn dùng `websockets-sansio`, giới hạn message được truyền vào server;
  handler kiểm tra byte thêm một lần. Compression và ping định kỳ tắt.

## Source và dependency thay đổi

| File | Function / thay đổi |
| --- | --- |
| `app/api/websocket.py` | `router`, `websocket_endpoint()`: local-only, accept, receive/send, close codes, xử lý disconnect/lỗi, cleanup socket trong finally |
| `app/main.py` | `create_app()` đăng ký WebSocket router bên cạnh health |
| `app/core/config.py` | `Settings.ws_max_message_bytes`, validator, lỗi cấu hình an toàn |
| `scripts/run_dev.py` | `main()` truyền ws implementation, max size, tắt ping/compression/proxy headers |
| `scripts/ws_client.py` | `main()`, `exchange()`, `local_url()`, `positive_timeout()`: client hữu hạn, URL local, timeout, echo chính xác, đóng và báo lỗi |
| `tests/test_websocket.py` | ASGI handler/route, lỗi send/receive, cleanup, timeout client; fixture server thật và test TCP |
| `tests/test_config.py` | Kiểm tra limit, validation, env override, tham số thực tế truyền vào Uvicorn |
| `requirements.txt` | Thêm `websockets==17.3` vì server và client đều cần |
| `.env.example` | Thêm mẫu `AI_SERVER_WS_MAX_MESSAGE_BYTES=4096` |
| `README.md` | Hướng dẫn hai terminal, hợp đồng Development, giới hạn, test, mapping và lưu ý chưa tương thích robot |
| `docs/test-report-d2-s1-02.md` | Báo cáo task 02 này |

`requirements-dev.txt` kế thừa requirements runtime nên không cần sửa.
Không ghi đè `.env`. Không thay đổi file ngoài `AI_SERVER`, database,
Backend, frontend, firmware hoặc Authentication/RBAC. Các scaffold task
03–08, schema và `docs/protocol.md` vẫn rỗng.

Dependency chính đã dùng: FastAPI 0.159.1, Uvicorn 0.54.0,
pydantic-settings 2.16.1, websockets 17.3, pytest 9.1.1, httpx 0.28.1.
`pip check`: **No broken requirements found**, exit 0. Không cài global.
Sandbox chặn mạng/bind socket; cài dependency và kiểm tra TCP thật đã chạy
sau khi được cấp quyền.

## Lệnh tái chạy trên macOS

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

Đã chạy đúng hai lệnh client/health này với server thực tại port 8000,
reload bật, log warning. Client output thực tế (exit 0):

```text
Handshake OK (Development echo; no Xiaozhi compatibility claim)
Echo OK: 19 UTF-8 bytes
Connection closed cleanly (1000)
```

HTTP `/health`: **200**, content-type application/json, `{"status":"ok"}`.
Ctrl+C server: `AI Server shutdown`, **exit 0**.

Lệnh test thực tế đã chạy:

```bash
.venv/bin/python -m pytest tests/test_health.py tests/test_config.py tests/test_websocket.py --basetemp=.test-artifacts/pytest-task02-live -v --junitxml=.test-artifacts/d2-s1-02-results.xml
```

Kết quả cuối: **60 passed in 6.68s**, exit 0, không warning.
JUnit cục bộ: `.test-artifacts/d2-s1-02-results.xml`.
Log server từng test nằm dưới `.test-artifacts/pytest-task02-live/`.

60 ca gồm **39 health/config**, **11 ASGI/timeout client** và **10 TCP thật**.
TCP dùng client websockets 17.3, server Uvicorn chạy bằng entrypoint thực
trên loopback port tạm; không thay thế bằng TestClient. Mỗi tiến trình test
có timeout và SIGINT cleanup, kiểm tra exit 0/startup/shutdown.

## DoD và giới hạn bằng chứng

| Mục | macOS | Bằng chứng |
| --- | --- | --- |
| Task 01 và GET /health vẫn hoạt động | PASS | Baseline 32 test, regression health/config, HTTP thật port 8000 và các fixture TCP |
| Handshake endpoint đã chốt | PASS | Client thật nhận HTTP 101 và subprotocol None |
| Gửi/nhận đúng message | PASS | ASCII, Unicode, whitespace ASGI, biên 4096 byte và fragmented text |
| Client close bình thường không lỗi không xử lý | PASS | Close 1000; không exception ASGI; client CLI exit 0 |
| Client ngắt đột ngột không crash server | PASS | Abort TCP client đầu, client thứ hai tiếp tục echo, client mới kết nối lại |
| Message sai được xử lý đúng hợp đồng | PASS | TCP: empty 1008, binary 1003, invalid UTF-8 1007; ASGI: lỗi nội bộ 1011 |
| Message quá lớn trên server thật | PASS | ASCII 4097 byte, Unicode 4100 byte và tổng fragment 4097 byte đều close 1009; client cho phép nhận 65536 nên không tự gây lỗi giới hạn |
| Hai client hoạt động độc lập | PASS | Đồng thời gửi first/second, mỗi client nhận đúng message của mình |
| Client lỗi không ảnh hưởng kết nối còn lại | PASS | Peer khỏe vẫn echo sau peer sai/oversize và sau TCP abort |
| Lệnh tái chạy và test thực tế | PASS | README, lệnh/exit code/output ở trên; JUnit 60 pass |
| Ghi rõ client hay robot | PASS | Chỉ client phần mềm loopback; robot thật NOT RUN |
| Không báo tương thích Xiaozhi khi chưa xác nhận | PASS | Echo Development riêng, không hello/schema robot |

Peer không phải loopback được kiểm tra từ ASGI scope giả lập; chưa thử từ
máy LAN thật. Lỗi nội bộ 1011 được kiểm tra bằng lỗi send/receive giả lập
tại ASGI, không tạo backdoor gây lỗi trong server thật. Timeout nhận của
client được kiểm tra với kết nối im lặng giả lập.

Uvicorn 0.54.0 dùng `logger.exception()` khi gặp UnicodeDecodeError tại
tầng decoder: có ERROR/traceback cho UTF-8 sai, nhưng đóng đúng 1007 và
server tiếp tục chạy. Test chỉ cho phép traceback được xử lý cụ thể này;
không bỏ qua `Exception in ASGI application` hoặc lỗi teardown khác.
Lần test đầu nhận đúng 1007 nhưng assertion cấm mọi traceback bị fail ở
teardown; đã sửa assertion theo hành vi source Uvicorn và chạy lại toàn bộ.
Không sửa thư viện hoặc tắt logger để giấu lỗi.

**Windows: NOT RUN** cho cài dependency, server/client, TCP và pytest.
README có lệnh PowerShell; không dùng kết quả macOS để ghi PASS Windows.

## Dev 3 cần xác nhận trước các task tiếp theo

1. Endpoint robot chính thức, nguồn cấp URL qua cấu hình/OTA và version
   firmware/protocol dùng để kiểm tra tương thích (mặc định firmware là 1).
2. Header bắt buộc, cách cấp/kiểm tra Device Token, ý nghĩa Device-Id và
   Client-Id; có dùng subprotocol hoặc Origin policy trên build thực tế không.
3. Schema client/server hello: trường bắt buộc/tùy chọn, features, audio_params,
   session_id, thời hạn hello và phản hồi khi không hỗ trợ protocol.
4. Các message tiếp theo, text/binary framing theo version 1/2/3, giới hạn byte
   và audio frame; quyền sở hữu session và trách nhiệm quản lý vòng đời.
5. Close/error codes cho protocol robot, reconnect, heartbeat và timeout.

Các điểm trên là thông tin bàn giao, chưa được triển khai trong task 02.
Không tự gửi tin cho Dev 3. Mọi server test đã được dừng; không commit/push.
