# Kết quả hoàn thiện FE đăng ký, ghép nối và bàn giao robot

Ngày: 2026-11-05 (Asia/Bangkok).

Chỉ thay đổi source/test/tài liệu trong `frontend/`. Không gọi server đang chạy,
không dùng tài khoản thật, không đọc/ghi database thật. URL BE test riêng và tài
khoản Admin/User test **chưa được cung cấp**; người dùng xác nhận chỉ kiểm tra cô lập.
Không khởi động lại FE hoặc BE đang chạy.

## File thay đổi

- `giao_dien/live.py`: đăng ký và làm mới/xóa form sau thành công; cấp mã theo robot;
  chặn cấp mã nếu lifecycle không available, có yêu cầu pending hoặc đọc yêu cầu lỗi;
  Việt hóa trạng thái; gỡ/reset có lý do, xác nhận và retry cùng key; bỏ nút unlink User;
  khóa cấu hình khi không có robot; chọn model theo provider; lịch sử theo tài khoản,
  phân trang và lọc robot trong trang đã tải; spinner, báo lỗi và xử lý kết quả ghi chưa rõ.
- `nen_tang/backend.py`: thêm header cho request, giữ idempotency key qua refresh token;
  xóa dữ liệu mã ghép nối/thao tác tạm khi logout/hết phiên qua clear_auth.
- `checks/test_robot_handover.py`: AppTest cho màn hình và entry point, toàn bộ API ghi giả lập.
- `checks/test_backend_client.py`: kiểm tra header qua refresh và dùng Streamlit thật
  khi đã cài để chạy chung với AppTest.
- `checks/wifi_setup_contract.py`: kiểm tra nguồn danh sách ownership qua helper phân trang.
- `ROBOT_HANDOVER_REPORT.md`: báo cáo này.

`app.py` đã được đọc và smoke test trực tiếp cho cả vai trò ADMIN/USER; không cần sửa
router hoặc thay cơ chế xác thực. Không sửa BE. Các thay đổi có sẵn ngoài frontend
không thuộc công việc này.

## Thao tác FE → hợp đồng BE đã đối chiếu

| Vị trí/thao tác trên web | Method/endpoint | Input và response thực tế |
|---|---|---|
| Admin → Quản lý thiết bị → Đăng ký thiết bị vật lý → Đăng ký thiết bị | POST `/devices/admin` | `{device_uid, display_name, hardware_model}`; DeviceRecord gồm `id`, `lifecycle_status`. UID 1–128, tên tối đa 120, model tối đa 100. Thành công đổi generation form rồi rerun tải danh sách. |
| Admin → Quản lý thiết bị → mở Thiết bị {UID} → Xuất mã ghép nối | POST `/devices/admin/{deviceId}/pairing-codes` | `{ttl_minutes}` nguyên 1–60; `{pairing_code, expires_at}`. Hiển thị đúng chuỗi và thời điểm BE trả về; code mới thay code cũ trong phiên. Mỗi click tạo một POST, không tự retry lỗi mạng. |
| Admin → danh sách robot/yêu cầu | GET `/devices/admin/all`, GET `/devices/admin/pairing-requests` | `page`, `limit=100`; `{items,total,page,limit,total_pages}`. FE tải mọi trang để không bỏ sót pending ở trang sau. |
| User → Robot của tôi → Pairing code → Gửi yêu cầu ghép nối | POST `/devices/pairing-requests` | `{pairing_code}` chuỗi 32–64 ký tự theo DTO, trim nhưng không ép số; BE lấy User từ JWT. PairingRequestRecord có `status: pending`. Thành công xóa form, hiện Chờ Admin duyệt, tải lại yêu cầu. |
| User → Robot của tôi → Yêu cầu của bạn | GET `/devices/pairing-requests/mine` | Phân trang; FE dịch pending/approved/rejected thành Chờ duyệt/Đã duyệt/Từ chối. |
| Admin → Yêu cầu ghép nối → Ghi chú xử lý → Duyệt/Từ chối | POST `/devices/admin/pairing-requests/{requestId}/approve` hoặc `/reject` | `{note}` tối đa 500 ký tự; PairingRequestRecord đã review. Dùng requestId; rerun tải robot và yêu cầu cả khi BE báo lỗi, giữ ghi chú. |
| User → Robot của tôi → Robot đã ghép | GET `/devices` | Phân trang, FE tải mọi trang. Chỉ robot từ assignments của User; mỗi robot một expander. Nút làm mới tải lại dữ liệu BE. |
| Admin → mở robot assigned → Gỡ người dùng và reset | POST `/admin/devices/{deviceId}/revoke` | `{reason}` tối đa 500 ký tự; FE bắt buộc lý do và checkbox xác nhận. Header `Idempotency-Key`: UUID hex 32 ký tự, đáp ứng DTO 16–128 ký tự chữ/số/_/-. Response HTTP 202: `{operationId,deviceId,status,resetStatus,backupExpiresAt}`. |
| Admin → robot Chờ reset/thao tác gỡ đang xử lý → Làm mới trạng thái reset | GET `/admin/devices/{deviceId}/reset-status` | `{jobId,deviceId,status,acknowledgedAt}`. Status job là PENDING/SENT/ACKNOWLEDGED/FAILED, khác lifecycle `reset_pending`. PENDING của job dịch Chờ reset. 404 báo chưa có job. |
| User → Trợ lý AI | GET `/devices`, GET `/ai/profile`, GET `/ai/providers` | Chỉ mở form sau khi GET devices thành công và có ít nhất một robot. Cấu hình ghi rõ theo tài khoản. |
| User → Trợ lý AI → Provider ưu tiên → Model LLM | GET `/ai/providers/{providerId}/models` | Mảng `{id,provider_id,model_code,capability,is_enabled}`; chỉ lấy đúng provider, enabled và LLM. Provider nằm ngoài form để tải model ngay khi đổi. |
| User → Trợ lý AI → Lưu cấu hình | PATCH `/ai/profile` | `{assistant_name,system_prompt,language_code,voice_code,preferred_provider_id,preferred_llm_model_id}`; response profile. Model chỉ lấy từ options hợp lệ; không dùng model của provider cũ. Model rỗng/lỗi khóa lưu khi đã chọn provider. |
| User → Lịch sử hội thoại → Trang lịch sử/Lọc theo robot/Mở hội thoại | GET `/conversations`, GET `/conversations/{id}` | `page`, `limit=100`; items có `device_id`, chi tiết có `messages`. Không khóa theo ownership hiện tại. Filter device_id chỉ trên trang đã tải, có chú thích rõ. |

Tất cả dùng client `api()` hiện có, Bearer token của phiên và refresh token hiện có.
Các route `/devices/admin...` có Roles ADMIN. Revoke/reset-status còn qua
AdminDeviceGuard/AccessRoleGuard, yêu cầu ADMIN active và verified. FE không gửi
User ID trong request ghép nối và không gọi claim/ACK nội bộ.

Code BE được đọc: `devices.controller.ts`, `dto/devices.dto.ts`, `devices.service.ts`,
`devices.repository.ts`, `recovery.controller.ts`, `recovery.dto.ts`, `recovery.service.ts`,
`recovery.repository.ts`, `admin-device.guard.ts`, `access-role.guard.ts`,
`ai.controller.ts`, `dto/ai.dto.ts`, `ai.service.ts`, `ai.repository.ts`.

## Ca kiểm thử đã chạy

Lần chạy cuối: discover `test_*.py` có **23 tests: 22 PASS, 1 FAIL** (ca demo cũ
ghi rõ bên dưới). Trong đó 13 tests luồng robot mới và 5 client tests đều PASS;
4/5 tests live routes cũ PASS. Hai Wi-Fi contract tests chạy riêng đều PASS.
Ba suite BE cô lập có **48/48 PASS**. Python compile, TypeScript build-config
typecheck noEmit và `git diff --check -- frontend` đều PASS.

PASS bên dưới chỉ xác nhận phạm vi **mock/AppTest/unit/HTTP cô lập** được ghi rõ,
không suy ra hệ thống thật hoặc transaction MySQL đã đạt.

| Ca kiểm thử | Input | Kết quả mong muốn | Kết quả thực tế | PASS/FAIL/BLOCKED |
|---|---|---|---|---|
| Entry point ADMIN/USER (AppTest) | Token giả, role từ mock, chọn Quản lý thiết bị/Robot của tôi | Router đúng màn hình, không exception | Đã chạy trực tiếp app.py cho cả hai vai trò | PASS |
| Đăng ký và cấp mã đúng ID (AppTest) | UID test-new; TTL 10 | Robot xuất hiện, form sạch, POST cấp mã dùng ID robot mới | Danh sách có robot, UID rỗng; request `/devices/admin/1/pairing-codes` body ttl_minutes=10 | PASS |
| UID trùng (AppTest) | Đăng ký lại test-new; mock BE trả 400 | Báo lỗi, giữ UID | Đúng, không thêm robot | PASS |
| Khóa cấp mã (AppTest) | assigned/reset_pending/available có pending/GET requests lỗi | Không cho xuất mã | Button disabled trong từng trường hợp | PASS |
| Pending ở trang sau (unit FE) | Hai trang requests, pending ở trang 2 | Tải đủ, không bỏ sót | Helper đọc trang 2 và trả pending | PASS |
| Thay mã hiển thị (AppTest) | Hai lần click cấp mã, BE mock trả hai chuỗi khác nhau | Mỗi click một POST, chỉ còn mã mới | Hai POST, một khối code chứa mã mới | PASS |
| Mã có số 0 đầu và mã đã dùng (AppTest) | Chuỗi 32 ký tự 0; gửi lại cùng mã | Gửi nguyên chuỗi; lần đầu sạch form và Chờ Admin duyệt; lần sau lỗi | Đúng với mock BE | PASS |
| Duyệt đúng requestId (AppTest) | requestId 41, deviceId 9 | POST dùng 41, làm mới trạng thái | Gọi `/devices/admin/pairing-requests/41/approve`, nút Duyệt biến mất | PASS |
| Nhiều robot và gỡ một robot (AppTest) | GET trả hai robot, lần sau chỉ trả robot 2 | Giữ đúng robot còn lại, không có nút unlink User | Hai expander → một expander robot 2; không có Hủy liên kết thiết bị | PASS |
| Xác nhận và timeout revoke (AppTest) | Thiếu checkbox/lý do; sau đó timeout, refresh, retry | Thiếu xác nhận không POST; retry nguyên key/reason | Hai lần POST hợp lệ có cùng payload và key 32 ký tự | PASS |
| Reset pending → available (AppTest) | Mock lifecycle thay đổi từ BE | Pending khóa mã; available mở lại; không hiện mã cũ | Đúng; FE không ACK hay tự đổi lifecycle | PASS |
| Model và cấu hình (AppTest) | Không robot; sau đó assigned, đổi P1→P2, chọn model 21, lưu/tải lại | Khóa khi chưa ghép; bỏ model 11; lưu provider 2/model 21 | Đúng, tải lại vẫn hiển thị model 21 từ profile mock | PASS |
| Model rỗng/lỗi/khác provider (AppTest) | Empty list, model foreign, API 503 | Không cho lưu model sai | Lưu cấu hình disabled; lỗi hiển thị | PASS |
| Lịch sử sau trả robot và lọc (AppTest) | Không robot, hội thoại có device_id 9 | Vẫn mở lịch sử tài khoản, lọc trong trang | Nội dung từ mock hiển thị; filter không gắn robot loại bản ghi 9 | PASS |
| Lỗi ghi (AppTest) | Mock 400/401/403/409/500/mất mạng | Không success, giữ input | Tất cả hiện lỗi, giữ chuỗi mã; lỗi chưa rõ yêu cầu refresh | PASS |
| Header qua refresh token (unit client) | POST revoke nhận 401 rồi refresh thành công | Retry giữ Idempotency-Key và body, dùng access token mới | Đối chiếu ba request mock đúng | PASS |
| Client và Wi-Fi regression | 5 client tests, 2 Wi-Fi contract tests | Không regress client/ownership/provisioning | Tất cả pass | PASS |
| BE devices service/recovery unit và HTTP mock | 3 suite, repository/service mock; HTTP server test tự mở cổng ngẫu nhiên và đóng | Hợp đồng mã, revoke, quyền và reset hoạt động cô lập | 48/48 tests pass, không kết nối DB/server đang chạy | PASS |
| Compile/typecheck | Python py_compile; TypeScript build config noEmit | Không lỗi cú pháp/type | Pass; không tạo build output trong BE | PASS |
| Regression test cũ: test_no_session_store_can_be_created | test_live_routes.py gọi module demo cũ | init_demo/data phải raise RuntimeError | init_demo hiện vẫn tạo store mẫu; assertion thất bại. File trang_thai.py không sửa, main app không gọi module này | FAIL |

## Ca chưa thể chạy trên hệ thống thật

| Ca kiểm thử | Input | Kết quả mong muốn | Kết quả thực tế | PASS/FAIL/BLOCKED |
|---|---|---|---|---|
| Luồng thật đăng ký → mã → User gửi → Admin duyệt | URL/tài khoản/dữ liệu test riêng | Robot thuộc đúng User sau duyệt | Chưa có URL/tài khoản test; chỉ chạy mock | BLOCKED |
| Mã sai/hết hạn/đã thay thế, từ chối rồi dùng lại mã cũ | Mã và DB test | BE từ chối, không tạo assignment | Unit BE có ca mã không hợp lệ/consumed; chưa xác nhận transaction MySQL hoặc toàn chuỗi thật | BLOCKED |
| Hai User dùng đồng thời một mã | Hai phiên test, MySQL test | Chỉ một yêu cầu được nhận | Không có DB test đã xác nhận | BLOCKED |
| Hai Admin xử lý cùng yêu cầu | Hai phiên test và BE test | Phiên sau nhận conflict/trạng thái mới | Chưa chạy tranh chấp trên BE thật | BLOCKED |
| Duyệt hai robot, revoke một, phân quyền A/B | Tài khoản A/B/Admin test | Còn robot kia; B không thấy robot/lịch sử A | FE đã test danh sách 2→1; chưa xác minh ownership và cách ly dữ liệu thật | BLOCKED |
| Revoke timeout không trùng transaction | Proxy lỗi/DB test | Cùng key chỉ tạo một operation | FE đã kiểm tra giữ key; không có DB test để đếm operation thật | BLOCKED |
| Reset robot thật offline/online và xuất mã mới | Robot, worker, reset contract được cấu hình | ACK thật → available → cấp mã | Thiếu thiết bị/worker được xác nhận; không gọi ACK từ FE | BLOCKED |
| Lưu model và đọc lại từ DB thật | BE/DB test và provider/model test | Giá trị persist đúng | AppTest đã xác nhận với mock, chưa có môi trường thật | BLOCKED |
| MySQL integration | Database test riêng có thể xác minh | Tests transaction/constraint chạy trong DB test | Bỏ qua vì chưa có DB test được xác nhận; không dùng cấu hình DB thật | BLOCKED |
| Browser trên localhost:8501 | Server đang chạy | Smoke/visual test tích hợp | Không truy cập theo chỉ dẫn mới của người dùng; AppTest thay thế kiểm tra logic màn hình | BLOCKED |

## Lệnh kiểm tra

Từ thư mục repo:

```powershell
frontend/.venv/Scripts/python.exe -m unittest discover -s frontend/checks -p test_robot_handover.py
frontend/.venv/Scripts/python.exe -m unittest discover -s frontend/checks -p test_backend_client.py
frontend/.venv/Scripts/python.exe -m unittest discover -s frontend/checks -p wifi_setup_contract.py
frontend/.venv/Scripts/python.exe -m unittest discover -s frontend/checks -p 'test_*.py'
frontend/.venv/Scripts/python.exe -m py_compile frontend/app.py frontend/giao_dien/live.py frontend/nen_tang/backend.py
git diff --check -- frontend
```

Từ `BE/`, chỉ kiểm tra cô lập, không sửa source/build output:

```powershell
node node_modules/typescript/bin/tsc --project tsconfig.build.json --noEmit --incremental false
node node_modules/jest/bin/jest.js --runInBand --no-cache --runTestsByPath test/devices.service.spec.ts test/recovery.http.spec.ts test/recovery.spec.ts
```

## Blocker và giới hạn BE được xác nhận từ code

1. **Blocker quy tắc reset toàn hệ thống:** `DELETE /devices/{id}/assignment` vẫn tồn tại.
   `DevicesRepository.unlink()` đưa robot thẳng về available, không reset job.
   FE đã bỏ nút User, nhưng client khác vẫn có thể gọi endpoint này. Cần sửa BE
   riêng để bắt buộc cùng quy trình revoke/reset.
2. Họ API FE đang dùng tiêu thụ mã ngay khi tạo yêu cầu. Họ API khác
   `/user/devices/pairing-requests`, `/admin/pairing-requests` tiêu thụ khi duyệt.
   FE không trộn hai họ. `DevicesService.createPairingCode()` chỉ kiểm tra available,
   chưa kiểm tra pending request hoặc lịch sử reset; FE chặn pending từ toàn bộ
   danh sách nhưng BE vẫn cần ràng buộc tương đương để chặn client khác/race.
3. `/ai/profile` lưu theo User. Service hiện kiểm tra provider enabled nhưng chưa
   kiểm tra model thuộc provider/LLM/enabled hoặc ownership trước khi PATCH.
   FE thêm các kiểm tra đó, BE cần bảo vệ tương đương cho client khác.
4. Reset thật cần worker/robot và `RESET_CONTRACT_APPROVED=true` cùng cấu hình
   nguồn reset hợp lệ. FE không được coi ACKNOWLEDGED riêng lẻ là lifecycle available;
   chỉ dữ liệu GET devices xác nhận available mới mở cấp mã.
5. Danh sách admin DeviceRecord chưa có owner User ID hiện tại. FE xác nhận robot
   bằng tên/UID/ID; không đoán chủ hiện tại từ lịch sử yêu cầu approved.
6. Idempotency key và mã cấp lần cuối giữ trong phiên Streamlit, không lưu bền vững.
   Retry cùng operation trong phiên giữ key/lý do. Nếu mất toàn bộ phiên, phải đối
   chiếu reset-status/dữ liệu BE trước thao tác mới.

Definition of Done tích hợp thật **chưa đạt** do môi trường test/thiết bị chưa có;
không đánh PASS thay cho các ca BLOCKED và không sửa BE để lách phạm vi frontend.
