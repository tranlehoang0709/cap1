# Đăng ký và bàn giao robot — 2026-11-05

## Hành vi và API tương thích

- `POST /devices/admin` giữ các trường robot hiện có và thêm `pairing_code`, `expires_at` ở cấp ngoài. Mặc định mã có hạn 10 phút; robot, hash mã và audit cùng transaction.
- `POST /devices/admin/:id/pairing-codes` giữ body `{ttl_minutes?}` và response `{pairing_code, expires_at}`. Chỉ chấp nhận robot `available`, không owner/pending, không có unlink/reset chưa hoàn tất. Mã chưa dùng trước đó bị revoke.
- Hai nhóm pairing đều gọi `PairingService`. `/devices/pairing-requests` vẫn nhận `{pairing_code}` và trả bản ghi snake_case; `/user/devices/pairing-requests` vẫn nhận `{pairingCode}` và trả `{id,deviceId,status:'PENDING'}`.
- Hai nhóm admin review giữ endpoint, body (`note` hoặc `reviewNote`), response và HTTP success status cũ. Có thể tạo bằng nhóm này rồi duyệt bằng nhóm kia.
- Mã bị consume ngay khi tạo pending, trên cùng connection MySQL với request, lifecycle và audit. Khóa parent device và code cùng conditional UPDATE ngăn hai user tạo pending từ cùng mã. Không tạo assignment trước approve.
- Mã đã được giữ bởi pending hợp lệ không cần còn trong hạn lúc admin duyệt. Pending cũ chưa consume mã chỉ được duyệt nếu mã còn dùng được và reservation không mơ hồ. Các pending cũ cùng dùng một mã phải được admin xử lý/từ chối trước; migration không tự chọn người thắng.
- `DELETE /devices/:id/assignment` giữ route nhưng luôn trả 403 `ADMIN_RECOVERY_REQUIRED`, không mở transaction hoặc thay đổi assignment.
- Thu hồi qua `POST /admin/devices/:id/revoke`, với `Idempotency-Key`. Luồng recovery hiện có gỡ owner, đóng history, revoke credential/AI sessions, hủy mã/pending, backup mã hóa và tạo reset job.
- `POST /internal/device-reset-jobs/claim` và `POST /internal/device-reset-jobs/:id/ack` được bỏ qua JWT người dùng bằng `@Public()`, nhưng vẫn bắt buộc `ResetSourceGuard`, service token riêng và `RESET_CONTRACT_APPROVED=true`. Chỉ ACK success có đủ xác nhận/challenge/attempt hợp lệ mới đưa robot về `available`.
- `POST /devices/admin/:id/credential` chỉ hoạt động khi robot có approved assignment, owner hợp lệ và reset không bị chặn. Sau reset vẫn phải duyệt owner mới trước khi cấp credential.
- `GET/PATCH /ai/profile` và `GET/PATCH /user/ai/profile` chỉ cho active verified USER có ít nhất một robot đã duyệt. Profile vẫn theo user, không tự xóa cấu hình của user khi thu hồi một robot. Internal resolve cũng áp dụng gate này.
- Hội thoại robot mới lưu `conversations.assignment_history_id`, lấy từ assignment history đang mở. List/detail/delete history chỉ cho đúng user và đúng lần gán hiện hành; revoke khiến cả chủ cũ mất quyền xem. Cùng user nhận lại robot không thấy hội thoại của lần gán cũ. Hội thoại web vẫn theo user.
- Hội thoại robot cũ có assignment ID NULL được giữ nguyên nhưng ẩn khỏi API. Không backfill dựa trên owner hiện tại hoặc timestamp vì có thể gán nhầm dữ liệu.
- Internal tạo/cập nhật AI session không được mở lại context của assignment cũ hoặc session revoked.

## Migration cho DB đã có bảng

Migration: `src/database/migrations/20261105_robot_handover.cjs`.
Runner: `scripts/migrate-robot-handover.cjs`.

1. Backup DB và chọn thời điểm hạn chế ghi. Kiểm tra `DB_HOST`, `DB_PORT`, `DB_NAME` của môi trường đích mà không đưa password vào command line.
2. Tại thư mục `BE`, chạy chế độ chỉ đọc kế hoạch:

   ```powershell
   node scripts/migrate-robot-handover.cjs --dry-run
   ```

3. Sau khi kiểm tra đúng DB/schema và kế hoạch, người vận hành mới chạy:

   ```powershell
   node scripts/migrate-robot-handover.cjs --apply
   ```

4. Chạy lại `--dry-run`, kế hoạch phải còn 0 DDL. Deploy/restart BE sau khi migration thành công.

Runner kiểm tra hai bảng InnoDB, kiểu signed BIGINT của history ID, cột nullable và FK hiện hữu trước khi ALTER. Chỉ thêm cột nullable và FK RESTRICT còn thiếu; không UPDATE/DELETE/TRUNCATE/DROP dữ liệu, không chạy baseline và không yêu cầu baseline migration marker. Nếu bị ngắt sau ADD COLUMN thì chạy lại sẽ tiếp tục phần FK. MySQL DDL có implicit commit; không coi toàn bộ migration là một transaction rollback được. Nếu cột hoặc FK có định nghĩa không tương thích, runner dừng để người vận hành xử lý.

Baseline SQL và DBML đã cập nhật cho cài mới. **Không chạy lại baseline trên DB đang có bảng.** Migration chưa được chạy trên database của ứng dụng trong công việc này.

Rollback ứng dụng: chỉ hoàn tác các file thuộc thay đổi này; có thể để nguyên cột/FK nullable bổ sung. Không DROP cột hoặc tự backfill dữ liệu khi rollback. Git có sẵn thay đổi của người dùng ở FE/AI_SERVER; không reset toàn bộ workspace.

## Kiểm chứng

`test/handover.mysql.integration.ts` dùng full AppModule, global guards, HTTP thật và MySQL 8.0.46 thật, chỉ trên instance riêng cổng 33317. Trước khi tạo database mới, test kiểm tra `@@datadir` phải đúng `BE/node_modules/.cache/aiva-handover-mysql`. Mỗi lần chạy tạo database `aiva_iot_test_handover_<random>`, không kết nối database ứng dụng, không DROP/DELETE cleanup. Dữ liệu chỉ là fixture trong instance tạm.

Suite này cài baseline trước thay đổi vào DB mới, giữ một hội thoại robot cũ, chạy migration hai lần để kiểm tra tương thích/idempotence, rồi kiểm tra đăng ký, hash mã, rotate, cạnh tranh giữa hai API, approve/reject chéo, chặn unlink/profile/credential, revoke → service claim/ACK qua global JWT guard, ẩn history sau revoke/chuyển chủ và khi chủ cũ nhận lại robot.

Chạy suite MySQL riêng sau khi chuẩn bị đúng instance dùng cho test:

```powershell
$env:AIVA_HANDOVER_DISPOSABLE_MYSQL='true'
npx.cmd jest --config jest.handover-mysql.config.cjs --runInBand --silent
```

Unit/HTTP/SQL mock suites liên quan:

```powershell
npm.cmd test -- --runTestsByPath test/devices.service.spec.ts test/pairing.service.spec.ts test/pairing.repository.spec.ts test/pairing.http.spec.ts test/ownership.spec.ts test/recovery.spec.ts test/recovery.http.spec.ts test/handover-access.spec.ts test/ai-configuration.spec.ts test/ai-http.spec.ts test/internal-integration.spec.ts --silent
npm.cmd run build
```

Các test mock được phân biệt với test MySQL thật; không dùng chúng làm bằng chứng firmware đã reset hoặc stream AI_SERVER đã đóng. Toàn bộ kết quả lệnh cuối được ghi trong báo cáo chat.

## Phần cần tích hợp thật

AI_SERVER/firmware phải lấy reset job, thực sự hủy các phiên đang chạy và reset cấu hình/cache cục bộ trước khi gửi ACK success. BE đã revoke session trong DB và kiểm tra lại assignment, nhưng không thể chứng minh đã ngắt âm thanh/WebSocket ngoài BE bằng các test này. Không thay AI_SERVER/firmware, không tự bật contract trên môi trường đang dùng. Recovery cần storage backup, key mã hóa, retry lease và service token riêng hợp lệ.

## File thay đổi

- Wiring/schema: `src/app.module.ts`, `src/database/AIVA_IoT_V1_5_CREATE_MYSQL.sql`, `src/database/AIVA_IoT_V1_5_DATABASE_BASELINE.dbml`.
- Devices: `src/modules/devices/devices.controller.ts`, `devices.module.ts`, `devices.repository.ts`, `devices.service.ts`, `ownership.repository.ts`, mới `assignment-access.ts`.
- Pairing: `src/modules/pairing/pairing.module.ts`, `pairing.repository.ts`, `pairing.service.ts`.
- Recovery: `src/modules/device-recovery/recovery.controller.ts`.
- AI: `src/modules/ai/ai.repository.ts`, `src/modules/ai-providers/ai-providers.module.ts`, `ai-providers.repository.ts`, `ai-providers.service.ts`, `src/modules/internal-api/internal-api.repository.ts`.
- Migration/runner mới: `src/database/migrations/20261105_robot_handover.cjs`, `scripts/migrate-robot-handover.cjs`.
- Test cập nhật: `test/devices.service.spec.ts`, `pairing.service.spec.ts`, `pairing.repository.spec.ts`, `pairing.http.spec.ts`, `recovery.spec.ts`, `recovery.http.spec.ts`, `ai-configuration.spec.ts`, `application-wiring.spec.ts`, `internal-integration.spec.ts`.
- Test/config mới: `test/handover-access.spec.ts`, `test/handover.mysql.integration.ts`, `jest.handover-mysql.config.cjs`.
- Tài liệu: `README.md`, tài liệu này.

`jest.live-mysql.config.cjs` đã có dưới dạng untracked trước công việc; không thuộc thay đổi này.
