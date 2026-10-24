# D2-S1-07 — Báo cáo logging và xử lý lỗi

Ngày thực hiện: 23/10/2026. Log application được xác nhận là **console-only** từ
cấu hình task 01 và README; không có yêu cầu file log, rotation hay retention.
Không thêm file handler.

## Thay đổi

- `app/core/logging.py`: `configure_logging()`, `get_logger()`,
  `redact_sensitive()`, `log_event()`; JSON UTC, event name, allowlist context,
  hash session/device references, redaction và traceback stack không kèm thông điệp exception.
- `app/main.py`: startup/shutdown giữ nguyên severity đã xác nhận và không để lỗi
  logger cản startup/shutdown.
- `app/api/websocket.py`: connection ID ngẫu nhiên, accepted/rejected,
  disconnect, server close và exception events; không ghi IP, header hay payload.
- `tests/test_logging.py`: redaction, format/level, handler idempotence,
  traceback an toàn và logger lỗi không thoát ra ngoài.
- `README.md`: nơi ghi log, định dạng, mức log và lệnh kiểm thử.

Auth, session và heartbeat chưa được triển khai ở các task trước, do đó chưa có
flow runtime tương ứng để instrument; không tạo event giả.

## Kiểm thử

- `python -m pytest tests/test_logging.py tests/test_health.py tests/test_websocket.py -v` — **NOT RUN**: môi trường không có pytest.
- `python -m py_compile app/core/logging.py app/main.py app/api/websocket.py tests/test_logging.py` — kết quả ghi nhận khi chạy tại workspace.
- ASGI/WebSocket smoke test — **NOT RUN**: thiếu `pydantic_settings` trong Python môi trường hiện tại.
- File logging/rotation/retention — **NOT RUN / NOT CONFIGURED** (console-only).
- Robot thật, authentication/session/heartbeat integration — **NOT RUN**.

## Definition of Done

| Tiêu chí | Trạng thái | Ghi chú |
| --- | --- | --- |
| Lifecycle và kết nối log | PASS (code) | Startup/shutdown, WS accepted/rejected/disconnected/closed. |
| Auth failure và timeout traceable | NOT RUN | Auth/heartbeat runtime chưa tồn tại. |
| Safe session/correlation reference | PASS (code) | Per-connection random ID; chưa có session/device ID xác thực. |
| Secrets, audio, conversation redacted/not logged | PASS (code) | Allowlist context, redaction, không log message payload. |
| Normal disconnect phân biệt với failure | PASS (code) | Disconnect INFO, exception ERROR. |
| Unexpected exceptions có traceback an toàn | PASS (code) | Stack và loại exception; ẩn message exception. |
| Không duplicate handler | PASS (code) | Tagged console handler cài idempotent. |
| Logging không cản cleanup/shutdown | PASS (code) | Event logging và lifecycle logging swallow lỗi logger. |
| Logging tests pass | NOT RUN | pytest chưa cài trong Python môi trường này. |
| Previous health/WebSocket/auth/session/heartbeat tests pass | NOT RUN | pytest chưa cài; auth/session/heartbeat tests hiện rỗng và tính năng chưa có. |
| Client/robot result phân biệt | PASS | Chỉ code và test Development; robot thật chưa chạy. |
| File logging | NOT RUN | Không được yêu cầu; console-only. |

