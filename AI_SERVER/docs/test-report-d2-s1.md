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
