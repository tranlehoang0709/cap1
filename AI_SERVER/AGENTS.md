# Bản đồ luồng AI_SERVER

Tài liệu này ghi luồng chạy hiện có trong mã nguồn. Cột **Ghi chú** tối đa 20 ký tự.

## Luồng chạy

| Từ | Qua | Ghi chú |
|---|---|---|
| `scripts/run_dev.py` | `app.main:app` | Chạy Uvicorn |
| `app.main:create_app()` | `app.core.config` | Nạp cấu hình |
| `app.main:create_app()` | `app.api.health` | Gắn router health |
| `app.main:create_app()` | `app.api.device_profiles` | Gắn router hồ sơ |
| `app.main:create_app()` | `app.api.websocket` | Gắn router WS |
| `app.main:lifespan()` | `app.core.logging` | Log vòng đời |
| `GET /health` | `app.api.health:health()` | Trả trạng thái |
| `GET /device-profiles` | `app.api.device_profiles:list_profiles()` | Liệt kê board |
| `GET /device-profiles/{id}` | `app.api.device_profiles:read_profile()` | Đọc hồ sơ board |
| `api.device_profiles` | `app.devices.catalog` | Tra catalog |
| `app.devices.catalog` | `DeviceProfile.display` | Profile màn hình |
| `app.devices.catalog` | `DeviceProfile.microphone` | Profile mic I2S |
| `app.devices.catalog` | `DeviceProfile.speaker` | Profile loa I2S |
| `app.devices.catalog` | `DeviceProfile.audio_loopback` | Profile loopback |
| `app.devices.catalog` | `DeviceProfile.memory` | Profile bộ nhớ |
| `app.devices.catalog` | `DeviceProfile.usb_serial` | Profile USB serial |
| `app.devices.catalog` | `DeviceProfile.buttons` | Profile nút bấm |
| `app.devices.catalog` | `esp32-s3-n16r8-tft-240x320` | Sơ đồ SD2 |
| `WS /ws/dev-echo` | `app.api.websocket:websocket_endpoint()` | Echo text local |
| `websocket_endpoint()` | `app.core.logging` | Log kết nối |
| `websocket_endpoint()` | `app.core.config.Settings` | Byte tối đa |
| `scripts/ws_client.py` | `WS /ws/dev-echo` | Thử echo local |

## Chưa thuộc luồng chạy

Các module `app/services`, `app/clients`, `app/protocol` và `app/models` hiện chưa được endpoint gọi trong luồng ứng dụng đang chạy.

## Quy tắc cập nhật

Khi thêm, sửa hoặc xóa chức năng làm đổi luồng chạy, hãy cập nhật bảng này trong cùng thay đổi mã nguồn: thêm/bỏ các cạnh liên quan, kiểm tra đường dẫn và tên hàm, giữ mỗi ghi chú không quá 20 ký tự. Cập nhật cả khi đổi endpoint, cấu hình hoặc điểm khởi chạy. Bảng này được duy trì cùng các thay đổi do tác nhân lập trình thực hiện; nó không tự quét thay đổi ngoài quy trình đó.

## Quy tắc sơ đồ Dev 1 / Sprint 1

- Cập nhật từng mục theo thứ tự người dùng yêu cầu; profile SD2 được thêm riêng.
- Chỉ thêm dữ liệu hoặc chức năng cho mục mới; không xóa, ghi đè hay thay thế chức năng đã chạy.
- Nhiều sơ đồ phải cùng tồn tại trong một AI Server. Mỗi board dùng `profile_id` riêng; thành phần mới được thêm vào profile liên quan, không biến thành cấu hình chung áp lên mọi board.
- Giữ nguyên trạng thái và thông số trong sơ đồ đầu vào. Phân biệt rõ `reported_pass`, `pending` và `not_tested`; không tự tuyên bố đã kiểm thử phần cứng.
- Thêm hoặc sửa test cho mục mới, giữ test cũ chạy; cập nhật README và bảng luồng này nếu thay đổi API hoặc luồng thực thi.
- Nếu thiếu thông số cần thiết hoặc sơ đồ mâu thuẫn, đánh dấu pending và hỏi người dùng trước khi suy đoán hành vi phần cứng.
