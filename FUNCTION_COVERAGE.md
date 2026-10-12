# Đối chiếu Functions → Frontend

Nguồn: `chucnang.docx`, Proposal ver 1.1 và hai hình mẫu User/Admin do người dùng cung cấp. Mỗi dòng là giao diện mô phỏng, chưa có kết nối Backend.

Menu được gom theo mẫu trong `ui/portal.py`: Người dùng/Phân quyền → Quản lý người dùng; Thiết bị/Giám sát → Quản lý thiết bị; AI Server/Provider → AI Management; System Key/Quota → API Key & Quota; Logs/Tài nguyên → Logs & Monitoring. User có Dashboard riêng; các cấu hình trợ lý/Provider nằm trong Cấu hình trợ lý AI, bộ nhớ/tài liệu nằm trong Lịch sử hội thoại, thống kê nằm trong Dashboard.

| ID | Trang / thành phần | Tương tác / giới hạn |
|---|---|---|
| ADM-01 | Đăng nhập, sidebar đăng xuất | Tài khoản mẫu, cổng role |
| ADM-02 | Dashboard quản trị | User, robot, phiên, chờ duyệt, cảnh báo, biểu đồ mẫu |
| ADM-03 | Quản lý người dùng | Xem/tìm/lọc/phân trang, thêm/sửa/khóa/mở/xóa, dọn dữ liệu demo liên quan |
| ADM-04 | Phân quyền | Hai role cố định, đổi role mẫu với xác nhận |
| ADM-05 | Thiết bị & ghép nối | Đăng ký robot, duyệt/từ chối từng yêu cầu, gán/hủy liên kết |
| ADM-06 | Giám sát thiết bị | Online/offline, heartbeat, pin, RSSI, firmware, chủ sở hữu mẫu |
| ADM-07 | AI Server | Trạng thái và kiểm tra kết nối giả lập; không gọi mạng |
| ADM-08 | Tài nguyên · P1 | CPU/RAM/GPU/VRAM mẫu và biểu đồ |
| ADM-09 | Logs & Audit | Lọc mức độ, loại, actor; xem chi tiết và thao tác phát sinh trong phiên |
| ADM-10 | Cấu hình hệ thống · P1 | Timeout, giới hạn kết nối, heartbeat mẫu |
| ADM-11 | System API Key | Thêm/thay/kiểm tra/xóa khóa mẫu OpenAI/Gemini; tách Personal Key |
| ADM-12 | Quota & Rate Limit | Thêm/sửa hạn mức theo User/Provider/toàn hệ thống; không thực thi |
| ADM-13 | OTA Firmware | Upload metadata .bin, phiên bản/ghi chú, bật/tắt cung cấp, tạo bản ghi OTA mẫu |
| ADM-14 | AI Provider | Bật/tắt, model, địa chỉ mẫu, chính sách lựa chọn |
| USR-01 | Đăng ký/đăng nhập/Tài khoản | Tự đăng ký User, hồ sơ, đổi mật khẩu, đăng xuất; quên mật khẩu mô phỏng |
| USR-02 | Robot của tôi | Gửi mã yêu cầu, xem trạng thái, nhiều robot, đổi tên, hủy liên kết |
| USR-03 | Trợ lý AI → Cá nhân hóa | Tên, tính cách, xưng hô, system prompt |
| USR-04 | Trợ lý AI → Ngôn ngữ · P1 | Tiếng Việt; ngôn ngữ khác chờ xác nhận hỗ trợ |
| USR-05 | Cấu hình trợ lý AI → Giọng nói | Chọn TTS A/B và lưu tốc độ minh họa; chưa phát âm thanh |
| USR-06 | AI Provider | Chỉ chọn Provider Admin cho phép |
| USR-07 | Personal API Key | Khóa của tài khoản hiện tại; thêm/kiểm tra/thay/xóa mẫu |
| USR-08 | Lịch sử hội thoại | Xem/xóa; tìm và mở lại phiên P1 |
| USR-09 | Bộ nhớ dài hạn · P2 | Xem/sửa/xóa bộ nhớ mẫu, không tự học |
| USR-10 | Website AI Chat → Internet Search | Yêu cầu tìm kiếm và kết quả kịch bản mẫu; không truy cập mạng |
| USR-11 | Tài liệu cá nhân · P2 | Upload metadata, xem/đổi tên/xóa; không xử lý RAG |
| USR-12 | Quyền riêng tư | Cờ lưu lịch sử/memory, xóa lịch sử/bộ nhớ/tài liệu hoặc dữ liệu AI cá nhân |
| USR-13 | Thống kê sử dụng · P1 | Lọc ngày/Provider, phiên/token mẫu, biểu đồ |
| USR-14 | Website AI Chat | Chat Local AI/OpenAI/Gemini mô phỏng; input có phản hồi |
| USR-15 | Website AI Chat | Tạo/chọn/giữ tin nhắn/kết thúc phiên; chế độ không lưu lịch sử |

User chưa có robot vẫn xem đủ 8 trang theo mẫu mới. Ghép nối cần Admin duyệt từng robot. Chat là mô phỏng trên web, không điều khiển thiết bị.
