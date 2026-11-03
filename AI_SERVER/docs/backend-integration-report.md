# Báo cáo tích hợp Backend — 03/11/2026

## 1. Kết luận và mapping thực tế

**BLOCKED tích hợp live.** `BE/API_CONTRACT.md` không khớp mã Backend đang được
`AppModule` nạp. Không sửa BE để ép tương thích, không gọi endpoint chưa đăng ký.
READY dưới đây chỉ có nghĩa có route trong source, không phải đã kiểm thử live.

| Chức năng | Endpoint / method | Trạng thái | Bằng chứng và giới hạn |
|---|---|---|---|
| Device authorization | POST /internal/devices/authorize | MISSING trong runtime | `ownership.controller.ts` có controller, `ownership.service.ts` có kiểm tra; `devices.module.ts` chỉ đăng ký DevicesController, không đăng ký InternalDevicesController/OwnershipService |
| Kiểm tra credential thay thế | GET /devices/device/me | INCOMPATIBLE | Có route, Bearer device credential, trả `{device_id,device_uid}`; không trả ownerUserId, không thay thế được ownership authorization |
| AI resolve-config | POST /internal/ai/resolve-config | MISSING | `ai-providers.controller.ts`, service rỗng; `AiProvidersModule` rỗng |
| Profile | GET/PATCH /ai/profile | INCOMPATIBLE | JWT user, snake_case; không có resolve theo device/service identity, không trả secret |
| Quota admission/budget | POST /internal/ai/authorize-request | MISSING | QuotasController/QuotasService rỗng; QuotasModule rỗng |
| Usage actual | POST /internal/ai/usage | MISSING | Không có route/service chạy được; DTO và guard còn lại không tạo API |
| Xem quota | GET /quotas, GET /admin/quotas | INCOMPATIBLE | JWT user/admin; không phải admission atomic, không có token reservation/idempotency settlement |
| Device heartbeat | POST /devices/device/heartbeat | READY, chưa tích hợp | Bearer device credential; snake_case telemetry; không phải contract forwarding `/internal/devices/heartbeat` |
| Internal heartbeat | POST /internal/devices/heartbeat | MISSING | MonitoringController chỉ có GET admin dashboard/instances |
| Session database | Không có API tạo/kết thúc ai_sessions | MISSING | Không gửi UUID WebSocket vào BIGINT sessionId |
| Cloud secret delivery | Không có API phù hợp | MISSING | Không chuyển credentialReference thành API key |

Đã đọc contract, `.env.example`, AppModule, module/controller/guard/DTO/service liên quan,
main/global guards/filter và AI_SERVER/AGENTS.md. `.env.example` BE hiện chỉ có cấu hình
DB/JWT/encryption/CORS/bootstrap; không có bộ biến service contract được tài liệu nêu.

Contract lịch sử được client foundation mô hình hóa, **không xác nhận đã triển khai**:

- Auth: JSON `{deviceUid,credential}` → `{allowed:true,deviceId,ownerUserId}`.
  Guard yêu cầu Bearer AI_DEVICE_SERVICE_TOKEN base64url 43–128 ký tự và
  DEVICE_AUTH_CONTRACT_APPROVED=true. DTO chỉ nhận hai field. 400 INVALID_INPUT,
  401 SERVICE_UNAUTHORIZED/DEVICE_UNAUTHORIZED (sai, revoke, expiry), 403
  CONTRACT_NOT_APPROVED/DEVICE_ACCESS_DENIED, 409 AUTHORIZATION_RETRY,
  500 AUTHORIZATION_UNAVAILABLE. Service kiểm tra assignment và owner active/verified USER.
- Config: dự thảo `{userId,deviceId?}` → provider/model/profile/credentialScope/reference.
  Guard AI_CONFIG_SERVICE_TOKEN và AI_CONFIG_CONTRACT_APPROVED còn source nhưng chưa wiring.
- Admission: dự thảo `{requestId,userId,providerId,modelId,deviceId?,sessionId?,conversationId?,maxTotalTokens?}`.
  Response có executionAllowed/replayed/reservedTokens/remainingQuota/reportDueAt.
  Guard quota token tồn tại; chưa có service để xác minh các error/status runtime.
- Usage: dự thảo `{requestId,providerId,status,inputTokens,outputTokens,durationMs}`,
  status success/failed/cancelled; contract hứa idempotency body giống hệt.
  Các mã 429 QUOTA_EXCEEDED, 409 policy/context/conflict và timeout/replay trong tài liệu
  chỉ được kiểm thử fixture, chưa thể xác nhận bằng API thực tế.

## 2. Thay đổi đã làm và giới hạn

- Thêm mode `development-mock` / `integrated` bằng environment, mặc định development.
- Integrated yêu cầu ba service token riêng, timeout hữu hạn, connection/response bounds;
  factory sử dụng async httpx pool hiện có, HTTPS hoặc opt-in HTTP loopback.
- Integrated chặn `/ws/dev-robot` **trước accept và cấp codec/audio session** vì thiếu API.
  Không có cờ bypass sang mock. Không gọi các route nội bộ chưa được đăng ký.
- Giữ `/ws/dev-echo` local, pipeline mock STT → LLM → TTS, half-duplex và playback proof.
- Thêm ceiling 12 request/user/sliding 60 giây vào quota bridge **mock-only** hiện có.
  Reporter dùng chung sẽ chia sẻ cửa sổ giữa thiết bị cùng owner; khác owner độc lập.
  Đây là giới hạn phụ trong một process; production cần Backend atomic global admission.
  Không thay token/request/ngày/tháng hiện có, không tự thêm policy mặc định.
- Client hiện có zero retry: giới hạn retry=0; không retry admission/usage, không double-charge
  do tự động retry. Auth/quota HTTP error/schema sai/timeout đều chặn thực thi.
- Foundation bind owner/device từ Backend response, UUID session riêng, invalidate cleanup
  đã có test mock; chưa nối vào gateway live vì contract thiếu.
- Chưa triển khai live auth/config/quota/usage/heartbeat/session/Cloud. UsageReporter hiện
  là RAM, không durable outbox. Unknown usage khi cancel/error giữ pending, không bịa 0.
  Token reservation chưa có ceiling provider thực tế nên live vẫn chặn hoàn toàn.

## 3. File sửa/tạo

`app/core/backend_config.py`, `app/services/user_rate_limit.py`,
`app/services/backend_execution.py`, `app/main.py`, `app/api/robot_websocket.py`,
`tests/test_backend_integration_mode.py`, `tests/conftest.py`, `.env.example`,
`README.md`, `AGENTS.md`, báo cáo này và `docs/backend-integration-test-output.txt`.
Chỉ thay đổi AI_SERVER; không commit/push.

## 4. Lệnh Windows CMD

Từ repo root, mở terminal BE riêng. Các lệnh dưới đây là hướng dẫn, không có nghĩa đã chạy BE.
BE phải có `.env` và database được provision sẵn; không chạy migration tự động.

```bat
cd /d E:\learn\AI_Project\cap1\BE
npm ci
npm run build
npm run start:dev
```

Terminal AI Server:

```bat
cd /d E:\learn\AI_Project\cap1\AI_SERVER
py -m venv .venv-win
.venv-win\Scripts\python.exe -m pip install -r requirements-dev.txt
if not exist .env copy .env.example .env
set AI_SERVER_BACKEND_MODE=development-mock
.venv-win\Scripts\python.exe scripts\run_dev.py
```

Chọn integrated để xác minh fail closed (hiện sẽ từ chối robot audio):

```bat
set AI_SERVER_BACKEND_MODE=integrated
set AI_SERVER_BACKEND_URL=http://127.0.0.1:3000
set AI_SERVER_BACKEND_ALLOW_LOCAL_HTTP=true
set AI_SERVER_BACKEND_TIMEOUT_SECONDS=5
set AI_SERVER_BACKEND_DEVICE_TOKEN=REPLACE_WITH_DEVICE_SERVICE_TOKEN
set AI_SERVER_BACKEND_CONFIG_TOKEN=REPLACE_WITH_CONFIG_SERVICE_TOKEN
set AI_SERVER_BACKEND_QUOTA_TOKEN=REPLACE_WITH_QUOTA_SERVICE_TOKEN
.venv-win\Scripts\python.exe scripts\run_dev.py
```

Thay placeholder bằng ba token base64url độc lập 43–128 ký tự trong cấu hình local.
Không chia sẻ/log các token. Backend hiện chưa nhận các route này dù đã đặt token.

```bat
.venv-win\Scripts\python.exe -m pytest tests\test_backend_client.py tests\test_backend_integration_mode.py -q -p no:cacheprovider
.venv-win\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp=.pytest-integration-new --tb=short
```

Test codec cần libopus native phù hợp kiến trúc Python và có thể được
`ctypes.util.find_library("opus")` tìm thấy; pip requirements không cài thư viện native này.

## 5. Kiểm thử thực tế

- **PASS mock: 49 tests** Backend fixture + integrated mode + per-user sliding window.
  Có 200, 401/403/429/5xx, timeout/network/cancel, schema sai, identity mismatch,
  hai device/user, usage success/failed/cancelled, dedupe/report conflict, unknown usage,
  replay admission và mock pipeline/half-duplex/revocation cleanup. Đây không phải live.
- **PASS cài dependency**: pip requirements-dev sau khi cấp quyền network;
  lần đầu collection thiếu httpx2, đã giải quyết bằng requirements được pin.
- **FAIL regression: 364 PASS, 18 FAIL, không lỗi collection/setup ở lần cuối (18.57s)**.
  Chi tiết tại backend-integration-test-output.txt: 16 lỗi nhóm robot/codec trong
  môi trường thiếu libopus; 1 lỗi checksum snapshot lịch sử không khớp (không thay
  baseline để ép PASS); 1 lỗi real TCP robot `ValueError: Unsupported signal: 2`
  trên Windows. Lần chạy ban đầu còn lỗi quyền
  thư mục pytest temp mặc định; đổi --basetemp trong AI_SERVER đã bỏ các lỗi setup đó.
- **BLOCKED** live auth/credential expired/revoked/config/quota/token-budget/usage/session:
  không có các API runtime cần thiết, không dùng test mock để đánh dấu live PASS.
- **NOT RUN** Backend process/MySQL live, Cloud và hardware. Không sửa DB/BE/firmware.

## 6. Backend cần bổ sung/xác nhận

1. Đồng bộ API_CONTRACT với module wiring thực tế; đăng ký internal auth cùng các global
   guard/public metadata phù hợp, xác nhận owner binding và credential expiry/revoke.
2. Triển khai resolve-config và secret delivery bảo mật; xác nhận STT/TTS provider/model/voice
   và ngân sách. Credential reference không phải secret và không được suy diễn.
3. Triển khai admission atomic + usage idempotent như contract; xác nhận sliding 60 giây
   12/user trên toàn bộ robot/provider/process, token ceiling/request, daily/monthly policy.
4. Xác nhận reservation, usage thực tế khi cancel/fail, report deadline, durable outbox,
   replay/idempotency horizon và đối soát unknown usage trước live execution.
5. Cung cấp session DB create/close/reconnect mapping nếu bắt buộc; xác nhận heartbeat
   forwarding thay vì tự đổi sang route device trực tiếp.
