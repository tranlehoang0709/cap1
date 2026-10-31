# AIVA-IoT — Backend API Contract

Tài liệu API backend tập trung. Cập nhật: 30/10/2026.
Nguồn: controller/service thực tế trong `BE/src`; không coi endpoint đề xuất là đã hoạt động.
Base URL phát triển: `http://localhost:3000` (PORT có thể thay đổi). Không có prefix `/api`.

## Trạng thái

| Module | Trạng thái |
|---|---|
| Admin Device List/Detail — Prompt 1 | Đã triển khai, có test; chưa nối issuer đăng nhập |
| Pairing/Approval — Prompt 2 | Đã triển khai, có test; cần provision mã và kiểm thử cạnh tranh MySQL có dữ liệu |
| User Devices/Dashboard — Prompt 3 | Đã triển khai, có test; dữ liệu thật chưa có để kiểm chứng rename xuyên suốt |
| Internal Device Authorization — Prompt 3 | BLOCKED tích hợp: AI Server/Firmware chưa duyệt contract; mặc định tắt |
| Auth login/refresh/register | Chưa có HTTP API hoạt động trong repo |
| AI configuration/API keys — Prompt 4 | Đã triển khai Provider/Profile/USER & SYSTEM key; cần cấu hình encryption key, DB chưa có models |
| Internal AI resolve-config — Prompt 4 | BLOCKED tích hợp theo mặc định; chỉ hỗ trợ credential reference, không trả key rõ |
| Heartbeat/Telemetry — Prompt 5 | Đã triển khai; timeout được duyệt 60 giây; forwarding tích hợp vẫn cần contract Device Auth |
| Revoke/Backup/Restore — Prompt 6 | Đã triển khai + test; cần cấu hình/duyệt durable backup volume và encryption key trước khi revoke |
| Reset dispatch/ACK — Prompt 6 | Có durable job + pull/lease/challenge API; BLOCKED tích hợp Firmware/AI Server, mặc định tắt |
| Quota/Rate Limit — Prompt 7 | Đã triển khai và test; migration chỉ chuẩn bị, chưa chạy. API fail closed nếu schema/config chưa sẵn sàng |

## Quy ước chung

- JSON; ID BIGINT là **chuỗi** để không mất độ chính xác JavaScript.
- Date/time trả ISO 8601 UTC hoặc null. Trường nullable giữ null.
- User/Admin dùng `Authorization: Bearer <access JWT>`. JWT HS256 có header
  alg=HS256, typ=JWT; sub là User ID dạng chuỗi; exp, iss, aud bắt buộc; nbf tùy chọn.
- Cấu hình verifier hiện tại: ADMIN_ACCESS_JWT_SECRET (ít nhất 32 byte),
  ADMIN_ACCESS_JWT_ISSUER, ADMIN_ACCESS_JWT_AUDIENCE. Cùng verifier dùng cho User/Admin;
  tên biến giữ tương thích Prompt 1. Chưa có endpoint cấp token.
- Backend đọc role từ DB, yêu cầu account active, email đã xác minh và đúng một role.
  Không tin role/userId/adminId do client gửi trong body.
- Phản hồi thành công là object trực tiếp. Lỗi thông thường theo Nest:
  `{statusCode:400,message:"...",error:"Bad Request"}`.
- Internal auth dùng `{allowed:false,reason:"MACHINE_READABLE_REASON"}` khi từ chối.
- Không trả password, pairing code/hash, device credential/hash hoặc API key.
- Schema đang chạy V1.5 là nguồn chuẩn; không yêu cầu chạy CREATE/migration.

## 1. Admin Device Management

### GET /admin/devices

Role: ADMIN. Query:

| Field | Quy tắc |
|---|---|
| page | Mặc định 1; integer 1–1,000,000 |
| limit | Mặc định 20; integer 1–100 |
| search | Tối đa 128 ký tự, không control; trim; tìm substring literal trên UID/tên |
| connectionStatus | Chuỗi trạng thái lowercase 1–20 ký tự; cho phép số/underscore sau chữ đầu |

Sort cố định ID tăng dần. Status đúng định dạng nhưng không có dữ liệu trả danh sách rỗng.
search không cho client dùng wildcard `%`/`_`; backend escape chúng. Query lặp/array cho
các field được nhận là không hợp lệ; query không biết được bỏ qua ở endpoint này.

```json
{
  "items": [{
    "id":"42","deviceUid":"robot-42","displayName":"AIVA",
    "lifecycleStatus":"assigned","connectionStatus":"offline","lastSeenAt":null,
    "owner":{"id":"7","displayName":"Owner"}
  }],
  "pagination":{"page":1,"limit":20,"total":1}
}
```

Không có assignment: owner=null. Trang rỗng: items=[]. HTTP 200/400/401/403/500.

### GET /admin/devices/:deviceId

Role: ADMIN. deviceId là số nguyên dương canonical dạng chuỗi, tối đa 9223372036854775807.
Trả toàn bộ field của item danh sách và:

```json
{
  "hardwareModel":"esp32-s3","currentFirmwareId":null,
  "createdAt":"2026-10-30T00:00:00.000Z","updatedAt":"2026-10-30T00:00:00.000Z",
  "currentAssignment":{
    "deviceId":"42","userId":"7","pairingRequestId":"10",
    "assignedBy":"1","assignedAt":"2026-10-30T00:00:00.000Z"
  }
}
```

currentAssignment=null nếu chưa gán. HTTP 200/400/401/403/404/500.

## 2. User Pairing Requests

### POST /user/devices/pairing-requests

Role: USER. Body duy nhất `{ "pairingCode":"ABC123" }`.
Mã gồm 6–128 ký tự ASCII chữ/số/underscore/hyphen; phân biệt hoa/thường, giữ số 0 đầu,
không tự trim. Backend tìm SHA-256 lowercase hex của UTF-8 mã thô trong code_hash.
Provisioner phải dùng đúng định dạng; firmware hiện chưa ghi hash này.

201: `{ "id":"10", "deviceId":"42", "status":"PENDING" }`.

Mã chưa hết hạn, chưa consumed/revoked; device available/pending_approval, chưa có owner,
đạt reset gate. Trùng pending của cùng User/device -> 409. Chưa consume mã lúc submit.
HTTP 201/400/401/403/409/500.

### GET /user/devices/pairing-requests

Role: USER. Chỉ trả request của JWT User. Không nhận userId/owner filter.
Query status (PENDING/APPROVED/REJECTED/CANCELLED, không phân biệt hoa/thường), page,
limit; pagination cùng giới hạn mục 1. Không nhận query lạ/lặp/array.
Sort ID giảm dần.

```json
{
  "items":[{
    "id":"10","deviceId":"42","userId":"7","status":"PENDING",
    "reviewNote":null,"reviewedBy":null,"reviewedAt":null,
    "createdAt":"2026-10-30T00:00:00.000Z"
  }],
  "pagination":{"page":1,"limit":20,"total":1}
}
```

HTTP 200/400/401/403/500.

## 3. Admin Pairing Approval

### GET /admin/pairing-requests

Role: ADMIN. Query/response giống User pairing list, nhưng scope tất cả User.
HTTP 200/400/401/403/500.

### POST /admin/pairing-requests/:id/approve

Role: ADMIN. ID là signed BIGINT dương dạng chuỗi. Body tùy chọn `{ "reviewNote":"OK" }`.
reviewNote tối đa 500 ký tự, không control; trim rỗng thành null; không nhận null trực tiếp.
Chỉ nhận field reviewNote.

200: `{ "status":"APPROVED", "assignment":{"deviceId":"42","userId":"7"} }`.

Transaction khóa device trước, recheck pending/code/User/reset, consume mã, insert
assignment + history, cập nhật request/lifecycle và ghi audit atomically.
Chỉ có một owner hiện tại (PK device_id). Request khác vẫn pending nhưng không thể
approve khi device đã có owner; Admin có thể reject chúng.
HTTP 200/400/401/403/404/409/500.

### POST /admin/pairing-requests/:id/reject

Role: ADMIN. ID/body như approve.
200: `{ "status":"REJECTED", "reviewNote":"Not authorized" }`.
Không tạo assignment/history và không consume mã. Có audit cùng transaction.
Duyệt lại request đã xử lý -> 409; rollback khi bất kỳ bước ghi/audit lỗi.
HTTP 200/400/401/403/404/409/500.

## 4. User Device Management / Dashboard

Các route dùng JWT USER. Current assignment phải trỏ đúng approved pairing request,
lifecycle=assigned và không đang unlink/reset. Offline không làm mất ownership.

### GET /user/devices

Không có owner filter; lấy userId từ JWT. Trả toàn bộ thiết bị hợp lệ của User, sort ID tăng.

```json
{"devices":[{"id":"42","deviceUid":"robot-42","displayName":"AIVA","connectionStatus":"offline"}],"total":1}
```

Không có robot: devices=[],total=0. HTTP 200/401/403/500.

### GET /user/devices/:id

Trả một item như User device list sau khi verify ownership. Không tìm thấy hoặc thuộc
User khác -> 404; thuộc User nhưng trạng thái truy cập bị chặn -> 409.
Đường dẫn tĩnh `/user/devices/pairing-requests` được đăng ký trước route động này.
HTTP 200/400/401/403/404/409/500.

### PATCH /user/devices/:id

Body duy nhất `{ "displayName":"Robot phòng khách" }`.
Tên sau trim 1–120 ký tự Unicode, không control. Backend chỉ cập nhật display_name
và updated_at; khóa/recheck ownership trong cùng transaction.
200: `{ "id":"42", "displayName":"Robot phòng khách" }`.
Không tồn tại/không thuộc User -> 404. Trạng thái bị chặn/xung đột -> 409.
HTTP 200/400/401/403/404/409/500.

### GET /user/dashboard/access

200: `{ "allowed":true, "reason":null }` khi có ít nhất một assignment hợp lệ;
robot offline vẫn được. Nếu không có:
`{ "allowed":false, "reason":"NO_APPROVED_DEVICE" }`.
Pending pairing không cấp quyền. Đây là quyết định server-side cho Dashboard;
các API dữ liệu riêng vẫn phải tự kiểm tra User/ownership. HTTP 200/401/403/500.

## 5. Internal Device Authorization — BLOCKED tích hợp

### POST /internal/devices/authorize

**Chưa duyệt contract liên dịch vụ; không bật production chỉ vì code đã tồn tại.**
Mặc định DEVICE_AUTH_CONTRACT_APPROVED=false. Không sửa firmware/AI Server trong Prompt 3.
Đề xuất cần hai bên xác nhận:

1. AI Server gọi Backend qua TLS với `Authorization: Bearer <AI_DEVICE_SERVICE_TOKEN>`.
   Service token riêng, ngẫu nhiên ít nhất 32 byte, base64url 43–128 ký tự; không dùng JWT User.
2. Body `{ "deviceUid":"robot-42", "credential":"<random-device-secret-base64url>" }`.
   Credential riêng từng robot, ngẫu nhiên ít nhất 32 byte, base64url 43–128 ký tự.
3. Provisioner lưu SHA256(UTF8(credential)) dạng hex thường vào device_credentials;
   raw secret chỉ được trao qua kênh bảo mật. Backend không cấp/phát credential ở đây.
4. Cấu hình DEVICE_AUTH_CONTRACT_APPROVED=true chỉ sau khi contract được duyệt; flag
   không phải bằng chứng hai bên đã đồng ý. AI_DEVICE_SERVICE_TOKEN để trong secret config.

Backend không xác thực bằng UID đơn lẻ: phải có credential active, chưa revoked/hết hạn,
đúng device; current assignment đã approve, owner active/verified USER, lifecycle hợp lệ,
không unlink/reset. expires_at=null nghĩa là không có hạn theo schema. Không phụ thuộc online.

200: `{ "allowed":true, "deviceId":"42", "ownerUserId":"7" }`.

| HTTP | reason | Ý nghĩa |
|---|---|---|
| 400 | INVALID_INPUT | Body/UID/credential sai định dạng |
| 401 | SERVICE_UNAUTHORIZED | Service token thiếu/sai/chưa cấu hình |
| 403 | CONTRACT_NOT_APPROVED | Đúng service token nhưng contract chưa bật |
| 401 | DEVICE_UNAUTHORIZED | Device/credential không hợp lệ, hết hạn hoặc revoked; lỗi chung |
| 403 | DEVICE_ACCESS_DENIED | Credential đúng nhưng assignment/owner/lifecycle không được phép |
| 409 | AUTHORIZATION_RETRY | Deadlock/lock timeout; refresh/retry |
| 500 | AUTHORIZATION_UNAVAILABLE | Lỗi DB, không trả SQL/secret |

## 6. Revocation/session contract cho Prompt 6 — đề xuất

Authorization là quyết định tại thời điểm transaction, không phải quyền vĩnh viễn.
Unlink/revoke/reset/credential rotation phải khóa parent devices row trước khi đổi
assignment/credential/lifecycle, cùng giao thức khóa Prompt 2/3. Nếu revoke commit
trước, authorization sau phải deny; nếu authorization thắng khóa trước, quyết định
có thể thành công nhưng session vừa mở phải được đóng khi nhận revoke.

AI Server phải reauthorize khi reconnect và có cơ chế đóng session đang mở theo deviceId
sau revoke; bỏ cache quyền cũ. Backend chỉ trả success sau commit. Timeout/lỗi DB là
fail closed; không dùng lần allow cũ để bỏ qua kiểm tra. DB hiện chưa có cơ chế delivery
revocation/outbox được thống nhất; transport/ack/retry/thời hạn recheck phải chốt ở Prompt 6.
Chưa triển khai session invalidation của AI Server hay firmware trong task này.

## Kiểm thử / triển khai

Trong BE: `npm.cmd run build`, `npm.cmd test`.
Metadata/query smoke chỉ đọc DB: `node scripts/check-devices-readonly.cjs`,
`node scripts/check-pairing-readonly.cjs`, `node scripts/check-ownership-readonly.cjs`.
Prompt 4: `node scripts/check-ai-readonly.cjs`.
Prompt 5: `node scripts/check-monitoring-readonly.cjs` (SELECT/EXPLAIN/PREPARE, không EXECUTE DML).
Prompt 6: `node scripts/check-recovery-readonly.cjs`; `node scripts/cleanup-recovery-backups.cjs`
chỉ dry-run. Thêm `--execute` mới xóa backup hết hạn theo cơ chế ở mục 9.

Prompt 8: `npm.cmd run test:coverage`, `npm.cmd run test:typecheck` và
`npm.cmd run test:mysql` (opt-in MySQL test riêng, xem `docs/SPRINT2_HANDOFF.md`).
Jest mặc định dùng mock persistence/transaction model; không gọi đó là MySQL/hardware E2E.
Update Prompt 7: schema/accounting đã được User duyệt để triển khai code; **chưa cho
phép chạy DDL**. Không dùng system_settings làm request ledger. API quota ở mục 10.
`node scripts/check-quota-readonly.cjs` chỉ kiểm metadata; `npm.cmd run test:quota:mysql`
cần DB test riêng có migration đã được operator áp sau khi được phép.
Các báo cáo `docs/d2s20*-test-report.md` ghi bằng chứng và giới hạn từng prompt;
**file này là nơi tra cứu API tập trung**, các docs cũ lưu chi tiết triển khai/lịch sử.

## 7. AI Provider, Profile & API Key — Prompt 4

Public success JSON trực tiếp; lỗi Nest dùng message là mã/diễn giải an toàn.
Tất cả API yêu cầu JWT đúng role và account active/verified. Không gọi provider ngoài
trong các API này; enabled/model compatibility là trạng thái catalog trong DB, không
phải kết quả kiểm tra mạng/model đang chạy. Provider hỗ trợ: LOCAL, OPENAI, GEMINI.
Các Provider enabled hiện cho mọi User hợp lệ; chưa có bảng ACL provider theo User.

### GET /ai/providers

Role: USER hoặc ADMIN. Chỉ trả Provider enabled được hỗ trợ và model enabled capability
LLM (so sánh capability không phân biệt hoa/thường). Không có model vẫn trả models=[].

```json
{"providers":[{"id":"1","code":"LOCAL","name":"Local AI","isEnabled":true,
"models":[{"id":"11","modelCode":"local-llm","capability":"llm"}]}]}
```

HTTP 200/401/403/409/500. DB hiện chưa có ai_models, không tự tạo model mẫu.

### PATCH /admin/ai/providers/:id

Role: ADMIN. Body patch không rỗng; chỉ nhận isEnabled (boolean) và
defaultLlmModelId (ID string hoặc null để bỏ default). Model default phải thuộc
Provider, enabled và capability LLM.

```json
{"isEnabled":true,"defaultLlmModelId":"11"}
```

200: `{id,code,name,isEnabled}`. Lưu is_enabled trong ai_providers; default model
trong system_settings key `ai.provider.<id>.defaults`, value
`{"defaultLlmModelId":"11"}`. Không có cột URL/default trong ai_providers; không
tự thêm cột. Không nhận endpoint URL/provider code/model creation ở API này.
Thay đổi và audit AI_PROVIDER_UPDATED cùng transaction.
HTTP 200/400/401/403/404/409/500.

### GET /user/ai/profile

Role: USER. Scope luôn là JWT User, không lấy User ID từ query/body.

```json
{
  "assistantName":"AIVA","systemPrompt":"Trợ lý hữu ích",
  "preferredProviderId":"2","preferredLlmModelId":"21",
  "languageCode":"vi","voiceCode":"voice-name","credentialScope":"USER"
}
```

Chưa có profile: các field profile null, scope USER; GET không tự INSERT.
HTTP 200/401/403/409/500.

### PATCH /user/ai/profile

Role: USER. Partial body, chỉ nhận 6 field profile ở trên và credentialScope.
assistantName tối đa 100 ký tự, systemPrompt 16,000 (cho newline/tab), languageCode
20, voiceCode 100; text trim, không rỗng, có thể null để xóa. Provider/model ID là
chuỗi hoặc null. Không nhận userId/deviceId. Ngôn ngữ/voice chưa đối chiếu catalog
AI Server; chưa có catalog trong DB này.

Scope là USER hoặc SYSTEM. ai_profiles vẫn chỉ có PK user_id; scope được lưu bằng
system_settings key `ai.user.<id>.credentialScope`, mặc định USER. Không có profile
riêng từng robot.

- Đổi Provider mà bỏ model sẽ dùng Admin default; nếu không có default -> MODEL_REQUIRED.
- Model phải enabled, LLM và thuộc Provider; sai -> MODEL_UNAVAILABLE.
- LOCAL không yêu cầu Cloud key; resolver trả credentialScope=NONE, reference=null.
- Stored SYSTEM preference đã mất grant không chặn chuyển về LOCAL; LOCAL không dùng
  key nên effective scope vẫn NONE. Chọn SYSTEM mới một cách rõ ràng vẫn cần permission.
- Cloud cần key active, unrevoked, đúng scope/provider và ciphertext xác thực được.
- USER scope không có key -> CREDENTIAL_REQUIRED; **không fallback SYSTEM**.
- SYSTEM cần User được Admin/deployment cấp phép qua
  AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS (chuỗi ID phân tách dấu phẩy), đồng thời User
  chọn SYSTEM rõ ràng. Mặc định allowlist rỗng. Bị rút quyền -> SYSTEM_SCOPE_NOT_ALLOWED.
  User không được xem metadata/list/revoke SYSTEM key.

200: profile sau cập nhật và credentialScope đã chọn. Lưu profile, scope và audit
AI_PROFILE_UPDATED cùng transaction. Audit chỉ ghi provider/model/scope, không prompt/key.
HTTP 200/400/401/403/404/409/500.

### Personal và SYSTEM API Key

| Scope | Collection | Role |
|---|---|---|
| USER | /user/ai/credentials | USER; owner_user_id=JWT User |
| SYSTEM | /admin/ai/credentials | ADMIN; owner_user_id=NULL |

Cả hai collection có:

| Method | Path | Input | Success |
|---|---|---|---|
| GET | collection | không | 200 `{credentials:[metadata]}` |
| POST | collection | `{providerId,label,secret}` | 201 metadata |
| PATCH | collection/:id | `{label,secret}` | 200 metadata, thay secret của key active |
| DELETE | collection/:id | không | 200 `{id,isActive:false}` |

Metadata: `{id,providerId,label,secretHint:"configured",isActive:true}`.
Không trả suffix của key, raw secret, ciphertext hoặc owner khác. GET gồm cả metadata
đã revoke. ID nằm ngoài scope hoặc thuộc User khác -> 404. Revoke lặp là idempotent,
không ghi audit lần nữa; replace key đã revoke -> CREDENTIAL_REVOKED. Không đổi provider
hoặc ownership bằng PATCH. Không tạo Cloud key cho LOCAL -> LOCAL_REQUIRES_NO_KEY.

label 1–100 ký tự sau trim; secret 16–8192 ASCII printable, không whitespace/control.
Đây là validation cú pháp và trạng thái lưu trữ, **không chứng minh key gọi OpenAI/Gemini
thành công**. Chưa có integration để remote-validate nên không thực hiện API call tốn phí.
Nhiều key active cùng scope/provider: resolver chọn ID mới nhất; muốn ngừng key cũ
phải revoke rõ ràng. Key được thu hồi ngay cho lần resolve tiếp theo.

AES-256-GCM: cấu hình AI_SECRET_KEY_BASE64 là random 32 byte dạng base64 và
AI_SECRET_KEY_ID; thiếu/sai -> SECRET_ENCRYPTION_NOT_CONFIGURED (409), không lưu plaintext.
Envelope `v1.<keyId>.<nonce>.<tag>.<ciphertext>`; nonce 12 byte mới mỗi lần save,
AAD gắn phiên bản/key ID/scope/User/provider để chống tráo ciphertext qua owner/provider.
Không có key hardcode, không tự lưu encryption key vào DB/.env. Ciphertext cũ khác
key ID/format hoặc bị sửa -> CREDENTIAL_UNAVAILABLE; không fallback plaintext.
Rotation master key cần kế hoạch re-encrypt bằng key cũ trước khi bỏ key; tool rotation
không thuộc prompt này. Create/replace/revoke và audit cùng transaction.
HTTP 200/201/400/401/403/404/409/500.

### POST /internal/ai/resolve-config — BLOCKED tích hợp

Contract riêng đang chờ AI Server chấp thuận. Mặc định AI_CONFIG_CONTRACT_APPROVED=false.
Service gọi qua TLS, Bearer AI_CONFIG_SERVICE_TOKEN riêng (random >=32 byte, base64url
43–128 ký tự), không dùng JWT User hoặc token device. Body:

```json
{"userId":"7","deviceId":"42"}
```

userId bắt buộc; deviceId tùy chọn cho phiên không gắn robot. AI Server là bên tin cậy
chịu trách nhiệm bind userId vào session đã xác thực; không chuyển userId tùy ý từ client.
Có deviceId thì Backend khóa/recheck device, current approved assignment phải thuộc
userId, lifecycle/unlink/reset và account phải còn hợp lệ. Không có deviceId vẫn phải
kiểm tra User active/verified USER và config; không phải bỏ qua User authorization.

```json
{
  "userId":"7","provider":{"id":"2","code":"OPENAI","name":"OpenAI"},
  "model":{"id":"21","modelCode":"configured-model","capability":"llm"},
  "profile":{"assistantName":"AIVA","systemPrompt":"...","preferredProviderId":"2",
    "preferredLlmModelId":"21","languageCode":"vi","voiceCode":"voice-name"},
  "credentialScope":"USER","credentialReference":{"id":"9","providerId":"2"}
}
```

LOCAL: scope NONE, reference null. Cloud reference không chứa raw key/ciphertext.
Chỉ nhận userId/deviceId; không cho caller override provider/model/key scope.
Chưa có secret-fetch API hay raw-key delivery contract; **AI Server chưa thể dùng
reference này để gọi Cloud trực tiếp**. Phải chốt secret broker/secure delivery riêng
trước khi nghiệm thu Cloud end-to-end. Không bật flag thay cho việc duyệt contract.

401 SERVICE_UNAUTHORIZED nếu sai/missing token; 403 CONTRACT_NOT_APPROVED nếu contract
chưa bật; lỗi User/device 403; thiếu profile/model/credential hoặc cipher invalid ->409;
ID/input sai ->400, provider không tồn tại ->404; DB lỗi ->500. Lỗi nghiệp vụ AI dùng
Nest JSON với message như PROFILE_NOT_CONFIGURED, PROVIDER_UNAVAILABLE, MODEL_REQUIRED,
MODEL_UNAVAILABLE, CREDENTIAL_REQUIRED, CREDENTIAL_UNAVAILABLE, SYSTEM_SCOPE_NOT_ALLOWED,
AI_CONFIGURATION_CONFLICT/UNAVAILABLE; không trả SQL/secret.

Prompt 7 có thể dùng userId/providerId/credentialScope/reference để áp quota. Session
đang chạy và cache config/key phải được invalidation khi provider/key/User/assignment
đổi; transport/ack/TTL thuộc contract Prompt 6/7, chưa triển khai trong task này.

## 8. Device Monitoring & Heartbeat — Prompt 5

### Timeout và nguồn sự kiện

**Timeout đã được User duyệt: 60 giây.** Cấu hình HEARTBEAT_TIMEOUT_SECONDS mặc định
60 khi không có env; `.env.example` ghi 60. Khoảng hỗ trợ 1–2,147,483 giây để phù hợp
Node timer; deployment thay giá trị phải thống nhất với firmware/AI Server. Config
sai làm startup validation fail hoặc trả INVALID_HEARTBEAT_TIMEOUT (409).

Không tìm thấy setting presence có sẵn trong DB/repo. MQTT_PING_INTERVAL_SECONDS=90
trong firmware là transport ping, **không dùng làm timeout presence**. Để giữ online
với timeout 60, AI Server phải forward heartbeat thực tế đều đặn với khoảng cách <60
giây; không thể chỉ dựa trên MQTT ping 90 giây. Không tự coi mọi traffic là heartbeat.
Firmware/AI Server chưa được sửa để gửi endpoint mới trong prompt này.

### POST /internal/devices/heartbeat

Source auth tái sử dụng InternalDeviceGuard của Prompt 3: TLS deployment + Bearer
AI_DEVICE_SERVICE_TOKEN riêng và DEVICE_AUTH_CONTRACT_APPROVED=true. Khi chưa duyệt
contract/provision credential, endpoint vẫn mặc định bị khóa. Không dùng JWT User,
không tin deviceUid đơn lẻ, không giả định status row trong ai_server_instances là
bằng chứng xác thực. Chưa có instance-scoped service identity contract.

```json
{
  "deviceUid":"robot-42",
  "credential":"<provisioned-32-byte-secret-base64url>",
  "observedAt":"2026-10-30T01:00:00Z",
  "telemetry":{
    "wifiRssi":-65,"freeHeapBytes":"123456","batteryPercent":85,
    "payload":{"uptimeSeconds":1234,"firmwareVersion":"1.2.3"}
  }
}
```

- deviceUid/credential: cùng định dạng Device Auth Prompt 3; proof được kiểm tra lại
  trong **cùng transaction** với presence/telemetry, không gọi endpoint authorize rồi
  ghi bằng một transaction khác.
- observedAt bắt buộc: UTC ISO toàn giây (`...:00Z` hoặc `...:00.000Z`). Phải là thời
  điểm **AI Server nhận heartbeat trực tiếp từ robot**, không phải lúc retry, không
  lấy clock tùy ý từ firmware. AI Server/Backend DB cần đồng bộ UTC; timestamp tương
  lai bị 409 HEARTBEAT_FROM_FUTURE, không có skew tolerance tự đặt.
- Schema DATETIME không có phần lẻ giây; timestamp có millisecond khác 000 bị 400.
  Tối đa một accepted event/robot/toàn giây. Nếu cần sampling nhanh hơn hoặc durable
  eventId dedupe độc lập timestamp, cần contract/storage khác; không đổi schema ở đây.
- telemetry tùy chọn. wifiRssi integer -127..0; batteryPercent integer 0..100;
  freeHeapBytes là number nguyên an toàn hoặc decimal string 0..9223372036854775807,
  được chuẩn hóa thành string. Các scalar vắng/null được lưu null.
- payload chỉ nhận uptimeSeconds (integer không âm an toàn), firmwareVersion (text
  1–100 ký tự, không control). Không nhận payload tùy ý/secret/User data. Không có
  metric/payload thực sự thì không INSERT telemetry. Không nhận field ngoài contract.

200 accepted:
`{"accepted":true,"deviceId":"42","lastSeenAt":"2026-10-30T01:00:00.000Z"}`.

200 ignored:
`{"accepted":false,"deviceId":"42","lastSeenAt":"2026-10-30T01:00:00.000Z","reason":"STALE_OR_DUPLICATE"}`.

Timestamp <= lastSeenAt hoặc đã cũ >= timeout so với DB UTC now: không đổi lastSeen,
không làm online, không INSERT sample. Retry phải giữ timestamp cũ. Reconnect là một
heartbeat fresh hợp lệ mới -> online, không tạo assignment mới.

Khóa parent device, validate credential/current approved assignment/owner/lifecycle,
đọc DB now, update last_seen_at monotonically + online, INSERT telemetry event_type
heartbeat cùng observedAt, commit atomically. Lỗi INSERT -> rollback presence.
Credentials/raw payload không được trả trong heartbeat response hoặc monitoring.

HTTP 400 input; 401 service/credential sai; 403 contract chưa duyệt hoặc device/owner
không được phép; 404 unknown UID cho caller nội bộ đã qua service auth; 409 future
timestamp/lifecycle/conflict/retry; 500 MONITORING_UNAVAILABLE. Prompt 3 authorize vẫn
giữ generic 401 cho unknown UID; chỉ heartbeat có chính sách 404 này.

### GET /admin/devices/:id/monitoring

Role ADMIN active/verified. Có thể xem robot chưa gán hoặc bị block để chẩn đoán;
không dùng quyền Admin monitoring để cấp phép heartbeat cho robot đó.

### GET /user/devices/:id/monitoring

Role USER active/verified. Reuse ownership transaction: chỉ current approved assignment
của JWT User và device access hợp lệ. Không tồn tại/thuộc User khác ->404; thuộc User
nhưng lifecycle/reset blocked ->409. Offline không làm mất assignment.

Cả hai route trả:

```json
{
  "deviceId":"42","connectionStatus":"offline","lastSeenAt":"2026-10-30T01:00:00.000Z",
  "telemetry":{"wifiRssi":-65,"freeHeapBytes":"123456","batteryPercent":85}
}
```

connectionStatus lưu và trả lowercase online/offline theo convention Prompt 1.
Tính bằng DB time: `0 <= now-lastSeenAt < timeout` là online; bằng/vượt 60 giây,
lastSeenAt null hoặc timestamp legacy tương lai là offline. Không suy đoán presence
từ lifecycle/assignment. latest telemetry theo recorded_at DESC,id DESC; chỉ
event_type=heartbeat, không trộn dữ liệu cũ ngoài contract. Chưa có sample: ba metric
null. Các field vắng ở sample mới là null, không ghép metric từ nhiều sample khác nhau.
Payload không public. HTTP 200/400/401/403/404/409/500.

### Cập nhật offline và concurrency

Monitoring GET tính trạng thái chính xác lúc đọc và có thể materialize offline bằng
conditional UPDATE; GET này vì vậy có side effect presence nhỏ, không đổi ownership.
PresenceSweeper dùng Nest lifecycle + Node timer (repo chưa có scheduler dependency),
HEARTBEAT_SWEEPER_ENABLED=true mặc định, cadence bằng timeout (60 giây). Không chạy
ngay khi khởi tạo. Chống overlap, đợi job đang chạy khi shutdown; lỗi log thông báo
chung và retry ở tick sau. false tắt background writer nhưng monitoring vẫn tính
đúng theo timestamp.

Sweep dùng UPDATE có predicate timeout trực tiếp trên row hiện tại; không ghi theo
danh sách ID stale. Không reset lastSeenAt, xóa assignment hay đổi lifecycle.
Hai thứ tự heartbeat/sweep đều bảo toàn heartbeat mới nhờ row lock + conditional
predicate. Không dùng future timestamp predicate trong batch sweep vì DB statement
time được chụp trước khi chờ khóa, có thể nhầm heartbeat vừa commit là tương lai.

Trạng thái lưu để Prompt 1/User device list đọc có thể trễ tối đa một cadence (tới
khoảng 60 giây sau deadline nếu job khỏe; lâu hơn khi DB/job lỗi). Monitoring response
vẫn tính deadline 60 giây trực tiếp. Latest telemetry query dùng index hiện có
device_id/recorded_at; sweep có thể scan devices vì không thêm index theo ràng buộc DB.
Chưa có retention/cleanup telemetry hoặc event bus/disconnect forwarding trong task này.

## 9. Device Revoke, Backup & Recovery — Prompt 6

### Điều kiện triển khai

- RECOVERY_STORAGE_APPROVED=false mặc định; RECOVERY_BACKUP_DIRECTORY phải là đường
  dẫn tuyệt đối tới thư mục **đã provision**, riêng tư, bền vững trên deployment.
  Backend không tự tạo thư mục hoặc chọn vị trí storage. Gate phải được bật sau khi
  operator kiểm tra durability, ACL, capacity, retention và backup/recovery volume.
- Reuse AI_SECRET_KEY_BASE64/AI_SECRET_KEY_ID (AES-256-GCM) từ Prompt 4. Không lưu key
  vào DB hoặc backup. Giữ master key để đọc credential và backup còn hạn; rotation
  cần re-encrypt có kế hoạch, không tự đổi key.
- Backup mã hóa có snapshot version 1: assignment đã approved và tên robot. **Không**
  backup plaintext credential, API key, conversation hoặc firmware state không có
  trong schema. Không snapshot/restore profile AI cấp User vì sẽ ảnh hưởng robot khác;
  cấu hình theo User vẫn được giữ nguyên và dùng lại khi provision thiết bị mới.

### POST /admin/devices/:id/revoke

Role ADMIN active/verified. Header bắt buộc:
`Idempotency-Key: <16–128 ASCII letters/digits/_/->`.
Body tùy chọn `{ "reason":"Owner requested" }`; reason null hoặc text 1–500 ký tự
sau trim, không control. Không nhận ownerId hay field khác.

202:

```json
{"operationId":"10","deviceId":"42","status":"RESET_PENDING",
 "resetStatus":"PENDING","backupExpiresAt":"2026-11-06T01:00:00.000Z"}
```

Khóa device trước, assignment và Admin/former-owner rows theo numeric ID; kiểm tra
assignment trỏ đúng approved request. Ghi/reuse history -> tạo operation -> tạo file
mã hóa + flush/fsync + đọc kiểm checksum -> ghi backup metadata (DB UTC + **7 ngày**)
-> đóng history -> xóa đúng current assignment -> thu hồi active device credentials/
unused pairing codes -> cancel pending requests -> lifecycle reset_pending -> tạo
reset job pending -> audit -> commit. File/backup/audit lỗi thì không commit revoke.

Session DB chưa kết thúc của riêng device được set status=revoked, ended_at=DB now,
error_code=DEVICE_REVOKED. Không đổi User, session login của User, AI profile/API keys
hoặc robot khác. Không sửa connection_status/lastSeenAt để giả lập reset/offline.
Ownership, dashboard eligibility của robot và credential-based authorization mất
hiệu lực ngay sau commit. Socket/audio đang chạy ở AI Server vẫn phải được đóng bởi
AI Server; DB transaction không thể chứng minh remote socket đã dừng.

Idempotency mapping trong system_settings dùng hash của key + Admin ID và hash input.
Cùng key/body trả operation hiện có, không tạo thêm backup/reset job; key khác body
->409 IDEMPOTENCY_KEY_REUSED. Retry key cũ sau khi robot có owner mới **không revoke owner
mới**; nếu operation cũ không còn là reset mới nhất, trả409 để client refresh.
Robot chưa có assignment và chưa có operation ->409 DEVICE_NOT_ASSIGNED. Không có
assignment nhưng đã có operation thì trả trạng thái operation đó, không tạo reset mới.
HTTP 202/400/401/403/404/409/500.

### GET /admin/devices/:id/recovery

Role ADMIN. 200 `{backups:[{backupId,operationId,deviceId,createdAt,expiresAt,deletedAt,restoredAt}]}`.
Tối đa 100 backup mới nhất. Không có nội dung snapshot, URI/path, checksum, key reference,
nonce hay credential. Metadata giữ lại sau cleanup để audit; restore không được phép
dựa vào metadata nếu blob đã bị xóa/hết hạn.

### GET /admin/devices/:id/reset-status

Role ADMIN. Job mới nhất:
`{"jobId":"40","deviceId":"42","status":"PENDING","acknowledgedAt":null}`.
Status public PENDING/SENT/FAILED/ACKNOWLEDGED; DB lowercase. SENT chỉ là **đã claim
giao việc**, không chứng minh gửi thành công/reset xong. Offline không ACK tự động.
404 nếu device/job không tồn tại. HTTP 200/400/401/403/404/409/500.

### Reset delivery / ACK — contract đề xuất, BLOCKED tích hợp

Repo chưa có reset delivery, management channel/factory proof hay ACK implementation
trong Firmware/AI Server. Không sửa hai bên trong prompt này. Backend dùng reset_jobs
hiện có làm durable outbox/pull queue. Không thực hiện network call trong transaction DB.

RESET_CONTRACT_APPROVED=false mặc định; DEVICE_RESET_SERVICE_TOKEN riêng, random >=32
byte base64url (43–128 ký tự), gửi Bearer qua TLS. Token này độc lập với User/Admin JWT,
device credential và token AI config. Reset phải qua kênh quản trị xác thực **vẫn hoạt
động sau khi owner/device credential bị thu hồi**; không dùng credential cũ vừa revoke
để hợp thức hóa reset ACK.

DEVICE_RESET_RETRY_SECONDS là lease/retry delay bắt buộc nếu bật contract. Chưa có
giá trị được duyệt, `.env.example` để trống; Backend không tự chọn timeout hoặc lấy
60 giây presence làm lease. Khoảng cấu hình 1–2,147,483 giây.

#### POST /internal/device-reset-jobs/claim

Body `{ "deviceId":"42" }`. AI Server poll khi có management connection/đủ điều kiện
giao việc. Lệnh gồm INVALIDATE_SESSIONS và RESET_USER_CONFIGURATION cho cùng job ID.

```json
{"claimed":true,"jobId":"40","deviceId":"42","operationId":"10","status":"SENT",
 "attempt":1,"challenge":"<random-32-byte-base64url>",
 "actions":["INVALIDATE_SESSIONS","RESET_USER_CONFIGURATION"]}
```

Ghi status sent, attempt_count tăng, sent_at, hash challenge trong system_settings
`recovery.reset.<jobId>.challenge` trước khi trả. Raw challenge chỉ trả cho service đã
xác thực; không lưu plaintext/audit. Poll trong lease trả claimed=false cùng metadata/
retryAfterSeconds, không rotate challenge. Nếu response bị mất, chờ hết lease để
claim lại: cùng job ID, attempt mới/challenge mới. Failed/sent job có thể retry sau
lease; không báo thành công vì timeout. Job ACK rồi trả claimed=false, không reset lại.
Firmware phải dedupe hành động reset theo job ID; AI Server chỉ ACK sau khi có chứng
cứ reset thật và invalidation session, không chỉ vì đã nhận/đẩy được command.

#### POST /internal/device-reset-jobs/:jobId/ack

Success:

```json
{"deviceId":"42","attempt":1,"challenge":"<challenge của lần claim>","result":"success",
 "sessionsInvalidated":true,"firmwareResetConfirmed":true}
```

Failed:
`{deviceId,attempt,challenge,result:"failed",failureCode:"RESET_FAILED"}`.
failureCode chỉ RESET_FAILED/SESSION_INVALIDATION_FAILED/DELIVERY_FAILED; không nhận
raw lỗi có thể chứa secret. Success thiếu một trong hai true ->400.

Recheck latest job/operation/device, attempt và constant-time hash proof, device không
owner và reset_pending. Dùng DB UTC ACK time; không nhận timestamp do caller đặt.
Success -> job acknowledged, operation completed, device available. Thu hồi lại mọi
unused pairing code/active credential phát sinh trước ACK để đóng lỗ hổng timestamp
cùng giây; provision mã/credential mới sau commit. Pairing gate Prompt 2 vẫn đòi code
mới, completed operation và matching acknowledged reset/history. Không coi ACK success
là tự cấp owner/credential.

Failed -> operation/job failed, device vẫn reset_pending và không được pairing/restore.
Retry tạo attempt/challenge mới. ACK của attempt cũ sau retry ->409 STALE_RESET_ACK;
proof sai ->403 INVALID_RESET_PROOF. Duplicate success hoặc duplicate failed cùng
attempt/result được xử lý idempotent, không ghi lại audit hoặc sửa lifecycle của owner
mới. Đổi failed thành success trên attempt đã xử lý ->409, cần claim attempt mới.
ACK đến muộn khi chưa có claim mới vẫn có thể hợp lệ; lease không tự phủ nhận chứng
cứ reset. Mỗi job/attempt chỉ có một kết quả được chấp nhận.

200 reset result `{jobId,deviceId,status,acknowledgedAt}`. Source sai ->401;
contract chưa duyệt ->403 RESET_CONTRACT_NOT_APPROVED; sai input ->400; absent job/device
->404; stale/state/clock conflict ->409; lỗi DB/audit ->500, rollback để retry.

### POST /admin/device-recovery/:backupId/restore

Role ADMIN. Không cần body. 200:
`{"deviceId":"42","status":"RESTORED","ownerUserId":"7"}`.

Khóa parent device rồi backup/assignment/operation/job, recheck Admin và former owner
active/verified USER; backup chưa deleted, chưa tới expiresAt (đúng ngày thứ 7 là hết
hạn). Chỉ operation mới nhất của device được restore; reset job matching acknowledged,
operation completed và device available/unassigned. Read checksum/GCM context đúng
device+operation, kiểm tra snapshot/original approval, recheck expiry sau file I/O.
Insert assignment và open history mới -> restore tên robot -> ghi restored_at/by ->
revoke unused code/cancel pending requests -> audit -> commit. PK device_id bảo vệ
exclusive owner khi restore cạnh tranh Pairing. Không overwrite owner hiện tại.

Restore lặp khi backup đã restore và owner đó vẫn giữ assignment hợp lệ trả RESTORED
không tạo history/audit mới; sau thay đổi ownership/operation hoặc hết hạn ->409.
Không bật lại credential cũ, session cũ, mã pairing cũ hay khôi phục profile cấp User.
Robot cần credential mới từ DEV-03 để reconnect. Cấu hình User hiện tại vẫn còn nguyên.
Backup lỗi/mất blob/integrity/crypto/audit lỗi không commit assignment. File missing có
thể trả RECOVERY_UNAVAILABLE (500); không dùng snapshot rỗng/fallback để restore.
HTTP 200/400/401/403/404/409/500.

### Retention / cleanup

File lưu dạng `recovery-file:<random UUID>.enc`; chỉ chấp nhận filename thuộc namespace
này, không lấy path trực tiếp từ request/DB URI tùy ý. GCM AAD gắn device/operation;
checksum SHA-256 phát hiện file hỏng. File được exclusive-create, flush/fsync, checksum
read-back trước khi commit revoke; directory fsync khi OS hỗ trợ (POSIX).
Windows yêu cầu operator xác minh volume durability/ACL vì directory fsync không portable.
Power-loss/storage-failover durability chưa được nghiệm thu bằng unit test.

File I/O không nằm trong transaction MySQL. Nếu DB/audit/commit lỗi, ciphertext có thể
thành orphan. Không xóa ngay khi commit outcome không rõ: DB có thể đã commit revoke
và vẫn cần backup. Cleanup chỉ xóa orphan không được DB tham chiếu và đã cũ >=7 ngày.

```powershell
cd BE
node scripts/cleanup-recovery-backups.cjs            # dry-run: chỉ đếm batch hết hạn
node scripts/cleanup-recovery-backups.cjs --execute  # thực sự xóa blob hết hạn/orphan đủ tuổi
```

Cleanup dùng DB UTC, tối đa 100 expired rows/batch, recheck dưới khóa, unlink ciphertext
trước khi đặt deleted_at và audit DEVICE_RECOVERY_BACKUP_EXPIRED. Không xóa operation/
history/audit/User hoặc metadata backup. File đã vắng coi là cleanup idempotent; lỗi
storage giữ metadata để retry. Restore luôn chặn expiry dù cleanup chưa chạy.
CLI tắt heartbeat sweeper trong process riêng để dry-run không phát sinh presence writes.
Operator cần đưa `--execute` vào lịch retention được duyệt; chưa tự đặt cadence mới.
Đây là logical deletion của file mã hóa, không cam kết overwrite vật lý SSD/snapshot/
volume backup. Secure erasure/retention của volume/snapshot phải được operator duyệt
trước khi RECOVERY_STORAGE_APPROVED=true. Không cấp HTTP cleanup cho User/Admin client.

Audit: DEVICE_ASSIGNMENT_REVOKED, DEVICE_RESET_DISPATCHED, DEVICE_RESET_ACKNOWLEDGED,
DEVICE_RESET_FAILED, DEVICE_ASSIGNMENT_RESTORED, DEVICE_RECOVERY_BACKUP_EXPIRED. Metadata
chỉ IDs/reason/attempt cần thiết, không chứa blob, key, credential hoặc challenge.

## 10. Quota Management — update Prompt 7 đã duyệt

**Schema/accounting đã duyệt; DDL chưa được chạy.** Migration chuẩn bị tại
`src/database/migrations/20261030_quota_admission.sql`: 7 cột mới trong usage_records,
UNIQUE request_id và FK policy, không thêm bảng hoặc ledger vào system_settings.
Không tự migration lúc startup/test. Mọi API quota kiểm cột/type, ascii_bin, unique
index đầy đủ và FK trước data transaction; thiếu ->409 QUOTA_SCHEMA_NOT_READY.
P1–P6 vẫn hoạt động độc lập khi migration quota chưa áp dụng.

### Mode và accounting

| Mode | Ba limits | Quy tắc |
|---|---|---|
| UNLIMITED | tất cả null | Bỏ enforcement, vẫn auth/ownership/provider/model/key và usage logging |
| LIMITED | dương hoặc null, ít nhất một dương | Áp các chiều hữu hạn |
| BLOCKED | 0 / 0 / "0" | Chặn request mới |

Không nhận mixed zero/positive/null. Chỉ một policy active đúng User+Provider; thiếu
->403 QUOTA_POLICY_MISSING, trùng ->409 QUOTA_POLICY_AMBIGUOUS, không wildcard fallback.
Mỗi admission commit tính một lượt, kể cả failed/cancelled. Phút rolling 60 giây
(tuổi đúng 60 giây ra khỏi window); ngày/tháng UTC theo DB time. Token thuộc tháng
admission, không chuyển tháng khi report tới muộn. Không reset usage khi đổi policy.

Finite token cap cần maxTotalTokens trước execution: actual + outstanding hold + budget
mới <= cap. Actual columns giữ null lúc pending. reserved_tokens là ceiling gốc immutable;
hold hiệu lực bằng ceiling khi nonfinal, bằng 0 khi finalized. Final report ghi actual
và release phần dư atomically, không refund lượt. Failed/cancelled cũng ghi actual;
không tự báo actual=0 do timeout. Overrun vẫn ghi sự thật/audit, tính lại LIMITED từ
actual đầy đủ, không tự thêm security hold. AI Server phải enforce ceiling vật lý.

UNLIMITED/null token cap có thể bỏ budget. Bật finite cap khi còn nonfinal request không
rõ budget ->409 UNBOUNDED_REQUESTS_IN_FLIGHT. Admin có thể BLOCKED để dừng nhận mới khi
đối soát. Hạ limit dưới used+held khiến remaining=0 và chặn mới, không undo work đã admit.

### GET/PUT /admin/ai/quotas/users/:userId/providers/:providerId

ADMIN active/verified. Target phải là USER tồn tại; có thể disabled để Admin vẫn cấu
hình chặn. Provider phải tồn tại. Không cần bật admission contract, nhưng cần schema mới.
GET 200 `{userId,providerId,policyId,mode,requestsPerMinute,requestsPerDay,tokensPerMonth}`.
Chưa có policy: `{userId,providerId,policyId:null,mode:null,policyStatus:"MISSING"}`.
Trùng active ->409 với activePolicyIds chỉ cho Admin; không tự chọn/xóa policy.

PUT: mode + expectedPolicyId bắt buộc (null nếu lần đầu). Ví dụ không có quota mặc định:
`{"mode":"UNLIMITED","expectedPolicyId":"17"}`.
UNLIMITED/BLOCKED có thể bỏ limits, backend chuẩn hóa all null/all zero; giá trị trái
mode ->400. LIMITED phải gửi đủ ba field, null rõ ràng cho chiều không giới hạn;
requestsPerMinute/Day integer 1..2147483647, tokensPerMonth decimal string dương
<=9223372036854775807. Không nhận owner/provider khác trong body.

Khóa Admin+target theo numeric ID, so expectedPolicyId, deactivate version cũ, INSERT
version mới và audit AI_QUOTA_POLICY_CHANGED cùng transaction. Không xóa policy cũ
được usage tham chiếu, không xóa counter. Version stale ->409 QUOTA_POLICY_CHANGED.
200 trả policy mới. HTTP 200/400/401/403/404/409/500.

### POST /internal/ai/authorize-request

TLS + Bearer AI_QUOTA_SERVICE_TOKEN riêng (random >=32 byte base64url 43–128 ký tự),
không dùng JWT User/device/config token. Admission cần AI_QUOTA_CONTRACT_APPROVED=true
và AI_USAGE_REPORT_TIMEOUT_SECONDS integer 1..2147483 **không có default**; thiếu ->409,
contract tắt ->403. Duyệt code không có nghĩa AI Server đã xác nhận live contract.

Body: `{requestId,userId,providerId,modelId,deviceId?,sessionId?,conversationId?,maxTotalTokens?}`.
requestId ASCII 16–128 chữ/số/_/-, global unique, case-sensitive; nên dùng UUID, không
chứa PII/prompt/secret. Context IDs là canonical BIGINT strings; optional IDs có thể
null. maxTotalTokens là nonnegative BIGINT string, chỉ có thể thiếu/null khi không có
finite token cap. Không nhận field khác. Hiện hỗ trợ LLM theo catalog/quyền P4.

AI Server phải bind context đã xác thực, không forward userId tùy ý từ client. Quota
không thay bước Device Auth P3. Backend recheck active verified USER, approved current
device ownership/lifecycle/reset, session/conversation active và đúng User/device.
Không thể bỏ deviceId để dùng device-bound session như chat không robot. P4 kiểm
Provider/model/key cùng connection, không SYSTEM fallback; UNLIMITED không bỏ kiểm này.

Khóa Device nếu có, rồi User/context/provider/policy. COUNT/SUM trong User lock rồi
INSERT admission/reservation và audit, commit trước allow; không count-then-allow
chưa có hold. UNIQUE request_id bảo vệ race liên process/tenant. Lỗi DB/deadlock không
bypass quota. 200 mới: `{allowed:true,requestId,providerId,mode,remainingQuota,
reservedTokens,reportDueAt,replayed:false,executionAllowed:true}`.
remainingQuota có requestsPerMinute/Day và tokensPerMonth dạng decimal strings hoặc
null cho chiều unlimited, không quota số mặc định.

Retry cùng ID/context trả 200 durable **state**, không cấp permit nữa:
`{allowed:false,requestId,providerId,replayed:true,executionAllowed:false,state:"ADMITTED",reason:"REQUEST_ALREADY_ADMITTED"}`.
Final state ->REQUEST_FINALIZED; overdue ->USAGE_REPORT_MISSING. Đổi context/budget cho
ID cũ ->409 REQUEST_CONTEXT_CONFLICT. AI Server phải dedupe/đối soát job gốc; không
blindly chạy provider lần nữa. Backend không hứa exactly-once ở provider ngoài.

Denied `{allowed:false,requestId,reason}`: BLOCKED/missing/permission 403, exhausted
429 QUOTA_EXCEEDED, thiếu budget hữu hạn 400 TOKEN_RESERVATION_REQUIRED, ambiguous/
invalid policy/context/conflict 409, unknown identity/device/provider 404 khi phù hợp,
DB failure 500 QUOTA_UNAVAILABLE. Denial audit commit nhưng không tạo usage row.

### POST /internal/ai/usage

Cùng service auth; có thể settle request đã admit ngay cả khi admission contract vừa
tắt/User/device/key bị revoke. Không cấp execution mới và không tạo row cho unknown ID.
Body `{requestId,providerId,status,inputTokens,outputTokens,durationMs}`; status
success/failed/cancelled không phân biệt hoa/thường, actual counts/duration integer
0..2147483647 theo INT schema. Không nhận field khác.

Locate request -> lock User/row -> bind provider/hash -> UPDATE actual/status/finalized_at
và audit; giữ nguyên admission occurred_at. 200 `{requestId,status:"SUCCESS",recorded:true,
replayed:false,budgetExceeded:false}`. Report lặp giống hệt ->replayed=true, không charge/
audit hai lần; payload finalized khác ->409 USAGE_REPORT_CONFLICT, sai provider ->409,
unknown ID ->404. Audit lỗi rollback actual/status. Overrun trả budgetExceeded=true,
ghi actual thật và AI_TOKEN_BUDGET_EXCEEDED, không drop usage để giữ số dưới limit.

### Missing report / crash

report_due_at lưu bền; AI_USAGE_REPORT_SWEEPER_ENABLED=false mặc định. Bật worker cần
deadline config, cadence cùng timeout, batch 100, không overlap, shutdown đợi job.
Worker chỉ chuyển ADMITTED ->REPORT_MISSING và audit, giữ hold và identity. Retry
admission cũng nhận diện overdue. Không auto-finalize/refund hay suy ra cancelled=0.
AI Server cần durable report retry/outbox; late report settle đúng row một lần.
Không tự delete ledger/IDs; retention/archive cần dedupe horizon được duyệt sau.
User locking/history scan/overdue scan cần đo tải, không tự thêm bảng/index ngoài duyệt.

### GET /user/ai/usage — GET /admin/ai/usage

JWT USER/ADMIN tương ứng. providerId optional; from/to phải có cả hai nếu dùng, UTC
ISO whole seconds `...:00.000Z`, from < exclusive to; mặc định tháng UTC hiện tại.
Admin thêm userId optional. User không được gửi userId/unknown query/repeated array.
Chỉ aggregates, không key/credential/private audit.

Response: `{requestsUsed,inputTokens,outputTokens,reservedTokens,unboundedRequests,
policyStatus,mode,quotaLimit,remainingQuota,range:{from,to},quotaWindowAt}`.
Counts/sums/remaining là decimal strings tránh mất BIGINT; INT request limits là numbers,
token limit là string. Aggregates theo range; remaining theo current windows tại
quotaWindowAt, không theo lịch sử. Chỉ scoped User+Provider mới có quotaLimit/remaining;
aggregate rộng trả NOT_SCOPED và null (không có nghĩa UNLIMITED), thiếu policy trả MISSING.
Scoped response thêm quotaUnboundedRequests và admissionBlockedByUnboundedRequests;
finite legacy policy có unknown hold trả token remaining=null thay vì quảng cáo usable
balance. BLOCKED remaining=0; UNLIMITED explicit mode mới có unlimited null. HTTP
200/400/401/403/404/409/500. Duplicate/invalid policy fail closed.
