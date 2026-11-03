# D2-S2-05-FIX — Hardware readiness & playback completion

Ngày 03/11/2026, macOS / Python 3.14.3. **Software regression đạt; chưa DONE cho
hardware hoặc Cloud Voice.** Chỉ thay đổi AI_SERVER và xiaozhi-esp32; không sửa/
gọi Backend API, Frontend, Database; không commit/push hoặc flash.

## 1. Đã sửa và trạng thái còn lại

- Khôi phục nguyên archive chính thức `78/esp-ml307` 3.6.6 (50 members). Có
  checksum archive và từng file quan trọng trước extraction; không sửa nội dung
  vendor. Hai file `web_socket.h/.cc` khớp đúng hash snapshot lịch sử.
- Điều tra nguyên nhân snapshot FAIL: tám source đã thay đổi hợp lệ ở Task 05,
  ba file dependency thiếu; manifest lịch sử không khớp manifest registry.
  Giữ nguyên snapshot cũ; thêm baseline **source audit** mới có provenance.
  Snapshot PASS không xác nhận Dev 3 protocol, SDK build hoặc board thật.
- Thêm đường TX EOF proof thử nghiệm cho **NoAudioCodec**, giới hạn ESP-IDF
  **6.0.2** và flag riêng OFF mặc định. Không dùng delay, sample-rate estimate,
  software queue drain, tts.stop hoặc unconditional true làm completion.
- Sửa race AudioOutput: write đang đợi transport lock phải kiểm tra lại aborted/
  scope trước gửi; kiểm tra scope sau khi chờ proof. Cancel không lọt audio trễ.
- Sửa cleanup native encoder: vẫn close khi Provider stream.aclose() ném lỗi.
- Giữ nguyên Orchestrator/Scheduler, adapters còn lại, echo, private allowlist,
  token local, wire framing và context isolation đã PASS.

**BLOCKED:** build/ISR validation thật, xác minh hai board/serial/GPIO và kiểm
tra acoustic playback. Nhánh driver mới là code thử nghiệm, chưa bật; hiện cấu
hình mặc định vẫn không thể phát completion ACK trên robot. Không coi EOF mô
phỏng trong host test là callback nhận từ phần cứng.

## 2. Rà toàn bộ driver output

| Driver trong source | Đường ghi | Completion hiện tại |
|---|---|---|
| NoAudioCodec Simplex/Duplex/PDM | `i2s_channel_write`, 6 DMA descriptors, auto-clear | Có override thử nghiệm `on_sent`, flag OFF, SDK 6.0.2 |
| Es8311AudioCodec | `esp_codec_dev_write` | BLOCKED: chưa có concrete drain binding |
| Es8374AudioCodec | `esp_codec_dev_write` | BLOCKED |
| Es8388AudioCodec | `esp_codec_dev_write` | BLOCKED |
| Es8389AudioCodec | `esp_codec_dev_write`, có conversion riêng | BLOCKED |
| BoxAudioCodec | `esp_codec_dev_write` | BLOCKED |
| DummyAudioCodec | trả 0 | Không có hardware completion |

Các wrapper ES83xx/Box có đường Write trả `samples` ngay cả khi lỗi được log
hoặc output đang disabled; không được dùng con số này làm driver proof. Không
bật IsOutputDrained cho chúng. Cần bổ sung kiểm tra kết quả ghi và drain contract
của esp_codec_dev/underlying data interface trước khi triển khai proof tương tự.
Không sửa các driver không liên quan sang một implementation chung.

### Thiết kế NoAudioCodec mới

Bật có chủ ý cả `CONFIG_AIVA_DEV_VOICE=y` và
`CONFIG_AIVA_I2S_TX_DRAIN_PROOF=y`; flag thứ hai mặc định n, Kconfig chỉ S3.
Preprocessor chỉ biên dịch proof với đúng SDK 6.0.2. Version/driver khác giữ false.

1. `Start()` đăng ký callback `i2s_channel_register_event_callback` trước enable
   TX; thất bại đăng ký thì không bao giờ trả proof.
2. Trước mỗi Write, reset fence. Chỉ arm sau `ESP_OK` và đủ bytes. IRQ xảy ra
   trong lúc copy hoặc trước arm không được tính. Ghi thiếu/lỗi không arm.
3. Callback `on_sent` nhận **địa chỉ DMA buffer thực tế**. Theo dõi đủ sáu địa
   chỉ khác nhau sau lần ghi cuối, rồi yêu cầu đủ cả sáu xuất hiện lần nữa.
   EOF lặp của một buffer không thể thay thế buffer khác. Buffer lạ ở pass hai
   làm fence fail closed.
4. Source SDK 6.0.2 gọi on_sent trên descriptor TX EOF rồi auto-clear buffer
   trước khi đưa lại vào write queue. Với không có write mới, pass thứ hai
   chứng minh các buffer auto-cleared đã qua TX. Đây là suy luận kỹ thuật từ
   implementation SDK đã đọc, **còn phải xác nhận trên DMA/ISR thật**; không
   phải thời lượng audio ước tính hoặc acoustic proof của loa/amplifier.
5. Lock portMUX bảo vệ trạng thái task/ISR. Callback IRAM, state bounded, không
   allocate/log/chạy network trong ISR. BeginWrite hoặc disable TX xóa proof.
6. Application chỉ ACK nếu guard đồng thời có stop đúng scope/count,
   received=successful writes, software queues/in-flight đều hết và driver fence
   true. Generation guard cũ tiếp tục loại callback turn trước.

Có static_assert ràng buộc số descriptor với config NoAudioCodec (6); không
áp dụng thuật toán này cho driver có ring/auto-clear khác. Các constructor
NoAudioCodec đang dùng auto_clear_after_cb=true. App dùng sự kiện drain/clock
hiện có để poll, không mở task hoặc timer ước lượng thời gian phát mới. Poll clock
có thể thêm khoảng chờ tới một chu kỳ clock; chưa đo hardware latency.

Nguồn chính thức đã đối chiếu:
[SDK 6.0.2 i2s_common.c](https://github.com/espressif/esp-idf/blob/v6.0.2/components/esp_driver_i2s/i2s_common.c),
[I2S API](https://github.com/espressif/esp-idf/blob/v6.0.2/components/esp_driver_i2s/include/driver/i2s_common.h).

## 3. Snapshot và dependency provenance

Archive chính thức:
[ML307 3.6.6 registry](https://components.espressif.com/components/78/esp-ml307/versions/3.6.6/readme).

- Archive SHA-256: `6fc750a6dfe8e5723ea8884bb7f5296a3cc03d1f2d4226f742c4be860dc6e6d0`.
- Repository commit trong archive: `9f2a278ac6bf4ca3d6bc5057e8fcf10097cc583f`.
- `include/web_socket.h`: `89575b7197fdc66472571b97257284e92195f7506f10ca33e7adfeb4b7f7ab59` — khớp cũ.
- `src/web_socket.cc`: `b7709bfcc4db43e554b8f06d310553aa3663207935b06bef41bd98765517b852` — khớp cũ.
- Manifest registry: `0a57a79752066530dc83dc9744f248ffa9a4edfa9631430decd4beff04526dd1`.
- Manifest repository tại commit trên: `62663199f5b9e14629bead9e1026968f017815626d71f5e262939e9cf967acfe`.
- Manifest lịch sử: `966175e680e95f6f1700dd69136efbc9b65c6cfd2483752525ff58c0d84922b1`.
  **Nguồn chính xác của bytes manifest lịch sử UNKNOWN**: không khớp cả hai nguồn
  chính thức. Không tái tạo/sửa vendor để ép khớp hash này.

Dùng nguyên manifest registry có metadata repository_info; baseline mới ghi rõ
thay đổi này. Snapshot cũ `firmware-snapshot-d2-s1-05.json` giữ nguyên bytes/hash
`21dcd2c7e1083704385365298820c871767e96f4cd9283fc985f2cc8d0464930`.
Baseline mới kiểm tra 25 source/dependency files thay vì 15 cũ, có old/new hashes,
checksum parent và bằng chứng từng entry. Không skip test; snapshot test bây giờ
kiểm tra baseline source hiện hành và tính nguyên vẹn baseline lịch sử, báo hết
file thiếu/thay đổi thay vì chỉ dừng ở lỗi đầu tiên.

Chưa có `dependencies.lock` hoặc ESP-IDF active; chỉ khôi phục riêng ML307,
**chưa resolve toàn bộ transitive dependencies**. Manifest project vẫn là
`~3.6.6`; lần resolve SDK có thể chọn patch khác và snapshot sẽ báo drift đúng
nghĩa. Không tạo lock giả hoặc đổi các version dependency khác để ép test xanh.

Trên checkout mới, phục hồi bản đã xác minh bằng archive chính thức:

```bash
curl --fail --location --output /tmp/esp-ml307-3.6.6.zip \
  'https://components.espressif.com/api/downloads/?object_id=7e5cb124-dcbf-48f6-83de-d18e75069f4c&object_type=component'
python3 AI_SERVER/scripts/restore_firmware_dependency.py --archive /tmp/esp-ml307-3.6.6.zip
python3 AI_SERVER/scripts/audit_firmware_snapshot.py
```

Restorer từ chối archive sai checksum, zip traversal/symlink, extraction quá
budget hoặc ghi đè destination đã có. Không tự tải network hoặc sửa baseline.
`managed_components` vốn ignored nên không được commit/bundle vào source báo cáo.

## 4. Hai board và khả năng demo

Rà lại source vẫn có 148 board directories/179 variants; `custom/` chỉ một
`custom/xiaozhi-s3-tft`. Không có generated sdkconfig hay build log chọn board.

| Hạng mục | D1 | SD2 / custom |
|---|---|---|
| Display | ST7789 240×240 | ST7789 240×320 |
| SCK/MOSI/CS/DC/RST/BL | 42/41/NC/1/2/17 | 21/47/41/40/45/42 |
| Mic WS/BCLK/DIN | 4/5/6 | 4/5/6 |
| Speaker DOUT/BCLK/WS | 7/15/16 | 7/15/16 |
| Amplifier | NS4168 metadata | MAX98357A metadata/source description |
| Firmware profile | Chưa ánh xạ được | Có custom source, README pins provisional |
| Demo local không mạch | PASS qua client mô phỏng | PASS qua client mô phỏng |
| Demo mic/loa trên đúng mạch | BLOCKED | BLOCKED |

Các 1.54-inch profiles không khớp đủ GPIO D1. Zhengchen trùng SCK/MOSI và audio
nhưng RST45/DC40/CS21/BL20 khác D1. Nologo khác pins màn. Không tạo/sửa profile,
không thay ampli chỉ vì cùng kích thước màn hình. Cần sơ đồ revision đã xác
minh hoặc build config/board identity cũ và hai cổng serial được đối chiếu.

ESP-IDF chưa có trong PATH/IDF_PATH, `/Users/mac/.espressif`, `/Users/mac/esp`
và Homebrew esp-idf; không có generated sdkconfig/dependencies.lock. Các serial
hiện thấy không có mapping robot đã xác nhận. Không build/flash bằng port suy đoán.

Sau khi mapping và SDK được xác nhận, lệnh canonical cho **profile đang tồn tại**:

```bash
source /duong/dan/esp-idf/export.sh
cd xiaozhi-esp32
idf.py --version
python3 scripts/build.py --list-boards
python3 scripts/build.py custom/xiaozhi-s3-tft --name xiaozhi-s3-tft
```

Lệnh này chưa xác nhận profile đúng mạch, cũng không bật hai flags thử nghiệm.
Cần config development riêng cho board đã xác minh; không sửa config production
hoặc GPIO source chung. Build hai profile tuần tự hoặc hai checkout độc lập.
Chưa có lệnh cho D1 vì chưa có profile xác minh. Chỉ sau khi build đúng board,
đối chiếu chip/flash/partition/serial, mới dùng template:

```bash
idf.py -p "$CONFIRMED_PORT_FOR_CURRENT_BUILD" flash monitor
```

**NOT RUN:** build firmware S3, representative MQTT/UDP, flash, monitor, đo ISR,
audio capture/speaker/stop/drain/reconnect trên cả hai mạch. Không đặt hardware PASS.

## 5. Files mới/sửa của FIX

| Files | Vai trò |
|---|---|
| Firmware `main/audio/i2s_tx_drain_fence.h` | Bounded two-pass DMA EOF fence, không clock/delay |
| Firmware `main/audio/codecs/no_audio_codec.{h,cc}` | SDK-gated callback/Write fence/disable invalidation/driver query |
| Firmware `main/Kconfig.projbuild` | Experimental flag OFF, depends local voice/S3 |
| Firmware `scripts/tests/test_i2s_tx_drain_fence.py` | Compile/run state logic và ghép VoicePlaybackGuard trên host |
| `app/services/robot_transport.py` | Recheck cancel/scope sau lock/wait; finally-close encoder |
| `tests/test_robot_gateway.py` | Regression queued write cancellation và cleanup failure |
| `scripts/restore_firmware_dependency.py` | Offline checksum-verified nguyên archive restoration |
| `tests/test_dependency_restore.py` | Hash/extraction/no-overwrite/security tests |
| `scripts/audit_firmware_snapshot.py` | Read-only audit đủ mọi missing/changed file |
| `docs/firmware-snapshot-d2-s2-05-fix.json`, `tests/test_protocol.py` | Baseline nguồn mới có provenance, giữ lịch sử |
| Docs/README/AGENTS liên quan | Trạng thái hiện hành, command và giới hạn nghiệm thu |

Không viết lại/sửa Orchestrator hoặc PlaybackScheduler trong FIX. Backend files
đang dirty từ các task trước được giữ nguyên, không thuộc thay đổi FIX này.

## 6. Chạy AI Server và tests trên macOS

Không cần Backend, Cloud API key hoặc thiết bị thật cho regression/mock demo:

```bash
cd AI_SERVER
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
brew install opus  # chỉ khi chưa có libopus
.venv/bin/python -m pip check
export AI_SERVER_ROBOT_TOKEN="$(.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(32))')"
export AI_SERVER_ROBOT_ENABLED=true
export AI_SERVER_ROBOT_ENERGY_THRESHOLD=100
export AI_SERVER_RELOAD=false
export AI_SERVER_HOST=127.0.0.1
.venv/bin/python scripts/run_dev.py
```

Token chỉ là local-development secret; không ghi vào firmware source/Git/log.
Energy100 là fixture thử tone, không phải VAD production. Defaults thử nghiệm
silence/stability/max-turn vẫn 700/300/15000 ms, có env cấu hình. Gateway mặc định
OFF, allowlist chỉ loopback, không bật public bind/proxy/port-forward.

Terminal/client phải nhận cùng environment/token an toàn, không tạo token khác:

```bash
.venv/bin/python scripts/robot_mock_client.py
.venv/bin/python scripts/ws_client.py --message 'Xin chào AIVA'
.venv/bin/python -m pytest tests/test_robot_gateway.py tests/test_tts.py tests/test_orchestrator.py tests/test_protocol.py tests/test_dependency_restore.py -q --tb=short
.venv/bin/python -m pytest tests -q --tb=short
cd ../xiaozhi-esp32
python3 -m unittest discover -s scripts/tests -v
```

Demo vẫn scripted STT/LLM, tone TTS, Opus thật, hai client TCP và ACK mô phỏng;
không thay đổi thành Cloud hoặc robot success chỉ vì snapshot/full pytest PASS.

Lưu ý giới hạn fault injection: đường I2S Write vẫn giữ `portMAX_DELAY` của
legacy. Chưa chứng minh bounded physical abort khi DMA/clock bị treo; cần kiểm
tra trên SDK/hardware trước khi bật flag. Cancel của voice guard ngăn ACK turn
cũ, còn BeginWrite/disable xóa fence driver. Không tuyên bố thu hồi âm thanh đã
phát hoặc reset decoder đồng nghĩa DMA/amplifier đã dừng.

## 7. Kết quả thực thi

Môi trường tests: `/private/tmp/aiva-stt-task02-venv`. TCP loopback chạy ngoài
socket sandbox khi cần; không gọi Backend/Cloud.

- Targeted gateway/TTS/orchestrator/protocol/dependency: **106 PASS**, 12.75 s.
- Full regression trước bước format: **384 PASS**, 29.55 s. Kết quả cuối sau
  format/audit được ghi bổ sung bên dưới.
- Firmware host: **70 PASS** trước format, gồm C++ fence/guard; không build SDK.
- pip check và diff whitespace: PASS tại thời điểm chạy.
- SDK build/ISR/hai board xác minh: BLOCKED; physical flash/playback: NOT RUN.
- Cloud Voice: BLOCKED (STT/TTS chưa chọn đủ Provider/model/voice/secret; LLM chưa
  có credential delivery hợp lệ). Không gọi Provider hoặc lấy key từ Backend.

EOF host test kiểm tra no-event, events cũ trước arm, duplicate buffer, đủ một
pass vẫn chặn, đủ hai pass, partial/error write, wrong ring, disable/cancel,
independent instances và duplicate completion. Tất cả EOF là mô phỏng.

Khả năng thực hiện demo trên mạch vẫn phụ thuộc profile/GPIO/serial, toolchain,
Wi-Fi/NVS provisioning, callback IRAM/locking/hardware TX và acoustic tests.
Sau đó mới triển khai STT/TTS thật và cấu hình secret hợp lệ cho Cloud Voice.


### Kết quả cuối sau format và cập nhật source baseline

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `python -m pytest tests -q --tb=short` | **PASS: 384 passed, 24.72 s** |
| Targeted gateway/TTS/orchestrator/protocol/restorer | PASS: 106 passed, 12.75 s |
| `python3 -m unittest discover -s scripts/tests -v` | PASS: 70 tests, 15.255 s |
| `python scripts/audit_firmware_snapshot.py` | PASS: problems=[] |
| clang-format 23.1.3 trên vùng C++ vừa sửa / header mới | PASS: dry-run -Werror |
| `python -m pip check`, `git diff --check` | PASS |
| Build ESP-IDF/S3/MQTT, ISR thực tế | BLOCKED: SDK/board mapping chưa đủ |
| Flash/monitor/hai mạch/acoustic playback | NOT RUN |
| Cloud STT/LLM/TTS thật | BLOCKED |

Formatter được cài riêng trong `/private/tmp/aiva-fix-format-venv`, không thêm vào
runtime requirements hoặc format hàng loạt source có sẵn. Full suite không skip
snapshot/dependency test. PASS phần mềm không thay đổi trạng thái hardware/Cloud.
