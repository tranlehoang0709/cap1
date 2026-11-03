# SD2 + Gemini: thử giọng nói trên LAN

SD1 = `xiaozhi-s3-tft`, SD2 = `aiva-iot-s3-st7789`. Hai mạch có thể dùng chung
AI_SERVER; hướng dẫn này thử SD2 trên COM3.

## File key

File đúng là `AI_SERVER/.env`, không phải `.evn`; file này bị Git bỏ qua.
API key Gemini chỉ nằm ở server. `AI_SERVER_ROBOT_TOKEN` là token LAN riêng cho
firmware, không được thay bằng API key Gemini. Mỗi biến chỉ có một dòng vì dòng
trùng phía cuối có thể ghi đè cấu hình trước đó.

```dotenv
GEMINI_API_KEY=
AI_SERVER_LLM_PROVIDER=gemini
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_STT_MODEL=gemini-3.5-flash-lite
GEMINI_TTS_MODEL=gemini-3.8-flash-tts
GEMINI_TTS_VOICE=Kore
AI_SERVER_HOST=0.0.0.0
AI_SERVER_PORT=8000
AI_SERVER_RELOAD=false
AI_SERVER_BACKEND_MODE=development-mock
AI_SERVER_ROBOT_ENABLED=true
AI_SERVER_ROBOT_AI_MODE=gemini
AI_SERVER_ROBOT_TOKEN=
AI_SERVER_ROBOT_ALLOWED_NETWORKS=["127.0.0.0/8","192.168.1.0/24"]
AI_SERVER_ROBOT_ENERGY_THRESHOLD=300
AI_SERVER_ROBOT_DEADLINE_SECONDS=90
```

Chế độ này dùng Gemini thật cho STT/LLM/TTS nhưng chưa tích hợp xác thực/quota
Backend vào media; không gọi đây là production/integrated. Theo lựa chọn người
dùng, câu trả lời dùng kiến thức mô hình, không bật tra cứu Internet.

## Server Windows

Cài `requirements-windows.txt` vào `.venv`, sau đó:

```bat
cd /d F:\cap1-dev2\AI_SERVER
.venv\Scripts\python.exe scripts\setup_windows_audio.py
run_server.cmd
```

PyOgg có DLL Opus trong Windows wheel theo [tài liệu dự án](https://github.com/TeamPyOgg/PyOgg).
Script setup ghi `AI_SERVER_OPUS_LIBRARY` vào `.env` và giữ nguyên key. DLL và
`.venv` không đưa vào Git. `run_server.cmd` giới hạn PATH của riêng tiến trình
server để tránh đường dẫn chương trình không truy cập được trên máy này.
Không chạy thêm server nếu cổng 8000 đã có dịch vụ. Sau khi sửa `.env`, khởi động
lại server. Health tại `http://127.0.0.1:8000/health` cần trả HTTP 200.
IP LAN đã kiểm tra là `192.168.1.95`; cập nhật URL/allowlist khi mạng đổi.

## Firmware và USB

Biến thể `aiva-iot-s3-st7789-dev-voice` bật WebSocket private, console USB và
thử nghiệm TX/DMA trên ESP-IDF 6.0.2. Biến thể `aiva-iot-s3-st7789` vẫn là bản
nạp/boot cơ bản. Giữ nguyên GPIO, không tự gán GPIO nút BOOT.

Trong môi trường ESP-IDF đã export:

```bat
cd /d F:\cap1-dev2\xiaozhi-esp32
python scripts\build.py custom/aiva-iot-s3-st7789 --name aiva-iot-s3-st7789-dev-voice --language vi-VN --wake-word disabled
idf.py -p COM3 -b 115200 flash
```

Sau khi firmware boot và kết nối Wi-Fi, mở CMD khác:

```bat
cd /d F:\cap1-dev2\AI_SERVER
.venv\Scripts\python.exe scripts\sd2_console.py configure --port COM3 --url ws://192.168.1.95:8000/ws/dev-robot
.venv\Scripts\python.exe scripts\sd2_console.py status --port COM3
.venv\Scripts\python.exe scripts\sd2_console.py record --port COM3 --seconds 5
```

`configure` gửi URL/token LAN/version vào NVS, chờ xác nhận rồi reboot để không
tái dùng kết nối cũ. Khi idle, `status` cần báo `state=3 ws_configured=1`.
`record` mở WebSocket và thu thủ công; nói gần micro khi được nhắc. Công cụ tự
gửi `stop` và chờ phát trả lời. Đóng Serial Monitor khác trước khi chạy.
Audio trong server giữ ở RAM, không lưu WAV hoặc transcript mặc định.

TTS gửi theo nhịp Opus 60 ms để tránh tràn hàng đợi giải mã firmware. Nhịp gửi
không thay thế playback proof: `playback.complete` vẫn cần đúng scope, số chunk
và bằng chứng TX/DMA từ driver.

## Kiểm tra 04/11/2026

- `.env`: bỏ cấu hình trùng, giữ nguyên key Gemini và token LAN riêng.
- Gemini LLM thật: PASS, phản hồi 805 ms, 5 input + 13 output tokens.
- HTTP health và WebSocket hello localhost/IP LAN: PASS.
- Firmware dev-voice: build và 5 vùng flash verify PASS.
- SD2 thật đã kết nối gateway và gửi audio tới Gemini STT, LLM, TTS.
- Tone mock cục bộ phát xong; server trở về LISTENING nhờ ACK thật từ SD2.
- Lần Gemini đầu đóng phiên lúc phát TTS; đã thêm pacing để không dồn đầy queue.
- Lần thử lại: SD2 thu âm, Gemini STT/LLM/TTS chạy thật, thiết bị bắt đầu phát;
  người dùng xác nhận nghe được âm thanh/câu trả lời. Sau đó provider trả
  `rate_limited` giữa lượt, nên chưa nghiệm thu câu trả lời trọn vẹn hoặc độ ổn
  định nhiều lượt. Không retry tự động, không chuyển provider để che lỗi quota.
- Bộ test server cuối: 507 PASS, 1 FAIL ở snapshot hash lịch sử đã lệch
  trước thay đổi này; giữ nguyên snapshot cũ, không ép hash để PASS.
- Firmware build/tài nguyên: 70 PASS. Hai test C++ host cũ thiếu compiler Windows.

Server Gemini đang chạy ở cổng 8000; gateway mock tạm cổng 8001 đã dừng. NVS SD2
đã trở lại endpoint Gemini cổng 8000. Không lưu API key, audio hoặc transcript
trong báo cáo này. Các bản sao `.env` và log chẩn đoán cục bộ trong
`.test-artifacts/` bị Git bỏ qua và có thể chứa metadata, không chia sẻ chúng.
