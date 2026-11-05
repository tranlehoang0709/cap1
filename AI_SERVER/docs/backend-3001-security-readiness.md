> Historical original-workspace audit. The assembled checkout preserves newer main implementations. See [current handoff](../../HANDOFF.md) for selected files, test failures and live blockers; this historical report does not certify the current runtime.

# Kiểm tra secret và readiness — 2026-11-04

**BLOCKED cho live integrated.** Chỉ kiểm tra file/source, môi trường của phiên
audit và GET health/Swagger. Không đọc môi trường của tiến trình Backend đang
chạy; trạng thái `.env` không chứng minh tiến trình đã nạp cấu hình đó.
Không tạo/copy/tái sử dụng secret, bật gate, sửa Backend/DB hoặc đổi tiến trình.
Lượt này chỉ thêm tài liệu và liên kết README; cấu hình từ lượt trước giữ nguyên.

## Secret: chỉ trạng thái, không giá trị

| Mục | Backend `.env` | AI_SERVER `.env` |
|---|---|---|
| Device service token | `AI_DEVICE_SERVICE_TOKEN`: THIẾU | `AI_SERVER_BACKEND_DEVICE_TOKEN`: THIẾU |
| Config service token | `AI_CONFIG_SERVICE_TOKEN`: THIẾU | `AI_SERVER_BACKEND_CONFIG_TOKEN`: THIẾU |
| Quota service token | `AI_QUOTA_SERVICE_TOKEN`: THIẾU | `AI_SERVER_BACKEND_QUOTA_TOKEN`: THIẾU |
| BE → AI Web Chat | Chưa có caller/biến được source sử dụng | `AI_SERVER_LIVE_WEB_TOKEN`: THIẾU |

Cả bốn token cũng thiếu trong môi trường của phiên audit. Chưa có cặp giá trị
để so sánh đồng bộ. Không suy trạng thái process khác từ kết quả này.

Backend có `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_ENCRYPTION_KEY`,
`DB_PASSWORD`, `ADMIN_PASSWORD`; chỉ xác nhận có giá trị, không xác nhận an toàn
hay đã xoay vòng. `DEVICE_RESET_SERVICE_TOKEN`, `AI_SECRET_KEY_BASE64` và
`AI_SECRET_KEY_ID` thiếu. AI_SERVER thiếu Gemini/OpenAI key, shared robot token
và local device credential map. Không thể xác định toàn bộ lịch sử lộ secret
từ hai `.env`; mọi giá trị từng bị lộ phải bị thu hồi/thay thế bởi chủ sở hữu.

## Cấu hình chính xác và gate

AI_SERVER hiện có ba giá trị kết nối sau trong `.env`:

```dotenv
AI_SERVER_BACKEND_MODE=integrated
AI_SERVER_BACKEND_URL=http://127.0.0.1:3001
AI_SERVER_BACKEND_ALLOW_LOCAL_HTTP=true
```

Đây là trạng thái cấu hình, **không phải gate đã sẵn sàng**. Ba token thật phải
được điền theo bảng trên; mỗi cặp hai bên dùng cùng token mới, ba scope dùng
ba token khác nhau. Source yêu cầu base64url 43–128 ký tự. Không dùng API key
Gemini/OpenAI hoặc JWT người dùng làm service token. `BackendClient` chỉ cho HTTP
khi explicit opt-in và đích loopback, không theo redirect/proxy môi trường.

| Kiểm tra | Kết quả |
|---|---|
| Live `GET /health`, `GET /api/docs-json` | PASS: HTTP 200 |
| `DEVICE_AUTH_CONTRACT_APPROVED` | BLOCKED: chưa đặt; source chỉ chấp nhận chuỗi `true` |
| `AI_CONFIG_CONTRACT_APPROVED` | BLOCKED: chưa đặt; guard có source nhưng controller/module chưa triển khai |
| `RESET_CONTRACT_APPROVED` | Chưa đặt; gate riêng của recovery, không cần bật để chạy chat |
| Device proof + owner active | NOT VERIFIED; không có proof thật để test |
| Resolve-config, quota admission/usage, turn start/complete | BLOCKED: thiếu routes trong source và live Swagger |
| Internal device heartbeat | BLOCKED: thiếu route client đang dùng |
| User/model/provider/credential/quota/DB readiness | NOT VERIFIED; không truy cập hoặc thay đổi DB V1.5 |
| AI startup | BLOCKED đúng thiết kế khi thiếu ba service token |
| TLS/WSS, ESP32 trust, playback evidence | BLOCKED/NOT VERIFIED |

Không bật cờ approval chỉ để vượt gate. BE owner phải triển khai API và phê
duyệt contract trước. Chỉ thêm token không giải quyết được các route còn thiếu.

## Web Chat contract thực tế

FE → BE: `POST /web-chat/messages`, user access JWT, JSON `content`, `provider_id`.
Source `AiService.chat()` hiện tạo chuỗi `[Mock ...]` và lưu conversation, không
gọi AI_SERVER. Các file controller/service trong module `web-chat` đang rỗng.

BE → AI đã có phía AI: `POST /internal/web-chat`, JSON `userId`, `providerId`,
`content`; `Authorization: Bearer <token mới được provision>`, so sánh với
`AI_SERVER_LIVE_WEB_TOKEN`. Token tối thiểu 43 ký tự; nên dùng token base64url
32 byte độc lập. AI trả `content`, `conversation_id`,
`usage.input_tokens`, `usage.output_tokens`, `Cache-Control: no-store`.
Không có biến URL/token của caller trong Backend hiện tại để đồng bộ; không
tự đặt tên biến BE rồi khẳng định source sẽ dùng. Identity phải do BE lấy từ
JWT hợp lệ; FE không gọi AI internal endpoint bằng service token.

## TLS, Opus và Python

- Không thấy Windows absolute path hardcode trong `app/` và `scripts/`.
  `run_server.cmd`, `run_lan.cmd`, `lan_firewall.ps1` dùng `.venv` theo thư mục repo.
- `.venv/Scripts/python.exe` trong AI_SERVER hiện **không tồn tại**. Alias `python`
  trỏ WindowsApps, đã không chạy được ở lượt trước. Không sửa launcher để phụ
  thuộc checkout khác. Python dùng audit là venv ở `E:/captone_integrate/AI_SERVER`,
  không phải runtime đã chuẩn bị cho workspace này.
- `AI_SERVER_TLS_CERTFILE`, `AI_SERVER_TLS_KEYFILE`, `AI_SERVER_OPUS_LIBRARY`,
  `AI_SERVER_LAN_PUBLIC_ORIGIN` đều chưa đặt: đây là thiếu cấu hình, chưa có bằng
  chứng chúng đang trỏ máy cũ. Các đường dẫn lịch sử trong docs không được runtime đọc.
- Trước LAN: tạo venv mới tại workspace bằng Python 3.12 đã xác minh; cài
  `requirements-windows.txt` (bao gồm dependencies dev và PyOgg), rồi chạy
  `.venv\Scripts\python.exe scripts\setup_windows_audio.py` để xác minh DLL và
  ghi đường dẫn Opus cục bộ. Các bước này **chưa thực hiện trong audit**.
- Điền cert/key thật bằng absolute path tới file cục bộ; nếu private key từng
  lộ, thay cặp key/cert, không copy lại key cũ. Đặt HTTPS LAN origin đúng hostname/IP
  trong SAN và đúng port, provision trust anchor cho ESP32. Host `0.0.0.0` và
  `reload=false` chỉ đặt khi chuẩn bị triển khai LAN có kiểm soát; hiện host loopback.
- Chưa load/kiểm chứng cert/key hoặc chạy native Opus tại workspace. Không chạy
  `run_lan.cmd` trong audit và không coi plaintext listener cũ là gateway an toàn.

## Quy trình xoay vòng do chủ sở hữu thực hiện

1. Lập danh sách secret đã lộ từ chat/log/file/backup/repo; coi mọi giá trị đó là
   compromised. Giữ bằng chứng cần thiết trong nơi hạn chế quyền. Không dán lại
   giá trị cũ/mới vào chat, command line, log hoặc tài liệu; không đưa `.env` vào Git.
2. Với Gemini/OpenAI key: revoke key cũ tại provider, tạo key mới theo quyền cần
   thiết, thay qua giao diện quản lý credential được phép của BE. Việc điền key
   mới vào AI `.env` chỉ phục vụ diagnostics/audio có sử dụng biến đó, không
   thay thế credential delivery từ BE cho integrated LLM. Không chạy diagnostics
   trong khi contract còn BLOCKED. Xóa key cũ khỏi mọi consumer.
3. Với service token: dùng password manager hoặc CSPRNG cục bộ sinh ít nhất
   32 byte ngẫu nhiên/token, mã hóa base64url không padding. Provision ba token
   độc lập theo bảng và token Web Chat thứ tư; tách cả reset token nếu được dùng.
   Chủ sở hữu BE cập nhật `.env` BE; người vận hành AI cập nhật `.env` AI bằng
   editor cục bộ. Không dùng token cũ từ backup và không tự bật approval flags.
   BE hiện chưa có Web Chat caller: provisioning phía BE cho token thứ tư vẫn
   BLOCKED cho đến khi có implementation được phê duyệt.
4. Với JWT signing secrets: thay cả access/refresh secret bằng giá trị mới độc
   lập (source yêu cầu ít nhất 32 ký tự); lên lịch triển khai để old JWT bị từ
   chối, thu hồi session theo quy trình BE và buộc đăng nhập lại. Không chỉ thay
   access secret rồi để refresh secret đã lộ tiếp tục được dùng.
5. Với mật khẩu admin: đổi qua `PATCH /auth/password` bằng identity hợp lệ và
   quy trình khôi phục tài khoản của owner nếu cần. Source đổi password hash
   và revoke refresh sessions của user. Thay `ADMIN_PASSWORD` cục bộ cho seed
   config cũng cần thiết nếu đã lộ, nhưng **không đổi mật khẩu user đã tồn tại**:
   `AdminSeeder` cố ý không ghi đè. Audit không gọi API thay mật khẩu.
6. Với `DB_PASSWORD`: DBA đổi credential DB thật và đồng bộ các consumer trong
   đợt triển khai được phép; sửa `.env` đơn thuần không đổi mật khẩu MySQL.
   Không sửa schema V1.5, không tự chạy SQL trong nhiệm vụ này.
7. Với `APP_ENCRYPTION_KEY`: **không thay nóng bằng một key bất kỳ**. Source
   AES-256-GCM chỉ đọc một key và ciphertext không có key ID; đổi key trực tiếp
   làm dữ liệu cũ không giải mã được. Owner cần backup hạn chế quyền và phương án
   re-encrypt có kiểm soát hoặc revoke/re-provision credential cũ trước khi
   chuyển key. Phần BE/DB này BLOCKED trong phạm vi audit. Key mới phải là
   32 byte, base64url 43 ký tự. `AI_SECRET_KEY_BASE64` là format khác (standard
   base64 44 ký tự có `=`), đi cùng `AI_SECRET_KEY_ID`; service đó hiện chưa
   được module đăng ký. Không tự thay thế một cơ chế mã hóa bằng cơ chế kia.
8. Với device/shared LAN credential đã lộ: owner rotate/revoke qua device
   credential flow được phép và provision lại thiết bị; cập nhật local map chỉ
   khi thực sự dùng diagnostic path. Không gửi cloud key xuống ESP32. Thay TLS
   private key/cert và cập nhật trust nếu cần; bảo vệ quyền đọc các file mới.
9. Sau khi toàn bộ secret cũ đã bị thu hồi, API và gate được owner phê duyệt:
   thực hiện đợt restart/reload có kiểm soát ngoài audit này. Sửa `.env` không
   đồng nghĩa process đang chạy đã dùng secret mới. Kiểm tra old credentials
   bị từ chối, new credentials hoạt động; log chỉ status/request ID, không secret.

Không có thao tác rotation nào đã được thực hiện hoặc xác nhận hoàn tất.
Không cần đưa giá trị secret vào báo cáo để xác minh rotation.

## Điều kiện chấp nhận live

Chỉ báo PASS sau authenticated device authorization, resolve-config, admission,
generation thật, actual usage settlement/idempotency và turn completion trên
Backend 3001. Sau đó kiểm tra FE Web Chat qua user JWT và ESP32 qua TLS/WSS với
proof/playback thật. Test fixture từ lượt trước không chứng minh các điều này.
Audit này không đổi code thực thi nên không chạy lại fixture suite; đã lặp lại
live GET health/Swagger, rà source/biến cấu hình/đường dẫn và kiểm tra diff.
