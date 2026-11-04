"""Isolated contracts with a Gemini adapter double; never a LIVE PASS."""
import asyncio
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from app.clients.backend import BackendCode, BackendError
from app.clients.gemini_llm import GeminiLLMAdapter
from app.models import backend as dto
from app.models.llm import ConversationKey, LLMRequest, ProviderDelta, ProviderDone, Usage
from app.core.llm_config import LLMSettings
from app.services.audio_context import AudioContext
from app.services.backend_execution import QuotaLLMAdapter, UsageReporter


def config():
    return dto.ResolvedConfig.model_validate(dict(userId='7', provider=dict(id='2',code='GEMINI',name='Gemini'),
        model=dict(id='21',modelCode='test-gemini',capability='llm'),
        profile=dict(assistantName='AIVA',systemPrompt='Respond briefly.',preferredProviderId='2',
                     preferredLlmModelId='21',languageCode='vi',voiceCode=None),
        credentialScope='USER',credentialReference=dict(id='9',providerId='2'),credential='fixture-secret-not-live'))


def context():
    return AudioContext(deadline=time.monotonic()+3)


class FixtureGemini(GeminiLLMAdapter):
    def __init__(self, **kwargs):
        super().__init__(api_key='fixture-secret-not-live')
        self.calls = 0
        self.count = 2
    async def count_input_tokens(self, request, context):
        return self.count
    async def stream(self, request, context):
        self.calls += 1
        yield ProviderDelta('Hello.')
        yield ProviderDone(True, 'completed', Usage(2, 3, 5))


def setup():
    backend = SimpleNamespace(start_turn=AsyncMock(return_value=dto.TurnResult(conversationId='11',sessionId='12')),
        admit=AsyncMock(return_value=SimpleNamespace(allowed=True,executionAllowed=True,reservedTokens='1000',credentialId='9')),
        report_usage=AsyncMock(return_value=SimpleNamespace(budgetExceeded=False)),
        complete_turn=AsyncMock(return_value=dto.TurnSaved(conversationId='11',sessionId='12',saved=True)))
    session=SimpleNamespace(valid=True,config=config(),client=backend,key=ConversationKey('7','opaque-session','42'))
    delegate=FixtureGemini()
    reporter=UsageReporter(backend,max_entries=100)
    wrapper=QuotaLLMAdapter(delegate,session,reporter,mock_only=False,max_total_tokens='1000',
                            report_context_factory=context,execution_slots=asyncio.Semaphore(5))
    request=LLMRequest(session.key,'turn-one','Hi',session.config.profile.systemPrompt,(),LLMSettings(model='test-gemini'))
    return backend,session,delegate,wrapper,request


def test_live_adapter_admits_then_settles_then_persists_and_rejects_repeat():
    async def run():
        backend,session,delegate,wrapper,request=setup()
        await wrapper.prepare(request.turn_id,context())
        assert delegate.calls == 0
        result=[e async for e in wrapper.stream(request,context())]
        assert result[-1].usage.total_tokens==5 and delegate.calls==1
        admission=backend.admit.call_args.args[0]
        assert admission.sessionId=='12' and admission.conversationId=='11' and admission.deviceId=='42'
        report=backend.report_usage.call_args.args[0]
        assert (report.inputTokens,report.outputTokens,report.status)==(2,3,'success')
        assert backend.complete_turn.call_args.args[0].requestId==admission.requestId
        with pytest.raises(BackendError):
            await anext(wrapper.stream(request,context()))
        assert delegate.calls==1
    asyncio.run(run())


@pytest.mark.parametrize('failure',['missing-secret','quota','timeout','input-budget','settlement','credential-rotation'])
def test_fail_closed_without_fabricated_usage_or_success(failure):
    async def run():
        backend,session,delegate,wrapper,request=setup()
        if failure=='missing-secret': session.config=session.config.model_copy(update={'credential':None})
        if failure=='quota': backend.admit.side_effect=BackendError(BackendCode.HTTP,status=429)
        if failure=='timeout': backend.admit.side_effect=BackendError(BackendCode.TIMEOUT)
        if failure=='input-budget': delegate.count=1001
        if failure=='settlement': backend.report_usage.side_effect=BackendError(BackendCode.NETWORK)
        if failure=='credential-rotation': backend.admit.return_value.credentialId='10'
        with pytest.raises(BackendError):
            _=[e async for e in wrapper.stream(request,context())]
        assert not backend.complete_turn.called
        if failure!='settlement': assert delegate.calls==0
    asyncio.run(run())


def test_secret_is_not_serialized_or_represented():
    c=config()
    assert 'fixture-secret-not-live' not in repr(c)
    assert 'credential' not in c.model_dump()


def test_real_count_tokens_request_includes_system_prompt_and_closes_client():
    async def run():
        count=AsyncMock(return_value=SimpleNamespace(total_tokens=9))
        closed=AsyncMock()
        client=SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(count_tokens=count),aclose=closed),close=lambda:None)
        adapter=GeminiLLMAdapter(api_key='fixture-secret',client_factory=lambda *_:client)
        _,_,_,_,request=setup()
        assert await adapter.count_input_tokens(request,context())==9
        assert count.call_args.kwargs['config']['system_instruction']==request.system_prompt
        closed.assert_awaited_once()
    asyncio.run(run())


def test_internal_web_chat_requires_service_auth_and_settles_before_response(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.core.backend_config import BackendSettings
    from app.services import live_gemini
    backend,_,_,_,_=setup()
    backend.aclose=AsyncMock()
    backend.resolve_config=AsyncMock(return_value=config())
    # Admission echoes the actual computed reservation and identifiers.
    async def admit(request,context):
        return SimpleNamespace(allowed=True,executionAllowed=True,reservedTokens=request.maxTotalTokens,credentialId='9')
    backend.admit=AsyncMock(side_effect=admit)
    monkeypatch.setenv('AI_SERVER_BACKEND_MODE','integrated')
    monkeypatch.setenv('AI_SERVER_LIVE_WEB_TOKEN','W'*43)
    for name,char in [('DEVICE','A'),('CONFIG','B'),('QUOTA','C')]:
        monkeypatch.setenv('AI_SERVER_BACKEND_'+name+'_TOKEN',char*43)
    monkeypatch.setattr(BackendSettings,'create_client',lambda _:backend)
    monkeypatch.setattr(live_gemini,'GeminiLLMAdapter',FixtureGemini)
    with TestClient(create_app()) as client:
        assert client.post('/internal/web-chat',json={}).status_code==401
        response=client.post('/internal/web-chat',headers={'Authorization':'Bearer '+'W'*43},
                             json={'userId':'7','providerId':'2','content':'Hi'})
        assert response.status_code==200,response.text
        assert response.json()['content']=='Hello.'
        assert 'credential' not in response.text
        assert backend.report_usage.called and backend.complete_turn.called


def test_gemini_usage_can_be_reconciled_idempotently_without_another_generation():
    async def run():
        backend,_,delegate,wrapper,request=setup()
        _=[e async for e in wrapper.stream(request,context())]
        report=backend.report_usage.call_args.args[0]
        await wrapper.reporter.submit(report,context())
        assert backend.report_usage.await_count==1 and delegate.calls==1
    asyncio.run(run())
