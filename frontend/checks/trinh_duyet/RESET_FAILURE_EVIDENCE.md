# Evidence khi assertion Reset FAIL

`canvasHash()` vẫn chụp đúng một PNG và trả SHA-256 của chính buffer đó. WeakMap chỉ giữ capture gần nhất theo frame; bản tham chiếu được giữ riêng ngay sau `settleReset()`. Không thêm thao tác browser trước screenshot.

Dòng assertion gốc giữ nguyên: `await expect.poll(() => settleReset(frame)).toBe(original);`. Khi nó ném lỗi, collector lưu bản sao buffer reference/actual hiện có, không chụp lại hoặc retry, rồi test ném lại nguyên lỗi gốc. Nếu collector lỗi, chỉ báo lỗi evidence; không đổi kết quả assertion.

Artifacts: `E:/captone_backup/browser_runs/<run_id>/reset-failures/<UTC timestamp>-<unique id>/`. Có expected.png, actual.png, SHA-256, difference-x32.png (chỉ khuếch đại để xem), difference-regions.png, bounding box/pixel count và evidence.json. Không có tolerance mới hoặc sửa PNG gốc. Nếu kích thước khác nhau, ghi DIMENSION_MISMATCH, không tự resize.

Metadata browser được đọc sau FAIL và ghi rõ thời điểm; không được coi là state lúc chụp. Không có debugger pause, render hoặc lệnh camera. Camera/control/Pixel-controller riêng trong closure ghi NOT_OBSERVABLE nếu không có provider chỉ đọc đã được thiết lập. UI expression ID, pause, focus, canvas dimensions, DPR, theme và diagnostics hiện có vẫn được ghi. Provider `observeState` chỉ dành cho test chẩn đoán, không tạo API production.

Provenance có source/test hashes hiện tại, SHA các file diagnostic và bản sao attestation/SHA khi được cấu hình. Trong profile main, helper provenance vẫn xác minh server PID/interpreter/config thực tế. Đây là evidence, không phải calibration candidate hoặc receipt.

Fixture 6×4 cố ý khác một pixel phải làm chính assertion so hash thất bại; test ngoài chỉ PASS khi đã bắt được lỗi gốc và chứng minh collector không retry, không đổi buffer/hash. Không dùng fixture làm bằng chứng Reset production PASS.

Chỉ chạy `node --test helpers/reset_failure_evidence.test.js` và tag `@reset_evidence` cho kiểm tra collector. Test Reset thật có thể FAIL nguyên trạng; đọc raw result. Không training/validation hoặc sửa model để phục vụ collector.
