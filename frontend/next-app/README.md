# AIVA-IoT Next.js frontend

Ứng dụng chạy song song với Streamlit, tại cổng **3100**. Mọi thay đổi của lượt triển khai nằm trong `frontend/next-app/`. Không thay entry point, dependencies hoặc cấu hình Streamlit; không thay BE, AI_SERVER, firmware, schema hoặc cấu hình thư mục gốc.

## Chạy local

Yêu cầu Node.js 20.19+ phù hợp Backend; bản Next đã cài yêu cầu Node 20.9+.

```powershell
cd frontend/next-app
Copy-Item .env.example .env.local
# Nếu dependencies chưa tồn tại:
npm.cmd ci
npm.cmd run dev
```

Mở `http://127.0.0.1:3100`. Backend phải được chủ dự án chạy riêng, mặc định `http://127.0.0.1:3000`. Không chạy `run_all.bat`, migration hay script chuẩn bị tài khoản từ frontend mới.

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run start
```

Playwright sử dụng Edge đã cài trên Windows. Không cần tải browser mới. E2E không đăng nhập tài khoản thật, không tạo dữ liệu nghiệp vụ hay gọi AI generation. Một số bài chủ động giả lập lỗi transport/phản hồi Auth để kiểm tra giao diện; chúng không chứng minh Backend thật hoạt động. Kiểm thử màn hình pending dùng React server rendering. Lệnh E2E build rồi tạo production host riêng trên cổng loopback ngẫu nhiên; kết thúc sẽ đóng đúng host đó và không tác động dịch vụ đang chạy. Screenshot/test artifacts được Git ignore.

`npm.cmd run test:integration` dùng Backend fixture độc lập để kiểm chứng Frontend/BFF, không kết nối database hoặc Backend thật. Kiểm tra live chỉ đọc có thể chạy bằng `node scripts/verify-live-readonly.mjs` khi các dịch vụ thật đã sẵn sàng.

## Cấu hình

| Biến server | Ý nghĩa |
|---|---|
| `AIVA_BACKEND_URL` | Origin Backend, mặc định loopback 3000; HTTP chỉ cho loopback, môi trường khác cần HTTPS |
| `AIVA_CHAT_PROVIDER_ID` | ID provider do quản trị viên chọn cho toàn bộ Chat trên frontend mới; không nhận từ browser/User |
| `AIVA_PUBLIC_ORIGIN` | Origin HTTPS chính xác khi triển khai sau reverse proxy; không có dấu `/` cuối |
| `AIVA_COOKIE_SECURE` | Production mặc định Secure; chỉ đặt `false` cho môi trường HTTP thử nghiệm được cấu hình rõ |

Không dùng `NEXT_PUBLIC_*` cho token, provider credential hoặc service key. Frontend không đọc `.env` của BE hay AI_SERVER.

## Chức năng

- Public: đăng nhập, đăng ký User, xác minh email bằng token hoặc fragment `#verify-email=...`. Fragment được xóa ngay, token chỉ giữ RAM, chỉ POST khi người dùng bấm xác minh. Response đăng ký không chuyển verification token ra browser.
- User: dashboard thực, usage theo ngày, Chat, robot/pairing, đổi tên robot, trợ lý cá nhân, lịch sử/chi tiết/xóa hội thoại, quyền riêng tư và tài khoản/mật khẩu.
- Admin: dashboard, tạo User/đổi role/status, đăng ký robot/cấp mã/duyệt/từ chối, recovery/reset status/restore, provider/model, system key, quota/usage, firmware metadata/release, instances/system logs/audit logs, system settings JSON và tài khoản.
- Giao diện sáng/tối; sidebar mobile, keyboard focus, loading/empty/error/success, dialog xác nhận và reduced-motion.
- NOVA Three.js hiển thị trên canvas trực tiếp, có Beast Mode sau 5 giây idle ở Auth, camera framing và privacy pose. Dashboard tải canvas khi yêu cầu và giải phóng khi đóng. Mô hình minh họa không biểu diễn heartbeat giả. Các tài nguyên robot cũ và license được giữ trong `public/robot/`.

## Auth và ranh giới bảo mật

Cookie chỉ chứa ID phiên ngẫu nhiên 256-bit, `HttpOnly`, `SameSite=Lax`, `Secure` ở production. Access/refresh JWT giữ trong bộ nhớ server, chỉ index theo hash của session ID. Không lưu JWT ở localStorage, cookie browser-readable, URL hoặc log.

Session store hiện hỗ trợ **một Node process**. Restart làm hết phiên; triển khai nhiều replica cần shared session store được duyệt riêng. Không tuyên bố sẵn sàng scale ngang. Production phải chạy HTTPS.

Mỗi request BFF xác nhận `/auth/me` và role hiện tại. Refresh được phối hợp theo session; mutation chỉ gửi một lần sau xác thực, không replay generation/approval/reset/release. POST BFF kiểm tra Origin; chỉ cho các operation trong `src/lib/operations.ts`. Browser không truyền upstream URL hoặc Authorization. Quyền và ownership cuối cùng vẫn do BE kiểm tra; chi tiết hội thoại được BFF kiểm tra thêm `user_id`.

User không có route hoặc operation quản lý Personal API Key, chọn provider/model hay unlink. Chat cloud kiểm tra `credentialScope === SYSTEM` từ `/user/ai/profile` trước generation. BFF bỏ secret/token khỏi response, giữ secret hint và pairing code Admin được cấp một lần theo contract thật.

Giới hạn ngoài phạm vi: BE hiện vẫn có các API personal key/provider-profile cũ. Frontend không thể thay chính sách của caller truy cập trực tiếp BE; cần backend enforcement riêng nếu sản phẩm yêu cầu vô hiệu hóa các API đó toàn hệ thống.

## BLOCKED / phụ thuộc Backend

1. **Chat**: cần `AIVA_CHAT_PROVIDER_ID`, provider/model hợp lệ, robot đã duyệt và AI pipeline thật. Cloud cần scope SYSTEM đã cấu hình trong BE, system key và User có trong allowlist `AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS`. Thiếu điều kiện sẽ báo lỗi/BLOCKED, không dùng personal key/fallback/mock. Không thay biến môi trường BE để vượt điều kiện.
2. BE trả `{content, conversation_id, usage}` cho `{content, provider_id}`. API chưa nhận conversation ID để tiếp tục context. UI giữ các lượt trong React state và cho thử lại khi lỗi; mỗi lượt vẫn là request độc lập. Không giả lập streaming hoặc trí nhớ hội thoại.
3. **Recovery/reset**: `202` chỉ ghi nhận yêu cầu. Chỉ trạng thái ACKNOWLEDGED do BE trả mới xác nhận ACK; không có nút tạo ACK giả. Restore phụ thuộc backup còn hạn và lifecycle hợp lệ. Runtime dispatch/ACK phải được chủ hệ thống cấu hình và kiểm thử thật.
4. **Xác minh/quên mật khẩu**: chưa có resend-verification/password recovery route. Không tạo endpoint thay thế hoặc tự xác minh account. Backend đăng ký hiện trả token nhưng frontend loại bỏ; delivery email là blocker BE.
5. Memory, tài liệu cá nhân, xóa dữ liệu AI hàng loạt, Wi-Fi provisioning từ xa, system-key probe và chính sách provider per-user chưa có API quản trị phù hợp. UI không thể hiện chúng đã hoạt động.
6. Quota lưu thành công không chứng minh admission/usage schema và runtime sẵn sàng. System settings không được dùng lưu secret; frontend chỉ gọi endpoint JSON sẵn có.

## Nguồn contract và backlog

Endpoint/DTO lấy từ các controller và service đang mount trong `BE/src`, tiếp nối audit Prompt 01. Có đối chiếu workbook `Copy of C2SE.34_SprintBacklog_FastFix.xlsx`: nhóm pairing/ownership, provider/key/quota và device UI. Các mô tả lịch sử còn Personal Key/User Provider trong `FUNCTION_COVERAGE.md` được thay bằng quy tắc rõ ràng của Prompt 02, không mang tính năng cũ vào UI mới.

Xem [API_MAPPING.md](./API_MAPPING.md) để đối chiếu endpoint.

## Bảo toàn ứng dụng cũ

Chưa chuyển traffic và chưa thay lệnh chạy cũ. Dừng tiến trình Next do bạn khởi động để quay về Streamlit; không cần rollback DB, BE hoặc firmware. Không có commit/push/merge tự động.

Robot assets đã được chuẩn bị sẵn. Nếu cập nhật bundle nguồn sau này, có thể tái tạo bản sao chỉ trong ứng dụng này:

```powershell
..\.venv\Scripts\python.exe -B scripts/prepare_robot.py
```
