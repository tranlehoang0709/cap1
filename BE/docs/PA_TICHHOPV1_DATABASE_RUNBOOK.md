# Runbook PA Calendar và PA08 multi turn

Ngày kiểm chứng: 20/11/2026. Nhánh: `tichhopv1`. Commit nền trước các thay đổi:
`03e16054eb46acc3775f4ac2623dbc970f817483`.

Tài liệu này thay thế báo cáo ban đầu có 577 PASS và bốn lỗi live-chat.
Source được bàn giao gồm sửa tương thích PA/Calendar, JWT delegation, hợp đồng
Gemini hiện hành và hội thoại PA08 nhiều lượt đồng bộ Backend, Frontend, AI_SERVER.
Kết quả dưới đây không chứng nhận model AI hoặc thiết bị thật.

## PA và Calendar

SQL đầu tiên của sweeper gốc là:

```sql
SELECT DISTINCT user_id FROM personal_tasks
WHERE deleted_at IS NULL AND due_at IS NOT NULL;
```

`deleted_at` thuộc `personal_tasks`; câu này không JOIN hoặc dùng alias.
Các bước tiếp theo còn dùng `personal_plans.deleted_at`. Không có bằng chứng
alias sai. Database đã kiểm tra có sẵn hai cột này; 63/63 SQL PA của source nền
prepare thành công. Đã tái hiện thiếu cột trong schema test riêng và kiểm tra
migration bổ sung giữ nguyên bản ghi. Chưa xác minh nguyên nhân trên máy khác.

Sweeper hiện bổ sung owner có reminder PA-22/PA-15 đang pending vào danh sách
quét để hủy alert cũ khi task cuối cùng đã soft delete. Không thay ngưỡng alert,
lịch quét, điều kiện PA-15 hoặc tắt sweeper để che lỗi.

Calendar dùng bảng PA chung nhưng migration standalone cũ không bổ sung những
cột repository yêu cầu. Đã sửa SQL dùng `message`, `channel`, `error_message`
thay vì `title`, `delivery_channel`, `last_error`; giữ alias API khi cần.
RRULE vẫn là chuỗi ở API, được JSON encode khi ghi vào cột JSON hiện hữu.
Khóa tương đương reminder được lưu bằng SHA-256, tránh cắt chuỗi Unicode dài.
Các phép đọc/join/conflict bỏ qua event đã soft delete.

Migration Calendar bổ sung chính xác:

| Bảng | Cột | Kiểu và mặc định |
| --- | --- | --- |
| personal_events | timezone | VARCHAR(64) NOT NULL DEFAULT 'UTC' |
| personal_events | deleted_at | DATETIME NULL DEFAULT NULL |
| personal_reminders | timezone | VARCHAR(64) NOT NULL DEFAULT 'UTC' |
| reminder_deliveries | attempt_count | INT NOT NULL DEFAULT 0 |
| reminder_deliveries | next_retry_at | DATETIME NULL DEFAULT NULL |
| reminder_deliveries | idempotency_key | CHAR(64) ASCII ascii_bin NULL DEFAULT NULL |

Index mới: `uq_pa_delivery_idempotency(idempotency_key)` unique và
`idx_pa_delivery_due(status,next_retry_at)`, đều ở `reminder_deliveries`.
Không thêm cột legacy hoặc đổi kiểu JSON đã có.

Đã kiểm tra sáu bảng personal_tasks, personal_plans, personal_events,
personal_reminders, reminder_deliveries, personal_memories và bảng liên quan.
Không bổ sung deleted_at vào reminder/delivery/memory khi không có thiết kế yêu cầu.

## Hợp đồng PA08 và quản lý session

Trước sửa, Backend bỏ qua conversation_id và sinh web_UUID mỗi request.
AI_SERVER lưu context theo user/session nên không tiếp tục được hội thoại.

| Ranh giới | Hợp đồng hiện tại |
| --- | --- |
| Frontend -> POST /web-chat/messages | content; conversation_id và request_id tùy chọn |
| Backend response | content, tool, grounded, conversation_id |
| Backend -> /internal/pa08-chat | user_id, session_id, content, timezone, delegation, stream=false, personalize=false; history tùy chọn |
| Xác thực nội bộ | X-AI-Tool-Service và signed delegation; không nhận session tùy ý từ client |

Một conversation WEB đang active, thuộc owner và chưa xóa ánh xạ đến một
ai_sessions đã lưu. Backend dùng lại `web_<ai_sessions.id>` qua các lượt.
Conversation không tồn tại, khác owner hoặc thuộc robot nhận 404; đóng nhận 409.
New Chat tạo conversation/session độc lập. Không tự gán thời hạn nghiệp vụ mới
cho conversation; TTL ở đây là cache AI_SERVER, không phải xóa hội thoại.

History chỉ gồm cặp user/assistant hoàn chỉnh: tối đa 20 message và 16000 ký tự.
AI_SERVER sử dụng lịch sử trong cả understanding và generation. Snapshot thay
thế cache, không append trùng; khôi phục được sau TTL/restart nếu save_history=1.
Không cho client thường nạp history qua /local/chat; không nhận role system/tool.
Nếu không đồng ý lưu lịch sử, Backend không lưu message/response và chỉ còn
context RAM. Sau restart không thể phục hồi hội thoại đó. Mô hình nhiều worker
với context RAM riêng khi tắt lưu lịch sử chưa được chứng nhận.

`pa08_web_turns` là bảng mới cho idempotency, có khóa chính (user_id,request_id),
index conversation_id và FK đến users/conversations. Nó lưu hash input, trạng
thái và response chỉ khi được phép lưu lịch sử. Frontend giữ request_id và input
đã chuẩn bị khi retry; sau thành công hoặc New Chat tạo mã mới.

Retry đã complete được replay mà không gọi AI/ghi message lần nữa. Cùng ID khác
input nhận 409. Request đồng thời trong cùng conversation nhận 409. Sau crash
hoặc outcome chưa xác định, không tự thực thi lại; trả 409 để tránh lặp thao tác.
Nếu response không được phép lưu, replay nhận 409. Client cũ thiếu request_id
vẫn dùng được nhưng không có bảo đảm dedupe cho request mới gửi lại sau mất kết nối.

JWT delegation đã bỏ aud trùng trong payload; audience vẫn được ký qua signing
options, scope/session/expiry vẫn kiểm tra. Gemini dùng SYSTEM/ENV_SYSTEM với
credentialReference=null và không trả credential MySQL. OpenAI vẫn yêu cầu
credential Backend. Không đổi provider hoặc bổ sung cơ chế quota Local mới;
quota denial, ownership và authentication được kiểm thử hồi quy.

## Migration và thứ tự triển khai

Các runner dry-run mặc định, chỉ apply khi có --apply và --database khớp cấu hình
Backend thực tế. Không chạy baseline/fresh-install SQL trên database có dữ liệu.
Backup và rehearsal trên bản sao test trước khi review áp dụng vào môi trường đích.
MySQL DDL auto-commit; không coi rollback transaction là rollback DDL.

Từ thư mục BE, sau khi cài dependencies và build:

```powershell
npm.cmd run build
npm.cmd run migration:pa -- --database <database-name>
node scripts/migrate-pa08-context.cjs --database <database-name>
```

Chỉ sau khi xác nhận endpoint, backup, prerequisite và kế hoạch DDL:

```powershell
npm.cmd run migration:pa -- --database <database-name> --apply
node scripts/migrate-pa08-context.cjs --database <database-name> --apply
```

Thay `<database-name>` bằng tên thật; không giữ nguyên dấu ngoặc khi chạy.

- `20261120_pa_soft_delete.cjs`: thêm deleted_at nullable vào task/plan nếu thiếu;
  từ chối definition không tương thích, không tự chuyển đổi dữ liệu.
- `20261120_pa_calendar_compat.cjs`: sáu cột/hai index trên canonical PA schema;
  kiểm tra prerequisite, definition và duplicate key trước DDL.
- `20261120_pa08_web_context.cjs`: thêm bảng pa08_web_turns; chạy lại kiểm tra
  cột, primary/index và FK; không sửa dữ liệu hội thoại đã có.
- `migration:calendar` dùng chung runner PA; không tạo bảng standalone dư thừa.

Schema legacy 37 bảng dùng title/delivery_channel khác canonical schema sẽ bị
runner từ chối. Cần DDL thật để thiết kế chuyển đổi riêng, không apply draft hàng loạt.

Triển khai AI_SERVER hỗ trợ history trước Backend mới, rồi Frontend. Backend mới
cần bảng pa08_web_turns trước khi phục vụ chat. Các client cũ không gửi history
vẫn được AI_SERVER chấp nhận. Không cần thay firmware cho bản sửa web chat này.

## Cấu hình cần chuẩn bị

- Backend: cấu hình MySQL theo BE/.env.example; tài khoản có quyền phù hợp,
  JWT secret và AI_TOOL_SERVICE_TOKEN do người vận hành cấp. Không dùng giá trị mẫu.
- AI_SERVER: Python venv và requirements-windows.txt cho Windows; .env.local theo
  mẫu, cập nhật các đường dẫn tài nguyên cho máy đích. Không commit file môi trường.
- AI_SERVER_BACKEND_TOOL_SERVICE_TOKEN phải khớp AI_TOOL_SERVICE_TOKEN của Backend.
  Backend đọc AI_SERVER_LOCAL_URL, mặc định http://127.0.0.1:8002.
- Llama cần executable/model GGUF hợp lệ và LOCAL_LLM_API_KEY; run.bat hỗ trợ
  AIVA_LLAMA_SERVER và AIVA_GGUF_MODEL. Không có model/key nào được đưa vào commit.
- Frontend: npm ci theo lockfile, cấu hình Backend origin và session secrets theo
  tài liệu/mẫu của Frontend. Cổng launcher: Backend 3000, Frontend 3100, Llama 8001,
  AI_SERVER Local 8002, Gateway 8081. Xác minh cấu hình Gateway riêng trước thiết bị.
- Gemini thật cần GEMINI_API_KEY tại AI_SERVER và các contract/config/quota gates
  hiện hành. Test MySQL Gemini dưới đây không dùng key cloud hoặc gọi Gemini thật.

run.bat kiểm tra AI_SERVER/.env.local trước khi start. Trong môi trường kiểm chứng,
file này và Backend tool service token chưa được cấu hình: health/login Backend
và Frontend trả 200 trên database test, nhưng chat runtime còn BLOCKED.
Không coi cửa sổ CMD hoặc health 200 là bằng chứng hội thoại AI thật hoạt động.

## Kết quả kiểm thử mới nhất

| Kiểm tra | Kết quả |
| --- | --- |
| Backend type check / build | PASS |
| Default Backend suite có MySQL test riêng | 37 suite PASS, 2 skipped; 601 PASS, 0 FAIL, 15 SKIP |
| PA08 MySQL -> HTTP AI_SERVER -> recording LLM | 10/10 PASS, nằm trong default suite |
| live-chat | 21/21 PASS, nằm trong default suite |
| PA CRUD / sweep / Calendar MySQL | 12/12, 1/1, 2/2 PASS, nằm trong default suite |
| Migration guard | 3/3 PASS, nằm trong default suite |
| Gemini MySQL integration riêng | 9/9 PASS; synthetic actuals, không gọi cloud |
| Backend E2E | 5/5 PASS theo fixture của suite |
| AI_SERVER local chat/dialogue/understanding/personalization | 99/99 PASS |
| Frontend type check / tests | PASS / 67/67 PASS |
| PREPARE PA baseline / PA hiện tại / Calendar | 63/63, 63/63, 15/15 PASS |
| Git diff whitespace check | PASS |

PA08 kiểm tra ba lượt nhận 0, 2, 4 message lịch sử và giữ một session; khác owner,
New Chat, conversation thiếu/đóng/xóa/robot, replay sau tạo lại repository,
request đồng thời, cache hết TTL, restart tiến trình fixture, giới hạn history,
tắt lưu lịch sử và outcome không xác định. Fixture dùng route/session store thật
và LLM giả ghi nhận input; không chứng minh chất lượng trả lời của model thật.

15 SKIP gồm 13 OTP MySQL opt-in, một legacy PA 37-table và một bridge Python đòi
.venv-win. Các cấu hình integration riêng khác không mặc nhiên được bao phủ bởi
default Jest; chỉ chứng nhận suite riêng được liệt kê ở trên.

Để lặp lại default suite an toàn: chuẩn bị MySQL local dành cho test và Python
AI_SERVER/.venv/Scripts/python.exe, sau đó từ BE chạy:

```powershell
node scripts/run-pa-isolated.cjs
```

Runner tạo schema test tên ngẫu nhiên, không copy dữ liệu người dùng, không DROP.
Cần quyền CREATE DATABASE trên máy test. Không dùng database production làm test.
Các test Calendar/sweep dùng outer transaction/SAVEPOINT và kiểm tra rollback.
Gemini integration cần opt-in và connection file ignored cho schema test riêng;
không chạy với connection production. Kết quả/log/connection/backup nằm local,
không được đưa vào source commit.

## Bảo toàn dữ liệu và giới hạn bàn giao

Trong đợt PA/Calendar ban đầu đã thêm sáu cột/hai index sau rehearsal test. So sánh
các cột gốc ở 38 bảng với snapshot cho kết quả không đổi. Các đợt PA08 chỉ ghi vào
schema test; migration PA08 đã apply và rerun thành công ở database runtime test.
Database chính aiva_iot chưa nhận bảng pa08_web_turns; chỉ xem kế hoạch, không apply.

Không DROP/TRUNCATE/reset dữ liệu hoặc tự merge/rebase. Nếu cần khôi phục, giữ
extension additive và backup; review từng thay đổi source, không xóa cột để rollback.

Chưa chứng nhận AI model thật, Llama, Gateway, thiết bị, voice, stress nhiều worker,
production scheduler hoặc máy khác. Chưa có kiểm thử trình duyệt end-to-end với
model thật. Nhóm có AI_SERVER và thiết bị cần chạy nghiệm thu tiếp trước khi triển khai.
