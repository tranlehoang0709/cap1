# Báo cáo hoàn thiện API nội bộ — 03/11/2026

## 1. Kết quả

Đã hoàn thiện source và đăng ký các API cần cho client Backend của AI_SERVER.
Build PASS. Bộ test liên quan 263 PASS. Cross-client HTTP PASS với NestJS/TCP thật
và repository giả lập. **Chưa đủ điều kiện chạy integrated audio/live Cloud**:
database hiện tại thiếu migration quota, AI_SERVER còn gateway blocker/mock-only
execution, chưa có secret-delivery broker hay durable usage outbox.

| API | Đã hoàn thiện | Trạng thái kiểm chứng |
|---|---|---|
| POST /internal/devices/authorize | Module/controller, dedicated service guard, credential expiry/revoke, approved assignment/owner, lifecycle/reset/unlink | PASS HTTP + unit/model tests; DB E2E NOT RUN |
| POST /internal/ai/resolve-config | User/device permission, enabled provider/model, profile/language/voice, USER/SYSTEM/NONE credential reference, không raw secret | PASS HTTP + tests; DB E2E NOT RUN |
| POST /internal/ai/authorize-request | Exact User+Provider policy, atomic reservation, 12/user rolling 60s xuyên provider/device, daily/monthly policy, replay không execution | PASS HTTP/model/repository tests; live BLOCKED schema |
| POST /internal/ai/usage | Actual success/failed/cancelled, idempotent same-body report, conflict protection, overrun audit, settle sau revoke/disable | PASS HTTP/model/repository tests; live BLOCKED schema |
| POST /internal/devices/heartbeat | Existing DTO, credential/owner recheck, monotonic presence/telemetry, reject future/stale/duplicate | PASS HTTP/model tests; DB E2E NOT RUN |
| GET/PUT /admin/ai/quotas/users/:userId/providers/:providerId | ADMIN RBAC, optimistic policy version, không xóa usage/counter, finite cap chặn unknown holds | PASS tests; live BLOCKED schema |
| GET /user/ai/usage, GET /admin/ai/usage | Scoped identity/query/date validation, actual/hold statistics | PASS tests; live BLOCKED schema |

Đã đọc `AI_SERVER/docs/backend-integration-report.md`, BackendClient, DTO và quota bridge
của AI_SERVER. Giữ response shape tương thích strict Pydantic, không thêm secret/policy
field vào resolve-config. Thay đổi rõ trong contract: policy UNLIMITED vẫn chịu ceiling
12/user; remainingQuota.requestsPerMinute của admission luôn phản ánh ceiling hữu hạn.

## 2. Hành vi và bảo đảm

- Các route service có Public metadata để bỏ User JWT global, nhưng vẫn bắt buộc guard
  service riêng. Token base64url độc lập, constant-time compare; không dùng JWT/device
  credential thay service token. Không log body/key/SQL. Filter giữ machine denial reason.
- Authorization bind owner/device từ current approved assignment và USER active/verified;
  sai/revoked/expired credential chặn. Ownership loại incomplete unlink kể cả status
  completed nhưng thiếu revoked_at/completed_at.
- Config không fallback provider/model/SYSTEM key. LOCAL không cần key; Cloud chỉ reference
  sau kiểm tra ownership/scope và ciphertext. Hỗ trợ key envelope APP_ENCRYPTION_KEY đang
  được public API dùng, cùng envelope context-bound đã có. Không có API xuất raw secret.
- Quota dùng READ COMMITTED, khóa User chung xuyên provider, count+reservation+audit trong
  cùng transaction và commit trước permit. Policy exact User+Provider; missing/duplicate/
  invalid →deny. Không thay các giá trị daily/monthly đang có.
- Request ID global unique, canonical context fingerprint. Replay trả executionAllowed=false;
  không provider retry, không trừ quota hai lần. Actual usage settle đúng admitted row,
  report trùng không charge/audit hai lần, conflicting report 409.
- Failed/cancelled vẫn ghi actual và giữ lượt request. Timeout/missing report giữ reservation,
  không bịa zero usage. Worker optional, OFF mặc định, không overlap; late report settle được
  sau admission disable hoặc user/device/key revoke. Overrun ghi sự thật và audit.
- Heartbeat bổ sung để khớp client hiện có và sửa build blocker từ PresenceSweeper cũ gọi
  method chưa tồn tại. Không đăng ký/bật presence worker tự động; không đổi assignment
  khi offline/disconnect. Không có session database create/close API mới.
- RBAC quota Admin/User mặc định nhận access JWT của login hiện tại; verifier legacy
  ADMIN_ACCESS_JWT_* chỉ khi được cấu hình rõ. Expired/refresh token bị từ chối.

## 3. File sửa/tạo trong BE

- `src/modules/devices/{devices.module.ts,ownership.controller.ts,ownership.repository.ts}`.
- `src/modules/ai-providers/{ai-providers.controller.ts,ai-providers.module.ts,ai-providers.repository.ts,ai-providers.service.ts}`.
- `src/modules/ai-profiles/ai-profiles.controller.ts`, `src/modules/api-keys/api-keys.controller.ts`.
  Các controller public lịch sử được export cho standalone tests, chưa đăng ký runtime
  để tránh xung đột API cũ. InternalAIConfigController được đăng ký qua AiProvidersModule.
- `src/modules/quotas/{quotas.controller.ts,quotas.module.ts,quotas.repository.ts,quotas.service.ts}`.
- `src/modules/monitoring/{monitoring.controller.ts,monitoring.module.ts,monitoring.repository.ts,monitoring.service.ts}`.
- `src/common/filters/api-exception.filter.ts`, `src/config/configuration.ts`,
  `src/modules/auth/access-role.guard.ts`.
- `test/internal-integration.spec.ts` mới; cập nhật `test/{quotas.service.spec.ts,
  configuration.spec.ts,monitoring.spec.ts,application-wiring.spec.ts}`. Cập nhật fixture
  phù hợp service-token độc lập/JWT hiện tại, seam locate read-only và global counter;
  giữ assertion nghiệp vụ cũ, không skip các regression đang fail.
- `scripts/check-internal-readiness.cjs` mới, chỉ SELECT schema, không seed/migrate.
- `API_CONTRACT.md`, `.env.example`, `.env.test.example`, báo cáo này,
  `docs/internal-api-regression.txt`, `docs/internal-api-test-results.json`.

Không sửa source AI_SERVER/Firmware/Frontend/DDL/migration; không chạy DDL hoặc ghi DB.
Thay đổi AI_SERVER còn trong workspace từ lượt trước, không phát sinh trong task BE này.
Không commit/push Git.

## 4. Lệnh Windows CMD

```bat
cd /d E:\learn\AI_Project\cap1\BE
npm ci
if not exist .env copy .env.example .env
```

Điền DB/JWT/encryption/bootstrap local. Ba service tokens độc lập base64url 43–128 ký tự.
Có thể tạo từng token trong terminal riêng:

```bat
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Điền AI_DEVICE_SERVICE_TOKEN, AI_CONFIG_SERVICE_TOKEN, AI_QUOTA_SERVICE_TOKEN vào `.env`;
không đưa token thật vào Git/log/chat. Flag false là mặc định. Khi môi trường đã được
phép dùng contract, chọn các flag tương ứng và deadline (ví dụ 30 giây theo vận hành):

```bat
set DEVICE_AUTH_CONTRACT_APPROVED=true
set AI_CONFIG_CONTRACT_APPROVED=true
set AI_QUOTA_CONTRACT_APPROVED=true
set AI_USAGE_REPORT_TIMEOUT_SECONDS=30
set AI_USAGE_REPORT_SWEEPER_ENABLED=false
npm run build
node scripts\check-internal-readiness.cjs
```

Readiness hiện trả BLOCKED QUOTA_SCHEMA_NOT_READY. **Không chạy migration để ép PASS**.
Migration `src/database/migrations/20261030_quota_admission.sql` đã có từ trước, vẫn
cần phê duyệt thực thi riêng và kiểm tra isolated schema/legacy nonfinal records.
Không tự thêm token/request/day columns ngoài thiết kế đã có.

Khi DB/bootstrap/migration đã được duyệt và cấu hình, mới chạy Backend thực:

```bat
npm run start:dev
```

Startup hiện có AdminSeeder; không coi việc chạy app trên DB production là read-only.
Đã tránh chạy app live để không phát sinh ghi DB ngoài phạm vi.

Test không truy cập DB thật:

```bat
npm test -- --runTestsByPath test/internal-integration.spec.ts test/ownership.spec.ts test/ai-configuration.spec.ts test/ai-http.spec.ts test/quotas.service.spec.ts test/quotas.repository.spec.ts test/quotas.http.spec.ts test/monitoring.spec.ts test/monitoring.http.spec.ts test/configuration.spec.ts
npm run build
npm run lint
npm test
```

Cross-client test tự tìm `AI_SERVER\.venv-win\Scripts\python.exe`; dùng `-B` để không ghi
pycache và không sửa AI_SERVER. Nếu không có Python env, riêng cross-client test SKIP.
MySQL suite cũ có lệnh `npx jest --config jest.quota-mysql.config.cjs --runInBand`,
chỉ chạy sau khi operator cung cấp isolated schema đã migrate và cho phép fixture DML.
`NODE_ENV=test`, `MYSQL_INTEGRATION_TESTS=true`, DB_NAME=`aiva_iot_test` hoặc suffix
được kiểm tra chặt; config không cho dùng arbitrary DB name. Chưa chạy suite này.

## 5. Kết quả thực tế

| Kiểm tra | Kết quả |
|---|---|
| Cài package-lock bằng npm ci --ignore-scripts | PASS, 618 packages |
| npm run build | PASS |
| 10 suite liên quan | PASS, 263 tests |
| Full AppModule internal tests mới | PASS, 14 tests, nằm trong 263 |
| AI_SERVER BackendClient → real TCP NestJS auth/config/admit/usage | PASS, repository giả lập; không Cloud/MySQL E2E |
| 401/403/wrong service scope, expiry/revoke/disabled owner, invalid schema | PASS mock/HTTP |
| 12/user/60s qua 2 robot cùng owner + provider khác; user khác độc lập | PASS transaction-model + HTTP |
| Finite token hold/exhaustion, daily/monthly boundary, replay/cancel/late usage | PASS model/repository tests |
| npm test toàn bộ | FAIL: 21 suite PASS, 2 suite FAIL; 445 tests PASS, 12 FAIL, một suite không collect được |
| npm run lint | FAIL: 4 TypeScript errors trong test/devices.spec.ts |
| Read-only probe DB hiện có | BLOCKED QUOTA_SCHEMA_NOT_READY; kết nối được, không ghi dữ liệu |
| MySQL admission/usage concurrency với schema thật đã migrate | NOT RUN/BLOCKED môi trường/schema/phê duyệt |
| Integrated gateway audio, Cloud, hardware | NOT RUN; source AI_SERVER vẫn chặn |

Regression chi tiết: [log](internal-api-regression.txt), [summary JSON](internal-api-test-results.json).
12 fail thuộc `application-wiring.spec.ts` kỳ vọng các public Admin/Pairing/User/config
và Recovery/reset route chưa đăng ký, gồm một RBAC assertion nhận 404 ở route không tồn tại.
`devices.spec.ts` không collect được vì API/type cũ: DevicesRepository.list,
DeviceRecord.owner/currentAssignment. Không sửa API ngoài scope để ép các assertion PASS.
`npm run lint` kiểm cả tests nên vẫn FAIL dù production build PASS.

Chưa có bằng chứng live auth/config theo dữ liệu thật. DB probe chỉ kiểm schema thông qua
information_schema, không xác nhận catalog/credential/quota rows đã được provision.

## 6. Còn thiếu trước integrated live

1. Phê duyệt và áp dụng migration quota đã chuẩn bị trên DB/môi trường được duyệt,
   xác minh unique/FK/type, reconcile legacy unknown/nonfinal holds, policy exact
   User+Provider và load/concurrency MySQL thực tế. Source luôn deny khi chưa sẵn sàng.
2. Provision profile/catalog/credential phù hợp và ba token riêng; xác nhận vận hành
   deadline/report retry/outbox và contract flags. Không có seed/policy fallback tự động.
3. AI_SERVER cần task riêng bỏ gateway blocker sau kiểm thử tương thích, wire auth/config/
   quota và enforce physical token ceiling, durable usage outbox/reconciliation. Không
   có thay đổi BE nào tự biến credentialReference thành Cloud secret.
4. Secret delivery/execution broker an toàn và STT/TTS model/voice policy cần thiết kế/
   phê duyệt riêng trước Cloud. Session DB create/close API chỉ cần thêm nếu flow thực tế
   yêu cầu; hiện có thể bỏ sessionId, vẫn bind user/device và requestId.
5. Các public legacy Admin/Pairing/Recovery wiring/tests chưa đồng bộ cần task riêng.
   Legacy mock web-chat chưa dùng internal ledger; không đưa nó vào Cloud production
   rồi giả định ceiling atomic mới đã bảo vệ toàn bộ path cũ.
