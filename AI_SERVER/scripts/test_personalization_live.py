"""Explicit Gemma-only H-06 probe; no fake memory records, writes or report files."""
import asyncio
from pathlib import Path
import sys
import time

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.clients.local.llama import LlamaServerAdapter
from app.core.runtime_config import LocalLLMSettings
from app.models.llm import ConversationKey, Message
from app.personal_assistant.personalization import PersonalizedAssistant
from app.personal_assistant.tool_boundary import TrustedToolContext
from app.services.audio_context import AudioContext


async def main():
    load_dotenv(ROOT / '.env.local', override=False)
    settings = LocalLLMSettings()
    adapter = LlamaServerAdapter(settings)
    service = PersonalizedAssistant(adapter, settings)
    ctx = TrustedToolContext('h06-live-probe', 'h06-probe', 'h06-read-only', allowed_tools=frozenset({'memory.query'}))
    key = ConversationKey(ctx.user_id, ctx.session_id, 'h06-text')
    history = ()
    try:
        for name, content, expected in (
            ('fallback', 'Trả lời ngắn gọn: gợi ý một món tráng miệng đơn giản.', 'NONE'),
            ('proposal', 'Tôi thích uống cà phê vào buổi sáng.', 'PROPOSED'),
            ('confirmation', 'Đồng ý, lưu sở thích đó giúp tôi.', 'SAVE_UNAVAILABLE')):
            reply = await service.reply(content, context=ctx, key=key, history=history,
                request_context=AudioContext(deadline=time.monotonic() + 300))
            assert reply.metadata['memory_status'] == 'MEMORY_UNAVAILABLE', reply.metadata
            assert reply.metadata['memory_action'] == expected, reply.metadata
            assert reply.metadata['used_memory_ids'] == [] and not reply.metadata['executed']
            assert reply.text.strip()
            print(f'PASS {name} model={reply.model} memory=MEMORY_UNAVAILABLE action={expected}', flush=True)
            if name == 'confirmation':
                assert 'chưa thể lưu' in reply.text
            history = (Message('user', content), Message('assistant', reply.text))
        return 0
    except Exception as error:
        code = getattr(getattr(error, 'code', None), 'value', None)
        print('FAIL/BLOCKED H06 Gemma probe: ' + type(error).__name__ + (' ' + code if code else ''), flush=True)
        return 1
    finally:
        await adapter.aclose()


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
