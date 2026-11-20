"""Loopback test process: real PA08 HTTP route/session code, synthetic LLM only.

Never imports the production app, connects to Backend, or calls an AI provider.
"""
import asyncio
import os
import socket
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn
from fastapi import FastAPI
from app.api.local_chat import local_chat
from app.models.llm import ProviderDelta, ProviderDone, Usage
from app.services.local_chat import LocalChatSessions
from app.personal_assistant.understanding import IntentUnderstanding

app = FastAPI()
recorded = []
analyses = []


async def analyze(self, content, *, history=(), **kwargs):
    analyses.append([{'role': m.role, 'content': m.text} for m in history])
    return SimpleNamespace(operations=[])


IntentUnderstanding.analyze = analyze


class FixtureLLM:
    async def discover_model(self):
        return 'test-model'

    async def stream(self, request, context, **kwargs):
        recorded.append({'user': request.key.user_id, 'session': request.key.session_id,
            'content': request.transcript,
            'history': [{'role': m.role, 'content': m.text} for m in request.history]})
        if request.transcript == 'slow':
            await asyncio.sleep(.3)
        if request.transcript == 'upstreamfail':
            raise RuntimeError('synthetic failure')
        yield ProviderDelta('turn=' + str(len(request.history)//2+1))
        yield ProviderDone(True, 'completed', Usage(4, 2, 6))


app.state.local_llm = FixtureLLM()
app.state.local_llm_settings = SimpleNamespace(max_output_tokens=256, max_output_chars=8000,
    timeout_seconds=5, system_prompt='Test only')
app.state.local_chat_sessions = LocalChatSessions(max_sessions=100, max_turns=20,
    max_history_chars=32768, ttl_seconds=60)
app.add_api_route('/internal/pa08-chat', local_chat, methods=['POST'])


@app.get('/_test/requests')
async def requests():
    return {'requests': recorded, 'analyses': analyses}


@app.post('/_test/expire')
async def expire():
    app.state.local_chat_sessions._items = {
        key: (0, history, busy) for key, (_, history, busy)
        in app.state.local_chat_sessions._items.items()}
    return {'expired': True}


if __name__ == '__main__':
    assert os.getenv('PA08_HTTP_FIXTURE') == 'true'
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    print('READY:' + str(sock.getsockname()[1]), flush=True)
    uvicorn.Server(uvicorn.Config(app, log_level='error')).run(sockets=[sock])
