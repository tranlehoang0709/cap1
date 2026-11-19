"""Explicit real-Gemma probe through authenticated Local AI_SERVER; prints only."""
import asyncio
import argparse
import json
from pathlib import Path
import sys
from uuid import uuid4

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.personal_assistant.schema import Analysis

CASES = [
    ('event', 'Ngày mai tạo lịch học tiếng Anh từ 19 giờ đến 21 giờ.', [('PA-01', 'create')]),
    ('reminder', 'Nhắc tôi uống nước ngày mai lúc 8 giờ sáng.', [('PA-02', 'create')]),
    ('plan', 'Lập kế hoạch học tiếng Anh cá nhân từ ngày 20/11/2026 đến 30/11/2026, mục tiêu ôn từ vựng, 3 buổi mỗi tuần, mỗi buổi 60 phút.', [('PA-06', 'create')]),
    ('task', 'Tạo công việc nộp báo cáo, deadline ngày 20/11/2026.', [('PA-10', 'create')]),
    ('progress', 'Cập nhật buổi học số 2 của kế hoạch tiếng Anh là đã hoàn thành.', [('PA-12', 'set_status')]),
    ('deadline', 'Đổi deadline công việc nộp báo cáo sang ngày 25/11/2026.', [('PA-10', 'update')]),
    ('memory', 'Hãy ghi nhớ tôi thích ăn kem.', [('PA-04', None)]),
    ('today', 'Hôm nay tôi có lịch gì?', [('PA-08', 'query')]),
    ('three', 'Thứ Hai tuần sau tôi học từ 5 giờ đến 7 giờ tối, nhắc tôi trước 30 phút. Tôi thích ăn kem.', [('PA-01', 'create'), ('PA-02', 'create'), ('PA-04', 'propose')]),
    ('missing', 'Tạo lịch học ngày mai.', [('PA-01', 'create')]),
    ('selection', 'Tôi có hai công việc cùng tên nộp báo cáo. Xóa công việc nộp báo cáo giúp tôi.', [('PA-10', 'delete')]),
    ('outside', 'Giải thích vì sao bầu trời có màu xanh.', []),
]


async def main(selected=None):
    values = dotenv_values(ROOT / '.env.local')
    token = values.get('LOCAL_LLM_CHAT_TOKEN')
    if not token:
        print('BLOCKED: LOCAL_LLM_CHAT_TOKEN not configured')
        return 2
    failures = 0
    async with httpx.AsyncClient(timeout=300, trust_env=False) as client:
        for name, content, expected in CASES:
            if selected and name not in selected:
                continue
            try:
                response = await client.post('http://127.0.0.1:8002/internal/personal-assistant/analyze',
                    headers={'Authorization': 'Bearer ' + token},
                    json={'user_id': 'pa-live-probe', 'session_id': uuid4().hex,
                          'content': content, 'timezone': 'Asia/Bangkok'})
                if response.status_code != 200:
                    raise AssertionError(f'HTTP {response.status_code}: {response.text[:200]}')
                result = Analysis.model_validate_json(response.content)
                ops = result.operations
                assert len(ops) == len(expected), [(op.feature, op.action) for op in ops]
                for op, (feature, action) in zip(ops, expected):
                    assert op.feature == feature and (action is None or op.action == action), (op.feature, op.action)
                assert result.executed is False and result.raw_input == content
                if name == 'event':
                    assert ops[0].entities.title
                    assert ops[0].entities.start.time == '19:00'
                    assert ops[0].entities.end.time == '21:00'
                if name == 'three':
                    assert ops[0].entities.title and not ops[0].missing_fields
                    assert ops[1].depends_on == [ops[0].id]
                    assert ops[1].entities.reminder_offset_minutes == 30
                    assert ops[0].entities.start.time == '17:00'
                    assert ops[0].entities.end.time == '19:00'
                    assert ops[2].confirmation_required and not ops[2].depends_on
                    print('EXAMPLE ' + result.model_dump_json(exclude_none=True), flush=True)
                if name == 'missing':
                    assert 'start.time' in ops[0].missing_fields
                if name == 'selection':
                    assert ops[0].target_resolution == 'selection_required'
                if name == 'outside':
                    assert result.scope == 'out_of_scope'
                if name == 'memory':
                    assert ops[0].confirmation_required
                print(f'PASS {name} model={result.model}', flush=True)
            except (httpx.ConnectError, httpx.ConnectTimeout) as error:
                print(f'BLOCKED {name}: {type(error).__name__}', flush=True)
                failures += 1
            except Exception as error:
                print(f'FAIL {name}: {type(error).__name__} {error}', flush=True)
                failures += 1
    return 1 if failures else 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', action='append', choices=[case[0] for case in CASES])
    sys.exit(asyncio.run(main(parser.parse_args().case)))
