"""Text-only Local speech pipeline seam; it never performs playback or routing."""
from collections.abc import AsyncIterator
from uuid import uuid4

from app.core.llm_config import LLMSettings
from app.models.llm import ConversationKey, LLMRequest, Message, ProviderDelta, ProviderDone
from app.services.stt import transcribe


class LocalSpeechPipeline:
    def __init__(self, *, stt, llm, llm_settings, system_prompt: str):
        self.stt = stt
        self.llm = llm
        self.llm_settings = llm_settings
        self.system_prompt = system_prompt

    async def stream(self, audio, context, *, key: ConversationKey,
                     history: tuple[Message, ...]) -> AsyncIterator[ProviderDelta | ProviderDone]:
        transcript = await transcribe(self.stt, audio, context)
        if not transcript.text.strip():
            return
        model = await self.llm.discover_model()
        config = LLMSettings(_env_file=None, model=model,
            max_output_tokens=self.llm_settings.max_output_tokens,
            max_output_chars=self.llm_settings.max_output_chars)
        request = LLMRequest(key, uuid4().hex, transcript.text, self.system_prompt,
                             history, config)
        async for event in self.llm.stream(request, context):
            yield event
