"""Provider-independent STT adapter and deadline/cancellation orchestration."""

from collections.abc import AsyncIterator
from typing import Protocol

from app.models.audio import AudioError, ErrorCode, TranscriptionResult
from app.services.audio_context import AudioContext
from app.services.audio_input import AudioInput


class STTAdapter(Protocol):
    def transcribe(self, audio: AudioInput, context: AudioContext) -> AsyncIterator[TranscriptionResult]:
        """Yield zero or more partials, exactly one final, then end.

        Implementations must honor task cancellation, release provider resources
        in finally, and never disguise cancellation as a successful transcript.
        """
        ...


async def transcribe(adapter: STTAdapter, audio: AudioInput,
                     context: AudioContext) -> TranscriptionResult:
    """Collect a final result without retaining partials or creating a queue.

    Consumers needing partials use stream_transcription() and must close its
    iterator on early exit (e.g. contextlib.aclosing).
    """
    async for result in stream_transcription(adapter, audio, context):
        if result.is_final:
            final = result
    return final


async def stream_transcription(adapter: STTAdapter, audio: AudioInput,
                               context: AudioContext) -> AsyncIterator[TranscriptionResult]:
    stream = None
    final_seen = False
    try:
        context.check()
        stream = adapter.transcribe(audio, context)
        while True:
            try:
                result = await context.run(lambda: anext(stream))
            except StopAsyncIteration:
                break
            if not isinstance(result, TranscriptionResult) or final_seen:
                raise AudioError(ErrorCode.INVALID_TRANSCRIPT)
            final_seen = result.is_final
            yield result
        if not final_seen:
            raise AudioError(ErrorCode.INVALID_TRANSCRIPT)
    except AudioError:
        raise
    except Exception:
        raise AudioError(ErrorCode.PROVIDER_FAILED) from None
    finally:
        try:
            if stream is not None:
                close = getattr(stream, "aclose", None)
                if close is not None:
                    try:
                        await close()
                    except Exception:
                        raise AudioError(ErrorCode.PROVIDER_FAILED) from None
        finally:
            await audio.aclose()
