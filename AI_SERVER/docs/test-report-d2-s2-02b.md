# D2-S2-02B — Turn Detection Foundation

Ngày kiểm tra: 03/11/2026, macOS / Python 3.14.3. Chỉ thay đổi `AI_SERVER/`.
Kế thừa Task 02; không viết lại AudioInput, AudioContext, STTAdapter hoặc framing.

## Chức năng và file đã làm

| File | Vai trò |
|---|---|
| `app/services/turn_detection.py` | Config, speech/transcript event types, TextRules, TurnDetector |
| `app/services/turn_input.py` | HalfDuplexTurn, TurnPhase, TurnEnded/TurnTimedOut |
| `tests/test_turn_detection.py` | 44 test cases, mock VAD/STT và timeline có nhãn giả |
| `README.md`, `AGENTS.md` | Cách cấu hình/chạy, bảng luồng foundation |
| `docs/test-report-d2-s2-02b.md` | Báo cáo này |

Không thay đổi các service nền Task 02, echo endpoint, router, requirements,
Backend gate, firmware, Frontend hoặc MySQL. Không dùng Cloud, LLM hay PhoBERT.

## Cấu hình đã được duyệt thử nghiệm

Người dùng xác nhận trong phiên làm việc:

| Tham số | Giá trị thử nghiệm | Biến cấu hình |
|---|---|---|
| min_silence_ms | 700 ms | AI_SERVER_TURN_MIN_SILENCE_MS |
| transcript_stability_ms | 300 ms | AI_SERVER_TURN_TRANSCRIPT_STABILITY_MS |
| max_turn_duration_ms | 15000 ms | AI_SERVER_TURN_MAX_DURATION_MS |

Đây **không phải thông số Xiaozhi chính thức**. `TurnDetectionConfig` bắt buộc
caller truyền đủ ba ngưỡng; `from_env()` cũng yêu cầu đủ, không fallback/default.
Loader không được gọi từ startup nên export biến không tự bật detector.
Có test biến thể silence 1000 ms theo đề nghị người dùng; chưa có kết quả robot
để khuyến nghị thay giá trị 700 ms hiện được duyệt thử nghiệm.

Luật ngôn ngữ là dependency bắt buộc. Test dùng terminal marks `. ? !` và đuôi
chưa hoàn chỉnh `và`, `nhưng`, `ừm`, `ờ`, `...`, `…`, `,`. Danh sách này chỉ là
fixture heuristic, chưa được duyệt cho production. Chuẩn hóa Unicode NFC,
casefold và whitespace; ưu tiên đuôi ngập ngừng/dang dở trước dấu kết câu.
Không có dấu kết câu hoặc bằng chứng không đủ -> UNKNOWN, không tự suy ra
COMPLETE từ STT final. Đây không phải parser ngữ pháp/ngữ nghĩa tiếng Việt.

## Luồng xử lý

1. Tạo một detector/input/context cho đúng một utterance, inject mock VAD và
   event sink đồng bộ của Orchestrator. Không tự reset hoặc tạo turn kế tiếp.
2. Khi mic tới, kiểm tra phase **trước VAD, STT input.feed và mọi queue**.
   PROCESSING/SPEAKING/CLOSED trả `False` và drop; không có buffer/replay queue.
3. Khi LISTENING, kiểm tra context và timeout. Frame được feed vào input nền;
   mock callback trả speech bool, sau đó detector cập nhật speech activity.
4. `SpeechActivity(False)` sau speech bắt đầu tính silence; thiếu event không
   được tự coi là silence. Transcript đổi nội dung làm reset stability; final
   có cùng text không reset và không được coi là lệnh END.
5. END chỉ khi đã có speech, VAD không active, đủ silence, text không rỗng/fresh,
   đủ stability và luật ngôn ngữ trả COMPLETE. Stable partial cũng có thể đủ;
   không bắt buộc chờ STT final để tránh vòng chờ final-sau-EOF.
6. END -> `input.finish()` để drain đúng input đã nhận -> PROCESSING -> emit
   `TurnEnded` đúng một lần, chứa text và cờ `transcript_is_final`. Duplicate,
   callback reentrant hoặc final tới muộn không tạo turn/event END mới.
7. Orchestrator tương lai gọi `speaking()` sau PROCESSING. Mic tiếp tục bị drop.
   Đóng/cancel bridge hủy context và dọn buffer/task STT bằng cơ chế Task 02.

Sau khi speech tiếp tục, transcript trước đó bị coi là stale cho tới khi có
update mới. VAD event tại đúng mốc silence được xử lý trước kết luận boundary
trong đường microphone; có test regression tránh END bằng VAD cũ ngay trước
khi nhận frame speech mới.

Clock event là monotonic milliseconds caller cấp; timestamp giảm, âm, NaN/Inf
bị từ chối. Không lấy trực tiếp wire timestamp làm clock này. Caller cần tick
định kỳ; khi cùng timestamp phải cập nhật speech activity trước tick/transcript
để không đánh giá trên VAD cũ. Không có timer/task nền tự chạy trong detector.

## Timeout/cancellation policy

- Im lặng dài nhưng câu ngập ngừng/không rõ: UNCERTAIN, tiếp tục chờ trong cùng
  turn cho tới khi có đủ bằng chứng hoặc timeout; không ép END.
- Tới 15000 ms: UNCERTAIN terminal, hủy input/context, emit `TurnTimedOut` một
  lần. **Không END dù đang speech**, không gọi LLM, không tự phát lại audio hoặc
  mở turn mới. Orchestrator tương lai phải báo timeout/cho phép thử lại rõ ràng.
  Đây là giới hạn tài nguyên theo policy foundation, không phải đoán người nói
  đã hoàn thành câu; utterance vượt giới hạn bị abort, không xử lý như câu đủ.
- Deadline của AudioContext hết trước: giữ AudioError(DEADLINE_EXCEEDED), hủy
  turn và cleanup; không đổi lỗi thành END. Cancel cũng không phát END.
- Event sink là callback inject, được đánh dấu phát trước callback để chống
  reentrant duplicate. Không có đảm bảo delivery bền vững/retry xuyên process;
  callback phải nhanh và Orchestrator phải chịu trách nhiệm khi sink lỗi.

## Lệnh đã chạy trên macOS

Venv đã có từ Task 02: `/private/tmp/aiva-stt-task02-venv`, đúng requirements-dev.
Từ root repo:

```bash
cd AI_SERVER
/private/tmp/aiva-stt-task02-venv/bin/python -m pytest tests/test_turn_detection.py tests/test_audio_foundation.py -q
/private/tmp/aiva-stt-task02-venv/bin/python -m pytest tests/test_turn_detection.py::test_synthetic_endpoint_metrics -q -s
/private/tmp/aiva-stt-task02-venv/bin/python -m pytest tests -q --tb=short
git diff --check
```

Full suite chạy ngoài sandbox vì các echo test cần bind TCP loopback thật.
Để chạy lại sau khi venv tạm không còn, tạo venv theo README và cài
`requirements-dev.txt`, rồi thay đường dẫn Python bằng `.venv/bin/python`.

## Kết quả thực thi

| Kiểm tra | Trạng thái | Bằng chứng |
|---|---|---|
| Test mới Turn Detection | PASS | 44 cases trong full suite |
| Turn Detection + foundation Task 02 | PASS | 116 passed |
| Mock STT ghép input.finish() | PASS | Chỉ nhận frame LISTENING, drain/EOF và cleanup |
| Echo regression ASGI/TCP thật | PASS | Tất cả case hiện có trong full suite |
| Full AI Server suite | FAIL | 190 passed, 1 failed |
| Snapshot firmware cũ | BLOCKED | Thiếu managed dependency, chi tiết dưới |
| git diff --check | PASS | Không lỗi whitespace |
| Opus decode/VAD/STT thật, robot, PhoBERT/LLM | NOT RUN | Không có triển khai hoặc lời gọi trong task |

Full suite FAIL duy nhất tại
`tests/test_protocol.py::test_firmware_snapshot_hashes_match_workspace_sources`,
FileNotFoundError với
`xiaozhi-esp32/managed_components/78__esp-ml307/idf_component.yml`.
Hai source dependency khác trong snapshot cũng thiếu như Task 01/02 đã ghi.
Không skip/sửa test, không tạo hoặc tải firmware dependency ngoài scope.
Do đó không tuyên bố DoD toàn suite PASS.

Các test mới bao gồm: câu hoàn chỉnh/ngập ngừng; silence ngắn/dài; final khi
đang nói; partial thay đổi; transcript stale sau resume; VAD tại boundary;
config 700/1000; no-speech; out-of-order/invalid time; timeout khi speech hoặc
silence; cancel/deadline; duplicate/reentrant END; không replay audio trong
PROCESSING/SPEAKING; mock STT cleanup không orphan task; isolation hai turn.

## Ví dụ input/output và đo trên mock

Timeline bên dưới là ms tương đối từ lúc tạo turn, không phải thời gian sleep:

| Input mock | Output |
|---|---|
| speech@0; partial `Bật đèn phòng khách.`@900; silence@1000; tick@1699 | WAIT |
| Cùng chuỗi trên, tick@1700 | END; finish input; một TurnEnded; PROCESSING |
| final hoàn chỉnh@100 khi VAD vẫn speech | WAIT |
| final `Tôi muốn...`@100; silence@200; tick@900 | UNCERTAIN, chưa finish input |
| Partial đổi text@1600 sau silence@1000; tick@1700 | WAIT vì stability chưa đủ |
| Cùng chuỗi trên, tick@1900 | END |
| speech vẫn active; tick/frame@15000 | UNCERTAIN; TurnTimedOut; cancel/clear input |
| Mic mới trong SPEAKING | False/drop; không gọi VAD, không feed STT |

Metric được tính bằng reference endpoint **gán nhãn giả** trong ba timeline:

```text
MOCK ONLY: early=0/3, post_sentence_wait_ms=[700, 900, 700], mean_ms=766.67
```

Tỷ lệ END trước reference = 0/3 (0% trên các fixture này). Thời gian chờ sau câu
= endpoint phát hiện trừ reference speech-end, gồm chờ stability và độ trễ tick.
Một test riêng tăng silence lên 1000 ms làm endpoint mẫu từ 1700 thành 2000 ms
(wait từ 700 thành 1000 ms). Không coi 0% hay 766,67 ms là chất lượng thực tế,
độ trễ STT hoặc benchmark tiếng Việt; ba fixture không đủ suy ra tỷ lệ cắt lời.

## Chưa thể kiểm chứng và bước tiếp theo

1. Chưa có Opus decoder/VAD thật: callback chỉ tạo bool giả từ fixture. Cần duyệt
   decoder/format, triển khai VAD rồi đo trên recording có nhãn và robot thật.
2. Thu mẫu câu hoàn chỉnh, ngập ngừng, nối mệnh đề, tự sửa câu, tiếng ồn và TTS
   echo. Đo END sớm/reference, phân phối wait và timeout rate; báo sample count,
   cấu hình, tick cadence và firmware build. Nếu cắt lời thường xuyên, A/B 700
   với 1000 ms theo yêu cầu người dùng; không tự áp thay đổi production.
3. Luật ngôn ngữ cần người dùng/team duyệt và đánh giá. Heuristic có thể sai cả
   khi câu có dấu chấm; mock PASS không chứng minh không cắt câu ngoài thực tế.
4. STT thật cần provider/model, secret delivery và audio conversion được duyệt.
   Không nối segment-final vào lifecycle EOF của Task 02: runner hiện đóng input
   khi adapter kết thúc. Cần thống nhất segment/utterance semantics; boundary
   có thể đến từ stable partial, sau đó STT drain/finalize trước LLM. Task này chỉ
   nhận mock transcript events và test reuse runner; không sửa STTAdapter.
5. Chưa có Orchestrator/robot endpoint/runtime integration; cần wiring state,
   scheduling VAD/ticks, timeout UX và event delivery theo contract được duyệt.
6. Khôi phục đúng snapshot dependency trong phạm vi được phép rồi chạy lại full
   suite. Foundation mới và echo PASS; nghiệm thu toàn bộ còn BLOCKED bởi lỗi cũ.
