# AGENTS.md

## Bắt đầu mỗi phiên làm việc

Đọc file này trước khi lập kế hoạch hoặc sửa dự án. Giữ tên chuẩn `AGENTS.md`
ở gốc repository để Codex nạp hướng dẫn khi mở phiên trong dự án.

1. Đọc bối cảnh, lộ trình và hai quy định bắt buộc bên dưới.
2. Kiểm tra `git status --short`, `git log -5 --oneline` và diff hiện tại;
   phân biệt công việc có sẵn của người dùng với thay đổi của phiên này.
3. Đọc `PROPOSAL_DOCUMENT.md` nếu có để hiểu phạm vi sản phẩm;
   `proposal_document.txt` và `C1SE40-Proposal_LET_ver1.1.docx` là các nguồn
   proposal khác đang có tại workspace. Các tài liệu này hiện chưa được Git
   theo dõi; không tự thêm chúng vào commit. Nếu thiếu hoặc mâu thuẫn, nêu rõ
   và dùng bản tóm tắt dưới đây làm bối cảnh, không tự suy đoán quyết định mới.
4. Đọc tài liệu kỹ thuật và `AGENTS.md` gần nhất của phần sắp sửa.
   Xác định yêu cầu, tiêu chí nghiệm thu và test cần viết/cập nhật trước khi sửa.
5. Xác minh tiến độ từ mã nguồn, lịch sử Git và kết quả test; không coi nội dung
   proposal hoặc kế hoạch là chức năng đã hoàn thành.

## Bối cảnh và kế hoạch phát triển

Mục tiêu theo proposal: xây dựng hệ sinh thái trợ lý AI giao tiếp bằng giọng
nói trên thiết bị Xiaozhi, có server riêng và quản trị tập trung.

| Phân hệ | Vai trò và công nghệ dự kiến |
| --- | --- |
| Thiết bị | ESP32, ưu tiên ESP32-S3; C/C++ và ESP-IDF; micro/loa I2S, wake word ngoại tuyến, màn hình tùy chọn, streaming và OTA |
| Realtime AI Server | Xác thực thiết bị; WebSocket hai chiều; Opus/PCM; điều phối ASR → LLM → TTS và trả âm thanh theo chunk |
| Backend quản trị | NestJS và PostgreSQL; JWT/RBAC, người dùng, ghép nối thiết bị, API key/quota, telemetry, cấu hình từ xa, lịch sử và OTA |
| Frontend | Next.js; Admin Dashboard và User Portal; quản lý thiết bị, giọng nói, system prompt và lịch sử tương tác |

**Hiện trạng kiểm tra ngày 2026-09-23:** repository này chứa firmware XiaoZhi
và công cụ build/test. Chưa thấy mã ứng dụng NestJS, Next.js hay AI Server
trong repository; chưa xác minh các repository bên ngoài. Chưa chốt board,
server endpoint hoặc thông tin triển khai cho hệ thống trong proposal.

Đã nhận sơ đồ phần cứng người dùng: ESP32-S3 N16R8, INMP441, MAX98357A,
loa 4 Ohm/2 W và TFT 2,4 inch được ghi là ST7789. Đọc
`docs/hardware-xiaozhi-s3.md` để tiếp tục xác nhận GPIO/nguồn/màn hình.
Đây là bản ghi chờ xác nhận, chưa có board firmware riêng và chưa thử thiết bị.

**Lộ trình theo proposal:**

- **V1 – Cloud AI:** hoàn thiện kết nối firmware với server riêng, streaming
  ASR/LLM/TTS dùng Cloud API; xây dựng web quản trị và các chức năng quản lý
  người dùng, thiết bị, khóa/quota, cấu hình, lịch sử và OTA.
- **V2 – Local AI:** thay dần provider bằng mô hình self-hosted; proposal nêu
  Faster-Whisper, Qwen/Llama qua vLLM/Ollama và Piper/ChatTTS như các lựa chọn.
  Dùng interface adapter để đổi provider không buộc sửa firmware hoặc web.
  Đánh giá Cloud/Local về độ trễ, chất lượng, tài nguyên và chi phí.
- Kế hoạch tổng thể là 3 sprint trong 3 tháng với 5 thành viên; proposal chưa
  chia chi tiết đầu việc theo sprint. Không tự ghi mốc dự kiến thành cam kết.
- Bước tiếp theo đề xuất: xác nhận board/variant và nơi đặt các phân hệ server,
  thống nhất contract xác thực/streaming, rồi nghiệm thu một luồng thoại V1
  xuyên suốt trước khi mở rộng. Đây là đề xuất, chưa phải tiến độ đã đạt.

Mục tiêu độ trễ end-to-end trong proposal là 1,2–2,0 giây, chưa phải số đo thực
tế; khi nghiệm thu phải ghi điểm bắt đầu/kết thúc đo và điều kiện thử.
Các yêu cầu xuyên suốt gồm reconnect khi mất mạng, phân quyền đúng chủ thiết
bị, bảo vệ API key/dữ liệu và thông báo trạng thái thu âm. Không đưa khóa AI
provider hoặc bí mật vào firmware, Git hay log. Giữ tương thích giao thức
firmware; không mặc định Socket.IO tương thích trực tiếp với WebSocket hiện có.

Cập nhật phần hiện trạng/lộ trình này trong cùng thay đổi khi có quyết định
kiến trúc, mốc đã nghiệm thu hoặc bước tiếp theo mới; ghi rõ bằng chứng và
việc còn chờ để phiên sau tiếp tục được ngay.

## Hai quy định bắt buộc cho mọi thay đổi

### 1. Mỗi thay đổi phải có commit Git tương ứng

- Mỗi đơn vị thay đổi hoàn chỉnh (tính năng, sửa lỗi, refactor, cấu hình hoặc
  tài liệu) phải có một commit riêng, bao gồm test và tài liệu liên quan.
  Không cần commit sau từng lần lưu file; không gộp các thay đổi độc lập.
- Trước commit: chạy kiểm thử/nghiệm thu, xem `git diff`, stage chính xác
  file/hunk của công việc, kiểm tra `git diff --cached` và
  `git diff --cached --check`. Không dùng `git add .` để gom công việc có sẵn.
- Tạo commit cục bộ ngay khi đơn vị thay đổi đã được xác minh, trước khi báo
  hoàn tất. Thông điệp phải nêu mục đích, ví dụ `docs: document project workflow`.
  Ghi mã commit trong báo cáo để truy vết/khôi phục; dùng `git revert <sha>`
  khi cần hoàn tác có lịch sử, không tự reset hoặc amend lịch sử cũ.
- Không tự push. Nếu Git bị chặn quyền, thiếu danh tính hoặc hook thất bại,
  báo đúng trở ngại và xử lý trong phạm vi được phép; không giả báo đã commit,
  không bỏ hook hoặc tự đổi danh tính để vượt lỗi.

### 2. Mỗi thay đổi phải viết/cập nhật test và nghiệm thu đạt trước bàn giao

- Viết hoặc cập nhật test liên quan trong cùng thay đổi. Với code, kiểm thử
  hành vi và hồi quy, gồm trường hợp thành công, lỗi và biên phù hợp; với
  tài liệu, viết/cập nhật ca kiểm tra nội dung, đường dẫn, lệnh và nghiệm thu.
  Không dùng test chỉ sao chép implementation hoặc luôn trả về thành công.
- Chạy toàn bộ bộ test hiện có của các phân hệ trong phạm vi bàn giao, cùng
  mọi kiểm tra build, tích hợp và nghiệm thu áp dụng ở mục Validation bên dưới.
  Sửa lỗi rồi chạy lại những kiểm tra bị ảnh hưởng; không xóa/bỏ qua test để đạt.
- Chỉ bàn giao với trạng thái **hoàn tất** khi tất cả test và tiêu chí nghiệm
  thu bắt buộc đều PASS. FAIL, SKIP hoặc chưa chạy không được tính là PASS.
- Nếu thiếu SDK, board, server, credential hay môi trường: ghi **chưa đủ điều
  kiện nghiệm thu**, liệt kê kiểm tra chưa chạy và điều kiện cần bổ sung.
  Có thể báo tiến độ, nhưng không tuyên bố công việc đã hoàn tất.
- Báo cáo bàn giao gồm: thay đổi, test đã viết/cập nhật, lệnh và kết quả kiểm
  thử, kết quả nghiệm thu, phần còn cần phần cứng và mã commit. Build thành
  công không thay thế nghiệm thu trên thiết bị thật.

## Project

XiaoZhi is an ESP-IDF C/C++ voice-assistant firmware supporting many chips, boards, displays, audio devices, and network transports. A build selects exactly one board implementation.

Use ESP-IDF v6.0.2 when possible. IDF 5.5.x is retained only for documented legacy boards.

## Architecture

- `main/application.*`: main event loop, protocol lifecycle, and high-level behavior.
- `main/device_state_machine.*`: legal runtime state transitions.
- `main/boards/common/`: board interfaces and reusable hardware/network helpers.
- `main/boards/**/`: board-specific pins, initialization, and build variants.
- `main/audio/`: codecs, audio tasks, engines, wake words, and queues.
- `main/protocols/`: transport-neutral API plus WebSocket and MQTT/UDP.
- `main/display/` and `main/led/`: reusable UI implementations.
- `main/mcp_server.*`: common device-side MCP tools and dispatch.
- `main/Kconfig.projbuild`: board and feature configuration.
- `main/CMakeLists.txt`: source, board, locale, font, and asset selection.
- `scripts/build.py`: canonical board/variant build entry point.

Read the closest existing implementation before adding a new one. Prefer the narrowest owning layer; do not put board-specific behavior into core modules.

## Required Rules

- Preserve unrelated worktree changes and keep patches focused.
- A build must export exactly one board factory through `DECLARE_BOARD(...)`.
- Never alter an existing board's pins to support different hardware. Add a uniquely named board or release variant; board identity affects OTA compatibility.
- Core code depends on `Board` interfaces, never a concrete board class or board `config.h`.
- Treat camera, backlight, display, LED, battery, and similar capabilities as optional.
- Change runtime state through `Application::SetDeviceState()` and the state machine.
- Callbacks may run outside the main task. Schedule application mutations with `Application::Schedule()` or event bits.
- Do not block the main event loop or audio tasks. Avoid unbounded queues and repeated large allocations in audio paths.
- Keep shared message semantics in `Protocol`; verify both transports when changing its contract.
- Validate network input and preserve `cJSON` ownership. NVS keys are persistent API and require migration when changed.
- Guard target-specific features with Kconfig/component rules. Do not assume every target has PSRAM or S3/P4 resources.
- Do not manually edit generated/vendor output: `build/`, `releases/`, `managed_components/`, `components/`, `sdkconfig*`, `main/assets/lang_config.h`, or generated mmap headers.
- Format only touched C/C++ files with the repository `.clang-format`; avoid unrelated mass formatting.

## Boards and Configuration

Board selection is a coupled chain:

`config.json` -> `scripts/build.py` -> `main/Kconfig.projbuild` -> `main/CMakeLists.txt` -> board source and `config.h`.

When adding a board or variant, update every relevant link in that chain. Include a unique board identity, correct chip target, flash/partition settings, exactly one `DECLARE_BOARD`, and board documentation. Follow `docs/custom-board.md`.

## Commands

Source the intended ESP-IDF environment first:

```sh
source /path/to/esp-idf/export.sh
idf.py --version
```

```sh
# Discover exact board and variant names
python3 scripts/build.py --list-boards

# Canonical variant build
python3 scripts/build.py <board-directory> --name <variant-name>

# Host-side build tests
python3 -m unittest discover -s scripts/tests -v

# Format/check touched files
clang-format -i <files>
clang-format --dry-run -Werror <files>
```

The build script changes local `sdkconfig` and build state. Do not assume the build directory still represents a previous target.

## Validation

- Board-only change: build affected variants and smoke-test changed hardware.
- Core, common-board, audio, protocol, display, dependency, Kconfig, or CMake change: run host tests and build representative affected chip/network paths.
- Protocol changes: verify WebSocket and MQTT/UDP when shared behavior changes.
- Audio changes: verify capture, playback, wake/VAD, interruption, reconnect, and applicable AEC modes.
- UI/assets changes: verify applicable no-display/OLED/LVGL paths and partition size.
- Always report what was tested and what still needs physical hardware. A successful build is not hardware validation.

## Authoritative Documentation

- Overview and SDK policy: `README.md`
- SDK compatibility: `docs/esp-idf-6-migration.md`
- Board guide: `docs/custom-board.md`
- Audio design: `main/audio/README.md`
- Code style: `docs/code_style.md`
- Protocols: `docs/websocket.md`, `docs/mqtt-udp.md`, `docs/mcp-protocol.md`
- CI matrix: `.github/workflows/build.yml`

Keep detailed or fast-changing information in those files, not here. Add a nested `AGENTS.md` only when a subsystem needs specialized instructions.
