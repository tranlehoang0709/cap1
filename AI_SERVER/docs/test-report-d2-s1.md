# D2-S1-01 — Báo cáo kiểm tra thực tế

Ngày kiểm tra: **22/10/2026**, macOS Darwin, ARM64. Chỉ báo cáo task 01.

## Cấu hình đã được người dùng xác nhận

`AI_SERVER_HOST=127.0.0.1`, `AI_SERVER_PORT=8000`,
`AI_SERVER_RELOAD=true`, `AI_SERVER_LOG_LEVEL=warning`.
File `.env` ban đầu rỗng; chỉ bổ sung bốn giá trị Development này.
Không dùng database, Backend, API key hoặc Device Token.

## Quy định và tài liệu

Đã kiểm tra AGENTS tại thư mục dự án, các thư mục cha và AI_SERVER;
không tìm thấy AGENTS áp dụng tại những vị trí này. `BE/AGENTS.md.txt`
thuộc cây Backend; không chỉnh sửa file đó trong task này.
Tìm thấy `xiaozhi-esp32/PROPOSAL_DOCUMENT.md`, `proposal_document.txt`
và tên tài liệu Proposal ver1.1; chưa tìm thấy tài liệu xác nhận là
Proposal/Feature List V1.5. **Không khẳng định đã đối chiếu V1.5.**
Phạm vi thực hiện theo yêu cầu D2-S1-01 đã được người dùng cung cấp.

## Môi trường và dependency đã cài

Tạo `.venv` mới bằng `/opt/homebrew/bin/python3`, **Python 3.14.3**.
Dependency được cài vào `AI_SERVER/.venv`, không cài global.

| Dependency | Phiên bản thực tế |
| --- | --- |
| FastAPI | 0.159.1 |
| Uvicorn | 0.54.0 |
| pydantic-settings | 2.16.1 |
| pytest | 9.1.1 |
| httpx | 0.28.1 |
| Pydantic | 2.14.1 |
| pydantic-core | 2.50.1 |
| Starlette | 1.9.0 |

Năm dependency trực tiếp được pin trong requirements. Danh sách dependency
đầy đủ đã cài nằm trong `.test-artifacts/dependencies.txt` cục bộ.
Dependency gián tiếp chưa được khóa đầy đủ trong một lockfile; môi trường
cài mới có thể giải quyết phiên bản gián tiếp mới hơn. Dùng `pip check` và
chạy lại test sau khi cài. Không coi Windows đã được xác minh từ kết quả này.

Lần tải PyPI trong sandbox thất bại vì mạng bị chặn. Đã yêu cầu quyền và
cài thành công bằng lệnh sau, không dùng cache ngoài thư mục dự án:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --no-cache-dir -r requirements-dev.txt
```

## Kết quả tự động trên macOS

```bash
.venv/bin/python -m pytest tests/test_health.py tests/test_config.py -v
```

Kết quả cuối: **32 passed in 0.23s**, không warning. Lần chạy cuối lưu tại
`.test-artifacts/pytest.txt` (thời gian thực thi có thể khác giữa các lần).
`pip check`: **No broken requirements found**, exit code 0; lưu tại
`.test-artifacts/pip-check.txt`.

Lần chạy đầu có một lỗi dữ liệu test: chuỗi được dùng làm host sai thực ra
là hostname đúng cú pháp. Đã sửa dữ liệu thành chuỗi chứa `/`, chạy lại PASS.
Đã chuyển kiểm thử HTTP sang `httpx.ASGITransport` và lifespan context rõ
ràng để tương thích bộ dependency đã cài mà không dùng TestClient bị deprecated.

Các test đã thực thi kiểm tra: HTTP 200, JSON chính xác, content type,
startup/shutdown, defaults đã chốt, dotenv, môi trường override cả bốn biến,
độc lập working directory, host đúng/sai, port đúng/sai và biên,
log level/reload sai, lỗi không lộ input, entrypoint truyền settings vào
Uvicorn với reload bật và tắt, thoát code 2 an toàn khi cấu hình sai.

File test rỗng của các task sau **không nằm trong 32 test này**.

## Kiểm tra server thật trên macOS

Đã chạy đúng entrypoint README trong PTY:

```bash
.venv/bin/python scripts/run_dev.py
curl --noproxy '*' --fail-with-body -i http://127.0.0.1:8000/health
```

Kết quả thực tế:

```text
WARNING: AI Server startup
HTTP/1.1 200 OK
content-length: 15
content-type: application/json

{"status":"ok"}
```

Thay mtime của `app/api/health.py` (không đổi nội dung) để kiểm chứng
auto-reload. Log thực tế:

```text
StatReload detected changes in 'app/api/health.py'. Reloading...
WARNING: AI Server shutdown
WARNING: AI Server startup
```

Gọi lại `/health` sau reload: HTTP 200, `{"status":"ok"}`.
Gửi Ctrl+C qua PTY: có `AI Server shutdown`, tiến trình **exit 0**.
Chạy lại ngay cùng lệnh và port 8000: startup thành công,
`/health` HTTP 200. Ctrl+C lần hai: shutdown, **exit 0**.

Override host, port và reload bằng môi trường:

```bash
AI_SERVER_HOST=localhost AI_SERVER_PORT=8001 AI_SERVER_RELOAD=false .venv/bin/python scripts/run_dev.py
curl --noproxy '*' --fail-with-body -i http://localhost:8001/health
```

Kết quả: startup, **HTTP 200**, `{"status":"ok"}` tại port 8001;
Ctrl+C có shutdown, **exit 0**. `.env` giữ nguyên giá trị đã chốt.

Thử cấu hình sai qua tiến trình thật:

```bash
AI_SERVER_PORT=not-an-integer .venv/bin/python scripts/run_dev.py
```

**Exit code 2**, output duy nhất:

```text
Invalid configuration. AI_SERVER_PORT: integer between 1 and 65535
```

Không in giá trị sai, không traceback hay settings dump.

Giới hạn môi trường: sandbox từ chối bind socket/HTTP loopback; các kiểm
tra server thật đã chạy sau khi được cấp quyền. Địa chỉ thử `127.0.0.2:8001`
không bind được trên máy này; app ghi shutdown và thoát 3. Đã dùng hostname
`localhost` được máy hỗ trợ cho kiểm tra host/port cuối cùng, và cập nhật
README tương ứng. Kiểm tra cú pháp host không bảo đảm địa chỉ có sẵn để bind.

## Definition of Done

| Mục | macOS | Bằng chứng |
| --- | --- | --- |
| Cài dependency trong venv mới | PASS | `.venv` mới, pip install exit 0, pip check exit 0 |
| Khởi động đúng lệnh README | PASS | PTY chạy `scripts/run_dev.py`, có startup |
| GET /health HTTP 200 và JSON chính xác | PASS | HTTP thật và test HTTP ASGI |
| Thay host/port có hiệu lực | PASS | `localhost:8001`, HTTP thật |
| Cấu hình sai bị từ chối an toàn | PASS | Tiến trình exit 2; test cả 4 trường |
| Startup/shutdown thực thi đúng | PASS | Test lifespan và log server thật |
| Ctrl+C sạch, chạy lại cùng port | PASS | Hai lần port 8000, exit 0 |
| Health/config test đã chạy | PASS | 32 passed |
| Không secret trong source/log | PASS | Không yêu cầu credentials; log vòng đời cố định; test không lộ input sai |
| Không thay đổi file ngoài AI_SERVER | PASS | Toàn bộ thao tác ghi của task nằm trong AI_SERVER |
| Không thay đổi DB/BE/firmware/Auth-RBAC | PASS | Không kết nối DB và không sửa các source này |
| Không triển khai task tiếp theo | PASS | Kiểm tra các file scaffold ngoài phạm vi còn rỗng |

**Windows: NOT RUN** cho cài dependency, khởi động, HTTP, reload,
Ctrl+C/restart và pytest. README có lệnh PowerShell tương đương; cần chạy
thực tế trên Windows trước khi ghi PASS cho nền tảng đó.

## File thay đổi trong task

- `app/main.py`: `create_app()`, `lifespan()`, `app`.
- `app/core/config.py`: `Settings`, `ConfigurationError`, `get_settings()`.
- `app/api/health.py`: `router`, `health()`.
- `app/core/logging.py`: `configure_logging()`.
- `scripts/run_dev.py`: `main()`; file mới.
- `requirements.txt`, `requirements-dev.txt`: dependency trực tiếp đã pin.
- `.env.example`, `.env`: bốn giá trị Development được xác nhận.
- `.gitignore`: bỏ qua dữ liệu môi trường/cache/test cục bộ.
- `tests/conftest.py`, `tests/test_health.py`, `tests/test_config.py`: fixtures và 32 test.
- `README.md`: hướng dẫn macOS/Windows, cấu hình, run/check/stop, mapping.
- `docs/test-report-d2-s1.md`: báo cáo này.

Artifact cục bộ được ignore: `.venv/`, `.pytest_cache/`, `__pycache__/`,
`.test-artifacts/`. Không commit/push. Mọi tiến trình kiểm tra đã được dừng.
Nếu cần hoàn tác, phục hồi các file đã điền nội dung về checkpoint rỗng
ban đầu và bỏ riêng `scripts/run_dev.py`, sau khi xác nhận không có thay
đổi mới của người dùng; không tự thực hiện thao tác xóa/rollback.

## D2-S1-08 — Kiểm thử kết nối realtime tích hợp

Ngày: **23/10/2026**. Đây là lần kiểm thử workspace Windows hiện tại. Kết quả macOS từ tasks 01–02 trong các phần trên là bằng chứng lịch sử, không thay cho lần chạy tích hợp task 08. Không có token thật nào được dùng hoặc ghi vào report.

### Điều kiện và lệnh đã chạy

- Source AI Server: checkout workspace hiện tại. Firmware: `PROJECT_VER=2.4.2`, checkout `97c008f02ab23bf98b7f959ec18b0519aac907fb`; Dev 3 chưa xác nhận đây là build robot cần kiểm thử. [Giao thức](protocol.md) vẫn là draft/PENDING.
- `device_auth.py`, `session_manager.py`, `heartbeat.py` và các test auth/session/heartbeat/integration đang rỗng. `/ws/dev-echo` không xác thực thiết bị.
- Không có valid Development test device/token, backend endpoint/mock contract, phiên bản client/firmware được Dev 3 xác nhận hoặc concurrency target được thống nhất.
- Đã chạy:

```powershell
python -m pytest tests\test_health.py tests\test_config.py tests\test_websocket.py tests\test_device_auth.py tests\test_sessions.py tests\test_heartbeat.py tests\test_logging.py tests\integration\test_realtime.py -v
```

Kết quả: **không thu thập/không chạy test**; Python 3.14 báo `No module named pytest`. ASGI import smoke cũng không chạy được do thiếu `pydantic_settings`. Không khởi chạy server/client, không tạo tình huống network loss và không chạy concurrency.

### Ma trận 12 case

| # | Setup, bước chạy, kết quả mong đợi | Kết quả thực tế / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| 1 | Cài dependencies; chạy server, GET `/health`, dừng sạch. Mong đợi startup, HTTP 200 và shutdown. | Không chạy được: thiếu pytest và `pydantic_settings`; test hiện có `test_health.py`; task 01 có bằng chứng macOS lịch sử riêng. | NOT RUN |
| 2 | Chạy server loopback; WebSocket handshake rồi gửi/nhận echo text. Mong đợi handshake và payload được echo nguyên vẹn. | Không chạy được trong lần này; `/ws/dev-echo` là echo local hiện có, không phải giao thức robot. Task 02 có báo cáo TCP lịch sử. | NOT RUN |
| 3 | Dùng token thiếu/sai/hết hạn/thu hồi và thiết bị không quyền. Mong đợi 401/403 theo contract, không accept. | Không chạy: auth runtime, token test và device policy chưa có. | NOT RUN |
| 4 | Backend mock trả timeout/lỗi/response sai. Mong đợi fail closed, không bypass auth. | Không chạy: chưa có Backend client/mock contract hoặc auth flow. | NOT RUN |
| 5 | Đóng WebSocket bình thường, dừng process/network riêng biệt. Mong đợi cleanup; network loss được ghi đúng là abrupt loss. | Không chạy lần này; không mô phỏng network loss. Test transport cũ không được tính thành kết quả task 08. | NOT RUN |
| 6 | Gửi heartbeat và để quá timeout. Mong đợi healthy connection giữ và timeout dọn session/task. | Người dùng đề xuất server Ping 20 s/Pong timeout 10 s, telemetry 30 s riêng. Workspace dependency có auto-Pong, nhưng server chưa tích hợp timeout/cleanup, telemetry chưa xác nhận; pytest/dependency thiếu. | NOT RUN |
| 7 | Ngắt rồi kết nối lại. Mong đợi theo reconnect policy đã thống nhất. | Không chạy: reconnect policy chưa xác nhận và client không tự reconnect. | NOT RUN |
| 8 | Kết nối trùng cùng robot. Mong đợi xử lý theo policy task 04. | Không chạy: SessionManager/runtime chưa có; policy chỉ được ghi ở tài liệu task 04, chưa tích hợp code. | NOT RUN |
| 9 | Gửi malformed/unsupported/oversized. Mong đợi close/error đúng contract và giới hạn bytes. | Không chạy lần này vì môi trường thiếu dependency; `/ws/dev-echo` focused tests có case binary/empty/oversize nhưng không thể gọi là đã pass task 08. | NOT RUN |
| 10 | Kết nối đồng thời số robot đã thống nhất. Mong đợi mọi session tách biệt. | Không chạy: target concurrency chưa được Dev 1/3 thống nhất. Không suy ra production capacity. | NOT RUN |
| 11 | Restart server khi client/session đang hoạt động rồi reconnect. Mong đợi session cũ đóng, reconnect đúng policy, không orphan. | Không chạy: session/reconnect runtime chưa có; không restart server trong lượt này. | NOT RUN |
| 12 | Theo dõi task/session registry và log sau tất cả luồng. Mong đợi không orphan và không có secret/audio/conversation. | Không chạy tích hợp; không có registry session/task để kiểm kê. Không dùng secret/token; log design hiện không ghi payload. | NOT RUN |

### Defect và phụ thuộc còn lại

| Severity | Vấn đề / tái hiện | Owner |
| --- | --- | --- |
| Blocker | Không thể xác thực tích hợp robot: auth/session/heartbeat chưa triển khai, Dev 3 protocol/firmware còn PENDING. | Dev 1/Dev 3 xác nhận contract; AI Server owner triển khai tasks bị thiếu |
| Blocker | Không thể chạy bộ pytest trong môi trường hiện tại: `python -m pytest` báo thiếu pytest; import app thiếu `pydantic_settings`. | Môi trường test/AI Server owner |
| High | Không có test token, backend endpoint/mock contract hoặc concurrency target để thực hiện case tương ứng. | Dev 1/Dev 3 cung cấp cấu hình test an toàn |

Không sửa code runtime trong task 08 vì không có test tích hợp nào thực thi được; không đổi firmware, Backend, database hoặc contract chưa được duyệt.

### DoD task 08

| Điều kiện | Trạng thái | Ghi chú |
| --- | --- | --- |
| Startup, health, shutdown | NOT RUN | Pytest và dependency `pydantic_settings` không có trong môi trường hiện tại. |
| WebSocket hợp lệ, message exchange | NOT RUN | Chưa chạy client/server task 08. |
| Token invalid/expired/revoked và Backend fail closed | NOT RUN | Auth và Backend validation runtime chưa có. |
| Disconnect/heartbeat/reconnect/duplicate cleanup | NOT RUN | Session/heartbeat implementation và policy xác nhận chưa có. |
| Invalid/unsupported/oversized | NOT RUN | Có focused tests cũ cho echo nhưng task 08 không thực thi được. |
| Concurrency ở target đã thống nhất | NOT RUN | Target chưa được Dev 1/Dev 3 cung cấp. |
| Restart/reconnect và không orphan | NOT RUN | Session registry/reconnect runtime chưa có. |
| Không lộ secret và không dùng production capacity claim | PASS (phạm vi báo cáo) | Không dùng token hoặc chạy concurrency; không có claim 20 robots/1 second. |
| Mọi case có trạng thái/evidence | PASS (tài liệu) | Ma trận 12 case ghi setup, kỳ vọng, thực tế, lý do và trạng thái. |
| Previous tests remain passing | NOT RUN | Không có pytest/dependency trong môi trường chạy hiện tại; historical task 01–02 evidence được giữ riêng. |

Không có kết quả case nào được đánh dấu PASS cho lần tích hợp task 08 này.

### Bổ sung sau khi xác nhận cấu hình Development

Người dùng yêu cầu dùng cấu hình Development hiện có để đối chiếu firmware. Giá trị đọc từ `.env.example`: `AI_SERVER_HOST=127.0.0.1`, `AI_SERVER_PORT=8000`, `AI_SERVER_LOG_LEVEL=warning`, `AI_SERVER_RELOAD=true`, `AI_SERVER_WS_MAX_MESSAGE_BYTES=4096`; endpoint client local là `ws://127.0.0.1:8000/ws/dev-echo`. Đây là cấu hình server local; không có test token.

Đối chiếu giao thức: firmware WebSocket lấy URL/token/version từ Settings, gửi header tùy cấu hình, gửi client `hello` và chờ server `hello`; Dev echo chỉ loopback, không auth, không reserve session, không triển khai protocol handler. Nó echo bytes text, không phải backend robot đã xác nhận. Firmware/board/build Dev 3 vẫn PENDING; do đó không kết nối robot vào endpoint này và firmware compatibility là **NOT RUN**.

Cài dependency trong venv macOS rồi chạy lệnh đã ghi trong README là bước kế tiếp để thực thi local Development cases 1–2, 5 và 9. Không đưa token vào source, command line hoặc report. Các case auth/backend/session/heartbeat/reconnect/concurrency vẫn chờ contract và fixtures Dev 1/Dev 3.

### Heartbeat proposal comparison — bổ sung 23/10/2026

Cấu hình Development được người dùng đề xuất: AI Server control Ping mỗi 20 giây, Pong timeout 10 giây, robot phản hồi Pong; telemetry 30 giây và độc lập. Source dependency `78/esp-ml307` trong workspace xử lý Ping nhận được bằng Pong echo và cung cấp `Ping()`/`OnPong()`, nhưng protocol layer không dùng API chủ động và server hiện tắt Uvicorn ping. Đây mới là capability của source dependency, không phải xác nhận build Dev 3. Server heartbeat/timeout/session cleanup và telemetry chưa được tích hợp; heartbeat test vẫn NOT RUN. Chi tiết nằm trong `protocol.md` mục 7.
