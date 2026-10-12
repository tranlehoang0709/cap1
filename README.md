# AIVA-IoT Frontend

Frontend Streamlit theo mẫu User/Admin, tông navy xanh tím. Mọi thao tác dùng dữ liệu trong phiên, chưa gọi backend, database, AI hoặc robot.

## Chạy trên Windows

```powershell
cd E:\captone\frontend
.\.venv\Scripts\python.exe -m streamlit run app.py
```

Nếu chưa có venv, tạo môi trường Python và cài `requirements.txt`. Chạy từ thư mục frontend để áp dụng `.streamlit/config.toml`.

## Tài khoản demo

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Admin | admin@example.test | Demo123! |
| User có 3 robot | user@example.test | Demo123! |
| User chờ duyệt | new@example.test | Demo123! |

Dữ liệu giữ trong cùng phiên khi đổi vai trò. Phiên mới khởi tạo lại dữ liệu demo.

## Màn hình

User có 8 mục: Dashboard, AI Chat, Thiết bị của tôi, Cấu hình trợ lý AI, API Key cá nhân, Lịch sử hội thoại, Quyền riêng tư, Tài khoản. Bộ nhớ/tài liệu nằm trong tab Lịch sử; thống kê trong Dashboard.

Admin có đăng nhập và 8 mục: Dashboard, Quản lý người dùng, Quản lý thiết bị, AI Management, API Key & Quota, OTA Firmware, Logs & Monitoring, System Settings.

Thao tác demo: thêm/sửa/khóa/xóa người dùng, phân quyền, đăng ký/duyệt ghép robot, gán/hủy liên kết, đổi tên robot, bật/tắt provider, cấu hình trợ lý/tốc độ giọng, quản lý API Key, tìm/lọc/phân trang, tạo/tiếp tục/kết thúc/xóa chat, quyền riêng tư, quota, upload metadata firmware và tạo bản ghi OTA, cấu hình hệ thống/thông báo, đổi hồ sơ/mật khẩu. Đóng đăng ký có hiệu lực trong demo. User chưa có robot vẫn xem các trang theo mẫu; ghép nối cần Admin duyệt.

## Giới hạn và nối backend

Chat trả câu trả lời mẫu; Internet Search không truy cập mạng. TTS chưa phát âm thanh. Kiểm tra key/provider không gọi dịch vụ. Telemetry/tài nguyên/thống kê là dữ liệu mẫu. OTA không flash robot. Khôi phục mật khẩu không gửi email. Ghi nhớ đăng nhập chỉ trong phiên. Cấu hình thông báo/ghi log chi tiết chỉ lưu lựa chọn để nối backend.

`ui/state.py` tập trung nguồn dữ liệu demo; `ui/portal.py` bố cục màn hình; `ui/theme.py` giao diện; `ui/user.py`, `ui/admin.py`, `ui/auth.py` các thao tác. Chưa triển khai HTTP client/endpoint khi chưa có API contract. Khi nối backend, thay đọc/ghi session trong các thao tác bằng client của nhóm và xác thực/phân quyền từ backend.

Chỉ dùng thông tin thử nghiệm. Key được che trên giao diện và không đưa vào audit. Dữ liệu không lưu bền vững.

## Kiểm tra

```powershell
.\.venv\Scripts\python.exe -m compileall -q app.py ui checks
.\.venv\Scripts\python.exe checks\smoke.py
.\.venv\Scripts\python.exe checks\reference.py
```

Ngày 12/10/2026: kiểm tra cú pháp và hai bộ AppTest đạt. Kiểm tra render 16 trang, tách key, chat riêng tư, duyệt từng robot, thêm/xóa người dùng, tắt provider, đóng đăng ký, chuyển trang từ dashboard và lưu tốc độ giọng. Chưa kiểm tra ảnh trên trình duyệt thật vì phiên công cụ không có trình duyệt kết nối.
