# Mặt Pixel LED trong robot 3D

`pixel-face.js` nhập trực tiếp controller/renderer/registry của prototype đã duyệt, không sao chép hoặc chỉnh sửa prototype. Esbuild đưa chúng vào bundle cục bộ; iframe không tải module hoặc gọi dịch vụ ngoài.

Mặt đen hiện tại là RoundedBoxGeometry 1.66×1.11, không có UV đơn giản phù hợp canvas 2:1. Adapter thêm một PlaneGeometry 1.48×0.74 tại z=0.80 trong head (mặt trước hộp tại z≈0.785), dùng CanvasTexture 128×64, NearestFilter, không mipmap, sRGB, MeshBasicMaterial không tone mapping. Body/head/camera/lighting và vật liệu ngoài khuôn mặt giữ nguyên.

`setExpression(id)` chỉ nhận năm ID prototype hoặc legacy `excited`. Với năm ID chính, mắt/miệng mesh cũ bị ẩn; adapter vẽ canvas từ state prototype. Với `excited`, adapter ẩn mặt LED và hiện lại mesh cũ; scene dùng nguyên controller `expressions.js` cũ. Không có option excited thứ sáu trên UI. Không alias excited sang happy.

`renderOnce()` là nơi duy nhất cập nhật mặt; không thêm RAF. Pause đóng băng pose, giảm chuyển động chuyển sang pose tĩnh. Mỗi iframe có controller riêng; offline khóa selector và giảm độ sáng. Lựa chọn được lưu trong closure scene qua lần giải phóng GPU hợp lệ, không ghi session/backend.

`releaseGPU()` gọi dispose adapter trước disposeScene; texture, material, plane được tháo và dispose đúng một lần. Canvas/renderer 2D không tạo thêm GPU context. Camera, hit-testing của toàn robot, wave và animateRobot cũ vẫn hoạt động.

Ranh giới tương lai: adapter xác thực ID, renderer không biết nguồn sự kiện. Không có endpoint/payload/firmware command mới. Tích hợp pixel đổi ảnh và fingerprint: model/receipt lịch sử giữ nguyên, chỉ candidate mới được dùng sau validation độc lập; không tự chấp nhận candidate.
