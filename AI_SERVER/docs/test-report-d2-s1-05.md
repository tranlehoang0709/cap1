# D2-S1-05 — Báo cáo giao thức firmware–AI Server

Ngày thực hiện: 23/10/2026. Phạm vi: kiểm tra tài liệu và snapshot source trong
workspace Windows. **Không chạy robot thật; không tuyên bố tương thích robot.**

## Căn cứ và trạng thái

- Firmware workspace khai báo `PROJECT_VER="2.4.2"`; checkout hiện tại là
  `97c008f02ab23bf98b7f959ec18b0519aac907fb`.
- Chưa xác nhận commit này, board, sdkconfig hoặc build là bản Dev 3 sử dụng.
  Dev 3 chưa cung cấp/xác nhận giao thức; các mục liên quan tiếp tục `PENDING`.
- Tài liệu giao thức ghi rõ hành vi `SOURCE`, hợp đồng đã chốt trong tasks 02–04,
  các điểm `PENDING` và phần `ĐỀ XUẤT`. Echo Development không được coi là endpoint
  robot.
- Không có schema runtime được cài đặt: chưa có hợp đồng firmware đã duyệt để
  định nghĩa model/parser an toàn. `messages.py` và `validator.py` chưa có model.

## Kiểm tra

Lệnh:

```powershell
python -m pytest tests/test_protocol.py -v
```

Kết quả: `pytest` **NOT RUN** vì môi trường hiện tại không có pytest (workspace
không có `.venv`, và `python -m pytest` báo `No module named pytest`). Đã biên dịch
file test bằng `py_compile` và chạy trực tiếp ba assertion của test: **15/15
snapshot hash OK sau chuẩn hóa CRLF/LF; 16/16 ví dụ JSON hợp lệ; trạng thái schema
vẫn PENDING**. Các kiểm tra này không xác nhận behavior mạng, schema runtime hoặc
robot thật.

## Definition of Done

| Tiêu chí | Trạng thái | Ghi chú |
| --- | --- | --- |
| Exact firmware source/version được tham chiếu | FAIL | Có version 2.4.2, commit checkout và SHA-256 snapshot; chưa xác nhận source/build của Dev 3. |
| Nhóm message, audio thực tế được tài liệu hóa | PASS (SOURCE) | Dựa trên snapshot; hợp đồng triển khai còn chờ Dev 3. |
| Direction, fields, examples, ordering | PASS (SOURCE) | Phân biệt quan sát source với quy ước server còn PENDING. |
| Error, closure, heartbeat, reconnect | PASS (SOURCE/PENDING) | Heartbeat/reconnect policy chưa được chốt; task 06 phụ trách implementation heartbeat. |
| Schema nhận/từ chối message hợp lệ/không hợp lệ | NOT RUN | Cố ý chưa triển khai schema robot trước khi hợp đồng được xác nhận. |
| Endpoint/auth/session nhất quán tasks 02–04 | PASS | Mô tả echo/auth/session đúng hiện trạng; task 03/04 policy được ghi là đã chốt nhưng code chưa triển khai. |
| Extension đề xuất được đánh dấu | PASS | Được phân biệt với SOURCE và hợp đồng đã chốt. |
| Dev 3 confirmation chỉ ghi khi thực nhận | PASS | Checklist để trống, trạng thái PENDING. |
| Pending confirmation không báo complete | PASS | Tài liệu nêu rõ draft và giới hạn nghiệm thu. |
| Client-only tests không báo robot compatibility | PASS | Phạm vi test được ghi riêng, không chạy robot. |

## Còn cần Dev 3 xác nhận

Commit/build/board chính xác; endpoint/TLS/subprotocol/headers; wire version;
schema hai chiều và session; Opus framing, kích thước và byte order; message
ordering và xử lý lỗi; heartbeat, timeout và reconnect; robot thật hoặc trace
đã xác thực. Không sửa hợp đồng hiện có trước khi các khác biệt tasks 02–04 được
thống nhất.
