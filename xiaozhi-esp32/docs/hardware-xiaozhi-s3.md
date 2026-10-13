# Phần cứng Xiaozhi của dự án

Nguồn: ảnh sơ đồ người dùng gửi trong phiên ngày 2026-09-23. Đây là bản
chép thông tin từ ảnh, chưa phải cấu hình board có thể build/nạp.
Ảnh gốc chưa được lưu thành file trong repository.

## Linh kiện được ghi trên ảnh

| Thành phần | Thông tin trên sơ đồ |
| --- | --- |
| Board | ESP32-S3 N16R8; cần xác nhận tên/mã dev board và revision |
| Micro | INMP441, giao tiếp I2S |
| Khuếch đại loa | MAX98357A |
| Loa | 4 Ohm, 2 W |
| Màn hình | TFT 2,4 inch; chú thích ST7789; PCB ghi SPI 240×320 |

## Kết nối chờ xác nhận

Không dùng các giá trị dự kiến dưới đây để nạp firmware khi chưa đối chiếu
với nhãn chân và dây trên mạch thật. GPIO là số IO, không phải số thứ tự chân.

| Module | Tín hiệu | Đọc sơ bộ từ ảnh | Trạng thái |
| --- | --- | --- | --- |
| INMP441 | WS | GPIO4 | Chờ xác nhận |
| INMP441 | SCK | GPIO5 | Chờ xác nhận |
| INMP441 | SD | GPIO6 | Chờ xác nhận |
| INMP441 | L/R | Có vẻ nối GND | Chờ xác nhận chọn kênh |
| INMP441 | VDD, GND | Có đường nguồn và mass | Cần xác nhận rail nguồn |
| MAX98357A | DIN | GPIO7 | Chờ xác nhận |
| MAX98357A | BCLK | GPIO15 | Chờ xác nhận |
| MAX98357A | LRC | GPIO16 | Chờ xác nhận |
| MAX98357A | VIN, GND | Có đường nguồn và mass | Cần xác nhận rail nguồn |
| MAX98357A | SD/EN, GAIN | Chưa rõ cách nối | Cần xác nhận |
| Loa | Hai dây loa | Đến hai đầu ra loa của MAX98357A | Chưa kiểm tra thực tế |
| TFT | SCK, SDI/MOSI, CS, DC, RESET, LED/BL | Có dây nối sang ESP32 | Nhãn GPIO chưa đủ rõ để chốt |
| TFT | VCC, GND | Có đường nguồn và mass | Cần xác nhận rail nguồn |
| TFT | SDO/MISO, touch và SD card | Chưa thấy dây sử dụng trong ảnh | Cần xác nhận có dùng không |

Tham khảo gần nhất: `main/boards/bread-compact-wifi-lcd/config.h` có cùng
mapping audio dự kiến. Điều này không xác nhận mapping trên mạch thật.
Không lấy mặc định GPIO màn hình của board tham khảo để thay cho sơ đồ.

## Thông tin cần bổ sung trước khi tạo board

1. Mã dev board/revision, xác nhận module N16R8 và mạch thực đã đấu đúng ảnh.
2. Bảng GPIO từng tín hiệu ở trên, các rail 3V3/5V/GND, cách nối SD/EN và GAIN.
3. Mã/link module màn hình để xác nhận controller ST7789, độ phân giải,
   IPS hay không; muốn hiển thị ngang hay dọc; có dùng touch/thẻ nhớ không.
4. Dùng nút BOOT có sẵn để thao tác hay nút ngoài; GPIO của nút ngoài nếu có.
5. Khi nạp: cổng USB đang dùng, cổng COM và môi trường ESP-IDF.
   Khi nối dịch vụ: server mặc định hay server riêng; nếu riêng cần URL OTA,
   WebSocket/MQTT và cơ chế xác thực. Không ghi credential vào tài liệu/Git.

Sau xác nhận, tạo board/variant có identity riêng theo `docs/custom-board.md`,
cập nhật đủ config.json, Kconfig và CMake; không sửa pins của board hiện có.

## Ca kiểm tra và nghiệm thu

| ID | Kiểm tra | Điều kiện đạt | Trạng thái hiện tại |
| --- | --- | --- | --- |
| D01 | Đối chiếu danh sách linh kiện với ảnh | Giữ đúng tên/nhãn ảnh; thông tin chưa rõ đánh dấu chờ xác nhận | PASS |
| D02 | Rà soát mapping | Mọi chân suy luận có trạng thái chưa xác nhận; không tạo cấu hình nạp từ suy đoán | PASS |
| D03 | Kiểm tra tài liệu tham khảo | File config.h và hướng dẫn custom board tồn tại | PASS |
| H01 | Đối chiếu chân/nguồn với mạch thật | Người dùng xác nhận đầy đủ bảng kết nối | Chưa chạy |
| H02 | Build board riêng | Đúng target, flash/PSRAM, partition; một DECLARE_BOARD; build thành công | Chưa có cấu hình |
| H03 | Thử thiết bị | Boot, thu/phát âm, wake word, màn hình/nút, mất mạng/reconnect và OTA đạt | Chưa chạy |

D01–D03 chỉ nghiệm thu bản ghi tài liệu. Chưa đủ điều kiện nghiệm thu firmware
hoặc phần cứng; không coi bản ghi này là firmware sẵn sàng nạp.
