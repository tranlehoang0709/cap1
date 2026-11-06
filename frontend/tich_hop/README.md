# P0 REST integration

Frontend đích: `E:\captone\frontend`. API mặc định: `http://127.0.0.1:3001`.
Không đọc `.env`, không truy cập MySQL trực tiếp, không tự khởi chạy Backend.

Chạy bằng môi trường hiện có:

```powershell
cd E:\captone\frontend
$env:AIVA_DATA_MODE = 'API'
$env:AIVA_BACKEND_BASE_URL = 'http://127.0.0.1:3001'
.\.venv\Scripts\python.exe -m streamlit run app.py --server.port 8501
```

Nếu cổng 8501 đang được dùng, không mở thêm tiến trình hoặc dừng server của người khác.
DEMO độc lập vẫn có thể chạy bằng `AIVA_DATA_MODE=DEMO`; API lỗi không fallback.

Contract đọc từ controllers/DTO/service của `E:\captone_be_fix\BE`:

- POST `/auth/register`: `display_name`, `email`, `password`; chỉ báo chờ xác minh.
  Không lưu/hiển thị `verification_token`, không tự gọi verify-email.
- POST `/auth/login`, GET `/auth/me`, POST `/auth/refresh`, POST `/auth/logout`.
  Role từ `/auth/me`, JWT theo từng Streamlit session. Refresh rotation tối đa một
  lần; GET được gửi lại một lần khi 401; mutation không được replay tự động.
  Refresh lỗi xóa phiên; 403 không tự logout. Logout luôn xóa phiên local và báo
  chưa xác nhận revoke khi Backend lỗi. Không ghi secret vào log/file/URL.
- GET `/users/me`, PATCH `/users/me` với `display_name`; email chỉ đọc.
- GET `/user/dashboard/access`: chỉ Backend cấp quyền Dashboard User. Bị từ chối
  vẫn có thể vào Robot để gửi yêu cầu ghép nối.
- GET `/user/devices`, GET `/user/devices/:id`: camelCase, robot được duyệt.
- GET/POST `/user/devices/pairing-requests`: POST `pairingCode`.
- GET `/admin/pairing-requests`, POST `/:id/approve` hoặc `/:id/reject`:
  body `reviewNote`; phải có xác nhận theo từng yêu cầu.
- GET `/devices/admin/all`: namespace snake_case, pagination phẳng.
- GET `/admin/dashboard`: số liệu tổng; GET này có thể cập nhật presence stale
  theo logic Backend hiện có. Không gọi trong kiểm thử live của task này.

API mode không gọi renderer nghiệp vụ DEMO. Mục chưa tích hợp hiển thị
“Chưa có dữ liệu”: Chat/History, AI settings/keys, privacy, password, các trang
quản trị khác; không khẳng định Chat mock là AI thật. Robot 3D chỉ minh họa,
giữ nguyên assets/camera/expressions; trạng thái kết nối lấy từ Backend.
Đổi tên/unlink, đăng ký robot và gán trực tiếp chưa được bật trong bước P0 này.

Proposal V1.5/bảng 66 chức năng authoritative chưa có; phạm vi dựa trên quyết
định tích hợp P0 đã được người dùng xác nhận. Không tuyên bố tuân thủ V1.5 đầy đủ.

Test không dùng tài khoản hoặc DB thật:
`.\.venv\Scripts\python.exe -B -m unittest discover -s checks -p test_portal_api.py`
Regression DEMO cần đặt `AIVA_DATA_MODE=DEMO` trước khi chạy test hiện có.
