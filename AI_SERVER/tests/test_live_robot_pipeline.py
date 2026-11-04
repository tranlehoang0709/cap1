"""Integrated route + native Opus with isolated provider/BE doubles. NOT LIVE."""
import json
import struct
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from app.main import create_app
from app.core.backend_config import BackendSettings
from app.models.audio import TranscriptionResult
from app.models.tts import TTSAudioChunk
from app.clients.gemini_tts import PCM_FORMAT as GEMINI_PCM_FORMAT, WAV_FORMAT
from app.services.opus_codec import OpusCodec
from tests.test_lan_bootstrap import PROOF, hello
from tests.test_live_gemini_integration import setup, config, FixtureGemini


def test_gemini_system_instruction_includes_server_date_without_claiming_live_web():
    from datetime import datetime, timezone, timedelta
    from app.clients.gemini_llm import _system_instruction
    fixed = datetime(2026, 11, 4, 1, 0, tzinfo=timezone(timedelta(hours=7)))
    prompt = _system_instruction('Answer in Vietnamese.', fixed)
    assert 'Answer in Vietnamese.' in prompt
    assert '2026-11-04 01:00:00' in prompt
    assert 'Do not claim to have live access to other current events or facts.' in prompt


def test_authenticated_manual_audio_round_trip_settles_and_persists(monkeypatch):
    from app.services import live_robot, live_gemini
    from app.models.backend import Authorization
    backend,_,_,_,_=setup()
    backend.aclose=AsyncMock()
    backend.authorize=AsyncMock(return_value=Authorization(allowed=True,deviceId='42',ownerUserId='7'))
    backend.resolve_config=AsyncMock(return_value=config())
    async def admit(request,context):
        return SimpleNamespace(allowed=True,executionAllowed=True,reservedTokens=request.maxTotalTokens,credentialId='9')
    backend.admit=AsyncMock(side_effect=admit)
    async def transcribe(audio,context):
        frames=[]
        while (frame:=await audio.read()) is not None:
            frames.append(frame)
        assert frames and len(frames[0].payload)==1920
        yield TranscriptionResult('Hi.',True,'vi')
    async def stream_pcm(request,context):
        assert request.config.audio_format == WAV_FORMAT
        for sequence in range(3):
            yield TTSAudioChunk(sequence,struct.pack('<480h',*([1000]*480)),GEMINI_PCM_FORMAT)
    monkeypatch.setenv('AI_SERVER_BACKEND_MODE','integrated')
    monkeypatch.setenv('AI_SERVER_ROBOT_ENERGY_THRESHOLD','100')
    monkeypatch.setenv('AI_SERVER_LAN_PUBLIC_ORIGIN','https://testserver')
    for name,char in [('DEVICE','A'),('CONFIG','B'),('QUOTA','C')]:
        monkeypatch.setenv('AI_SERVER_BACKEND_'+name+'_TOKEN',char*43)
    monkeypatch.setattr(BackendSettings,'create_client',lambda _:backend)
    monkeypatch.setattr(live_gemini,'GeminiLLMAdapter',FixtureGemini)
    monkeypatch.setattr(live_robot,'create_gemini_stt_adapter',lambda _:SimpleNamespace(transcribe=transcribe))
    monkeypatch.setattr(live_robot,'create_gemini_tts_adapter',lambda _:SimpleNamespace(model='fixture-tts',voice='fixture',stream_pcm=stream_pcm))
    with TestClient(create_app(), base_url='https://testserver') as client:
        with client.websocket_connect('wss://testserver/ws/robot',headers=PROOF) as ws:
            session=hello(ws)
            assert backend.resolve_config.call_args.args[0].includeCredential is True
            ws.send_json({'type':'listen','state':'start','mode':'manual','session_id':session})
            listening=ws.receive_json()
            assert listening['type']=='status' and listening['state']=='listening'
            assert listening['session_id']==session and isinstance(listening['turn_id'],str)
            codec=OpusCodec(16000,60)
            try:
                ws.send_bytes(codec.encode(struct.pack('<960h',*([2000]*960))))
                ws.send_json({'type':'listen','state':'stop','session_id':session})
                processing=ws.receive_json()
                assert processing == {'type':'status','state':'processing','session_id':session,'turn_id':listening['turn_id']}
                start=ws.receive_json()
                assert start['type']=='tts' and start['state']=='start',start
                assert start['turn_id'] == listening['turn_id']
                proof={key:start[key] for key in ('session_id','turn_id','playback_id')}
                ws.send_json(proof|{'type':'playback','state':'ready','audio_chunks':0})
                count=0
                while True:
                    event=ws.receive()
                    if event.get('bytes') is not None:
                        assert len(codec.decode(event['bytes']))==1920
                        count+=1
                    else:
                        stop=json.loads(event['text'])
                        assert stop['type']=='tts' and stop['state']=='stop',stop
                        assert stop['audio_chunks']==count and count>0
                        break
                ws.send_json(proof|{'type':'playback','state':'complete','audio_chunks':count})
                complete=ws.receive_json()
                assert complete == {'type':'status','state':'complete','session_id':session,'turn_id':listening['turn_id']}
                assert backend.report_usage.called and backend.complete_turn.called
            finally:
                codec.close()
