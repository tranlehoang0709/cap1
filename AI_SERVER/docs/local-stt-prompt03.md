# Prompt 03 — Local Vietnamese speech-to-text

## Selected engine and model

The primary engine is `faster-whisper==1.2.1` with CTranslate2 4.9.0 on CUDA,
using `Systran/faster-whisper-small`, float16, language `vi`, beam size 5.
CTranslate2 detected one CUDA device on the RTX 4060 Ti 16 GB and both model
load and inference succeeded on Python 3.14/Windows.

The multilingual small model was selected as the conservative first deployment:
it supports Vietnamese while leaving substantially more GPU memory for the
running Gemma server than large-v3. Its local cache occupies 463.7 MiB. Actual
Vietnamese accuracy was not accepted because no real Vietnamese recording was
available. whisper.cpp was therefore not selected or installed.

## Audit and data path

The robot media contract is raw Opus, mono, 16 kHz, 60 ms frames. `OpusCodec`
already decodes packets to PCM16 little-endian. `BoundedAudioInput` owns the
bounded per-turn buffer and cancellation. The current live robot path uses an
explicit firmware `listen.stop` boundary; its speech callback always returns
active. The generic `RobotSettings` source default remains 700 ms and was not
changed. Local faster-whisper uses its reviewed 2000 ms minimum-silence VAD
setting, satisfying Prompt 03 without modifying gateway behavior or firmware.

The implemented seam is:

```text
raw Opus → OpusCodec.decode → mono PCM16 → resample 16 kHz
         → LocalSTTAdapter → TranscriptionResult(vi)
         → LocalSpeechPipeline → LlamaServerAdapter/Gemma
```

`LocalSpeechPipeline` stops on empty transcription and therefore does not call
Gemma for silence. It accepts the existing `ConversationKey` and history; it
does not invent identity, persist a transcript, expose a new route, alter the
WebSocket protocol, or perform TTS.

All audio remains in bounded byte arrays/NumPy memory. Runtime uses
`local_files_only=True`; it cannot download a model during startup. Model
construction is guarded by a process-wide cache and occurs once per
model/device/compute configuration. Synchronous inference runs in a worker
thread so the event loop retains cancellation/deadline control. Raw audio,
transcripts and provider errors are not logged.

## Dependencies and model storage

Direct dependency added:

- `faster-whisper==1.2.1`

Installed transitive runtime versions include CTranslate2 4.9.0, NumPy 2.5.4,
PyAV 19.0.2, ONNX Runtime 1.32.0, tokenizers 0.23.3 and Hugging Face Hub 2.4.0.
`pip check` reports no broken requirements.

Model cache:

```text
C:\Users\troc\.cache\huggingface\hub\models--Systran--faster-whisper-small
```

The cache is outside Git and measured 463.7 MiB. Configuration rejects a model
cache located inside `AI_SERVER`.

## Runtime configuration

```dotenv
LOCAL_STT_ENGINE=faster-whisper
LOCAL_STT_MODEL=Systran/faster-whisper-small
LOCAL_STT_CACHE_DIR=C:\Users\troc\.cache\huggingface\hub
LOCAL_STT_DEVICE=cuda
LOCAL_STT_COMPUTE_TYPE=float16
LOCAL_STT_LANGUAGE=vi
LOCAL_STT_TIMEOUT_SECONDS=30
LOCAL_STT_VAD_MIN_SILENCE_MS=2000
```

Start Local AI as before:

```powershell
& .\AI_SERVER\run_local.cmd
```

`/health` reports Local STT engine/model/language readiness independently from
LLM and TTS readiness.

## Validation — 2026-11-14

1. **PASS — model load:** CUDA model loaded from local-only cache.
2. **BLOCKED — real Vietnamese PCM:** no real Vietnamese recording was found or
   supplied. Unit contract coverage uses a fixture and is not an E2E claim.
3. **BLOCKED — real speech Opus → PCM → STT:** codec integration is tested, but
   no real Opus speech recording was available.
4. **BLOCKED — accented Vietnamese output from real voice:** same missing audio.
   UTF-8 `TranscriptionResult` handling passes unit coverage only.
5. **PASS — silence:** one second of actual zero PCM ran on CUDA in 134.6 ms,
   returned zero segments; adapter silence guard returns an empty final result
   without calling the LLM.
6. **PASS — invalid audio:** odd-length PCM and codec failures become safe typed
   audio errors without payload logging.
7. **PASS — resource measurement:** standalone loaded/inferred process measured
   232.8 MiB working set and 1251.6 MiB private memory. Total GPU use rose from
   about 1042 MiB to 1726 MiB (approximately 684 MiB attributable during the
   STT measurement).
8. **PASS — coexistence capacity:** with llama-server running, GPU still had
   14384 MiB free during the STT measurement. This establishes memory headroom,
   not concurrent generation throughput.
9. **BLOCKED — real STT → Gemma:** Prompt 02 llama-server `/v1/models` still
   requires the missing configured API key; no real transcript was available.
10. **PASS — no Cloud STT:** Local imports and factory path do not construct
    Gemini/OpenAI STT; no fallback exists.
11. **PASS — Cloud isolation:** Cloud 8000 and Local 8002 started together.
    Local health reported STT READY while Cloud health remained unchanged.

Focused verification: 140 tests passed across Local STT/runtime/chat,
provider-neutral LLM, audio input and native Opus. Python compilation,
`pip check`, and `git diff --check` passed.

No audio file is written at runtime. No Backend, Frontend, MySQL, firmware,
gateway routing, TTS, PA feature, Gemini/OpenAI probe, commit or push occurred.

## Prompt 04 boundary

Prompt 04 still needs a real Vietnamese speech recording or authorized live
microphone capture for accuracy/latency acceptance, plus the configured Local
LLM API key for real STT→Gemma verification. Local TTS and robot gateway routing
remain unimplemented and Local voice remains NOT_READY.
