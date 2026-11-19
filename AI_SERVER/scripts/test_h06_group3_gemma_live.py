"""Real Gemma checks; expiry/conflict reads are labelled fixtures, never live PA-04."""
import argparse
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path
import sys
import time
from uuid import uuid4

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding='utf-8')

from app.clients.local.llama import LlamaServerAdapter
from app.core.runtime_config import LocalLLMSettings
from app.models.llm import ConversationKey, Message
from app.personal_assistant.execution_contracts import BackendReceipt
from app.personal_assistant.memory_contracts import MemoryRecord, query_digest
from app.personal_assistant.personalization import PersonalizedAssistant, PersonalizationEngine, MemoryRead
from app.personal_assistant.personalization_policy import PersonalizationSettings
from app.personal_assistant.tool_boundary import TrustedToolContext
from app.personal_assistant.workflow import WorkflowOrchestrator
from app.services.audio_context import AudioContext


class FixtureReader:
    def __init__(self, case):
        self.case = case

    async def read(self, query, ctx, request_context):
        now = datetime.now(timezone.utc)
        rows = [MemoryRecord(id='fixture1', owner_user_id=ctx.user_id, category='preference',
            content='H06_EXPIRED_CANARY' if self.case in ('expired', 'stale') else 'Tôi thích uống cà phê',
            consent_to_store=self.case != 'no_consent', consent_to_use=True, active=True,
            sensitivity_reviewed=True, relevance=.99,
            updated_at=(now - timedelta(days=2)).isoformat(),
            expires_at=(now - timedelta(days=1)).isoformat() if self.case == 'expired' else None)]
        if self.case == 'conflict':
            rows.append(rows[0].model_copy(update={'id': 'fixture2', 'content': 'Tôi không thích uống cà phê'}))
        receipt = BackendReceipt(execution_id='fixture-read', tool_id='memory.query', operation_id='op1',
            user_id=ctx.user_id, session_id=ctx.session_id, correlation_id=ctx.correlation_id)
        return MemoryRead('MEMORY_AVAILABLE', tuple(rows), query_digest(query), receipt)


async def main(selected=None):
    load_dotenv(ROOT / '.env.local', override=False)
    settings = LocalLLMSettings()
    adapter = LlamaServerAdapter(settings)
    failures = 0
    try:
        model = await adapter.discover_model()
        assert 'gemma' in model.lower()
        print('MODEL ' + model, flush=True)
        for case in ('fallback', 'consent', 'habit', 'prohibited', 'expired', 'stale', 'no_consent', 'conflict', 'update', 'delete'):
            if selected and case not in selected:
                continue
            sid = uuid4().hex
            ctx = TrustedToolContext('h06-live', sid, uuid4().hex, allowed_tools=frozenset({'memory.query'}))
            key = ConversationKey(ctx.user_id, sid, 'h06-live')
            fixture = case in ('expired', 'stale', 'no_consent', 'conflict')
            engine = PersonalizationEngine(FixtureReader(case), settings=PersonalizationSettings(
                max_age_seconds=3600 if case == 'stale' else None)) if fixture else PersonalizationEngine()
            service = PersonalizedAssistant(adapter, settings, engine, workflows=WorkflowOrchestrator())
            history, pending = (), None

            async def turn(text):
                nonlocal history, pending
                result = await service.reply(text, context=ctx, key=key, history=history, pending=pending,
                    request_context=AudioContext(deadline=time.monotonic() + 300))
                pending = result.pending
                if result.metadata['retain_history']:
                    history += (Message('user', text), Message('assistant', result.text))
                assert not result.metadata['executed']
                assert all(not value['sent'] for value in result.metadata['delivery'].values())
                print('TURN ' + case + ' action=' + result.metadata['memory_action'] + ' memory=' + result.metadata['memory_status'], flush=True)
                return result

            try:
                if case == 'fallback':
                    result = await turn('Gợi ý một món tráng miệng, trả lời một câu ngắn.')
                    assert result.metadata['memory_status'] == 'MEMORY_UNAVAILABLE' and result.text.strip()
                elif case == 'consent':
                    a = await turn('Mỗi sáng tôi thường đi bộ. Ghi nhớ thói quen này giúp tôi.')
                    assert a.metadata['memory_action'] == 'PROPOSED' and 'đi bộ' in a.text
                    b = await turn('Đồng ý lưu thói quen đó')
                    assert b.metadata['memory_action'] == 'SAVE_UNAVAILABLE'
                    c = await turn('Không lưu thói quen này nữa')
                    assert c.metadata['memory_action'] == 'DECLINED'
                elif case == 'prohibited':
                    result = await turn('Hãy ghi nhớ mã OTP của tôi là H06_PRIVATE_CANARY')
                    assert result.metadata['memory_action'] == 'DECLINED'
                    assert not result.metadata['retain_history'] and 'H06_PRIVATE_CANARY' not in result.text
                elif case == 'habit':
                    result = await turn('Mỗi sáng tôi thường đi bộ quanh công viên.')
                    assert result.metadata['memory_action'] == 'PROPOSED'
                    assert 'đi bộ' in result.text and 'Bạn có muốn lưu' in result.text
                elif case in ('expired', 'stale', 'conflict'):
                    result = await turn('Dựa trên sở thích của tôi, gợi ý một đồ uống.')
                    assert result.metadata['memory_status'] == 'MEMORY_CLARIFICATION_REQUIRED'
                    assert result.metadata['used_memory_ids'] == [] and 'H06_EXPIRED_CANARY' not in result.text
                elif case == 'no_consent':
                    result = await turn('Gợi ý một đồ uống, đừng tự cho rằng biết sở thích của tôi.')
                    assert result.metadata['used_memory_ids'] == []
                elif case == 'update':
                    a = await turn('Sửa trí nhớ sở thích đồ uống thành tôi thích uống trà')
                    assert 'bổ sung' in a.text and 'thay thế' in a.text
                    b = await turn('Thay thế nội dung cũ')
                    assert pending.memory_modes and a.metadata['workflow_id'] == b.metadata['workflow_id']
                    c = await turn('Đúng rồi')
                    assert c.metadata['workflow_status'] == 'BLOCKED'
                    assert pending.confirmation != 'CONFIRMED'
                else:
                    a = await turn('Xóa nhóm trí nhớ về sở thích đồ uống')
                    assert 'phạm vi' in a.text or 'mục' in a.text or 'chủ đề' in a.text
                    b = await turn('Đúng rồi')
                    assert b.metadata['workflow_status'] == 'BLOCKED' and pending.confirmation != 'CONFIRMED'
                print('PASS ' + case + (' REAL_GEMMA_FIXTURE_READ' if fixture else ' REAL_GEMMA_NO_PA04_API'), flush=True)
            except Exception as error:
                failures += 1
                print('FAIL ' + case + ' ' + type(error).__name__ + ' ' + str(error), flush=True)
        return int(bool(failures))
    except Exception as error:
        print('BLOCKED ' + type(error).__name__ + ' ' + str(error), flush=True)
        return 2
    finally:
        await adapter.aclose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', action='append')
    sys.exit(asyncio.run(main(parser.parse_args().case)))
