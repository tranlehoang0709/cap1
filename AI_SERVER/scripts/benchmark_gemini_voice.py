"""Live latency benchmark for sentence-streamed Gemini voice turns.

Runs only in explicitly enabled development-mock diagnostics; this is not an
integrated-mode path and never substitutes fixtures for live results.
"""

import argparse
import asyncio
import math
import statistics
import sys
import time
import tracemalloc
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.llm_config import LLMSettings  # noqa: E402
from scripts.interactive_voice_demo import load_live_adapters, new_session, process_question  # noqa: E402
from app.services.llm import LLMRunner  # noqa: E402


CASES = {
    "short": "Xin chào, bạn có thể giúp tôi không?",
    "knowledge": "Vì sao bầu trời có màu xanh?",
    "explanation": "Giải thích ngắn gọn nguyên lý hoạt động của pin lithium-ion.",
}


def summarize(values):
    ordered = sorted(values)
    return {
        "median": round(statistics.median(ordered)),
        "p95": round(ordered[max(0, math.ceil(.95 * len(ordered)) - 1)]),
        "min": round(ordered[0]),
        "max": round(ordered[-1]),
    }


async def run(runs: int) -> int:
    llm, model, tts, settings, timeout = load_live_adapters()
    try:
        runner = LLMRunner(LLMSettings(model=model))
        tracemalloc.start()
        total_turns = 0
        failed_turns = []
        all_metrics = {}
        sample_counts = {}
        for group, question in CASES.items():
            collected = {name: [] for name in ("llm_ttft", "llm_total", "tts_first", "tts_total", "ttfa", "total")}
            for index in range(runs):
                key, conversation = new_session(user_id=f"benchmark-{group}")
                before = time.perf_counter()
                try:
                    result = await process_question(question, llm=llm, tts=tts, runner=runner,
                        conversation=conversation, key=key, llm_model=model, tts_settings=settings,
                        llm_timeout_seconds=timeout, output_dir=ROOT / "artifacts" / "benchmark",
                        export_wav=False)
                except Exception as error:
                    code = getattr(error, "code", None)
                    stage = getattr(error, "stage", "unknown")
                    safe_code = getattr(code, "value", code) or "provider_error"
                    failed_turns.append((group, index + 1, stage, safe_code))
                    print(f"LIVE FAIL {group} {index + 1}/{runs}: stage={stage}, code={safe_code}; no retry",
                          flush=True)
                    continue
                assert result.total_ms <= (time.perf_counter() - before) * 1000 + 1000
                collected["llm_ttft"].append(result.llm_ttft_ms)
                collected["llm_total"].append(result.llm_ms)
                collected["tts_first"].append(result.tts_first_audio_ms)
                collected["tts_total"].append(result.tts_ms)
                collected["ttfa"].append(result.time_to_first_audio_ms)
                collected["total"].append(result.total_ms)
                total_turns += 1
                print(f"LIVE {group} {index + 1}/{runs}: LLM_TTFT={result.llm_ttft_ms}ms, "
                      f"first_audio={result.time_to_first_audio_ms}ms, total={result.total_ms}ms, "
                      f"tokens={result.usage.total_tokens}", flush=True)
                del result
            all_metrics[group] = {metric: summarize(values) for metric, values in collected.items() if values}
            sample_counts[group] = len(collected["total"])
        _, peak = tracemalloc.get_traced_memory()
        complete = total_turns == runs * len(CASES) and not failed_turns
        print(f"{'LIVE PASS' if complete else 'LIVE INCOMPLETE'}: {total_turns}/{runs * len(CASES)} real Gemini turns; "
              f"failed={len(failed_turns)}; Python peak traced memory={peak / (1024*1024):.2f} MiB")
        for group, metrics in all_metrics.items():
            print(f"{group} ({sample_counts[group]}/{runs}): {metrics}")
        return 0 if complete else 1
    except Exception as error:
        code = getattr(error, "code", None)
        stage = getattr(error, "stage", "unknown")
        print(f"LIVE FAIL: {type(error).__name__}; stage={stage}; "
              f"code={getattr(code, 'value', code) or 'provider_error'}", flush=True)
        return 1
    finally:
        tracemalloc.stop()
        await llm.aclose()
        await tts.aclose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--enable", action="store_true", help="Explicitly permit real Gemini requests")
    parser.add_argument("--runs", type=int, default=5, help="Live runs per group; minimum five")
    args = parser.parse_args()
    import os
    if not args.enable or os.getenv("AI_SERVER_GEMINI_BENCHMARK_ENABLE", "").lower() != "true":
        print("BLOCKED: requires --enable and AI_SERVER_GEMINI_BENCHMARK_ENABLE=true")
        return 2
    if args.runs < 5 or args.runs > 10:
        print("BLOCKED: --runs must be between 5 and 10")
        return 2
    return asyncio.run(run(args.runs))


if __name__ == "__main__":
    raise SystemExit(main())
