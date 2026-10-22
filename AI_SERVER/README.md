# AIVA-IoT AI Server — D2-S1-01 và D2-S1-02

Server độc lập bằng Python/FastAPI: cấu hình, vòng đời, `GET /health`
và WebSocket echo Development. Health xác nhận ứng dụng đang chạy;
không kiểm tra MySQL, Backend, thiết bị hoặc AI provider.

Chưa triển khai giao thức robot, device authentication, session, heartbeat,
STT/LLM/TTS, API AI hoặc hệ thống log task 07. Các file trống của task 03–08
được giữ nguyên; không coi chúng là chức năng đã triển khai/kiểm thử.

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

Đọc [báo cáo task 02](docs/test-report-d2-s1-02.md) để xem căn cứ firmware,
kết quả TCP thực tế, DoD và các điểm chờ Dev 3. `docs/protocol.md` và các
file schema task 05 vẫn rỗng vì chưa có hợp đồng robot được duyệt.

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
.venv/bin/python -m pip check
```

Windows:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_health.py tests/test_config.py tests/test_websocket.py --basetemp=.test-artifacts/pytest-task02 -v
.\.venv\Scripts\python.exe -m pip check
```

Test cô lập `.env` cá nhân và các biến `AI_SERVER_*` của shell. Bao gồm
health, startup/shutdown, host/port hợp lệ và sai, log level/reload,
ưu tiên môi trường hơn `.env`, lỗi an toàn và tham số entrypoint.
Các file test rỗng của task sau không nằm trong bằng chứng kiểm thử.
`tests/test_websocket.py` có test ASGI và test mạng TCP thật. Test TCP khởi
động `run_dev.py` ở port loopback tạm, timeout hữu hạn, dừng tiến trình khi
kết thúc. Cần môi trường cho phép bind socket loopback. Không thay thế các
test này bằng TestClient rồi coi là đã kiểm tra transport.

## Vòng đời và lỗi

`lifespan()` ghi startup trước khi phục vụ và shutdown khi thoát. Không có
tài nguyên giả, kết nối database hoặc client AI cần cleanup. Logger cơ bản
chỉ ghi hai thông điệp cố định, không dump settings. Để nhìn thấy hai sự kiện
ở ngưỡng `warning` đã chọn, chúng dùng mức cao hơn giữa INFO và log level
đã cấu hình; `WARNING: AI Server startup` không biểu thị lỗi khởi động.
Log Uvicorn vẫn theo đúng `AI_SERVER_LOG_LEVEL`.
Uvicorn 0.54.0 ghi ERROR và traceback cho UTF-8 sai đã được xử lý ở tầng
transport, sau đó đóng `1007`. Đây là lỗi input có chủ đích trong test;
không phải exception thoát khỏi handler và không làm dừng server.

Cấu hình sai: entrypoint thoát code 2, báo tên biến và điều kiện hợp lệ,
không in input, settings hoặc traceback. Hostname hợp lệ về cú pháp nhưng
không tồn tại trên máy/mạng, port đang bị chiếm hoặc địa chỉ không thể bind
sẽ bị hệ điều hành/Uvicorn từ chối lúc khởi động. Giải phóng port hoặc chọn
host/port hợp lệ rồi chạy lại; không tự dừng tiến trình khác.

## Mapping source

| File | Function/class | Vai trò |
| --- | --- | --- |
| `app/main.py` | `create_app()`, `lifespan()`, `app` | Factory, vòng đời và ASGI app cho Uvicorn |
| `app/core/config.py` | `Settings`, `get_settings()`, `ConfigurationError` | Đọc/validate cấu hình và lỗi an toàn |
| `app/api/health.py` | `router`, `health()` | `GET /health` |
| `app/api/websocket.py` | `router`, `websocket_endpoint()` | Echo local, kiểm tra message và cleanup socket |
| `app/core/logging.py` | `configure_logging()` | Logger vòng đời cơ bản |
| `scripts/run_dev.py` | `main()` | Chạy Uvicorn theo cấu hình |
| `scripts/ws_client.py` | `main()`, `exchange()`, `local_url()`, `positive_timeout()` | Client local có timeout và báo lỗi |
| `tests/conftest.py` | `isolated_settings`, `dotenv_file` | Cô lập settings/test dotenv |
| `tests/test_health.py` | `test_health_and_lifespan()` | HTTP health và hai sự kiện vòng đời |
| `tests/test_config.py` | `test_*` | Validation, ưu tiên cấu hình, entrypoint |
| `tests/test_websocket.py` | `test_*`, `live_server`, `drive_endpoint()` | ASGI, TCP thật và timeout client |

Không tìm thấy Proposal/Feature List xác nhận phiên bản V1.5. Có tài liệu
Proposal cũ trong `../xiaozhi-esp32/` nhưng không xác nhận đó là V1.5.
Phạm vi triển khai theo yêu cầu D2-S1-01 của người dùng.
