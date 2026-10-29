# Kiểm thử trình duyệt AIVA-IoT

## Hồ sơ camera tường minh (.41 và .86)

Camera tests yêu cầu `AIVA_CAMERA_PROFILE=chrome-155.0.8059.41` hoặc
`chrome-155.0.8059.86`; không fallback giữa profile. `.41` giữ nguyên model/SHA lịch sử.
`.86` còn yêu cầu `AIVA_CAMERA_MODEL` và `AIVA_CAMERA_MODEL_SHA256` khi validation/acceptance.
Train chỉ dùng fingerprint .86 đã định nghĩa, không có model ngưỡng chưa thu mẫu.

Quy trình riêng: chọn run ID mới cho từng tập; thu 12 train bằng
`AIVA_CAMERA_COLLECTION=train` và grep `@camera_collect_calibration`; gọi
`freezeCameraCalibration()` trong đúng run train; kiểm tra U<L cho cả hai theme và
lưu SHA trước khi thu 8 validation bằng `AIVA_CAMERA_COLLECTION=validation` cùng model/SHA đã khóa.
Không thay ngưỡng bằng dữ liệu validation. Candidate chỉ mang trạng thái pending user acceptance.
Sau khi validation đạt, bỏ `AIVA_CAMERA_COLLECTION` và chạy hai ca `@camera$|@lifecycle`,
rồi full regression với cùng profile/model/SHA. Snapshot vẫn không tự được phê duyệt.
Không sửa runtime giữa train, freeze, validation và acceptance; checksums sẽ chặn thay đổi.

Gate .86 kiểm tra Chrome/GPU/ANGLE-D3D11/OS, viewport/DPR, Three.js180 và canvas card305x142.
Metadata còn thiếu của `.41` không được bổ sung hồi tố. Model mới ghi fingerprint và
checksum runtime/test; mọi PNG/JSON/metrics phải nằm trong run artifacts mới bên ngoài source.
Chạy thêm `node --test helpers/ho_so_camera.test.js` để kiểm tra registry.

## Hiện trạng sau refactor

Baseline Giai đoạn 7 đã nghiệm thu chức năng: 41 PASS, 0 FAIL/NOT RUN; Fix A/B/C và
robot lifecycle/camera đã qua regression. Đây là kết quả baseline lịch sử, không phải
lần chạy mới của Giai đoạn 8 (chỉ sửa Markdown). Các phần kết quả lỗi bên dưới được
giữ để tra cứu lịch sử chẩn đoán, không phải trạng thái hiện tại. Screenshot chưa tự
được duyệt làm ảnh chuẩn. Xem [hướng dẫn cấu trúc](../../HUONG_DAN_CAU_TRUC.md).

## Camera continuity sau Fix A

Ca nghiệm thu `@camera` chạy mặc định cùng regression, gồm positive, focus,
theme, xoay một bước, zoom một bước, drag 2px và Reset. Ca `@lifecycle` vẫn
giữ mọi assertion iframe/document/canvas/diagnostics, timeOrigin và renderer.
SHA-256 chỉ kiểm tra tính toàn vẹn PNG/mô hình, không quyết định continuity.

Mô hình được đọc từ `E:/captone_backup/browser_runs/2026-10-14T10-51-23-245Z/analysis/calibration-model.json`,
SHA-256 `e55ed65af650bf84771fff821b5aa5970690bc710bf60c98b4799137eecf39b7`.
Không làm tròn hoặc hiệu chỉnh lại ngưỡng trong test. Metric là median của
`1 - Edge IoU` tại 16/32/64. Miền giữa hai ngưỡng, ảnh không hợp lệ hoặc profile
khác được báo INCONCLUSIVE và làm test không đạt nghiệm thu; không skip.
Profile đã kiểm chứng: Chrome 155.0.8059.41, 1440x1080, DPR 1, robot pause,
focus đặt vào nút Reset bằng focus(), so cùng theme. Không suy rộng cho GPU,
viewport/DPR khác hoặc thay đổi nhỏ hơn các đối chứng. Metadata mới lưu renderer
WebGL; dữ liệu hiệu chuẩn cũ không có fingerprint GPU để xác nhận độc lập driver.
Gate GPU hiện giới hạn vào ANGLE/Intel Iris Xe/D3D11 vừa chạy đối chứng nghiệm thu;
renderer khác hoặc không đọc được fingerprint trả INCONCLUSIVE. Đây là giới hạn
phạm vi quan sát hiện tại, không phải bổ sung dữ liệu lịch sử vào model đã khóa.
Hai góc nhìn đã hiệu chuẩn, không phải mọi camera pose, được dùng khi nghiệm thu.

Các ca thu mẫu và chẩn đoán cũ vẫn tồn tại nhưng chỉ bật riêng, không tự hiệu
chuẩn lại trong full regression:

```powershell
node helpers/chay_kiem_thu.js --grep '@camera$'
node helpers/chay_kiem_thu.js --grep '@lifecycle'
# Chỉ chạy lại thu mẫu khi được phê duyệt riêng:
$env:AIVA_CAMERA_COLLECTION = 'train' # hoặc validation với model/hash đã khóa
node helpers/chay_kiem_thu.js --grep '@camera_collect_'
Remove-Item Env:AIVA_CAMERA_COLLECTION
# Chẩn đoán hash lịch sử, không phải tiêu chí nghiệm thu camera mới:
$env:AIVA_CAMERA_DIAGNOSTIC = '1'
node helpers/chay_kiem_thu.js --grep '@camera_diagnostic'
Remove-Item Env:AIVA_CAMERA_DIAGNOSTIC
```

Ảnh vẫn là ứng viên, không được tự duyệt thành screenshot baseline. Nếu GPU hoặc
rendering profile thay đổi cần đánh giá/hiệu chuẩn bổ sung, không dùng ngưỡng này
như bảo đảm tổng quát. Rollback chỉ hai file test/helper và tài liệu từ checkpoint,
sau khi kiểm tra không có sửa đổi mới; không hoàn nguyên app.py hoặc runtime.

Package độc lập, chỉ dùng cho kiểm thử; không được import vào ứng dụng Streamlit.
Node.js 24, npm 11 và Chrome hệ thống được dùng trong lần triển khai đầu.
Dependency `@playwright/test` được khóa tại phiên bản 1.64.0.

## Chạy trên máy local

Khởi chạy Streamlit theo hướng dẫn của frontend bằng môi trường sẵn có. Bộ test chỉ
chấp nhận origin cấu hình hợp lệ (mặc định `http://localhost:8501`) và kiểm tra health trước mỗi lượt chạy; không tự
khởi động server, cài browser, đổi port hoặc cấu hình ứng dụng.

```powershell
cd E:\captone\frontend\checks\trinh_duyet
npm run check
npm run probe
npm run test:smoke
npm run test:ui
npm run test:responsive
npm run test:robot
npm run test:screenshots
npm test
```

Nếu PowerShell chặn `npm.ps1`, gọi `npm.cmd` thay cho `npm`; không đổi execution policy.

Nếu cần phục hồi dependency đã được phê duyệt từ lockfile:

```powershell
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
npm ci --ignore-scripts --no-audit --no-fund
```

Không chạy `npx` để tải package tự động. Không chạy `playwright install`.
Chrome chạy headless qua channel `chrome`, sandbox bật, context tạm riêng cho từng
test. Không dùng profile cá nhân, CDP hoặc `--no-sandbox`. Probe không đạt thì
runner dừng; không thử công cụ khác để vượt hạn chế automation.

## Phạm vi

- `xac_thuc`: đọc form Login/Register/recovery; đăng nhập/đăng xuất demo hợp lệ.
- `nguoi_dung`, `quan_tri`: đọc đủ tám trang mỗi Portal, header, controls, overflow.
- `header_sidebar`: navigation sau scroll, rerun do đổi theme, menu và header.
- `chu_de`: Light → Dark → Light, semantic tokens và dropdown mở bằng bàn phím.
- `responsive`: Login/User/Admin ở 1920/1440/1024/768, DPR 1, zoom mặc định 100%.
- `robot`: diagnostics thật, canvas, kéo xoay, wheel zoom, reset, wave, theme và
  identity của renderer. Không thêm hook hoặc phụ thuộc package robot.
- `anh_giao_dien`: screenshot ứng viên baseline cho ba màn hình, bốn độ rộng,
  hai theme; thêm sidebar mở ở 768. Chưa có pixel comparison với baseline đã duyệt.

Các tài khoản demo công khai đã được cho phép sử dụng. Không thay credentials bằng
tài khoản thật. Không submit đăng ký, recovery, chat, form quản trị hoặc thao tác
thêm/sửa/xóa. Login có thể ghi audit trong session demo theo hành vi sẵn có của app.
Test Python cũ có thao tác trên AppTest/session mô phỏng riêng, không trên server.

## Bằng chứng và cách đọc kết quả

Mỗi lượt ghi vào `E:\captone_backup\browser_runs\<run_id>\`:

- `environment.json`: health, Chrome version, channel, quyền launch và request chặn.
- `report/html/index.html`: báo cáo HTML; `report/results.json`: kết quả Playwright.
- `report/status.json`: PASS/FAIL/NOT RUN cho test được runner báo cáo.
- `errors.json`: console, pageerror, request failure theo từng test.
- `screenshots/`: ảnh ứng viên và ảnh khi FAIL.
- `traces/`: trace thao tác khi test đã đăng nhập bị FAIL; không chụp DOM/video
  trong trace và không trace quá trình nhập mật khẩu. Xem ảnh mask riêng để đánh giá UI.

Mở HTML trực tiếp trong Chrome. Có thể dùng CLI đã cài local để mở trace khi được
phép; không upload trace lên dịch vụ bên ngoài. File report/trace cần giữ local.
Ảnh mask trường credentials và dòng email tài khoản demo, không che header/menu.
Ảnh mới chỉ là **CANDIDATE**, phải được người dùng duyệt trước khi làm chuẩn.

PASS nghĩa là assertion đã chạy đạt; FAIL là đã chạy không đạt; NOT RUN là chưa
chạy; BLOCKED là thiếu health, quyền browser hoặc môi trường. Runner một worker,
không retry, dừng sau FAIL đầu tiên; các test còn lại không được coi là PASS.
Không dùng chờ thời gian cố định làm điều kiện render; đo rect, ancestor clipping,
scroll widths, computed colors và diagnostics. Đây không phải chứng nhận mọi pixel,
mọi modal hoặc mọi trạng thái của ứng dụng đã chính xác.

Mạng chỉ cho phép HTTP/WebSocket của origin đã chọn; mặc định là localhost:8501.
Hai thông báo metrics Streamlit chỉ được phân loại `network-policy` nếu đồng thời
có bằng chứng request metrics bị chặn và đúng thông báo/bundle local đã đối chiếu.
Lỗi chặn resource chỉ nhận `ERR_BLOCKED_BY_CLIENT` hoặc biến thể CDP `.Inspector`
đã đối chiếu, tại đúng endpoint metrics và có bằng chứng policy chặn endpoint đó.
Request ngoài dự kiến vẫn bị chặn và ghi `error`, kể cả WebSocket chưa kết nối;
không coi mọi request bị chặn là ngoại lệ telemetry. Lỗi interceptor cũng là lỗi test.
Warnings sandbox/feature đã nhận diện vẫn được lưu; warnings khác được đánh dấu
chưa đánh giá. Không thay sandbox iframe hoặc bỏ qua toàn bộ warnings.

## Bảo trì và rollback

Sửa locator/assertion trong helpers khi DOM thật được xác minh đã thay đổi. Không
thêm runtime hook hoặc sửa giao diện để làm test PASS. Giữ widget labels và route
đúng source; đừng click Save/Delete/Submit trong các test chỉ đọc.

Checkpoint trước triển khai nằm ngoài source, có manifest SHA-256. Khi rollback,
đối chiếu checksum trước; chỉ gỡ package `checks/trinh_duyet/` do giai đoạn này tạo,
sau khi xác nhận không có thay đổi mới của người dùng trong đó. Không khôi phục đè
runtime, không dùng `git reset --hard` hoặc `git clean`. Artifacts và checkpoint
được giữ riêng để xem lại. Chưa triển khai Giai đoạn 3.

## Kết quả triển khai đầu ngày 14/10/2026

Lượt full `2026-10-14T07-59-33-940Z`: **22 PASS, 1 FAIL, 4 NOT RUN**.
Test robot đã qua render, kéo, zoom và reset nhưng iframe bị detach khi đổi theme;
assertion giữ identity/renderer chưa đạt. Wave nằm sau bước này nên chưa chạy.
Không sửa runtime hoặc nới assertion. Nhóm smoke riêng trước đó 5/5 PASS, UI 8/8
PASS; các kết quả này không biến lượt full thành PASS. Có 28 ảnh ứng viên và một
ảnh FAIL. Chart Admin có nhãn trục nhạt trong Light; khi mở sidebar ở 768, Dashboard
bị nén và một số nhãn rút gọn. Cần đánh giá thủ công trước khi duyệt baseline.

## Phân tích lại baseline (lịch sử trước Fix A)

Robot hiện có ba test độc lập: wave lặp hai lần/khôi phục pose; camera/WebGL;
và test gốc giữ renderer qua đổi theme. Không xóa test FAIL. Test lifecycle dùng
soft assertions để đo đủ ba lần chuyển, nhưng bất kỳ identity nào đổi vẫn làm FAIL.
Reacquire frame chỉ phục vụ thu bằng chứng, không thay thế điều kiện giữ iframe gốc.

`helpers/vong_doi_iframe.js` quan sát các event frame, identity của DOM/document/
canvas/diagnostics, SHA-256 srcdoc, config và thời điểm tạo document. Fixture chỉ đọc
field `script_finished` của WebSocket Streamlit 1.65 để đợi rerun; không lưu payload,
không tạo state hoặc hook trong robot. Nếu protocol thay đổi cần đối chiếu lại.

Đã tái hiện: flash đăng nhập hiện ở lần đầu, bị `pop` khi rerun; block feedback
không còn được render ở lần sau. Wrapper trang đổi index 3 → 1, iframe mới được
mount dù SHA-256 srcdoc giữ nguyên. Hai lần đổi theme tiếp theo, khi flash đã hết,
giữ cùng iframe/document/canvas/diagnostics. Không quy mọi theme switch thành reload.
Đây là hành vi layout/rerun cần xử lý riêng nếu giữ renderer là điều kiện nghiệm thu;
không sửa runtime trong package kiểm thử.

Trong đợt chẩn đoán lịch sử, để tiếp tục chạy các test độc lập sau FAIL lifecycle đã dùng:

```powershell
npm.cmd run test:robot -- --max-failures=0
npm.cmd test -- --max-failures=0
```

Tham số này chỉ cho runner tiếp tục sau test FAIL, không skip assertion, không retry
hoặc chuyển lỗi thành PASS. Ảnh mới vẫn là ứng viên chờ duyệt.

## Origin tường minh — Phase 3C-F

`AIVA_TEST_ORIGIN` chỉ nhận chính xác `http://localhost:8501` hoặc
`http://localhost:8502`; khi không đặt biến, dùng 8501. Giá trị có path (kể cả `/`
ở cuối), query, fragment, credentials, HTTPS, hostname alias hoặc port khác đều bị
từ chối ngay khi import helper, trước khi probe/browser chạy. Mỗi lượt chỉ tin
một origin. Navigation, health, HTTP/WebSocket và emitter telemetry dùng cùng cấu hình.

```powershell
$env:AIVA_TEST_ORIGIN = 'http://localhost:8502'
node --test helpers/bao_mat.test.js
npm.cmd test -- --max-failures=0
```

Lệnh test không tự khởi động/dừng server. Phải xác minh listener, PID và framework
đúng trước khi chạy; không thay server 8501 để phục vụ thử nghiệm 8502.

Gate bảo mật kiểm tra cả default và explicit origin, URL giả/credentials, HTTP/WS
ngoài policy, emitter sai, Recording/page errors và request failures. Toàn bộ raw
records vẫn được lưu. Ngoại lệ telemetry không mở quyền truy cập Internet.

`context.route()` của full suite vô hiệu HTTP cache. Cold/warm cache phải được đo
bằng runner riêng có interception được kiểm chứng, có bằng chứng cache hit/miss
và WebSocket bị hạn chế; không đổi nhãn lượt chạy thành bằng chứng warm cache.

Sửa helper làm thay đổi `cameraChecksums.testInputs`; model lịch sử được giữ nguyên,
không cập nhật SHA để né provenance. Chrome 156 chưa có calibration được duyệt:
camera gate có thể BLOCKED/INCONCLUSIVE hoặc raw FAIL; không được skip hoặc báo PASS.
Giữ nguyên `robot.spec.js`, PNG Reset assertion, thresholds và screenshot baselines.

## Chrome 156 riêng — Phase 3C-G3

Profile `chrome-156.0.8078.48` chỉ dành cho Streamlit 1.66.0 trong venv166
ngoài source, origin `http://localhost:8502`, Iris Xe/ANGLE D3D11,
1440×1080/DPR 1, Three.js r180, canvas CSS/buffer 305×142. Registry khóa SHA
chrome.exe và manifest 40 dependency. Mismatch phải INCONCLUSIVE; không fallback.

`cameraChecksums()` ghi runtime, collector/policy/tests và environment riêng.
Không hash model/receipt vào nguồn sinh model: đồ thị một chiều
source/environment → 12 training cases → frozen model SHA → 8 validation cases
→ receipt SHA. Không cập nhật SHA trong năm model lịch sử để né provenance.

Training dùng `AIVA_CAMERA_COLLECTION=train`; freeze bằng helper hiện có.
Validation dùng `AIVA_CAMERA_COLLECTION=validation` cùng model path/SHA đã freeze.
Chỉ validation được đọc candidate chưa có receipt; chế độ này không chạy acceptance.
Sau 8 lượt độc lập đạt toàn bộ 120 classifications, lưu receipt riêng chứa SHA
model, provenance, raw/evaluation paths và SHA, không chỉnh model đã freeze.
Receipt có status `VALIDATED_PENDING_USER_ACCEPTANCE`, `approved=false`.

Acceptance/full regression của profile156 bắt buộc có `AIVA_CAMERA_MODEL`,
`AIVA_CAMERA_MODEL_SHA256`, `AIVA_CAMERA_VALIDATION` và
`AIVA_CAMERA_VALIDATION_SHA256`. Loader xác minh receipt, tám case đủ negative
controls, digest dữ liệu, fingerprint, lifecycle và độc lập với training.
Receipt hợp lệ cho phép kiểm thử candidate; không mang nghĩa người dùng đã duyệt.

Chỉ mở rộng điều kiện init settleReset cho profile156 theo bằng chứng G2.
Không đổi implementation settleReset, formulas, thresholds hoặc PNG Reset gate.
PNG gate vẫn có thể FAIL dù camera/edge gần tương đương; phải báo raw FAIL.
Không dùng dữ liệu chẩn đoán G/G1/G2 làm training hoặc validation mới.

## Main Streamlit 1.66.0 — Phase 3D-B

Profile `chrome-156.0.8078.48-main` dành riêng cho `.venv` của frontend và origin
`http://localhost:8501`. Không dùng lại candidate G3/8502 làm candidate main.
Ngoài manifest dependency, browser/GPU/canvas và source/test hashes, mỗi lần đo
xác minh attestation/SHA của process phục vụ 8501: PID, listener owner, command
line, interpreter/prefix, module Streamlit và effective configuration.
`AIVA_MAIN_SERVER_ATTESTATION` và `AIVA_MAIN_SERVER_ATTESTATION_SHA256` phải
được cung cấp tường minh. Launcher/attestation nằm ngoài source.

PID được ghi trong observation ledger và kiểm tra trực tiếp, không đưa PID vào
fingerprint cố định để tránh coi restart hợp lệ là thay đổi hình học camera.
Source launcher và cấu hình/version/module vẫn thuộc fingerprint. Giữ nguyên
12 train/8 validation độc lập, receipt và trạng thái chờ người dùng nghiệm thu.
Không sửa robot.spec.js, settleReset, metric formulas hoặc PNG Reset gate.
Các model lịch sử/G3 giữ nguyên SHA; thêm registry làm thay đổi provenance test
mới, không cập nhật model cũ để né checksum. Wheel main được khóa ở1.66.0;
rollback chỉ thay Streamlit về1.65.0 bằng wheel local đã xác minh.
