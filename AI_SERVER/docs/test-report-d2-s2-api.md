# D2-S2-API — AI Server ↔ Backend ↔ Xiaozhi

Ngày kiểm tra: 03/11/2026, macOS / Python 3.14.3. **Chỉ sửa AI_SERVER**.
BE, Firmware, FE, DB không thay đổi. Không bật gate, không push Git.

## 1. Nguồn và mức xác minh

Đã đối chiếu controller/DTO/guard/service với BE/API_CONTRACT.md cho Devices,
Monitoring, AI Profiles/Providers, Quotas và Device Recovery; đọc firmware
protocols, application.cc, ota.cc; kế thừa source AI_SERVER hiện tại.
Ưu tiên source hiện hành nếu tài liệu lịch sử khác tiến độ: ví dụ P7 quota đã
có code dù đoạn handoff P8 cũ còn nói chưa triển khai (handoff có note cập nhật).

Docs hiện có report Task 01/Sprint 1, 02/02B/03/04. Orchestrator Task 05 có source,
21 test và demo nhưng chưa có report Task 05 hoàn chỉnh; không tìm thấy report/
module Task 06 riêng để xác minh. Không tự coi Task 01–06 đều hoàn thành.

VERIFIED dưới đây là hợp đồng có trong source, **không phải approval/live PASS**.
Các gate được tài liệu mô tả default false; không đọc secret .env để suy gate
runtime hoặc tự đổi gate. Mock fixture không phải một phê duyệt liên dịch vụ.

## 2. Bảng API thực tế

Tất cả route nội bộ dưới đây là HTTP POST, response thành công 200, không có
prefix /api/v1 trong main.ts. ID DB là canonical positive BIGINT string tối đa
9223372036854775807. Không dùng UUID wire/internal làm DB sessionId.

| Route | Request thực tế | Response thành công | Auth / gate | Trạng thái |
|---|---|---|---|---|
| `/internal/devices/authorize` | `{deviceUid, credential}` | `{allowed:true,deviceId,ownerUserId}` | Bearer AI_DEVICE_SERVICE_TOKEN; DEVICE_AUTH_CONTRACT_APPROVED | VERIFIED code/client; BLOCKED live |
| `/internal/devices/heartbeat` | `{deviceUid,credential,observedAt,telemetry?}` | `{accepted,deviceId,lastSeenAt,reason?}` | Cùng Device guard/gate | VERIFIED code/client; BLOCKED nguồn firmware |
| `/internal/ai/resolve-config` | `{userId,deviceId?}` | `{userId,provider,model,profile,credentialScope,credentialReference}` | Bearer AI_CONFIG_SERVICE_TOKEN; AI_CONFIG_CONTRACT_APPROVED | VERIFIED code/client; Cloud secret BLOCKED |
| `/internal/ai/authorize-request` | `{requestId,userId,providerId,modelId,deviceId?,sessionId?,conversationId?,maxTotalTokens?}` | New permit hoặc durable replay state | Bearer AI_QUOTA_SERVICE_TOKEN; AI_QUOTA_CONTRACT_APPROVED + report timeout/schema ready | VERIFIED code/client; live BLOCKED |
| `/internal/ai/usage` | `{requestId,providerId,status,inputTokens,outputTokens,durationMs}` | `{requestId,status,recorded:true,replayed,budgetExceeded}` | Cùng QuotaSourceGuard; **không dùng admission gate để cấm settlement** | VERIFIED code/client; live/outbox BLOCKED |

Service tokens riêng từng nhóm, base64url 43–128 ký tự theo guard, không phải
Cloud key/JWT User/device credential. Backend đề nghị sinh random ít nhất 32 byte;
format validation không thể chứng minh entropy của secret do operator cấp.

### Chi tiết schema và lỗi

**Authorize:** credential random base64url cùng format, Backend so SHA256 UTF8
hex với active/unrevoked/unexpired row, recheck approved assignment/owner active
verified USER/lifecycle/unlink/reset. Unknown/invalid/expired/revoked đều generic
401 DEVICE_UNAUTHORIZED; không tự dựng mã EXPIRED/REVOKED riêng.

- 400 INVALID_INPUT; 401 SERVICE_UNAUTHORIZED hoặc DEVICE_UNAUTHORIZED;
  403 CONTRACT_NOT_APPROVED hoặc DEVICE_ACCESS_DENIED;
  409 AUTHORIZATION_RETRY; 500 AUTHORIZATION_UNAVAILABLE.

**Heartbeat:** observedAt là UTC whole-second `...:ssZ` hoặc `...:ss.000Z`, dùng
server receipt time trực tiếp. Telemetry chỉ nhận wifiRssi -127..0, batteryPercent
0..100, freeHeapBytes safe integer hoặc BIGINT decimal string không âm. Payload
chỉ uptimeSeconds safe integer không âm, firmwareVersion 1–100 ký tự/no controls.
Không tự chuyển Ping/Pong thành heartbeat hoặc tự thêm eventId/connectionStatus.
Ignored response có accepted=false, reason=STALE_OR_DUPLICATE; lastSeenAt có thể
null. Accepted=true cần lastSeenAt. Client kiểm tra deviceId khớp session đã auth.

- 400 invalid input; 401 service/credential; 403 gate/access; 404 unknown UID;
  409 HEARTBEAT_FROM_FUTURE/lifecycle/conflict; 500 MONITORING_UNAVAILABLE.

**Resolve-config:** provider `{id,code,name}`; model `{id,modelCode,capability:"llm"}`;
profile có assistantName/systemPrompt/preferredProviderId/preferredLlmModelId/
languageCode/voiceCode (nullable theo service). CLOUD trả scope USER/SYSTEM và
reference `{id,providerId}`; LOCAL scope NONE/reference null. Không có plaintext
key, ciphertext hoặc secret-fetch endpoint. Model/prompt trong wrapper phải khớp
config đã resolve, không dùng default model/prompt nếu response khác hoặc thiếu.

- 401 SERVICE_UNAUTHORIZED; 403 CONTRACT_NOT_APPROVED/PROVIDER_UNAVAILABLE/access;
  409 PROFILE_NOT_CONFIGURED/MODEL_REQUIRED/MODEL_UNAVAILABLE/CREDENTIAL_REQUIRED/
  CREDENTIAL_UNAVAILABLE/SYSTEM_SCOPE_NOT_ALLOWED/config conflict; 400 bad input,
  404 Provider absent, 500 AI_CONFIGURATION_UNAVAILABLE (tùy nhánh service).

**Quota:** requestId ASCII 16–128 chữ/số/_/-, global/case-sensitive; các context ID
là BIGINT string, optional null/omitted. maxTotalTokens nonnegative BIGINT string,
không phải chỉ max_output_tokens. Live budget enforcement/token preflight chưa có.
New response gồm allowed=true, requestId/providerId/mode/remainingQuota/
reservedTokens/reportDueAt/replayed=false/executionAllowed=true. remainingQuota
gồm requestsPerMinute/requestsPerDay/tokensPerMonth là decimal strings hoặc null.
Replay trả allowed=false, replayed=true, executionAllowed=false, state/reason.
Client **không execute lại** khi nhận replay 200.

- 400 TOKEN_RESERVATION_REQUIRED/bad input; 401 service; 403 gate/policy/access;
  429 QUOTA_EXCEEDED; 409 REQUEST_CONTEXT_CONFLICT/QUOTA_SCHEMA_NOT_READY/
  USAGE_REPORT_TIMEOUT_NOT_CONFIGURED/policy/context errors; 404 absent context;
  500 QUOTA_UNAVAILABLE. report timeout config không có default trong service.

**Usage:** status success/failed/cancelled, Backend chấp nhận không phân biệt hoa
thường; client gửi lowercase canonical. Actual counts/duration integer 0..2147483647.
Response status uppercase SUCCESS/FAILED/CANCELLED. Không gửi ước tính hoặc tự
thay unknown thành zero. Cùng report giống hệt được Backend idempotent/replayed;
payload đã finalize khác ->409 USAGE_REPORT_CONFLICT, sai provider/context ->409
USAGE_CONTEXT_CONFLICT, unknown request ->404, DB ->500. Không charge hai lần.

Client giữ enum lỗi network/timeout/cancel/invalid-response/HTTP-denied và status;
chỉ giữ reason có trong allowlist source, không đưa raw message/body vào exception.

### Conversation / revoke / reset

- BE module conversations còn rỗng, không có API tạo ai_session/conversation để
  client tự dùng; không invent endpoint. Quota request bỏ sessionId/conversationId
  khi chưa có persisted IDs, vẫn bind userId/deviceId từ authorization.
- `POST /admin/devices/:id/revoke`: Admin JWT/RBAC, Idempotency-Key 16–128,
  body reason optional; HTTP 202 operation/resetPending. Đây không phải service
  endpoint để client Device token tự gọi.
- `GET /admin/devices/:id/recovery`, `GET /admin/devices/:id/reset-status`,
  `POST /admin/device-recovery/:backupId/restore`: Admin identity riêng.
- `POST /internal/device-reset-jobs/claim`: body deviceId, Bearer
  DEVICE_RESET_SERVICE_TOKEN và RESET_CONTRACT_APPROVED, retry lease config.
  Trả claimed=true + jobId/deviceId/operationId/status SENT/attempt/challenge/
  actions, hoặc claimed=false + metadata/retryAfterSeconds. Claim có side effects.
- `POST /internal/device-reset-jobs/:jobId/ack`: deviceId/attempt/challenge/result;
  success cần sessionsInvalidated=true VÀ firmwareResetConfirmed=true; failed chỉ
  failureCode whitelist. 200 jobId/deviceId/status/acknowledgedAt. 401 service,
  403 reset gate/proof, 409 stale ACK/state/conflict, 400 input, 404/500 phù hợp.

Reset routes VERIFIED nhưng **không triển khai dispatch/ACK client trong task này**:
chưa có factory management proof/kênh firmware sống sau credential revoke hoặc
bằng chứng reset thật. Không claim job để treo lease hoặc gửi ACK giả.

## 3. Đã kết nối / chưa kết nối

Đã kết nối trong test: BackendFixture → BackendClient authorize → trusted session
→ resolve-config → quota admission → Orchestrator mock STT/LLM/TTS → usage thực
tế của mock. Heartbeat auth denial khi đang SPEAKING làm invalidate session,
cancel pipeline/clear queue và chặn start/mic sau revoke. Có TCP loopback thật
để xác minh HTTP request/connection reuse/cleanup (server giả, không Nest/MySQL).

Chưa nối runtime app, robot endpoint, real Backend/gates, Cloud secret, telemetry
firmware, reset/revoke event delivery và physical audio output. Không có full
Firmware → Backend → Cloud → robot E2E PASS. HTTP client không biến mock proof
hoặc credential reference thành quyền Cloud/robot.

## 4. Files và luồng

| File tạo/sửa trong D2-S2-API | Trách nhiệm |
|---|---|
| app/models/backend.py | DTO/schema response strict, BIGINT/time/telemetry validation |
| app/clients/backend.py | Async HTTPX pool, bounds, service auth, errors, 5 route methods |
| app/services/device_auth.py | Authorize/bind config/session facade/heartbeat/invalidate |
| app/services/backend_execution.py | Mock-only quota LLM wrapper, bounded UsageReporter |
| tests/test_backend_client.py | 45 cases, HTTP mocks/TCP reuse/Orchestrator integration |
| requirements.txt | Promote httpx==0.28.1 thành runtime dependency (đã có ở dev) |
| README.md, AGENTS.md | Usage, flow map và trạng thái pending |
| docs/test-report-d2-s2-api.md | Báo cáo này |

Client không tự đọc environment/DB/token hoặc tự startup; caller inject base
origin, ServiceTokens và ClientLimits bắt buộc. HTTPS mặc định verify cert;
HTTP chỉ localhost/loopback khi explicit opt-in. trust_env=false, redirects=false,
zero automatic retries; max connection/response bytes và total timeout gồm cả
slot wait/response stream. Async context manager/aclose dọn pool.

Response reject unknown fields, malformed JSON/content type, duplicate JSON keys,
oversize hoặc identity/status/request binding sai. Credentials là SecretStr/repr
ẩn; JSON gửi credential thật chỉ trong request body TLS, không log body/header.

```text
Firmware headers (chưa có approved mapping/provisioning)
   -- BLOCKED --> robot gateway (chưa có approved path/auth contract)

Explicit provisioned proof trong test
 -> POST authorize -> Backend deviceId/ownerUserId -> internal UUID session key
 -> POST resolve-config -> profile/model/credentialReference (KHÔNG phải API key)
 -> session.bind(Orchestrator) -> session.start_turn()/microphone()
 -> STT final -> quota admission -> MockLLM -> MockTTS -> MockAudioOutput
 -> usage có actual counts -> POST usage; unknown counts -> pending reconciliation
```

Session key mint nội bộ, không từ MAC/Client-Id/wire session_id. Heartbeat chỉ
được caller gọi khi có trực tiếp event robot theo contract được duyệt, không có
timer/schema firmware được tự tạo. Backend recheck lỗi thì session fail closed.

Quota wrapper chỉ nhận MockLLMAdapter và mock_only=True, để không vô tình dùng
live OpenAI qua secret chưa được cấp. Caller phải dùng đúng backend model/prompt;
mock E2E lấy language/voice từ profile nhưng TTS model/format vẫn là fixture.
Không fallback User/System key, Provider hoặc model khi config/quota lỗi.

UsageReporter giữ attempt/report task có giới hạn trong RAM, coalesce identical
reports; conflict reject. HTTP timeout/cancel giữ ambiguous state, không tự resend
hoặc execute lại. Unknown usage (kể cả cancel trước terminal usage) giữ pending,
không report zero. Reserve có thể còn ambiguous khi admission lỗi mạng; cần đối
soát trạng thái ledger. Đây **chưa phải durable outbox/production accounting**.
Known usage sau cancel dùng context settlement riêng, không reuse context đã hủy.

## 5. Runbook macOS và cấu hình an toàn

Từ root repo, cài AI_SERVER (không chạy npm/install/build trong BE):

```bash
cd AI_SERVER
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pip check
.venv/bin/python -m pytest tests/test_backend_client.py -q --tb=short
.venv/bin/python -m pytest tests -q --tb=short
.venv/bin/python scripts/run_dev.py
```

Terminal khác từ AI_SERVER:

```bash
curl -i http://127.0.0.1:8000/health
.venv/bin/python scripts/ws_client.py --message 'Xin chào AIVA'
```

Server giữ endpoint cũ, không tự gọi client/live API. Không cần service tokens
thật để chạy tests. Test tạo secret placeholder chỉ trong RAM và transport giả.

Backend thật chỉ operator chạy sau khi đã có môi trường/DB được duyệt, từ BE:

```bash
npm run start:dev
```

Lệnh này **NOT RUN trong task**, có thể tạo dist/build artifacts ở BE nên không
được assistant thực thi trong scope chỉ sửa AI_SERVER. Port mặc định source là
3000, có thể override bằng PORT. Không sửa .env/gates; gate chưa duyệt vẫn phải
trả deny. Không dùng Backend live production để seed credential hoặc test heartbeat/
quota side effects. Không chạy DB migration/check DML trong task.

Khi contract được duyệt, operator cấp 3 service tokens riêng qua secret manager
đã có; caller đọc chúng thành SecretStr rồi truyền ServiceTokens. Không đặt literal
trong code, curl -H command line, log hoặc report. Client không tự cấp secret.
Base origin HTTPS và HTTP/time/resource budgets cần deployment duyệt trước live.

## 6. Cách kiểm tra từng mức

**Mock HTTP/DTO (không socket):**

```bash
.venv/bin/python -m pytest tests/test_backend_client.py -k 'not real_tcp' -q
```

Auth expired/revoked là fixture HTTP 401 generic, không phải đã thực thi kiểm tra
expiry/revoke bằng MySQL thật. Config disabled/foreign user/reference sai sẽ deny,
không có secret lookup hay Provider fallback.

**Local TCP thật, server giả:**

```bash
.venv/bin/python -m pytest tests/test_backend_client.py::test_real_tcp_connection_reuse_and_cleanup -q
```

Hai authorize POST dùng một TCP connection, sau context manager pool đóng.
Không tương đương Nest controller/guard/database integration.

**Mock Backend gắn Orchestrator và revoke:**

```bash
.venv/bin/python -m pytest tests/test_backend_client.py::test_backend_to_orchestrator_mock_e2e_and_revocation -q
.venv/bin/python -m pytest tests/test_orchestrator.py tests/test_tts.py tests/test_websocket.py -q
```

**Kết nối thật sau này:** cần duyệt provisioning + UID mapping, TLS/service auth,
gates, isolated fixtures/model/quota schema và secret broker; dùng authorize_device
rồi session.resolve/bind/start_turn, không trực tiếp tin firmware identity. Robot
path/auth/codec/playback ACK cần Dev 3 xác nhận trước khi thêm gateway. Không có
live robot/Cloud probe hoặc route tự tạo trong task này.

## 7. Test thực tế và giới hạn nghiệm thu

Venv thực thi: `/private/tmp/aiva-stt-task02-venv`. Tất cả pytest từ AI_SERVER.
Socket tests chạy ngoài sandbox với loopback permission. Không gọi Backend live,
MySQL, Cloud hoặc robot. Không sửa/skip firmware snapshot test.

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `python -m pytest tests/test_backend_client.py -q --tb=short` | PASS: 45 passed |
| CLI echo test riêng + Backend tests | PASS: 46 passed |
| `python -m pytest tests -q --tb=short`, lần cuối | FAIL: 344 passed, 1 failed |
| `python -m pip check` | PASS: No broken requirements found |
| `git diff --check` | PASS |
| Real Backend/Nest/MySQL integration | NOT RUN/BLOCKED bởi approval và fixtures |
| Robot hello/Opus fixture transport qua gateway | BLOCKED: chưa có approved gateway/profile; framing unit cũ vẫn chạy |
| Live Cloud / robot playback | BLOCKED/NOT RUN; không dùng mock làm bằng chứng |
| Reset delivery/ACK | BLOCKED/NOT RUN; không có management proof/physical reset |

Một full run trước đó có 344 passed, 1 snapshot FAIL và 1 teardown ERROR ở
test_cli_real_exchange_and_server_rejection: server process bị fixture kill -9
sau timeout shutdown. Không sửa test/echo để che; chạy lại riêng đạt 46 passed,
full suite sau đó đạt 344 passed/1 snapshot FAIL, không còn teardown error.

FAIL còn lại là FileNotFoundError của
test_firmware_snapshot_hashes_match_workspace_sources với file
xiaozhi-esp32/managed_components/78__esp-ml307/idf_component.yml thiếu sẵn.
Không tuyên bố toàn suite PASS. Các test echo, half-duplex, late audio/proof,
framing và isolation nền đã được chạy trong full suite.

Case mới: auth allow/deny/gate/expiry-revoke fixture; wrong identity/schema;
network/timeout/cancel; oversized/malformed/duplicate JSON/redirect; distinct
service tokens; telemetry bounds/receipt timestamp; two auth sessions; quota
deny/replay; live blocker; known usage success/failed/cancelled, report coalesce/
conflict; unknown usage pending; connection reuse; Orchestrator revoke cleanup.

## 8. Quyết định còn thiếu và bước tiếp theo

1. Dev 3/Backend duyệt MAC → deviceUid, secure provisioning/rotation/expiry proof
   và mapping token Settings firmware. Activation challenge HMAC không chứng minh
   credential SHA256 scheme Backend đang đề xuất. Không bật gate để thay approval.
2. Chốt robot WebSocket path/auth/hello/version/listen modes và audio profile.
   Firmware source có hello/control/Opus v1/v2/v3 nhưng build thực tế chưa được
   xác nhận; AI_SERVER hiện vẫn chỉ WS local echo. Không invent robot path.
3. Chốt secret delivery scope USER/SYSTEM, model catalog/voice/TTS Provider, codec
   conversion/STT/VAD; reference-only config chưa cho phép Cloud execution.
4. Duyệt input+output token ceiling, quota schema/deadline và durable reporting
   outbox/reconciliation. Unknown usage không thể settle chính xác bằng DTO hiện
   tại cho tới khi có actuals; không fake zero hoặc tự refund/drop ledger.
5. Xác nhận telemetry source và revocation delivery/kênh quản trị reset, physical
   reset/stop/drain/playback-complete proof. Internal on_playback_drained và tts.stop
   không phải network ACK. Session invalidate local chưa tự chứng minh loa đã dừng.
6. Tách local mock acceptance với Backend/DB integration và robot E2E; chạy thật
   chỉ khi có environment/credential/contract được duyệt. Client foundation đã
   test; toàn bộ hệ thống chưa đủ điều kiện nghiệm thu production.
