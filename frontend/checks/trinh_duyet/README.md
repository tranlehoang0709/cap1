# Kiểm thử trình duyệt AIVA-IoT

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
chấp nhận `http://localhost:8501` và kiểm tra health trước mỗi lượt chạy; không tự
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

Mạng chỉ cho phép HTTP/WebSocket của localhost:8501; telemetry ngoài local bị chặn.
Hai thông báo metrics Streamlit chỉ được phân loại `network-policy` nếu đồng thời
có bằng chứng request metrics bị chặn và đúng thông báo/bundle local đã đối chiếu.
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
