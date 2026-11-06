# Reset bắt buộc trước khi cấp mã bàn giao robot

Ngày 2026-11-05, múi giờ Asia/Bangkok. Chỉ sửa trong `BE/`. Không gọi server đang
chạy, không dùng tài khoản thật, không đọc/ghi database thật. HTTP tests tự mở
server test ở cổng ngẫu nhiên rồi đóng, MySQL/storage được mock hoặc dùng file
tạm test. Chưa có URL/tài khoản/DB test riêng được xác nhận; không chạy migration.

## Cập nhật sau khi tiếp tục

Lần tiếp tục chỉ sửa test và báo cáo, không đổi runtime. Đã đối chiếu các suite
lỗi với controller/service/DTO hiện có và chuyển sang contract đang hỗ trợ:

- `test/contract-app.fixture.ts`: JWT và guards thật, identity store mock; không
  load cấu hình database hoặc AppModule.
- `test/devices.spec.ts`: kiểm tra `/devices/admin/all`, danh sách nhiều robot theo
  User, quyền 401/403, query/TTL, chặn unlink và cấp mã khi reset_pending.
- `test/monitoring.spec.ts`: kiểm tra sweep chỉ đổi presence, không thay ownership/
  lifecycle; counts, SQL binding heartbeat/metrics, lỗi DB và shutdown/không chạy chồng.
- `test/monitoring.http.spec.ts`: kiểm tra MonitoringController thực tế, quyền Admin,
  heartbeat/metrics và DTO lỗi trước khi gọi service.
- `test/application-wiring.spec.ts`: dùng `/devices/admin/all`, `/api-keys`,
  `/admin/api-keys/system`; không còn kỳ vọng các route cũ không được đăng ký.
- `docs/robot-reset-tests.json`: kết quả mới **25 suite, 489 tests PASS**, không skip.

Bốn suite từng lỗi chạy riêng đạt **51/51 PASS**; auth e2e **4/4 PASS** và build PASS.
Test cũ cho admin device search/owner projection và per-device monitoring mô tả
API không còn được đăng ký. Test mới xác nhận API đang hỗ trợ; không tuyên bố
các tính năng cũ đó đã được triển khai. MySQL và robot thật vẫn BLOCKED.

## Kết quả và phạm vi thay đổi

Working tree lúc bắt đầu đã có thay đổi BE của công việc khác: direct unlink đã
bị service từ chối, hai họ API đã dùng chung PairingService và recovery đã có
transaction/reset proof gate. Các thay đổi đó được giữ nguyên. Công việc này
hoàn thiện các guard còn thiếu, mã lỗi/API docs và regression test; không nhận
các thay đổi có sẵn là thay đổi mới của lượt này.

| File sửa trong lượt này | Thay đổi |
|---|---|
| `src/modules/devices/devices.service.ts` | Direct unlink trả 403 với lỗi rõ `ADMIN_RECOVERY_REQUIRED`. Đưa assertPairingReady vào hàm cấp mã chung để cả đăng ký trả mã và xuất mã đều qua gate. |
| `src/modules/devices/devices.controller.ts` | Swagger ghi rõ DELETE bị từ chối và đường Admin thay thế. |
| `src/modules/pairing/pairing.repository.ts` | Chặn mọi lần setLifecycle available từ reject nếu vẫn có owner/pending hoặc reset chưa được xác nhận; dùng DB UTC trong cùng transaction. |
| `src/modules/devices/assignment-access.ts` | File được sửa đồng thời; bản cuối dùng alias ownedConversationHistory = visibleConversation, giữ chính sách current assignment. Không ghi đè bản sửa đồng thời. |
| `src/modules/ai/ai.repository.ts` | List/detail/delete dùng alias lịch sử chung và vẫn ràng buộc c.user_id. Bản cuối không mở đọc lịch sử robot đã revoke. |
| `test/application-wiring.spec.ts` | HTTP DELETE với User và Admin qua AppModule thật + MySQL mock đều 403, không mở transaction hay thực hiện SQL ghi. |
| `test/devices.service.spec.ts` | Kiểm tra registration không đi vòng gate cấp mã. |
| `test/pairing.repository.spec.ts` | Test transition available bị owner/pending/reset chặn và trường hợp hợp lệ được phép. |
| `test/pairing.service.spec.ts` | Test cả hai họ API chặn submit/approve trước reset, giữ tiêu thụ mã khi submit và không phục hồi sau reject. |
| `test/pairing.http.spec.ts` | Cập nhật mock reservation/pending theo service hiện tại; kiểm tra HTTP 409 cho submit/approve khi reset_pending hoặc lifecycle sai available. |
| `test/recovery.spec.ts` | Test nhiều lần cùng key, robot còn lại không thay đổi, sai job/device/attempt/proof, failed ACK, retry thành công rồi cấp mã; kiểm tra SQL không sửa conversations/messages và chỉ đúng robot. |
| `test/handover-access.spec.ts` | File được cập nhật đồng thời; bản cuối kiểm tra cả User cũ/mới không đọc history robot khi mất current assignment, cùng các guard cấp mã/credential hiện có. |
| `README.md`, `API_CONTRACT.md` | Cập nhật ảnh hưởng caller và hợp đồng reset. |
| `docs/robot-reset-tests.json` | Kết quả Jest toàn bộ, gồm chi tiết các lỗi còn lại. |
| `docs/robot-reset-report.md` | Báo cáo này. |

Không sửa recovery service/repository trong lượt này: đã kiểm tra và tái sử dụng
logic hiện có, bổ sung test nối thực service cấp mã với reset gate trên cùng state model.

## API bị ảnh hưởng

| API | Quyền/hợp đồng | Kết quả |
|---|---|---|
| DELETE `/devices/{id}/assignment` | Authenticated User/Admin | 403 `ADMIN_RECOVERY_REQUIRED`, không mutate ownership. Không tự nâng quyền sang Admin/revoke. |
| POST `/admin/devices/{id}/revoke` | ADMIN active/verified; `{reason}` và Idempotency-Key | Giữ nguyên HTTP 202, operation/reset status, backup expiry. Xóa đúng current assignment theo deviceId/userId/requestId. |
| GET `/admin/devices/{id}/reset-status` | ADMIN | Giữ `{jobId,deviceId,status,acknowledgedAt}`; pending/sent/failed không phải available. |
| POST `/internal/device-reset-jobs/claim`, POST `/{jobId}/ack` | Nguồn reset được xác thực, contract được bật | Giữ contract. Chỉ success đúng latest job/operation/device/attempt/proof và đủ hai confirmation mới mở available. |
| POST `/devices/admin/{id}/pairing-codes` | ADMIN; `{ttl_minutes}` | Giữ `{pairing_code,expires_at}`. Chặn lifecycle khác available hoặc assignment/pending/reset gate không hợp lệ. |
| POST `/devices/admin` | ADMIN; UID/name/hardware | Giữ response hiện có của working tree, gồm mã ban đầu; mã đó cũng qua gate chung. Không đổi payload FE. |
| POST `/devices/pairing-requests` | USER theo service, body `{pairing_code}` | Giữ response snake_case/lowercase `pending` qua adapter. Mã được consumed tại submit, cùng transaction. |
| POST `/devices/admin/pairing-requests/{requestId}/approve` hoặc `/reject` | ADMIN; `{note}` | Giữ ID yêu cầu/payload/response. Approve kiểm tra reset và reservation; reject không làm mã dùng lại được. |
| POST `/user/devices/pairing-requests`; POST `/admin/pairing-requests/{requestId}/approve` hoặc `/reject` | USER/ADMIN guards; camelCase payload | Dùng cùng service/gate với adapter FE; không còn đường riêng bỏ qua reset. |
| GET `/conversations`, GET/DELETE `/conversations/{id}` | User đã xác thực, c.user_id của chính mình và current assignment cho robot | Dữ liệu giữ nguyên owner cũ nhưng lịch sử robot bị khóa đọc sau revoke theo chính sách bản sửa đồng thời. Web history vẫn theo tài khoản. |

## Caller và đường lifecycle đã rà

- Tìm trong `frontend/`, `AI_SERVER/`, firmware `xiaozhi-esp32/` và `BE/` không thấy
  caller production còn gửi DELETE assignment; FE hiện đã bỏ nút này. Còn route
  controller, service, stub test và tài liệu/audit cũ. Client ngoài repo chưa thể
  xác minh: caller từng mong 200 phải xử lý 403 và chuyển thao tác cho Admin.
- Trước lượt này `DevicesRepository.unlink()` đã bị bỏ khỏi working tree, service
  unlink không gọi transaction. Không phục hồi đường đó.
- New device được INSERT available: chưa từng có chủ nên không bắt buộc reset.
- Recovery revoke xóa đúng assignment, đóng history, thu hồi credential và AI
  session, hủy code/pending, chuyển reset_pending và tạo một job trong transaction.
  Không có SQL xóa/chuyển owner của conversations/messages hoặc robot khác.
- Recovery acknowledge success là đường reset_pending → available; điều kiện
  được kiểm tra dưới khóa parent device trong service, ghi đúng job/operation/device.
- Pairing reject có thể pending_approval → available. Nay repository recheck owner,
  pending và reset history; state sai/legacy chưa reset không thể đi vòng qua reject.
- Restore chỉ available → assigned sau matching reset thành công; restore không
  mở available và không tái kích hoạt credential cũ.
- Không có đường runtime assigned → available trực tiếp khác được tìm thấy.

## Kết quả test đã chạy

PASS chỉ áp dụng đúng phạm vi mock/unit/HTTP cô lập. State-model serialization
không chứng minh isolation/locking/unique constraints trên MySQL thật.

| Ca kiểm thử | Input | Mong muốn | Thực tế | Kết quả |
|---|---|---|---|---|
| User gọi DELETE trực tiếp | User JWT test, device 42; AppModule thật, MySQL mock | 403, không mutation | Trả ADMIN_RECOVERY_REQUIRED, không transaction, không SQL INSERT/UPDATE/DELETE | PASS |
| Admin cũng không dùng DELETE để bỏ reset | Admin JWT test | 403, đi qua revoke | Đúng | PASS |
| Admin gỡ một trong hai robot | Robot 42 và 99 cùng User 7, revoke 42 | Chỉ xóa assignment 42, giữ 99/User | State model và SQL binding xác nhận đúng deviceId/userId/requestId, không xóa conversations/messages | PASS |
| Retry cùng idempotency key | Ba lần revoke song song cùng key/body trong transaction model | Một operation/backup/reset job | Cùng operationId; createOperation/revoke gọi một lần; robot 99 giữ nguyên | PASS |
| Reset pending không cấp mã | assigned → revoke → reset_pending | Không insert code | DevicesService từ chối DEVICE_NOT_AVAILABLE | PASS |
| Lifecycle sai available khi operation chưa hoàn tất | Gán state available nhưng job/operation chưa ACK | Gate DB vẫn chặn | HTTP/service 409, không insert code/assignment | PASS |
| ACK job cũ, sai device, sai attempt, sai proof | Service reset thật, tx/storage mock | Không mở available | 409/404/403 theo trường hợp; cấp mã vẫn bị chặn | PASS |
| ACK failed | result failed, RESET_FAILED | Giữ reset_pending | Không có UPDATE devices available; cấp mã bị chặn | PASS |
| ACK success đúng retry | Claim lại attempt mới, đúng challenge, đủ hai confirmation | Available và cấp mã mới | Code 32 ký tự; đúng một INSERT device_pairing_codes; credential cũ vẫn revoked | PASS |
| Hai nhóm submit/approve | Legacy/current adapters, reset gate false | Cả hai bị chặn | Cả hai 409, không consume trước eligibility, không assignment | PASS |
| Tiêu thụ mã tại submit và reject | Submit qua từng nhóm rồi reject, nhập lại | Không phục hồi mã | Cả hai consumed tại submit; dùng lại 400 | PASS |
| Reject không lách reset | owner/pending/reset blockers tại repository | Không UPDATE available | Đúng; case không blocker mới UPDATE | PASS |
| Giữ dữ liệu lịch sử User cũ | Revoke robot 42 | Không xóa/chuyển owner conversations/messages | Kiểm tra SQL revoke không ghi/xóa các bảng đó; không ảnh hưởng robot 99 | PASS |
| Bảy suite trọng tâm | devices.service, pairing repository/service/HTTP, recovery service/HTTP, handover-access | Không regression liên quan | 196 tests PASS trong lần full run được lưu JSON | PASS |
| Bốn suite từng lỗi | Devices, monitoring service/HTTP và app wiring hiện tại | Compile và assertions đúng contract | 51/51 tests PASS khi chạy riêng | PASS |
| Auth e2e cô lập sẵn có | Jest test:e2e, service mock | Contract/auth cũ không lỗi | 4/4 PASS | PASS |
| Build | npm.cmd run build | Nest build thành công | PASS | PASS |
| Full BE tests | Toàn bộ default Jest *.spec.ts | Tất cả suite pass | 25/25 suite, 489/489 assertions PASS; không skipped | PASS |
| MySQL integration | DB test riêng đã xác nhận | Transaction/isolation/constraints/retry được chứng minh bằng MySQL | Chưa có cấu hình DB test riêng được xác nhận, không chạy | BLOCKED |
| Robot/worker thật | Thiết bị, worker, reset contract được cấu hình | Reset thật rồi cấp mã | Chưa có thiết bị/worker test được xác nhận, không gọi server đang chạy | BLOCKED |

### Các lỗi của lần chạy trước đã xử lý

Danh sách dưới đây ghi nguyên nhân của lần chạy trước. Các suite này đã được
chuyển sang contract hiện tại như phần cập nhật; full run mới không còn lỗi.
Không sửa implementation monitoring hoặc thêm endpoint cũ để làm xanh test:

- `test/monitoring.spec.ts`: import/call API không còn trong source hiện tại như
  calculateDeviceStatus, MonitoringTransaction, processHeartbeat.
- `test/monitoring.http.spec.ts`: controller exports không còn khớp source hiện tại.
- `test/devices.spec.ts`: mong DevicesRepository.list, DeviceRecord.owner và
  currentAssignment không còn trong source hiện tại; suite lỗi TypeScript.
- `test/application-wiring.spec.ts`: 6 assertion còn mong các route
  `/admin/devices`, `/user/ai/credentials`, `/admin/ai/credentials`,
  `/admin/devices/42/monitoring`, `/internal/devices/heartbeat` hiện không được đăng ký.
  Riêng hai test DELETE mới trong suite này đã PASS khi chạy riêng và trong full run.

Các source monitoring/routes đó không được thay đổi trong lượt này. Mock HTTP
pairing cũ thiếu reserveCodeForApproval và dùng hasPendingRequest thay cho
hasAnyPending đã được sửa trong phạm vi liên quan; suite pairing HTTP hiện PASS.

## Lệnh đã chạy

Trong `BE/`:

```powershell
npm.cmd run build
node node_modules/jest/bin/jest.js --runInBand --no-cache --silent --json --outputFile=docs/robot-reset-tests.json
node node_modules/jest/bin/jest.js --runInBand --no-cache --runTestsByPath test/application-wiring.spec.ts --testNamePattern='direct DELETE assignment'
npm.cmd run test:e2e -- --no-cache
git diff --check -- BE
```

Bộ trọng tâm cũng đã chạy riêng trong quá trình sửa; số 196 ở bảng lấy từ
assertionResults của lần full run cuối, không cộng trùng với hai test DELETE hay
4 test e2e. Không chạy script MySQL integration/migration vì chưa xác nhận DB test.

## Giới hạn còn lại

- DB cần có schema recovery/history hiện có của repo. Không tự migrate DB và không
  xác nhận deployment hiện tại đã áp dụng các migration đó.
- Chính sách history được sửa đồng thời trong working tree để yêu cầu current
  assignment. User cũ không đọc được lịch sử robot sau revoke dù dữ liệu không mất;
  User mới cũng không được đọc lịch sử của User cũ. Nếu nghiệp vụ yêu cầu User cũ
  vẫn đọc được thì cần chốt lại chính sách này; không coi việc giữ dữ liệu là đã
  đáp ứng quyền đọc sau bàn giao. Không sửa đè thay đổi đồng thời để mở quyền.
- Hội thoại robot legacy thiếu assignment_history_id vẫn được giữ trong DB nhưng
  không mở quyền đọc bằng cách đoán lịch sử owner.
- Bộ test cô lập và build đã PASS. MySQL thật và reset trên robot/worker thật chưa
  được kiểm chứng; không suy diễn các ca đó từ kết quả mock.
