# Đối chiếu Functions → Frontend

Nguồn: `chucnang.docx`, Proposal ver 1.1 và các quyết định giao diện đã được người dùng duyệt. Chưa có Proposal V1.5 hoặc danh sách 66 chức năng có thẩm quyền để xác nhận tuân thủ. Các thao tác dưới đây là UI/mock trong phiên Streamlit, chưa chứng minh tích hợp Backend, AI Server hoặc thiết bị thật.

Registry hiện tại: `giao_dien/dinh_tuyen.py`; nhãn và ánh xạ đích điều hướng cũ: `nen_tang/dieu_huong.py`.

- User Portal — **5 mục**: Trang chủ; Trò chuyện AI; Robot của tôi; Cài đặt trợ lý; Tài khoản.
- Admin Portal — **8 mục**: Dashboard; Quản lý người dùng; Quản lý thiết bị; AI Management; API Key & Quota; OTA Firmware; Logs & Monitoring; System Settings.
- Các USR bên dưới nằm trong module tương ứng tại `giao_dien/nguoi_dung/`, trừ đăng nhập/đăng ký tại `giao_dien/xac_thuc/dang_nhap.py` và đăng xuất tại Sidebar.

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
| USR-01 | Login/Đăng ký; Tài khoản → Thông tin tài khoản; Sidebar → Đăng xuất | Tự đăng ký User, hồ sơ, đổi mật khẩu, đăng xuất; quên mật khẩu mô phỏng |
| USR-02 | Robot của tôi → Ghép nối robot / Quản lý liên kết | Gửi mã yêu cầu, xem trạng thái duyệt, nhiều robot, đổi tên, xác nhận hủy liên kết mẫu |
| USR-03 | Cài đặt trợ lý → Cá nhân hóa → Thông tin | Tên, tính cách, xưng hô; system prompt trong Nâng cao: hướng dẫn cho AI; lưu mẫu |
| USR-04 | Cài đặt trợ lý → Cá nhân hóa → Ngôn ngữ · P1 | Chỉ Tiếng Việt; ngôn ngữ khác chờ xác nhận hỗ trợ |
| USR-05 | Cài đặt trợ lý → Cá nhân hóa → Giọng nói | Chọn TTS A/B và lưu tốc độ minh họa; chưa phát âm thanh |
| USR-06 | Cài đặt trợ lý → Nâng cao → Dịch vụ AI; Trò chuyện AI → Cài đặt nâng cao | Chỉ chọn Provider Admin cho phép; chưa gọi dịch vụ thật |
| USR-07 | Cài đặt trợ lý → Nâng cao → Khóa kết nối AI (API Key) | Khóa của tài khoản hiện tại; thêm/kiểm tra/thay/xóa mẫu; kiểm tra không xác thực với Provider |
| USR-08 | Trò chuyện AI → Lịch sử → Lịch sử hội thoại | Xem/xóa có xác nhận; tìm/lọc và mở lại phiên mẫu; tab Trò chuyện cũng có danh sách gần đây |
| USR-09 | Trò chuyện AI → Lịch sử → Bộ nhớ dài hạn · P2 | Xem/sửa/xóa bộ nhớ mẫu, không tự học hay dùng bộ nhớ trong phản hồi |
| USR-10 | Internet Search — DEFERRED | Không hiển thị theo quyết định Phase 3B, không phải bị mất khi gộp menu; khác tài liệu cũ, chờ thống nhất phạm vi; không thay đổi Backend/AI Server |
| USR-11 | Trò chuyện AI → Lịch sử → Tài liệu cá nhân · P2 | Upload metadata, xem/đổi tên/xóa; không đọc nội dung, embedding, indexing hoặc xử lý RAG |
| USR-12 | Tài khoản → Quyền riêng tư | Cờ lưu lịch sử/memory, xóa từng nhóm hoặc dữ liệu AI cá nhân có xác nhận; chỉ dữ liệu mẫu |
| USR-13 | Trang chủ → Thống kê sử dụng · P1 | Lọc ngày/Provider, phiên/token mẫu, biểu đồ; không đo sử dụng thực tế |
| USR-14 | Trò chuyện AI → Trò chuyện | Chat Local AI/OpenAI/Gemini với phản hồi cố định; chưa kết nối Backend; Internet Search hoãn theo USR-10 |
| USR-15 | Trò chuyện AI → Trò chuyện → ⋯ Hội thoại | Tạo/chọn/đổi tên/giữ tin nhắn/kết thúc/tiếp tục phiên; chế độ không lưu lịch sử dùng phiên tạm; chưa có ngữ cảnh AI thật |

User chưa có robot vẫn truy cập được 5 mục hiện tại. Ghép nối cần Admin duyệt từng robot; hủy liên kết không đóng các trang AI. Yêu cầu chặn Dashboard khi chưa có robot được duyệt trong tài liệu cũ chưa được áp dụng, cần quyết định phạm vi riêng. Chat là mô phỏng trên web, không điều khiển thiết bị.
