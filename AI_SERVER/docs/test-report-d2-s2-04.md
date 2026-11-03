# D2-S2-04 — TTS & Half-Duplex Playback Foundation

Ngày kiểm tra: 03/11/2026. macOS / Python 3.14.3. Chỉ thay đổi AI_SERVER.

## 1. Đã làm / chưa làm

Người dùng xác nhận **chưa chốt TTS Provider/model/voice/audio profile/queue
limits; chỉ làm interface + MockTTS**. Không tự kế thừa OpenAI làm TTS Provider
từ lựa chọn LLM ở Task 03, không gọi Cloud hoặc lấy key từ Backend.

Đã làm:

- TTSAdapter độc lập Provider, request chứa text đoạn, model/voice/language,
  audio format, session/turn scope; context dùng deadline/cancel Task 02.
- Streaming audio chunks typed: codec/rate/channels/sample format từ AudioMetadata,
  data_format riêng, sequence trong từng segment. Payload không xuất trong repr.
- MockTTS và MockAudioOutput riêng; không synthesis giọng nói, không phát loa.
- PlaybackScheduler: một synthesis producer và một output consumer chạy đồng
  thời, synthesize từng câu tuần tự, phát tuần tự; queue bound cả byte và chunk,
  backpressure thay vì drop audio hoặc tích buffer vô hạn.
- Reuse TextChunk.tts_safe/SentenceOutput Task 03; kiểm tra index và final text
  để từ chối duplicate/gap, unsafe text hoặc response incomplete. Không tự viết
  lại sentence segmentation hoặc đoán cụm nghĩa mới.
- Chuyển SPEAKING trước output.start/write; mic vẫn bị HalfDuplexTurn cũ chặn
  trước VAD/STT, không lưu để replay. Gửi hết audio không mở lại LISTENING.
- Bằng chứng completion tách khỏi finish/send, ràng buộc User/Session/Device/
  Turn/generation. Hiện chỉ chấp nhận proof mock-only; không chấp nhận tts.stop,
  queue drain/send success hoặc tự đặt tên một device ACK chưa được duyệt.
- Cancel/timeout/disconnect/output error hủy task, xóa queue, abort output và
  giữ session blocked; Provider trả chunk trễ bị loại trước queue/write.
- 43 test mới và demo tạo WAV tone giả; đã chạy regression thực tế.

Chưa làm: Cloud TTS adapter (chưa chọn Provider/model/voice/credential), conversion
Opus/profile robot, robot transport, playback ACK thật, recovery/drain policy và
Orchestrator runtime. Chỉ định nghĩa AudioConverter/AudioOutput để nối sau khi
contract được duyệt; **không tuyên bố conversion hoặc robot playback PASS**.

## 2. Files tạo/sửa

| File | Vai trò |
|---|---|
| `app/models/tts.py` | Config/limits bắt buộc, audio/request/scope/proof/receipt và typed errors |
| `app/services/tts.py` | TTSAdapter, AudioConverter, AudioOutput interfaces |
| `app/services/playback.py` | AudioQueue và PlaybackScheduler có backpressure/cleanup |
| `app/services/mock_tts.py` | MockTTS fixture stream, output sink/proof thủ công |
| `app/services/llm.py` | Đổi đúng một guard để stream hiện tại tiếp tục trong SPEAKING |
| `tests/test_tts.py` | 43 test cases, gồm ghép LLM streaming và half-duplex |
| `scripts/tts_mock_demo.py` | Tạo tone WAV, xem metadata/order/gating/proof offline |
| `README.md`, `AGENTS.md` | Hướng dẫn và bảng luồng foundation |
| `docs/test-report-d2-s2-04.md` | Báo cáo này |

Không viết lại AudioInput/STTAdapter/Turn Detection hoặc sửa chúng. Không thay
requirements và không thêm endpoint. Giữ nguyên công việc Task 02/02B/03 đã có.

Sửa guard LLM là cần thiết để ghép streaming: trước đó runner chỉ cho ongoing
stream ở PROCESSING; khi audio câu đầu chuyển SPEAKING, câu tiếp theo sẽ bị hủy.
Giờ chỉ **stream đã claim của cùng turn** được tiếp tục ở PROCESSING/SPEAKING.
Conversation.claim vẫn yêu cầu PROCESSING và conversation chưa có active turn,
nên request/turn mới trong SPEAKING tiếp tục bị từ chối. Có test tích hợp riêng.

## 3. Luồng hoạt động

```text
LLM ordered TextChunk(tts_safe=True) + final LLMResult
 -> PlaybackScheduler kiểm tra scope/index/text budget
 -> TTSAdapter.synthesize(segment) -> typed streaming audio
 -> bounded AudioQueue -> AudioOutput.start/write tuần tự
 -> AudioOutput.finish (chỉ đã gửi hết)
 -> wait_playback_complete (bằng chứng riêng)
 -> proof đúng scope -> đóng turn cũ -> PlaybackReceipt.ready_for_next_turn
```

Hiện TTSAdapter/AudioOutput trong demo/test đều là mock. Luồng nối tiếp tới robot
bị BLOCKED; không serialize message mới và không tự gửi tts.start/tts.stop.
Conversion Opus/profile chỉ được làm sau khi codec/framing/profile được xác nhận.

### Queue và backpressure

Caller bắt buộc cung cấp PlaybackLimits: max_queue_chunks, max_queue_bytes,
max_chunk_bytes, max_segments, max_text_chars, max_turns. Tất cả positive integers,
chunk phải fit queue. Không có production defaults. TTSConfig cũng bắt buộc model,
voice/language/audio format cụ thể, không chọn giúp caller.

Producer đợi khi queue đầy; chunk quá lớn bị reject. Chỉ có một segment đang
synthesize, không worker pool hoặc prefetch toàn bộ câu trả lời. Có thể mở rộng
parallel synthesis sau khi concurrency/ordering budgets được duyệt; task này
chọn tuần tự để không cần đoán thêm limits.

Queue bound áp cho payload đang chờ; ngoài queue có tối đa một chunk đang write
và một chunk producer đang giữ để put. Provider/output adapter tương lai cũng
phải giới hạn transport/prebuffer riêng; queue bound không bảo đảm SDK bên ngoài
không buffer. Text được giới hạn theo segment/char count và turn dedupe set cũng
bị giới hạn max_turns. Mock output lưu delivered chunks để test, không phải
implementation sink production hoặc bộ lưu audio.

### Half-duplex, proof và cancel

Scheduler giữ một session scope, caller phải tái sử dụng instance đó cho session
đã xác thực. Không phải global/distributed session registry. Không nhận key khác
hoặc duplicate turn ID. Audio nội bộ có generation mới mỗi lần; nó không phải
field wire protocol. Proof sai turn/generation/session bị reject.

`finish()` chỉ báo producer/output đã gửi hết. Trong khi chờ completion, turn
vẫn SPEAKING và mic bị drop. Proof mock hợp lệ đóng **turn cũ** thành CLOSED,
trả receipt cho Orchestrator cho phép tạo một turn LISTENING mới; không reset
detector cũ hoặc tự tạo turn. Khi chưa có proof, không nhận lượt playback mới.

Sau timeout/cancel/lỗi: cancel context, dọn queue/tasks, abort output, không trả
ready receipt; scheduler giữ blocked. Không suy timeout thành playback xong.
Chưa có recovery API cho scheduler blocked: cần policy stop/drain/verify thật
được duyệt. Restart hoặc dựng scheduler khác không phải bằng chứng loa đã dừng.

Future adapters phải hợp tác asyncio cancellation và cleanup hữu hạn. Không thể
thu hồi audio đã phát, hoặc bảo đảm physical stop nếu sink/firmware không có
abort/drain contract. LLM history đã complete ở Task 03 không tự rollback khi
playback lỗi; Orchestrator cần theo dõi trạng thái delivery riêng về sau.

Đọc lại firmware: application.cc nhận tts.stop rồi lên lịch đổi state; có
on_playback_drained callback nội bộ và notification progress riêng. Chưa xác
minh thông điệp ACK playback của voice stream gửi về AI Server. Callback nội bộ
không được coi là network ACK. Không sửa firmware trong task này.

## 4. Cách chạy trên macOS

Từ root repo, nếu chưa có môi trường:

```bash
cd AI_SERVER
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pip check
```

Không cần API key/env Cloud TTS để chạy mock. TTSConfig/PlaybackLimits được truyền
trực tiếp; không thêm config production mặc định hoặc biến tự bật Cloud. Các
giá trị fixture trong demo/test không phải lựa chọn codec/sample rate production.

```bash
.venv/bin/python scripts/tts_mock_demo.py
.venv/bin/python -m pytest tests/test_tts.py -q --tb=short
.venv/bin/python -m pytest tests/test_tts.py tests/test_llm.py -q
.venv/bin/python -m pytest tests -q --tb=short
.venv/bin/python scripts/run_dev.py
```

Terminal khác từ AI_SERVER:

```bash
curl -i http://127.0.0.1:8000/health
.venv/bin/python scripts/ws_client.py --message 'Xin chào AIVA'
```

Startup vẫn chỉ phục vụ endpoint cũ, không gọi TTS hoặc phát audio. Test TCP
regression kiểm tra startup/health/echo thật. Dừng server bằng Ctrl+C.

## 5. Demo đã chạy và audio test

Đã thực thi từ AI_SERVER:

```bash
/private/tmp/aiva-stt-task02-venv/bin/python scripts/tts_mock_demo.py
```

Script tự tạo `.test-artifacts/tts-mock-demo.wav` (ignored artifact): tone tổng
hợp 440 Hz, PCM signed 16-bit little-endian, 8 kHz mono, 20 chunk × 10 ms.
Đây **không phải speech synthesis hoặc firmware PCM wire**. Playback sink mock
không phát loa. TTS model/voice chỉ là nhãn mock-model/mock-voice.

Queue demo dùng 2 chunk, 320 byte total, 160 byte/chunk; 2 segment, 500 text
code points, 2 turn. Toàn bộ là budget giả, không được duyệt để áp production.

Output quan sát:

```text
Metadata: codec=pcm, sample_rate_hz=8000, channels=1, sample_format=s16le, data_format=raw
Order: [(0,0), ... (0,9), (1,0), ... (1,9)]
Sent all: phase=SPEAKING, playback_complete=False
Mic accepted during SPEAKING: False; mic buffer bytes=0
Explicit MOCK proof: source=mock-only; ready_for_next_turn=True; old_turn=CLOSED
Queue peak: chunks=2, bytes=320; remaining=0
```

Order ở trên viết gọn từ 20 entry thực tế. Sau khi output.finished, script chủ
động gọi mock confirm_complete(scope); không phải ACK nhận từ firmware.

Đã đọc WAV bằng Python wave: 1 channel, 8000 Hz, 2 byte/sample, 1600 frames,
3200 byte PCM data. Có thể kiểm tra lại mà không gọi Provider:

```bash
.venv/bin/python -c 'import wave; w=wave.open(".test-artifacts/tts-mock-demo.wav"); print(w.getparams()); w.close()'
```

File WAV chỉ giúp kiểm tra audio fixture/container. Nghe được tone trên máy tính
(nếu tự mở file) cũng không chứng minh Xiaozhi nhận/decode/phát đúng.

## 6. Kết quả test thực thi

Môi trường dùng venv Task 02 `/private/tmp/aiva-stt-task02-venv`, Python 3.14.3.
Không cài dependency mới. Lệnh pytest từ AI_SERVER trừ lần nhầm cwd ghi dưới.

| Kiểm tra | Kết quả |
|---|---|
| `python -m pytest tests/test_tts.py -q --tb=short` | PASS: 43 passed |
| TTS + LLM targeted trước hai case bổ sung cuối | PASS: 86 passed (41 TTS + 45 LLM) |
| `python -m pytest tests -q --tb=short` ngoài sandbox, có TCP loopback | FAIL: 278 passed, 1 failed |
| Demo mock + đọc metadata WAV | PASS |
| `python -m pip check` | PASS: No broken requirements found |
| `git diff --check` | PASS |
| Cloud TTS | BLOCKED: chưa duyệt Provider/model/voice và secret |
| Opus conversion/profile Xiaozhi | BLOCKED: chưa duyệt codec/profile/conversion |
| Firmware playback-complete ACK | BLOCKED: chưa có contract được xác nhận |
| Robot playback / physical stop/drain / speech quality | NOT RUN |

Một lần gọi targeted pytest nhầm từ root repo trả exit 4, no tests ran; đã chạy
lại đúng AI_SERVER và được 43 passed. Không tính lần nhầm cwd là PASS.

Full suite FAIL duy nhất vẫn là
`tests/test_protocol.py::test_firmware_snapshot_hashes_match_workspace_sources`:
thiếu `xiaozhi-esp32/managed_components/78__esp-ml307/idf_component.yml`.
Snapshot còn hai file dependency khác thiếu như Task 01/02/03 đã báo. Không
skip/sửa test để che lỗi hoặc tạo dependency firmware ngoài scope. Không tuyên
bố toàn bộ suite PASS. Echo TCP, AudioInput/STT/Turn Detection và LLM đều PASS.

Các nhóm test mới:

- Order (segment, chunk), metadata/data format và exact final text/index;
  duplicate/gap, unsafe/incomplete text, thiếu final và empty audio bị từ chối.
- Queue byte/count bounds độc lập, oversized rejection, producer backpressure;
  test slow sink trên toàn scheduler chứng minh queue không vượt cap.
- Lỗi Provider/output được chuẩn hóa, stream cleanup và không lộ raw payload
  trong error/repr. Không log audio hoặc secrets.
- Timeout/cancel/disconnect/task cancellation khi chờ proof; clear queue, không
  orphan tasks và không tự nhận turn mới sau abort.
- Provider trả chunk trễ sau cancellation không vào queue/output.
- Hai session riêng, proof sai session/generation, old proof không mở khóa turn
  mới; duplicate turn không tạo lại audio.
- Không nhận tts.stop/queue drain/send success làm proof. Trong SPEAKING mic
  bị chặn, buffer mic 0; finish gửi xong chưa làm task hoàn tất.
- LLM stream của cùng turn tiếp tục trong SPEAKING, request LLM mới vẫn reject;
  output đúng 3 chunk fixture, không lặp/mất segment trong ca ghép.

Mock PASS không phải Cloud TTS, codec decode hoặc robot playback PASS.

## 7. Vấn đề tồn đọng và bước tiếp theo

1. Duyệt TTS Provider/model/voice/language, output codec/container/rate/channels,
   secret delivery và production limits trước Cloud adapter. Không lấy key từ DB
   hoặc coi Backend credential reference là key; live test chỉ chạy khi được cấp
   credential hợp lệ theo contract.
2. Chốt input/output audio profile và codec conversion: PCM fixture 8 kHz không
   phải đề xuất profile robot. Cần adapter decode/resample/Opus encode/framing
   đúng contract; AudioConverter hiện chỉ là interface, không pass-through giả.
3. Dev 3 xác nhận playback-complete/abort/drain evidence cho voice stream, identity
   và turn binding. Không tự tạo message mới, không dùng tts.stop làm ACK.
   Sau đó mới thêm evidence loại thật và kiểm thử mic resume trên phần cứng.
4. Orchestrator giữ một scheduler mỗi trusted session, nối LLM/context, output,
   proof và conversation lifecycle; chỉ tạo LISTENING mới sau receipt hợp lệ.
   Recovery sau cancel/timeout phải được duyệt và xác minh output đã dừng.
5. Đánh giá cần parallel synthesis hay không; nếu cần, duyệt worker/prefetch/
   reorder budgets rồi bổ sung. Hiện streaming synthesis/phát được overlap nhưng
   synthesis giữa các segment cố ý tuần tự.
6. Khôi phục dependency snapshot cũ trong phạm vi được phép rồi chạy lại full
   suite. Unit/mock và echo đạt; nghiệm thu toàn suite và robot còn BLOCKED.
