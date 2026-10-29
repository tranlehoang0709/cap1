# Hướng dẫn cấu trúc Frontend AIVA-IoT

Cập nhật ngày 15/10/2026. Giai đoạn 9 chuyển auth sang `giao_dien/xac_thuc/dang_nhap.py`
và registry sang `giao_dien/dinh_tuyen.py`; app dùng các module này trực tiếp.
`ui/auth.py` và `ui/portal.py` giữ compatibility alias. `ui/fields_theme.py` đã xóa
sau khi loại bỏ hai lời gọi no-op và xác minh không còn caller/import động.
App/auth/User không còn import `ui.*`. Các phần phân loại caller Giai đoạn 8 bên dưới
là ghi nhận trước cleanup; không dùng chúng để suy ra app vẫn đi qua shim.
Đây là frontend Python + Streamlit dùng dữ liệu demo trong session, chưa nối backend.
Refactor giữ nguyên giao diện, navigation, phân quyền demo và robot Three.js.

## 1. Cấu trúc thực tế

```text
frontend/
├── app.py                         # Entry point và thứ tự render
├── .streamlit/config.toml         # Cấu hình Streamlit hiện có
├── requirements.txt
├── nen_tang/                      # State, điều hướng, validation, theme, đường dẫn
├── giao_dien/
│   ├── dinh_tuyen.py              # USER_ROUTES, ADMIN_ROUTES
│   ├── xac_thuc/dang_nhap.py      # Login/Register/recovery demo
│   ├── nguoi_dung/                # 7 module; Tài khoản dùng component chung
│   └── quan_tri/                  # 8 module trang Admin
├── thanh_phan/
│   ├── bo_cuc/                    # Header và Sidebar
│   ├── dung_chung/                # Panel, bảng, tài khoản, API key, theme toggle
│   ├── bieu_mau/                  # Xác nhận thao tác
│   └── robot/                     # Python dựng/nhúng robot và fallback
├── kieu_dang/                     # CSS ứng dụng và widget dùng chung
├── ui/                            # Auth, routing và compatibility modules
│   └── assets/
│       ├── layout/header_scroll.js
│       └── aiva3d/                # Bundle, nguồn JS, CSS, HTML, license, Node tests
└── checks/                        # Python/Node checks và trinh_duyet/ (Playwright)
```

`giao_dien/xac_thuc/` đã có từ Giai đoạn 9; hai hàm auth giữ nguyên nội dung và API.
`ui/auth.py` chỉ re-export, không chứa implementation song song.
Các `__init__.py` đánh dấu package, không phải trang dư cần xóa.

## 2. Nền tảng và luồng chạy

| File | Trách nhiệm |
|---|---|
| `app.py` | Cấu hình trang, `init_demo`, account/role, chọn routes, theme, header, flash, gọi trang |
| `nen_tang/trang_thai.py` | Demo/defaults, identity, dữ liệu, ownership, preferences/privacy, audit/flash, `mine`, `allowed_providers` |
| `nen_tang/dieu_huong.py` | `go(page)`: điều hướng bằng state và rerun hiện có |
| `nen_tang/kiem_tra_du_lieu.py` | `email_valid` |
| `nen_tang/duong_dan.py` | `FRONTEND_ROOT`, `ASSETS_DIR`; không phụ thuộc working directory |
| `nen_tang/chu_de.py` | `apply_theme`, bảng token duy nhất và inject CSS |
| `giao_dien/xac_thuc/dang_nhap.py` | Implementation form xác thực demo; `ui/auth.py` giữ alias |
| `giao_dien/dinh_tuyen.py` | Registry **đang dùng** `USER_ROUTES`, `ADMIN_ROUTES`; `ui/portal.py` alias cùng object |

Luồng Login: header và toggle → `apply_theme` → auth → stop; đã bỏ field-theme no-op.
Luồng Portal: Sidebar/chọn trang → `apply_theme` → header → flash container → `routes[page]()`.
Giữ `flash = st.session_state.pop("flash", None)` và container `portal_flash` luôn tồn tại
(Fix A); không đưa trang hoặc iframe vào container flash.

## 3. Muốn sửa chức năng nào thì vào file nào?

| Chức năng User | Implementation |
|---|---|
| Dashboard, thống kê sử dụng | `giao_dien/nguoi_dung/bang_dieu_khien.py` (`dashboard_user`, `usage`) |
| AI Chat, composer, lịch sử bên cạnh | `giao_dien/nguoi_dung/tro_chuyen_ai.py` (`web_chat`, `render_chat`) |
| Robot của tôi, ghép nối, đổi tên, hủy liên kết | `giao_dien/nguoi_dung/thiet_bi.py` (`devices_user`, `robot_cards`, `robots`) |
| Trợ lý, giọng nói, ngôn ngữ, provider | `giao_dien/nguoi_dung/cau_hinh_tro_ly.py` (`render_page`, `assistant`, `provider`) |
| API key cá nhân | `giao_dien/nguoi_dung/khoa_api_ca_nhan.py` (`personal_keys`) |
| Hội thoại, bộ nhớ, metadata tài liệu | `giao_dien/nguoi_dung/lich_su_hoi_thoai.py` (`render_page`, `history`, `memory`, `knowledge`) |
| Quyền riêng tư | `giao_dien/nguoi_dung/quyen_rieng_tu.py` (`privacy_page`) |
| Tài khoản | `thanh_phan/dung_chung/bieu_mau_tai_khoan.py` (`account`), không có bản sao riêng trong User |

| Chức năng Admin | Implementation |
|---|---|
| Dashboard hiện tại và view dashboard tương thích cũ | `giao_dien/quan_tri/bang_dieu_khien.py` (`dashboard_admin`, `dashboard`) |
| Người dùng và role | `giao_dien/quan_tri/quan_ly_nguoi_dung.py` (`render_page`, `users`, `roles`) |
| Thiết bị, duyệt/gán robot, telemetry | `giao_dien/quan_tri/quan_ly_thiet_bi.py` (`devices_admin`, `devices`, `telemetry`) |
| Provider và AI Server | `giao_dien/quan_tri/quan_ly_ai.py` (`ai`, `providers`, `server`) |
| System API key, quota | `giao_dien/quan_tri/khoa_api_va_han_muc.py` (`keys`, `system_keys`, `quotas`) |
| OTA và metadata firmware | `giao_dien/quan_tri/firmware_ota.py` (`firmware`) |
| Log và tài nguyên mẫu | `giao_dien/quan_tri/nhat_ky_giam_sat.py` (`monitoring`, `logs`, `resources`) |
| System Settings, bảo mật, thông báo | `giao_dien/quan_tri/cau_hinh_he_thong.py` (`render_page`, `settings`) |

Các alias `render_telemetry`, `render_logs`, `render_resources` tránh trùng tên với biến tab,
không phải implementation thứ hai. Không nhầm wrapper `render_page` với form cùng module.
Fix B nằm trong `dashboard_admin`: màu tick Light và margin phải giữ nguyên.
Fix C nằm ở các hook Dashboard cùng media query trong `kieu_dang/portal.css`.

| Thành phần chung | File cần sửa khi có yêu cầu được duyệt |
|---|---|
| Header Login/Portal, branding, gắn scroll script | `thanh_phan/bo_cuc/tieu_de.py` |
| Sidebar, menu, thông tin account, logout | `thanh_phan/bo_cuc/thanh_ben.py` |
| Content panel | `thanh_phan/dung_chung/khung_noi_dung.py` |
| Bảng, tìm kiếm, filter, pagination, chọn record | `thanh_phan/dung_chung/bang_du_lieu.py` |
| Form hồ sơ/mật khẩu | `thanh_phan/dung_chung/bieu_mau_tai_khoan.py` |
| Form API key dùng chung | `thanh_phan/dung_chung/quan_ly_khoa_api.py` |
| Toggle theme và đồng bộ state | `thanh_phan/dung_chung/nut_chuyen_chu_de.py` |
| Xác nhận thao tác | `thanh_phan/bieu_mau/xac_nhan.py` |
| Scroll khi đổi trang, chống clipping | `ui/assets/layout/header_scroll.js`; giữ nguyên DOM hooks |

## 4. Theme và CSS

- Nguồn theme: `appearance` và toggle `aiva_theme_switch` hiện có. Không tạo toggle/token system thứ hai.
- `nen_tang/chu_de.py` inject token `:root`, sau đó `portal.css` và `components.css`
  trong một `style#aiva-application-theme`. CSS toggle được inject trước stylesheet này.
- `kieu_dang/portal.css`: bố cục, branding, shared components, Login, Dashboard và chat.
- `kieu_dang/components.css`: widget, disabled/focus/hover, bảng và các overlay có tên.
- `kieu_dang/theme_switch.css`: renderer đổi prefix sang `.st-key-aiva_theme_switch_scope`.
- Chat dùng hook `st-key-chat_*`; Login có hook riêng; Dashboard dùng hook chung cho hai role.
- Dropdown React Aria/BaseWeb có thể nằm **ngoài `.stApp`**. Giữ guard `:root:has(.stApp)`
  và selector widget/portal có tên; không thay tất cả bằng `.stApp …`.
- Audit Giai đoạn 7: 205 rule stylesheet chính, hai lượt x 52 trạng thái; không xác nhận
  xung đột nên không sửa CSS. Đây không phải bảo đảm cho mọi widget/plugin hoặc DOM tương lai.

## 5. Robot

| File | Vai trò |
|---|---|
| `thanh_phan/robot/khung_hien_thi.py` | `render_robot_scene(*, hero=False, online=True)`, iframe và pause toggle |
| `thanh_phan/robot/tai_lieu_3d.py` | `ASSETS`, cache theo mtime, `asset`, `build_document` |
| `thanh_phan/robot/du_phong.py` | Chuỗi `ROBOT` SVG fallback gốc |
| `ui/assets/aiva3d/template.html`, `style.css` | Khung HTML/CSS riêng trong iframe |
| `ui/assets/aiva3d/robot.bundle.js` | Bundle cục bộ được nhúng inline, không CDN |
| `ui/assets/aiva3d/model.js`, `controls.js`, `scene.js`, `theme.js`, `diagnostics.js` | Nguồn geometry, tương tác, rendering, theme và diagnostics; xem README của component |
| `ui/assets/aiva3d/THREE-LICENSE.txt`, `package*.json`, `*.test.js` | License, build dependency và Node tests; không coi là file dư |

Assets vẫn tại `ui/assets/aiva3d/`, được tìm qua `ASSETS_DIR`. Iframe cao 352/202px,
nội dung hero/card 350/200px. Không đổi asset path khi chỉ di chuyển module Python.
`build_document(light=...)` giữ srcdoc ổn định khi chỉ đổi theme; JS đọc theme cha để cập nhật
scene. Đừng đưa theme vào HTML theo cách gây remount. Pause/online/hero có ý nghĩa riêng.
Kéo xoay, wheel zoom, double-click/reset và vẫy tay được kiểm thử; renderer/diagnostics không
được expose thêm chỉ để làm test PASS. Fallback không phải model 3D chính.

## 6. Legacy audit Giai đoạn 8 — ghi nhận trước cleanup 9

Hai trục phân loại: module còn caller hay không, và có còn implementation thật hay chỉ alias.
Một shim có caller vẫn là code đang dùng; import không được dùng nội bộ có thể là API re-export.

| Module cũ | Phân loại và bằng chứng | Implementation đích / quyết định |
|---|---|---|
| `ui/auth.py` | Implementation thật, `app.py` gọi | Giữ nguyên; chưa chuyển sang `giao_dien/xac_thuc/` |
| `ui/portal.py` | Registry hoạt động, app import hai route dict | Giữ; không được xóa như shim thuần |
| `ui/user.py`, `ui/admin.py` | Re-export và registry cũ; `ui.portal` còn dùng namespace, tests import động | Các module `giao_dien/*` và shared components; giữ compatibility |
| `ui/state.py` | Shim còn caller từ app/auth/legacy/tests | `nen_tang/trang_thai.py`; giữ |
| `ui/common.py` | Shim còn caller từ auth/legacy/table tests | `nen_tang` và `thanh_phan`; giữ |
| `ui/theme.py` | App còn import | `nen_tang/chu_de.py`; giữ |
| `ui/theme_switch.py` | Shim, không thấy caller runtime trực tiếp; contract test import qua mapping | Toggle mới trong `thanh_phan`; ứng viên xem xét sau, chưa an toàn để xóa |
| `ui/motion.py` | Auth, User Dashboard/thiết bị, legacy/tests còn import | `thanh_phan/robot/khung_hien_thi.py`; giữ |
| `ui/aiva3d.py` | Shim, robot tests còn import trực tiếp/động | `thanh_phan/robot/tai_lieu_3d.py`; giữ |
| `ui/robot.py` | Legacy portal và robot tests còn import | `thanh_phan/robot/du_phong.py`; giữ |
| `ui/fields_theme.py` | Hàm no-op nhưng app vẫn gọi | Compatibility API; muốn bỏ phải duyệt sửa caller riêng |
| `ui/__init__.py` | Package marker | Giữ |

Ứng viên cleanup cần phê duyệt riêng:

1. Import không được đọc nội bộ và dòng trắng dư trong `ui/portal.py`, `ui/admin.py`;
   phải kiểm tra public import bên ngoài trước khi bỏ symbol.
2. `ui.user.ROUTES`, `ui.admin.ROUTES` và view `dashboard` cũ: không thấy app chọn trực tiếp;
   vẫn là exported API và có tham chiếu nội bộ. Không kết luận view/file hoàn toàn không dùng.
3. Shim không có caller runtime trực tiếp, đặc biệt `ui/theme_switch.py`: vẫn có contract tests
   và có thể có consumer ngoài repo. Cần kế hoạch chuyển caller, deprecation và test trước khi xóa.
4. Script audit thủ công và JSON lịch sử trong `checks/`: có thể archive sau quyết định giữ bằng chứng;
   không tự xóa vì không xuất hiện trong import graph Python.

Audit quét AST cả import trong hàm, 333 binding import và 14 lời gọi import động trong các
contract tests. Các mapping/biểu thức ghép tên module được kiểm tra bằng regression thực tế.
`app.py` dispatch bằng dictionary, không dùng auto-discovery `pages/`.
Asset được đọc qua đường dẫn/chuỗi, JS được test/build qua Node; việc không có Python import
không chứng minh asset hoặc script không được dùng. Không thể xác nhận consumer ngoài repo.

## 7. Chạy ứng dụng bằng môi trường hiện có

```powershell
cd E:\captone\frontend
.\.venv\Scripts\python.exe -B -m streamlit run app.py --server.port 8501
```

Đọc URL thực tế từ tiến trình và kiểm tra server trước khi dùng browser automation.
Bộ Playwright hiện chỉ chấp nhận `http://localhost:8501`. Không tự đổi port hoặc cài dependency.
Tài khoản demo và giới hạn dữ liệu xem [README](README.md); không đưa credential thật vào test/artifact.

## 8. Chạy kiểm thử

Từ thư mục frontend:

```powershell
$checks = 'smoke','reference','tables','theme_ui','robot3d','shared_components','user_pages','admin_pages','robot_components','legacy_cleanup'
foreach ($check in $checks) {
    & .\.venv\Scripts\python.exe -B "checks/$check.py"
    if ($LASTEXITCODE -ne 0) { throw "FAIL: $check" }
}
node --test ui/assets/aiva3d/model.test.js ui/assets/aiva3d/controls.test.js ui/assets/aiva3d/fallback.test.js ui/assets/aiva3d/theme.test.js checks/header_scroll.test.js checks/trinh_duyet/helpers/bao_mat.test.js
```

Năm script đầu kiểm tra hành vi/AppTest; năm script sau có 15 unittest contract cases.
Không gọi tổng số case này là số file/bộ Python độc lập. Node hiện có 19 test.

```powershell
cd E:\captone\frontend\checks\trinh_duyet
node helpers/chay_kiem_thu.js
```

Runner probe Chrome trước, không tự khởi chạy Streamlit/cài browser. Artifacts nằm ở
`E:\captone_backup\browser_runs\<run_id>`. Xem [README Playwright](checks/trinh_duyet/README.md)
về camera calibration/GPU profile, các nhóm test và trạng thái INCONCLUSIVE.
Full regression hiện có 41 test; giữ assertions, không tự duyệt ảnh ứng viên.
Các `*.spec.js` bao phủ auth, User, Admin, theme, header/sidebar, responsive, robot, flash và screenshots.
`fixtures/phien_demo.js` quản lý phiên demo; `helpers/` quản lý runner, bảo mật local-only,
điều hướng, theme, bố cục, lỗi, lifecycle/robot và báo cáo. Các Python contract tests dùng import động.

Kết quả baseline Giai đoạn 7: Playwright 41 PASS, Node 19 PASS, Python regression PASS,
computed styles 52/52 và geometry 16/16 khớp. Đây là kết quả lịch sử, không tự coi là lần chạy mới.
Giai đoạn 8 chỉ sửa Markdown: chạy lại Python/Node; browser regression NOT RUN nếu runtime không đổi.

## 9. Dependency và nguyên tắc thêm trang mới

`app.py` → routing `giao_dien/dinh_tuyen.py` → trang `giao_dien/*` → `nen_tang` và `thanh_phan`.
`nen_tang` không import ngược UI; shared components không import legacy pages.
User/auth hiện gọi robot component trực tiếp; các shim vẫn giữ cho caller/test tương thích.

Đặt module mới trong đúng Portal, tên tiếng Việt không dấu snake_case; giữ tên kỹ thuật của hàm,
biến, class bằng tiếng Anh, comment/docstring tiếng Việt có dấu. Reuse panel/table/account/key manager.
Thêm route chỉ khi có yêu cầu chức năng được duyệt; giữ kiểm tra role và không chuyển app sang
Streamlit auto-pages. Không đổi widget/session/navigation keys khi chỉ tổ chức lại source.
CSS mới phải dùng hook component hiện có hoặc chứng minh cần scope; giữ dropdown portal-aware,
không tạo wrapper làm đổi vị trí iframe. Thêm test hành vi cần thiết và giữ legacy re-export khi còn caller.

## 10. Tài liệu và nghiệm thu

- `README.md`: cách chạy, demo và giới hạn sản phẩm.
- `FUNCTION_COVERAGE.md`: đối chiếu chức năng; registry vẫn ở `ui/portal.py`, implementation tra bảng trên.
- `DESIGN.md`, `checks/UI_VERIFICATION.md`: bối cảnh/ghi nhận lịch sử; đối chiếu ngày và report trước khi suy ra hiện trạng.
- `checks/trinh_duyet/README.md`: lệnh browser test, camera profile và lịch sử lỗi.
- `ui/assets/aiva3d/README.md`: kỹ thuật component robot và bundle.

Checkpoint, manifest, import graph, patch và báo cáo từng giai đoạn ở `E:\captone_backup`.
Rollback chỉ file thuộc giai đoạn sau khi so hash, không ghi đè sửa đổi mới hoặc dùng git reset/clean.
Giai đoạn 8 không phê duyệt cleanup: mọi xóa/di chuyển legacy hoặc sửa runtime phải có task riêng.

Giai đoạn 9 đã được phê duyệt riêng: chỉ xóa field-theme no-op; các shim khác còn giữ.
`checks/legacy_cleanup.py` kiểm tra ranh giới import, alias auth/registry và module đích.
