# AIVA Pixel Face — prototype độc lập

Chạy từ `E:\captone\frontend`, không cài dependency:

```powershell
.\.venv\Scripts\python.exe -B prototypes/pixel_face/serve.py --port 8510
```

Mở **http://127.0.0.1:8510/**. Cần HTTP local để tải ES modules; không mở trực tiếp `file://`.
Đổi cổng nếu 8510 đang dùng. Trang không đăng nhập, không dùng Streamlit và không gửi HTTP/WebSocket ngoài các file tĩnh cục bộ.
`serve.py` chỉ bind loopback và đặt MIME `.mjs` tường minh, tránh registry MIME `text/plain` trên Windows. Không chạy server này để triển khai production.

- `registry.mjs`: 5 ID, nhãn tiếng Việt, thông số thời gian.
- `controller.mjs`: `ExpressionController.setExpression(id)`, `update(dt)`, pause/reduced motion/visibility. Trạng thái cục bộ, không biết API hay Streamlit.
- `renderer.mjs`: `PixelFaceRenderer(canvas, {width:128,height:64})`; `render(state,{motion})`. Raster gốc, không texture/sprite tải ngoài. Có thể đổi logical resolution, ưu tiên cùng tỷ lệ 2:1 và bội nguyên của 128×64.
- `preview.mjs`: UI, một RAF loop, IntersectionObserver, reduced-motion của hệ điều hành và checkbox. Không có test hook ghi vào controller.
- `index.html`, `style.css`: trang preview responsive; Play/Pause chỉ dừng thời gian, reduced motion vẽ pose tĩnh.

Kiểm tra controller: `node --test prototypes/pixel_face/controller.test.mjs`.
Kiểm tra browser riêng: xem đầu file `browser.test.mjs`, dùng Playwright đã có; artifacts phải ở ngoài source.

## Ranh giới tích hợp tương lai — chưa triển khai

Renderer chỉ nhận state từ controller, bất kể nguồn chọn là UI hay sự kiện tương lai. Sau khi chốt giao thức, adapter riêng có thể xác thực ID rồi gọi `setExpression(id)`; không đặt logic mạng vào renderer.
Một thử nghiệm Three.js tương lai có thể dùng canvas làm CanvasTexture trên màn mặt, lọc NearestFilter, chỉ cập nhật texture khi render và dispose khi unmount. Cần nghiệm thu thiết kế, kiểm tra UV/mặt hiển thị, lifecycle, hiệu năng và provenance camera trước; prototype này không import Three.js, không sửa robot hoặc tạo texture production.
Registry 3D hiện tại có `excited`; prototype không đổi/xóa/alias preset đó. Mapping giữa hai registry cần quyết định riêng, không tự chuyển `excited` thành `happy`.

Chưa nhận được 5 ảnh tham chiếu trong attachment của lượt này, nên hình vẽ được tạo mới theo mô tả, chưa xác nhận tương đồng ảnh gốc. Không dùng tài sản Mochi hay sprite pack.
Đây là mô phỏng biểu cảm, không phải telemetry, trạng thái AI hay lệnh firmware.
