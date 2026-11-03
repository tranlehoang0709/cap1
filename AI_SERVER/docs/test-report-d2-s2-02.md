# D2-S2-02 — Audio Input & STT Foundation

Ngày kiểm tra: 03/11/2026. Phạm vi thay đổi: chỉ `AI_SERVER/`.

## Căn cứ Task 01 và source hiện tại

- Runtime chỉ có `/health`, device-profile API và `/ws/dev-echo` local text;
  chưa có auth/session/heartbeat/robot schema hoặc pipeline AI được endpoint gọi.
- `xiaozhi-esp32/main/protocols/protocol.h` và
  `websocket_protocol.cc::SendAudio()` xác minh envelope v1 raw payload,
  v2 packed 16 byte (`!HHIII`), v3 packed 4 byte (`!BBH`), audio type 0,
  reserved 0. Không biết version robot thật; không tự chọn default.
- `GetHelloMessage()`/audio encoder mô tả Opus 16 kHz mono 60 ms upload.
  Điều này không chứng minh wire PCM hoặc định dạng input của provider STT.
- Backend route thật là `POST /internal/devices/authorize`; contract/gate còn
  chờ duyệt. `resolve-config` chỉ trả credential reference, không có secret
  delivery contract cho AI Server. Không gọi Backend hoặc bật bất kỳ gate nào.
- Snapshot firmware cũ có 12 file nguồn hiện diện khớp hash; ba dependency
  trong `managed_components/78__esp-ml307/` không có tại checkout.
  Không sửa firmware/generated dependency hoặc test snapshot để che vấn đề.

## Đã triển khai

| File | Interface / hành vi |
|---|---|
| `app/models/audio.py` | `AudioMetadata`, `AudioFrame`, `TranscriptionResult`, `AudioError`, `ErrorCode` |
| `app/protocol/audio_framing.py` | `FramingConfig`, `validate_audio_frame()`; version và limit bắt buộc |
| `app/services/audio_input.py` | `AudioInput`, `BoundedAudioInput`; single consumer, FIFO, frame/byte bounds |
| `app/services/audio_context.py` | `AudioContext`; absolute monotonic deadline, cancellation, task cleanup |
| `app/services/stt.py` | `STTAdapter`, `stream_transcription()`, `transcribe()`; typed results và safe errors |
| `tests/test_audio_foundation.py` | `MockSTT`, fixture envelope hợp lệ/sai, 72 test cases |

Không thay đổi router, Settings runtime, requirements hoặc hành vi echo. Không
thêm provider, model, API key, endpoint robot, codec decoder hoặc resampler.
`messages.py`/`validator.py` robot vẫn pending; framing utility độc lập không
biến tài liệu draft thành protocol runtime đã duyệt.

## Contract nội bộ và giới hạn

Caller tạo `AudioContext(deadline=...)`, metadata và input riêng cho một turn.
`AudioInput.read()` trả frame hoặc `None` khi EOF; `finish()` ngừng feed và drain;
`aclose()` hủy phần còn lại. Không dùng một input cho nhiều consumer/turn.
Context/input chỉ dùng trong một event loop. Metadata của input không thay đổi.
Cancel context xóa buffer ngay và đánh thức reader. Hết deadline được kiểm tra
trên thao tác; reader/STT đang đợi có timer, thao tác timeout đóng input.

Buffer từ chối overflow, không tự drop/retry hoặc chờ producer vô hạn. Giới hạn
byte là payload đang đợi; frame bound giới hạn overhead object. Transport tương
lai vẫn phải giới hạn toàn binary message trước khi ASGI materialize payload.
Framing nhận message đã ghép fragment, kiểm tra header/size/type/reserved trước
khi tách payload; không decode hay xác minh bitstream Opus. Type khác 0 hoặc
reserved khác 0 bị từ chối theo policy foundation dựa trên source sender,
chưa phải lời khẳng định về mọi extension firmware.

STT adapter có thể yield partials hoặc không; phải có đúng một final rồi EOF.
Empty final text được phép cho trường hợp không có speech. Exception provider
được chuẩn hóa thành lỗi cố định, không chứa exception message. Caller muốn
dừng iterator sớm phải dùng `contextlib.aclosing`. Adapter tương lai phải hợp tác
với cancellation và cleanup hữu hạn; asyncio không thể preempt code đồng bộ
block event loop hoặc adapter cố tình bỏ qua task cancellation.

Mock trả text cố định, không nhận dạng âm thanh. Fixture là envelope tổng hợp,
không phải recording hoặc Opus packet đã decode. Vì vậy PASS của mock không
được tính là STT thật, audio conversion hoặc robot compatibility PASS.

## Kiểm thử đã thực thi

Môi trường macOS, Python 3.14.3; venv tạm
`/private/tmp/aiva-stt-task02-venv`. Cài đúng `requirements-dev.txt`, không thêm
dependency vào repository. Dependency transitive theo resolver tại thời điểm chạy.
Lệnh pytest chạy từ `AI_SERVER/`.

| Lệnh / kiểm tra | Kết quả |
|---|---|
| `python -m pytest tests/test_audio_foundation.py -q` | **72 passed** |
| `python -m pytest tests -q --tb=short` ngoài sandbox, có TCP loopback | **146 passed, 1 failed** |
| `python -m pip check` | **PASS**, No broken requirements found |
| `git diff --check` | **PASS** |

Lần chạy trong sandbox trước đó bị chặn bind loopback: 118 passed, 4 failed,
12 errors (khi bộ mới còn 59 case). Đã chạy lại ngoài sandbox để xác minh TCP
thật; kết quả đầy đủ cuối cùng là 146 passed/1 failed nêu trên.

Lỗi duy nhất còn lại:
`tests/test_protocol.py::test_firmware_snapshot_hashes_match_workspace_sources`
FAIL do thiếu
`xiaozhi-esp32/managed_components/78__esp-ml307/idf_component.yml`.
Snapshot còn tham chiếu `include/web_socket.h`, `src/web_socket.cc` cũng thiếu.
Đây là phụ thuộc checkout đã ghi nhận ở Task 01, không phải test bị skip.
Không tuyên bố toàn bộ suite PASS và không khôi phục dependency ngoài phạm vi.

Các ca echo ASGI/TCP thật, client close-code, UTF-8/fragment/size/error và log
redaction hiện có đều PASS trong lần chạy đầy đủ ngoài sandbox.

## Ma trận nghiệm thu

| Tiêu chí | Kết quả |
|---|---|
| AudioInput/STT independently testable | PASS qua mock và protocol nội bộ |
| v1/v2/v3 framing, byte order, exact bounds | PASS fixture network-order độc lập |
| Truncated header, wrong version/type/reserved/length | PASS, typed rejection |
| Oversized actual/declared size, nonbinary, empty frame | PASS |
| Invalid metadata/result types, immutable metadata | PASS |
| FIFO, byte/frame bounds, drain/EOF, reject feed after finish | PASS |
| Hai input/mock độc lập | PASS |
| Deadline trước start, khi input/provider đợi, không reset bởi partials | PASS |
| Context/task cancellation, clear buffer, provider finally, không orphan task | PASS |
| Partial/final, thiếu hoặc trùng final, lỗi provider, early iterator close | PASS |
| Echo regressions qua TCP thật | PASS |
| Toàn bộ suite | CHƯA ĐẠT: 1 snapshot test FAIL do dependency thiếu |
| Real STT / Cloud / robot | NOT RUN, ngoài scope và còn blockers |

## Trước tích hợp STT thật

Cần người dùng/team duyệt provider/model, cách cấp secret an toàn và format
audio adapter yêu cầu (container/codec, rate, channel, sample format), sau đó
quyết định decoder/resampler và dependency phù hợp. Không tự lấy key từ DB,
không coi credential reference là key, không tự gán PCM wire cho firmware.

Robot integration còn cần xác nhận wire version, hello/profile, auth/provisioning
và endpoint. Không có robot endpoint mới trong task này.

Foundation đã triển khai và test mới/echo đạt; **chưa đủ điều kiện chốt DoD toàn
bộ suite** vì snapshot dependency thiếu. Cần khôi phục đúng dependency theo
snapshot trong một bước được phép trước khi nghiệm thu toàn bộ. Không tự push.
