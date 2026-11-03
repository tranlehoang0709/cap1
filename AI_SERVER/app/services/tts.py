"""Provider/output interfaces. Implementations must cooperate with cancellation."""

from collections.abc import AsyncIterator
from typing import Protocol

from app.models.tts import (
    AudioFormat, PlaybackEvidence, PlaybackScope, ScheduledAudio, TTSAudioChunk, TTSRequest,
)
from app.services.audio_context import AudioContext


class TTSAdapter(Protocol):
    def synthesize(self, request: TTSRequest, context: AudioContext) -> AsyncIterator[TTSAudioChunk]: ...


class AudioConverter(Protocol):
    """Reserved seam for APPROVED codec/profile conversion. No implementation yet."""
    def convert(self, chunk: TTSAudioChunk, target: AudioFormat,
                context: AudioContext) -> AsyncIterator[TTSAudioChunk]: ...


class AudioOutput(Protocol):
    async def start(self, scope: PlaybackScope, audio_format: AudioFormat, context: AudioContext) -> None: ...
    async def write(self, audio: ScheduledAudio, context: AudioContext) -> None: ...
    async def finish(self, scope: PlaybackScope, context: AudioContext) -> None:
        """Sending finished, NOT evidence of device playback completion."""
        ...
    async def wait_playback_complete(self, scope: PlaybackScope, context: AudioContext) -> PlaybackEvidence: ...
    async def abort(self, scope: PlaybackScope) -> None: ...
