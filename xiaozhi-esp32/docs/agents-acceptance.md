# Kiểm tra nghiệm thu hướng dẫn Codex

Phạm vi: thay đổi tài liệu `AGENTS.md`; không thay đổi firmware.
Chạy lại các ca dưới đây khi cập nhật hướng dẫn, ghi kết quả thật trong báo cáo.

| ID | Cách kiểm tra | Kết quả mong đợi |
| --- | --- | --- |
| A01 | Kiểm tra tên file ở gốc bằng `git ls-files AGENTS.md` và đọc phần mở đầu | Có `AGENTS.md`; yêu cầu đọc đầu phiên, xem Git và tài liệu liên quan |
| A02 | Đối chiếu phần bối cảnh với proposal và cây mã nguồn | Đúng các phân hệ, stack, V1 Cloud/V2 Local; phân biệt hiện trạng và kế hoạch; không nhận server/web đã hoàn thành |
| A03 | Đọc quy trình commit với tình huống worktree có file người dùng chưa commit | Mỗi thay đổi hoàn chỉnh có commit riêng kèm test; chỉ stage phạm vi công việc; báo mã commit; không gom file ngoài phạm vi |
| A04 | Đọc quy trình test với tình huống test FAIL, SKIP hoặc thiếu board/SDK | Phải bổ sung test; chỉ hoàn tất khi mọi kiểm tra bắt buộc PASS; trường hợp thiếu điều kiện phải báo chưa nghiệm thu |
| A05 | So sánh `git diff -- AGENTS.md` với bản trước | Giữ nguyên hướng dẫn kiến trúc, board factory/pins, state machine, audio, protocol, generated files và kiểm thử firmware |
| A06 | Kiểm tra các đường dẫn kỹ thuật và lệnh host test trong `AGENTS.md` trên repository | Đường dẫn tồn tại; có thể chạy bộ host test; proposal chưa theo dõi được mô tả rõ, không bị thêm nhầm vào commit |
| A07 | Chạy `python -m unittest discover -s scripts/tests -v` và `git diff --check` | Toàn bộ host test PASS; không có lỗi whitespace |

Nghiệm thu tài liệu không chứng nhận thiết bị hoặc hệ thống AI hoạt động.
Thay đổi tài liệu này không yêu cầu flash/build firmware hoặc thử phần cứng.
