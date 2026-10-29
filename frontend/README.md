# AIVA-IoT Frontend

Frontend Streamlit theo mẫu User/Admin, tông navy xanh tím. Mọi thao tác dùng dữ liệu trong phiên, chưa gọi backend, database, AI hoặc robot.

Cấu trúc sau refactor, mapping file/chức năng và audit legacy: [HUONG_DAN_CAU_TRUC.md](HUONG_DAN_CAU_TRUC.md).

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

Chat trả câu trả lời mẫu cố định theo Provider; không có tùy chọn Internet Search trên giao diện Chat. TTS chưa phát âm thanh. Kiểm tra key/provider không gọi dịch vụ. Telemetry/tài nguyên/thống kê là dữ liệu mẫu. OTA không flash robot. Khôi phục mật khẩu không gửi email. Ghi nhớ đăng nhập chỉ trong phiên. Cấu hình thông báo/ghi log chi tiết chỉ lưu lựa chọn để nối backend.

`nen_tang/` chứa state demo, điều hướng, validation và theme; `giao_dien/nguoi_dung/` và `giao_dien/quan_tri/` chứa implementation các trang; `thanh_phan/` chứa component dùng chung và Python nhúng robot; `kieu_dang/` chứa CSS. `giao_dien/dinh_tuyen.py` giữ registry đang dùng; `giao_dien/xac_thuc/dang_nhap.py` triển khai xác thực demo. `ui/portal.py` và `ui/auth.py` giữ alias tương thích. Các module `ui/*` đã tách giữ compatibility re-export, chưa được phép xóa. Assets robot vẫn ở `ui/assets/`. Chưa triển khai HTTP client/endpoint khi chưa có API contract. Khi nối backend, thay đọc/ghi session trong các thao tác bằng client của nhóm và xác thực/phân quyền từ backend.

Chỉ dùng thông tin thử nghiệm. Key được che trên giao diện và không đưa vào audit. Dữ liệu không lưu bền vững.

## Kiểm tra

```powershell
$checks = 'smoke','reference','tables','theme_ui','robot3d','shared_components','user_pages','admin_pages','robot_components','legacy_cleanup'
foreach ($check in $checks) {
    & .\.venv\Scripts\python.exe -B "checks/$check.py"
    if ($LASTEXITCODE -ne 0) { throw "FAIL: $check" }
}
```

Lệnh Node/Playwright và điều kiện camera/GPU xem [hướng dẫn cấu trúc](HUONG_DAN_CAU_TRUC.md#8-chạy-kiểm-thử) và [README browser tests](checks/trinh_duyet/README.md). Baseline Giai đoạn 7 đã ghi nhận Playwright 41 PASS, Python regression PASS, Node 19 PASS; screenshot vẫn là ứng viên cần duyệt. Giai đoạn 8 chỉ cập nhật tài liệu, không tự dùng kết quả browser cũ như lần kiểm thử mới.

Ghi nhận lịch sử ngày 13/10/2026: hai bộ AppTest đạt sau khi thiết kế lại theo TasteSkill; thời điểm đó chưa kiểm tra trình duyệt. Xem DESIGN.md để biết bối cảnh và giới hạn của đợt thiết kế cũ, không suy ra trạng thái kiểm thử hiện tại từ ghi nhận này.
