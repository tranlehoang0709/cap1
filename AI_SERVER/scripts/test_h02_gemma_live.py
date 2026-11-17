"""Exercise current /analyze source in-process with the real configured Gemma adapter."""
import asyncio
import argparse
import os
from pathlib import Path
import sys
from uuid import uuid4

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding='utf-8')


async def main(selected=None):
    for name, value in dotenv_values(ROOT / '.env.local').items():
        if value is not None:
            os.environ.setdefault(name, value)
    os.environ['AI_RUNTIME'] = 'local'
    from app.main import create_app
    from app.clients.local.llama import LlamaServerAdapter
    from app.core.runtime_config import LocalLLMSettings
    app = create_app()
    adapter = LlamaServerAdapter(LocalLLMSettings())
    app.state.local_llm = adapter
    token = os.environ.get('LOCAL_LLM_CHAT_TOKEN')
    if not token:
        print('BLOCKED missing local authentication')
        return 2
    failures = 0
    try:
        model = await adapter.discover_model()
        assert 'gemma' in model.lower(), 'Configured model is not Gemma'
        print('MODEL ' + model, flush=True)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                timeout=310, headers={'Authorization': 'Bearer ' + token}) as client:
            async def turn(sid, text):
                r = await client.post('/internal/personal-assistant/analyze', json={
                    'user_id': 'h02-live', 'session_id': sid, 'content': text})
                assert r.status_code == 200, 'HTTP ' + str(r.status_code) + ' ' + r.text[:100]
                body = r.json()
                assert body['executed'] is False
                return body

            for case in ('schedule', 'correction_cancel', 'memory', 'memory_update', 'memory_delete', 'isolation'):
                if selected and case not in selected:
                    continue
                sid = uuid4().hex
                try:
                    if case in ('schedule', 'correction_cancel', 'isolation'):
                        a = await turn(sid, 'Tạo lịch học ngày mai')
                        assert a['dialogue']['status'] == 'MISSING_INFORMATION'
                        if case == 'isolation':
                            other = await turn(uuid4().hex, 'Ghi nhớ tôi thích uống trà')
                            assert other['dialogue']['correlation_id'] != a['dialogue']['correlation_id']
                        b = await turn(sid, 'Từ 7 đến 9 giờ tối')
                        assert b['dialogue']['status'] == 'AWAITING_CONFIRMATION'
                        assert b['operations'][0]['entities']['start']['time'] == '19:00'
                        assert b['operations'][0]['entities']['end']['time'] == '21:00'
                        c = await turn(sid, 'Đúng rồi')
                        assert c['dialogue']['confirmation'] == 'CONFIRMED'
                        assert c['dialogue']['workflow_status'] == 'BLOCKED'
                        repeat = await turn(sid, 'Đúng rồi')
                        assert repeat['dialogue']['revision'] == c['dialogue']['revision']
                        assert repeat['dialogue']['workflow_id'] == b['dialogue']['workflow_id']
                        if case == 'correction_cancel':
                            changed = await turn(sid, 'Đổi giờ bắt đầu thành 8 giờ tối')
                            assert changed['dialogue']['confirmation'] == 'UNCONFIRMED'
                            assert changed['operations'][0]['entities']['start']['time'] == '20:00'
                            cancelled = await turn(sid, 'Hủy đi')
                            assert cancelled['dialogue']['status'] == 'CANCELLED'
                    elif case == 'memory':
                        a = await turn(sid, 'Ghi nhớ tôi thích uống cà phê buổi sáng')
                        assert a['dialogue']['status'] == 'AWAITING_CONFIRMATION'
                        assert 'cà phê' in str(a['dialogue']['questions'])
                        b = await turn(sid, 'Đúng rồi')
                        assert b['dialogue']['confirmation'] == 'CONFIRMED'
                        assert b['dialogue']['workflow_status'] == 'BLOCKED'
                    else:
                        text = ('Sửa trí nhớ sở thích đồ uống thành tôi thích uống trà' if case == 'memory_update'
                                else 'Xóa nhóm trí nhớ về sở thích đồ uống')
                        a = await turn(sid, text)
                        if case == 'memory_update':
                            assert 'thay thế' in str(a['dialogue']['questions']), str(a['dialogue']['questions'])
                            a = await turn(sid, 'Thay thế nội dung cũ')
                            assert 'replace' in a['dialogue']['memory_modes'].values(), str(a['dialogue'])
                        if not a['operations'][0]['entities'].get('target_query'):
                            a = await turn(sid, 'Mục cần sửa là sở thích đồ uống' if case == 'memory_update'
                                           else 'Nhóm cần xóa là sở thích đồ uống')
                            assert a['operations'][0]['entities'].get('target_query'), str(a['dialogue'])
                        b = await turn(sid, 'Đúng rồi')
                        assert b['dialogue']['confirmation'] != 'CONFIRMED'
                        assert b['dialogue']['workflow_status'] == 'BLOCKED'
                        assert b['dialogue']['workflow_code'] == 'MEMORY_LOOKUP_NOT_IMPLEMENTED', str(b['dialogue'])
                    print('PASS ' + case, flush=True)
                except Exception as error:
                    failures += 1
                    print('FAIL ' + case + ': ' + str(error), flush=True)
    except Exception as error:
        print('BLOCKED real Gemma: ' + type(error).__name__ + ' ' + str(error), flush=True)
        return 2
    finally:
        await adapter.aclose()
    return bool(failures)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', action='append')
    sys.exit(asyncio.run(main(parser.parse_args().case)))
