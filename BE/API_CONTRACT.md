# AIVA-IoT — Backend API contract

Cập nhật 03/11/2026, đối chiếu module thực tế và client `AI_SERVER/app/clients/backend.py`
cùng `AI_SERVER/app/models/backend.py`. Tài liệu này thay thế mô tả internal API cũ.
Base URL development `http://127.0.0.1:3000`, không có prefix `/api`.
Production dùng TLS tại ingress tin cậy; không truyền service token qua HTTP mạng ngoài.
Swagger ở `/api/docs`, JSON ở `/api/docs-json`; các route dùng body `unknown` cần xem
schema chi tiết trong tài liệu này, không suy schema từ Swagger tự sinh.

## Trạng thái triển khai

| Chức năng AI_SERVER | Endpoint | Source/runtime wiring | Live |
|---|---|---|---|
| Device auth/owner | POST /internal/devices/authorize | READY, DevicesModule | HTTP test PASS; DB end-to-end NOT RUN |
| Config/profile/voice/reference | POST /internal/ai/resolve-config | READY, AiProvidersModule | HTTP test PASS; DB end-to-end NOT RUN |
| Quota/budget admission | POST /internal/ai/authorize-request | READY, QuotasModule | BLOCKED schema hiện có |
| Usage settlement | POST /internal/ai/usage | READY, QuotasModule | BLOCKED schema hiện có |
| Heartbeat forwarding | POST /internal/devices/heartbeat | READY, MonitoringModule | HTTP test PASS; DB end-to-end NOT RUN |
| Session DB create/close | Chưa có API nội bộ | MISSING | Không gửi UUID WS vào sessionId |
| Cloud secret delivery/execution broker | Chưa có API | MISSING | Reference không phải secret |

READY nghĩa đã có controller, service, module registration; không có nghĩa Cloud/hardware
hoặc MySQL concurrency đã được xác minh. Test HTTP dùng real NestJS/TCP nhưng repository
giả lập. Read-only schema probe tới DB cấu hình hiện tại trả QUOTA_SCHEMA_NOT_READY.
Chưa chạy migration, không tự thêm schema/counter qua system_settings.
AI_SERVER hiện vẫn có blocker trong gateway và mock-only execution bridge; thay đổi BE
không tự bật integrated audio và không thay code AI_SERVER.

## Quy ước và xác thực

- JSON object trực tiếp, không có wrapper data. ID là canonical positive decimal string,
  tối đa BIGINT signed 9223372036854775807; không nhận JS number cho ID.
- Timestamp UTC ISO; DB V1.5 DATETIME có độ chính xác giây. Token counts/budget BIGINT
  là decimal string; actual usage là integer 0..2147483647, không float/bool.
- Internal routes bỏ global User JWT qua metadata `Public`, nhưng luôn có guard service
  riêng. `Public` không bỏ các guard riêng này. Không nhận JWT/device credential làm
  service token. Không log body chứa credential, ciphertext, API key hoặc prompt.
- Service tokens: ba giá trị base64url độc lập 43–128 ký tự, Bearer exact; không trùng
  JWT secrets. Constant-time digest comparison. Guard từ chối missing/malformed/wrong
  token với 401 `{allowed:false,reason:"SERVICE_UNAUTHORIZED"}`.
- Device auth/heartbeat dùng AI_DEVICE_SERVICE_TOKEN + DEVICE_AUTH_CONTRACT_APPROVED=true.
  Config dùng AI_CONFIG_SERVICE_TOKEN + AI_CONFIG_CONTRACT_APPROVED=true.
  Admission dùng AI_QUOTA_SERVICE_TOKEN + AI_QUOTA_CONTRACT_APPROVED=true.
  Cờ mặc định false; contract chưa bật →403 CONTRACT_NOT_APPROVED.
  Usage dùng quota token nhưng không yêu cầu admission flag đang bật, để settle work cũ.
- Token sai cấu hình không cấp quyền. Startup kiểm tra token các contract được bật,
  tính độc lập của mọi service token được cấu hình và deadline khi quota/worker được bật.
- Các route User/Admin mới dùng AccessRoleGuard, kiểm tra JWT HS256/exp/sub/issuer/audience
  và active verified account/role trong DB. Nếu không cấu hình bộ legacy ADMIN_ACCESS_JWT_*,
  dùng token login hiện tại JWT_ACCESS_SECRET, iss=aiva-iot, aud=aiva-api, typ=access.
  Legacy verifier chỉ dùng khi khai báo rõ toàn bộ bộ ADMIN_ACCESS_JWT_*; không tự chấp
  nhận refresh token hoặc role/userId do body client cung cấp.
- HTTP 400: field thừa/schema sai; 401 auth; 403 quyền/contract/policy blocked;
  404 identity/context không tồn tại; 409 conflict/schema/config chưa sẵn sàng;
  429 quota hoặc global Throttler; 500 DB/service error. Không trả SQL/secret.
  Error reason nội bộ được tạo rõ là `{allowed:false,reason:"CODE"}`;
  HttpException thông thường qua global filter giữ `{statusCode,code,message,path,timestamp}`.
  Client phải fail closed với mọi non-200 hoặc response sai schema.

## POST /internal/devices/authorize

Bearer device service token, body chỉ hai field:

```json
{"deviceUid":"robot-42","credential":"<provisioned-base64url-43-to-128-chars>"}
```

200:

```json
{"allowed":true,"deviceId":"42","ownerUserId":"7"}
```

Thiết bị/credential được khóa theo transaction. So hash, status active, revoked_at null,
expires_at null hoặc trong tương lai. Assignment hiện tại phải thuộc pairing approved,
device lifecycle assigned; không có incomplete unlink/reset chưa acknowledge.
Owner phải active, email verified, đúng một role USER. Connection offline không làm mất
ownership, thiết bị có thể reconnect. Không suy UID từ MAC hoặc client-id.

400 INVALID_INPUT; 401 DEVICE_UNAUTHORIZED cho unknown UID/sai/revoked/expired credential;
403 DEVICE_ACCESS_DENIED cho owner/status/assignment không hợp lệ;
409 AUTHORIZATION_RETRY cho lock conflict; 500 AUTHORIZATION_UNAVAILABLE.
`GET /devices/device/me` cũ chỉ trả device_id/device_uid, không thay thế owner auth.

## POST /internal/ai/resolve-config

Bearer config service token. Body `{userId,deviceId?}`; deviceId có thể null.
userId phải là identity đã được AI_SERVER bind từ authorization, không lấy từ robot input.

```json
{"userId":"7","deviceId":"42"}
```

200 (ví dụ Cloud reference):

```json
{
  "userId":"7",
  "provider":{"id":"2","code":"OPENAI","name":"OpenAI"},
  "model":{"id":"3","modelCode":"configured-catalog-model","capability":"llm"},
  "profile":{"assistantName":"AIVA","systemPrompt":"Cấu hình của user",
    "preferredProviderId":"2","preferredLlmModelId":"3","languageCode":"vi","voiceCode":"configured-voice"},
  "credentialScope":"USER","credentialReference":{"id":"9","providerId":"2"}
}
```

Provider chỉ LOCAL/OPENAI/GEMINI, phải enabled. Model phải enabled, đúng provider và
capability llm. Chọn profile user; nếu thiếu model, dùng đúng setting
`ai.provider.<id>.defaults.defaultLlmModelId`, nếu không có thì fail, không tự chọn model.
Kiểm tra user active/verified USER và current approved ownership nếu deviceId được gửi.
Voice/language/prompt nullable giữ giá trị profile, không tự mặc định giọng/provider TTS.
Đây là config LLM + profile; không tuyên bố có catalog STT/TTS hoặc token policy trong response.

LOCAL → credentialScope=NONE, credentialReference=null. Cloud mặc định USER scope;
không fallback SYSTEM. SYSTEM chỉ khi user đã chọn scope SYSTEM qua setting và được
AI_SYSTEM_CREDENTIAL_ALLOWED_USER_IDS cho phép. Chọn credential active không revoke,
đúng provider/owner; xác minh ciphertext có thể giải mã ở BE, chỉ trả reference ID.
Hỗ trợ envelope APP_ENCRYPTION_KEY hiện có từ `/api-keys` và envelope context-bound
AI_SECRET_KEY_BASE64/AI_SECRET_KEY_ID. Key sai/hết quyền/ciphertext lỗi →fail closed.
Không trả plaintext, ciphertext hay credential hint trong resolve-config.

400 schema/ID; 403 USER_ACCESS_DENIED/DEVICE_ACCESS_DENIED/PROVIDER_UNAVAILABLE/
SYSTEM_SCOPE_NOT_ALLOWED; 404 PROVIDER_UNAVAILABLE; 409 PROFILE_NOT_CONFIGURED,
MODEL_REQUIRED, MODEL_UNAVAILABLE, CREDENTIAL_REQUIRED, CREDENTIAL_UNAVAILABLE,
AI_CONFIGURATION_RETRY; 500 AI_CONFIGURATION_UNAVAILABLE.

## POST /internal/ai/authorize-request

Bearer quota service token. AI_USAGE_REPORT_TIMEOUT_SECONDS bắt buộc 1..2147483 giây;
không tự mặc định deadline. Request JSON chỉ nhận:

```json
{"requestId":"a-unique-request-id-0001","userId":"7","providerId":"2","modelId":"3",
 "deviceId":"42","sessionId":null,"conversationId":null,"maxTotalTokens":"1000"}
```

requestId ASCII 16–128 ký tự `[A-Za-z0-9_-]`, unique toàn hệ thống, case-sensitive,
không chứa PII/prompt/secret. Context IDs optional/null. sessionId là persisted ai_sessions
BIGINT; không gửi WebSocket UUID. Nếu có session/conversation phải active, chưa end/delete,
đúng user/device và conversation của session. Không bỏ deviceId để giả session robot thành chat.

Policy phải có **đúng một active row User+Provider**. Không fallback global/null policy,
không lấy policy mới nhất để che duplicate. UNLIMITED: các policy cap null;
BLOCKED: toàn zero; LIMITED: dương hoặc null, không toàn null. Policy thiếu/duplicate/
invalid và lỗi schema đều fail closed.

Ceiling cố định **12 request/phút/user**, rolling `(now-60s,now]`, xuyên provider và mọi
device của user, kể cả policy UNLIMITED. Policy RPM thấp hơn vẫn áp dụng. Giữ daily UTC
request limit và monthly UTC token limit của policy; không thay số cấu hình đã có.
Mọi lượt đã admit (success/failed/cancelled/report_missing) đều tính request, không refund.
Provider/model/credential recheck trong cùng transaction; UNLIMITED không bỏ permission.

Finite tokensPerMonth bắt buộc maxTotalTokens nonnegative BIGINT string. Tính actual
tháng hiện tại + toàn bộ outstanding reservation + budget mới trước allow. Unknown
unbounded pending work chặn finite policy. Giữ hold qua timeout/tháng, không tự giải phóng.
AI_SERVER phải enforce ceiling input+output vật lý; BE reservation không thể ngắt Cloud call.
Giới hạn riêng input/output/request chưa có trong schema/contract ngoài budget caller gửi.

Khóa Device nếu có → User → context/provider/policy; User lock serialize toàn provider.
Trong transaction tính count/hold, insert usage_records/admission và audit rồi commit
trước khi trả permit. READ COMMITTED, unique request_id bảo vệ duplicate xuyên process.
Không auto retry transaction ambiguous hoặc cấp permit lần hai.

200 mới:

```json
{"allowed":true,"requestId":"a-unique-request-id-0001","providerId":"2","mode":"LIMITED",
 "remainingQuota":{"requestsPerMinute":"11","requestsPerDay":"99","tokensPerMonth":"9000"},
 "reservedTokens":"1000","reportDueAt":"2026-11-03T01:00:30.000Z",
 "replayed":false,"executionAllowed":true}
```

remainingQuota là decimal strings/null. requestsPerMinute là nhỏ nhất của remaining policy
User+Provider và remaining ceiling toàn user, luôn hữu hạn dù policy mode UNLIMITED.

Replay cùng request/context/budget trả durable state, không cấp execution:

```json
{"allowed":false,"requestId":"a-unique-request-id-0001","providerId":"2",
 "replayed":true,"executionAllowed":false,"state":"ADMITTED","reason":"REQUEST_ALREADY_ADMITTED"}
```

State có thể ADMITTED/REPORT_MISSING/SUCCESS/FAILED/CANCELLED; reason tương ứng
REQUEST_ALREADY_ADMITTED/USAGE_REPORT_MISSING/REQUEST_FINALIZED. Đổi context/budget
với ID cũ →409 REQUEST_CONTEXT_CONFLICT; global uniqueness race →409 QUOTA_REQUEST_CONFLICT.
Chỉ caller giữ job gốc được xử lý/đối soát; không gọi provider lần hai từ replay.

Denial codes: 403 QUOTA_POLICY_MISSING/QUOTA_BLOCKED/quyền; 429 QUOTA_EXCEEDED;
400 TOKEN_RESERVATION_REQUIRED; 409 AMBIGUOUS_QUOTA_POLICY/INVALID_QUOTA_POLICY/
INVALID_AI_CONTEXT/UNBOUNDED_REQUESTS_IN_FLIGHT/USAGE_REPORT_TIMEOUT_NOT_CONFIGURED/
QUOTA_SCHEMA_NOT_READY; 404 unknown identity/context; 500 QUOTA_UNAVAILABLE.
Denial business sau identity lock được audit commit, không tạo usage row; lỗi DB/audit rollback.

## POST /internal/ai/usage

Bearer quota token; settle được sau khi contract bị tắt hoặc user/device/key bị revoke.
Không mở execution mới và không tạo usage cho unknown requestId.

```json
{"requestId":"a-unique-request-id-0001","providerId":"2","status":"cancelled",
 "inputTokens":20,"outputTokens":5,"durationMs":1200}
```

status success/failed/cancelled, không phân biệt hoa thường; actual integer 0..2147483647.
Không dùng estimate/0 thay unknown usage vì timeout. Giữ pending và gửi actual muộn.

200 `{requestId,status:"CANCELLED",recorded:true,replayed:false,budgetExceeded:false}`.
Locate row read-only → lock User → lock row → validate provider/report fingerprint →
finalize actual/status và audit cùng transaction. Không đổi occurred_at (admission month),
không xóa request identity/reservation gốc. Actual thay hold khi tính availability.
Report trùng body (status normalized) →200 replayed=true, không charge/audit lần hai.
Report final khác →409 USAGE_REPORT_CONFLICT; provider sai →409 USAGE_CONTEXT_CONFLICT;
unknown ID →404 REQUEST_NOT_FOUND; schema/config/conflict/DB fail closed.
Overrun vẫn ghi actual thật, budgetExceeded=true và AI_TOKEN_BUDGET_EXCEEDED audit.

Khi hết reportDueAt, admission replay hoặc worker chuyển ADMITTED→REPORT_MISSING,
giữ hold, không refund và không bịa cancelled=0. Late report settle một lần.
AI_USAGE_REPORT_SWEEPER_ENABLED=false mặc định; khi bật dùng interval bằng deadline,
batch 100, không overlap, shutdown đợi job; không bật worker tự động trong task này.
AI_SERVER vẫn cần durable usage outbox/reconciliation và idempotent retry đã được kiểm soát.

## POST /internal/devices/heartbeat

Bearer device service token + contract auth approved. Body `{deviceUid,credential,observedAt,telemetry?}`.
observedAt là server-receipt UTC whole second, giữ nguyên timestamp nếu retry.
Không suy heartbeat từ WS Ping/Pong hoặc playback ACK. Telemetry optional:
wifiRssi -127..0, freeHeapBytes nonnegative BIGINT string hoặc safe integer,
batteryPercent 0..100, payload chỉ uptimeSeconds và firmwareVersion.

200 `{accepted:true,deviceId,lastSeenAt}`; duplicate/out-of-order hoặc quá hạn:
`{accepted:false,deviceId,lastSeenAt,reason:"STALE_OR_DUPLICATE"}`.
Recheck credential/owner trong transaction, update presence+telemetry atomically.
Timestamp tương lai →409 HEARTBEAT_FROM_FUTURE. Timeout mặc định 60 giây, nullable lastSeenAt.
Không ghi assignment/lifecycle khi heartbeat/disconnect/timeout. Source sweeper hiện chưa
được đăng ký runtime; read monitoring sẽ tính offline. Không tuyên bố worker đang chạy.

## Admin policy và thống kê

- GET/PUT `/admin/ai/quotas/users/:userId/providers/:providerId`: active verified ADMIN.
  PUT bắt buộc `{mode,expectedPolicyId}` (null khi tạo lần đầu). LIMITED gửi đủ
  requestsPerMinute, requestsPerDay, tokensPerMonth, null rõ ràng cho chiều unbounded.
  INT request caps dương; token cap positive BIGINT string. UNLIMITED toàn null;
  BLOCKED toàn zero. Không đổi limit hiện hữu nếu không có PUT được authorize.
  Version stale →409 QUOTA_POLICY_CHANGED; pending unbounded→409 khi bật finite token cap.
  Update deactivate version cũ/insert version mới/audit cùng transaction; không xóa usage.
  GET missing `{userId,providerId,policyId:null,mode:null,policyStatus:"MISSING"}`.
- GET `/user/ai/usage`: active verified USER, identity từ JWT; query providerId/from/to,
  không được gửi userId, unknown/repeated array field.
- GET `/admin/ai/usage`: ADMIN, thêm userId optional. from/to phải cùng có, UTC whole-second
  `.000Z`, from < exclusive to. Default tháng UTC hiện tại tới đầu tháng kế tiếp.
  Response `{requestsUsed,inputTokens,outputTokens,reservedTokens,unboundedRequests,
  policyStatus,mode,quotaLimit,remainingQuota,range,quotaWindowAt,quotaUnboundedRequests,
  admissionBlockedByUnboundedRequests}`. Aggregate counts BIGINT strings. Quota remaining
  theo thời điểm hiện tại, không theo historical range. Broad scope NOT_SCOPED/null,
  không có nghĩa unlimited. Thiếu policy MISSING, duplicate/invalid →409.
  Thống kê remaining policy theo User+Provider; admission còn áp ceiling global 12/user.

## API hiện hữu và tương thích

Các controller cũ `/devices`, `/ai/profile`, `/api-keys`, `/quotas`, `/admin/quotas`,
`/web-chat/messages`, `/auth/*`, dashboard vẫn giữ runtime của chúng. Public profile/key
hiện tại dùng snake_case. Các controller lịch sử `/user/ai/profile`, `/user/ai/credentials`,
`/admin/ai/credentials` được export cho standalone tests nhưng chưa đăng ký runtime;
Standalone test controllers are not deployed APIs. `/web-chat/messages` is mounted but
currently fail-closed with HTTP 503 `AI_PIPELINE_UNAVAILABLE`; it creates no mock messages
or estimated usage. Real chat remains blocked on provider execution and approved quota/usage.
Admin cấu hình quota mới qua endpoint versioned phía trên, tránh tạo duplicate active
policy qua legacy POST `/admin/quotas`. Không tự sửa/xóa policy cũ khi phát hiện conflict.

## Schema và kiểm thử

Quota cần migration đã có `src/database/migrations/20261030_quota_admission.sql`:
request_id unique ascii_bin đầy đủ, fingerprints, quota_policy_id FK, reserved_tokens,
report_due_at/report_fingerprint/finalized_at. Không thực thi migration trong task này.
Readiness chỉ SELECT information_schema, không seed/migrate. Startup app thật vẫn có
AdminSeeder hiện hữu; cần cấu hình/môi trường DB được phép trước khi chạy.

Windows CMD, từ BE (điền `.env` local trước khi chạy app):

```bat
cd /d E:\learn\AI_Project\cap1\BE
npm ci
npm run build
node scripts\check-internal-readiness.cjs
npm run start:dev
```

Không chạy app live nếu chưa cho phép bootstrap/ghi DB. Không chạy migration:run để
ép quota ready. Sau khi migration được duyệt, operator áp dụng trên môi trường được
duyệt và xác minh readiness trước khi bật AI_QUOTA_CONTRACT_APPROVED.

```bat
npm test -- --runTestsByPath test/internal-integration.spec.ts test/ownership.spec.ts test/ai-configuration.spec.ts test/ai-http.spec.ts test/quotas.service.spec.ts test/quotas.repository.spec.ts test/quotas.http.spec.ts test/monitoring.spec.ts test/monitoring.http.spec.ts test/configuration.spec.ts
npm run build
npm run lint
npm test
```

`internal-integration.spec.ts` boot real AppModule với repository/DB pool giả lập,
chạy TCP và gọi client AI_SERVER nguyên bản nếu có Python env, không sửa AI_SERVER.
Nếu Python env thiếu thì riêng cross-client test SKIP, không đánh dấu PASS.
MySQL integration suite có sẵn yêu cầu isolated schema đã provision/migrate và các row
fixture được phép; chưa chạy vì chưa có môi trường đó. Không dùng production DB để test.
Kết quả thực tế, file sửa và blocker: [báo cáo](docs/internal-api-completion-report.md).

## Web chat runtime update (2026-11-04)

`POST /web-chat/messages` is now fail-closed and returns HTTP 503 `AI_PIPELINE_UNAVAILABLE`.
It no longer creates mock assistant messages, estimates token counts, or persists fabricated
usage. Enable real chat only after provider execution, approved quota admission, and actual
usage settlement are available. Historical text above describing a mock web-chat path is
superseded by this runtime update.
