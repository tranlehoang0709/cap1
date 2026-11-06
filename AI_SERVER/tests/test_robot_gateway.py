"""Native Opus and ASGI WebSocket integration; mocked AI, no hardware/Cloud."""
import json
import math
import struct
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.core.robot_config import RobotSettings
from app.main import create_app
from app.models.audio import AudioFrame
from app.protocol.audio_framing import FramingConfig, encode_audio_frame, validate_audio_frame
from app.services.opus_codec import CodecError, OpusCodec, PCMOpusFrames, resample_pcm16
TOKEN = 'fixture-development-token-1234567890'

def configured(monkeypatch, **options):
    monkeypatch.setenv('AI_SERVER_BACKEND_MODE', 'development-mock')
    for k,v in dict(enabled='true', token=TOKEN, energy_threshold=100, **options).items():
        monkeypatch.setenv('AI_SERVER_ROBOT_' + k.upper(), str(v))
    application = create_app()
    assert application.state.backend_settings.mode == 'development-mock'
    return application

def headers(version=1, token=TOKEN):
    return {'Authorization': 'Bearer '+token, 'Protocol-Version': str(version), 'Device-Id': 'same-untrusted-mac', 'Client-Id': 'same-untrusted-client'}

def hello(ws, version=1):
    ws.send_json(dict(type='hello', version=version, transport='websocket', features={'aiva_half_duplex_v1': True}, audio_params=dict(format='opus', sample_rate=16000, channels=1, frame_duration=60)))
    return ws.receive_json()['session_id']

def mic(ws, session, version=1):
    ws.send_json(dict(type='listen', state='start', mode='auto', session_id=session))
    codec=OpusCodec(16000,60)
    try:
        pcm=struct.pack('<960h', *(int(4000*math.sin(i*.15)) for i in range(960)))
        ws.send_bytes(encode_audio_frame(AudioFrame(codec.encode(pcm),0),FramingConfig(version,4096)))
    finally: codec.close()
    ws.send_json(dict(type='listen',state='stop',session_id=session))
    start=ws.receive_json()
    assert start['type']=='tts' and start['state']=='start'
    return start

def drain(ws,start,version=1,complete=True):
    proof={k:start[k] for k in ('session_id','turn_id','playback_id')}
    ws.send_json(proof | dict(type='playback',state='ready',audio_chunks=0))
    codec=OpusCodec(16000,60)
    count=0
    try:
        while True:
            item=ws.receive()
            if item.get('bytes') is not None:
                packet=validate_audio_frame(item['bytes'],FramingConfig(version,1275))
                assert len(codec.decode(packet.payload))==1920
                count+=1
            else:
                stop=json.loads(item['text'])
                assert stop['state']=='stop' and stop['audio_chunks']==count==2
                break
    finally: codec.close()
    if complete: ws.send_json(proof | dict(type='playback',state='complete',audio_chunks=count))
    return proof

@pytest.mark.parametrize('version',[1,2,3])
def test_native_pipeline_second_turn(monkeypatch,version):
    with TestClient(configured(monkeypatch),client=('127.0.0.1',1234)) as client:
        with client.websocket_connect('/ws/dev-robot',headers=headers(version)) as ws:
            session=hello(ws,version)
            start=mic(ws,session,version)
            ws.send_bytes(b'invalid-busy-mic-must-drop-before-codec')
            drain(ws,start,version)
            next_start=mic(ws,session,version)
            assert next_start['turn_id']!=start['turn_id']
            drain(ws,next_start,version)

def test_standalone_lan_admits_turn_before_microphone_audio(monkeypatch):
    uid, credential = 'fixture-sd2', 'F' * 43
    monkeypatch.setenv('AI_SERVER_ROBOT_LOCAL_DEVICE_CREDENTIALS',
                       json.dumps({uid: credential}))
    monkeypatch.setenv('GEMINI_API_KEY', 'fixture-gemini-key')
    monkeypatch.setenv('AI_SERVER_LLM_PROVIDER', 'gemini')
    monkeypatch.setattr('app.clients.provider_factory.create_llm_adapter',
                        lambda _settings: (object(), 'fixture-gemini-model'))
    monkeypatch.setattr('app.clients.stt_factory.create_gemini_stt_adapter', lambda _settings: object())
    from types import SimpleNamespace
    monkeypatch.setattr('app.clients.tts_factory.create_gemini_tts_adapter',
                        lambda _settings: SimpleNamespace(model='fixture-tts', voice='fixture-voice'))
    app = configured(monkeypatch, ai_mode='gemini', allowed_networks='["127.0.0.0/8"]')
    headers = {'Device-Uid': uid, 'Device-Credential': credential,
               'Protocol-Version': '1', 'Device-Id': 'fixture-device',
               'Client-Id': 'fixture-client'}
    with TestClient(app, base_url='https://testserver', client=('127.0.0.1', 1234)) as client:
        with client.websocket_connect('wss://testserver/ws/robot', headers=headers) as ws:
            session = hello(ws)
            ws.send_json({'type': 'listen', 'state': 'start', 'mode': 'manual',
                          'session_id': session})
            admitted = ws.receive_json()
            assert admitted['type'] == 'status'
            assert admitted['state'] == 'listening'
            assert admitted['session_id'] == session
            assert admitted['turn_id']
            codec = OpusCodec(16000, 60)
            try:
                pcm = struct.pack('<960h', *(int(1000 * math.sin(i * .15)) for i in range(960)))
                ws.send_bytes(encode_audio_frame(AudioFrame(codec.encode(pcm), 0),
                                                  FramingConfig(1, 4096)))
            finally:
                codec.close()

def test_two_sessions_and_reconnect(monkeypatch):
    with TestClient(configured(monkeypatch),client=('127.0.0.1',1234)) as client:
        with client.websocket_connect('/ws/dev-robot',headers=headers()) as a:
            sa=hello(a); start=mic(a,sa); drain(a,start,complete=False)
            with client.websocket_connect('/ws/dev-robot',headers=headers(3)) as b:
                sb=hello(b,3)
                assert sa!=sb
                start_b=mic(b,sb,3)
                assert start_b['playback_id']!=start['playback_id']
                drain(b,start_b,3)
        with client.websocket_connect('/ws/dev-robot',headers=headers()) as c:
            assert hello(c) not in (sa,sb)

def test_wrong_proof_closes(monkeypatch):
    with TestClient(configured(monkeypatch),client=('127.0.0.1',1234)) as client:
        with client.websocket_connect('/ws/dev-robot',headers=headers()) as ws:
            session=hello(ws); start=mic(ws,session); proof=drain(ws,start,complete=False)
            ws.send_json(proof | dict(type='playback',state='complete',audio_chunks=1))
            assert ws.receive()['type']=='websocket.close'

@pytest.mark.parametrize('bad',['disabled','token','public'])
def test_fail_closed(monkeypatch,bad):
    app=create_app() if bad=='disabled' else configured(monkeypatch)
    with TestClient(app,client=('8.8.8.8' if bad=='public' else '127.0.0.1',1234)) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect('/ws/dev-robot',headers=headers(token='bad' if bad=='token' else TOKEN)): pass

@pytest.mark.parametrize('version',[1,2,3])
def test_bad_frame_closes_and_releases(monkeypatch,version):
    with TestClient(configured(monkeypatch),client=('127.0.0.1',1234)) as client:
        with client.websocket_connect('/ws/dev-robot',headers=headers(version)) as ws:
            session=hello(ws,version)
            ws.send_json(dict(type='listen',state='start',mode='auto',session_id=session))
            ws.send_bytes(b'\xff')
            message = ws.receive()
            if version == 1:
                assert json.loads(message['text']) == {'type': 'error', 'code': 'OPUS_CODEC_ERROR'}
                message = ws.receive()
            assert message['type'] == 'websocket.close'
        assert client.app.state.robot_slots._value==2

@pytest.mark.parametrize('rate',[8000,12000,16000,24000,48000])
def test_codec_conversion_and_cleanup(rate):
    pcm=b'\0\0'*(rate*60//1000)
    frames=PCMOpusFrames(rate,16000,max_chunk_bytes=6000); decoder=OpusCodec(16000,60)
    try:
        assert not frames.feed(pcm[:2])
        packets=frames.feed(pcm[2:])
        assert len(packets)==1 and len(decoder.decode(packets[0]))==1920
        assert not frames.pending and not frames.finish()
        assert len(resample_pcm16(pcm,rate,24000))==2880
        with pytest.raises(CodecError): frames.feed(b'x')
        with pytest.raises(CodecError): frames.feed(b'\0'*6002)
    finally: frames.close(); decoder.close()
    with pytest.raises(CodecError): decoder.decode(b'a')

@pytest.mark.parametrize('kwargs',[{'enabled':True},{'allowed_networks':['0.0.0.0/0']},{'min_silence_ms':0}])
def test_config_validation(kwargs):
    with pytest.raises(ValueError): RobotSettings(**kwargs)

@pytest.mark.parametrize('change', [dict(version=4), dict(features={}), dict(audio_params=dict(format='pcm',sample_rate=16000,channels=1,frame_duration=60))])
def test_hello_mismatch_rejected(monkeypatch,change):
    with TestClient(configured(monkeypatch),client=('127.0.0.1',1234)) as client:
        with client.websocket_connect('/ws/dev-robot',headers=headers()) as ws:
            packet=dict(type='hello',version=1,transport='websocket',features={'aiva_half_duplex_v1':True},audio_params=dict(format='opus',sample_rate=16000,channels=1,frame_duration=60))
            ws.send_json(packet|change)
            assert ws.receive()['type']=='websocket.close'

def test_missing_completion_times_out_and_releases_slot(monkeypatch):
    with TestClient(configured(monkeypatch,deadline_seconds=1.5),client=('127.0.0.1',1234)) as client:
        with client.websocket_connect('/ws/dev-robot',headers=headers()) as ws:
            session=hello(ws); start=mic(ws,session); drain(ws,start,complete=False)
            aborted = ws.receive_json()
            assert aborted['state'] == 'abort'
            assert ws.receive()['type']=='websocket.close'
        assert client.app.state.robot_slots._value==2

def test_overload_abort_and_wrong_identity(monkeypatch):
    with TestClient(configured(monkeypatch,max_sessions=1),client=('127.0.0.1',1234)) as client:
        with client.websocket_connect('/ws/dev-robot',headers=headers()) as a:
            sa=hello(a)
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect('/ws/dev-robot',headers=headers()): pass
            a.send_json(dict(type='listen',state='start',mode='auto',session_id=sa))
            a.send_json(dict(type='abort',session_id=sa))
            assert a.receive()['type']=='websocket.close'
        with client.websocket_connect('/ws/dev-robot',headers=headers()) as b:
            hello(b)
            b.send_json(dict(type='listen',state='start',mode='auto',session_id='other-session'))
            assert b.receive()['type']=='websocket.close'

def test_real_tcp_two_clients(tmp_path):
    import asyncio
    import importlib.util
    import os
    from pathlib import Path
    import signal
    import socket
    import subprocess
    import sys
    import time
    import httpx
    root=Path(__file__).resolve().parents[1]
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0)); port=probe.getsockname()[1]
    env={k:v for k,v in os.environ.items() if not k.upper().startswith('AI_SERVER_')}
    env.update(AI_SERVER_HOST='127.0.0.1',AI_SERVER_PORT=str(port),AI_SERVER_RELOAD='false',AI_SERVER_ROBOT_ENABLED='true',AI_SERVER_ROBOT_TOKEN=TOKEN,AI_SERVER_ROBOT_ENERGY_THRESHOLD='100',
               AI_SERVER_BACKEND_MODE='development-mock', AI_SERVER_ROBOT_AI_MODE='mock',
               AI_SERVER_TLS_CERTFILE='', AI_SERVER_TLS_KEYFILE='',
               AI_SERVER_ROBOT_ALLOWED_NETWORKS='["127.0.0.0/8"]')
    with (tmp_path/'tcp.log').open('w+') as log:
        process=subprocess.Popen([sys.executable,str(root/'scripts/run_dev.py')],env=env,stdout=log,stderr=log,cwd=root)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    log.seek(0); pytest.fail('server exited: '+log.read())
                try:
                    if httpx.get(f'http://127.0.0.1:{port}/health',timeout=.1).status_code==200: break
                except httpx.HTTPError: pass
                time.sleep(.05)
            else: pytest.fail('server did not start')
            spec=importlib.util.spec_from_file_location('robot_mock_client',root/'scripts/robot_mock_client.py')
            demo=importlib.util.module_from_spec(spec); spec.loader.exec_module(demo)
            async def both():
                return await asyncio.gather(demo.exercise(f'ws://127.0.0.1:{port}/ws/dev-robot',TOKEN,1),demo.exercise(f'ws://127.0.0.1:{port}/ws/dev-robot',TOKEN,3))
            results=asyncio.run(both())
            assert results[0]['session_id']!=results[1]['session_id']
            assert all(r['audio_chunks']==2 for r in results)
            print('REAL TCP / MOCK AI:',results)
        finally:
            if os.name == 'nt':
                process.terminate()
            else:
                process.send_signal(signal.SIGINT)
            try: process.wait(timeout=8)
            except subprocess.TimeoutExpired: process.kill(); process.wait(); pytest.fail('server cleanup timed out')
        log.seek(0); output=log.read()
        assert TOKEN not in output and 'Traceback' not in output

@pytest.mark.parametrize('first',[b'binary-hello', '{"type":"hello","type":"hello"}', 'x'*4097])
def test_malformed_hello_cleanup(monkeypatch,first):
    with TestClient(configured(monkeypatch),client=('127.0.0.1',1234)) as client:
        with client.websocket_connect('/ws/dev-robot',headers=headers()) as ws:
            if isinstance(first,bytes): ws.send_bytes(first)
            else: ws.send_text(first)
            assert ws.receive()['type']=='websocket.close'
        assert client.app.state.robot_slots._value==2

def test_partial_pcm_padding_and_invalid_profiles():
    converter=PCMOpusFrames(16000,16000,max_chunk_bytes=100)
    decoder=OpusCodec(16000,60)
    try:
        assert converter.feed(b'\0\0'*25)==[]
        packets=converter.finish()
        assert len(packets)==1 and len(decoder.decode(packets[0]))==1920
        assert converter.finish()==[] and not converter.pending
    finally: converter.close(); decoder.close()
    for source,cap in [(0,100),(16000,0),(16000,65537)]:
        with pytest.raises(CodecError): PCMOpusFrames(source,16000,max_chunk_bytes=cap)

def test_output_rejects_late_audio_and_ack_after_abort():
    import asyncio
    import time
    from app.models.llm import ConversationKey
    from app.models.tts import PlaybackScope, ScheduledAudio, TTSAudioChunk
    from app.services.audio_context import AudioContext
    from app.services.robot_transport import RobotAudioOutput, OPUS_FORMAT
    class Sink:
        async def send_json(self,message): pass
        async def send_bytes(self,message): raise AssertionError('late audio must not reach socket')
    async def scenario():
        output=RobotAudioOutput(Sink(),'session',1)
        scope=PlaybackScope(ConversationKey('local','session','device'),'turn','generation')
        context=AudioContext(deadline=time.monotonic()+1)
        task=asyncio.create_task(output.start(scope,OPUS_FORMAT,context))
        await asyncio.sleep(0)
        proof=dict(session_id='session',turn_id='turn',playback_id='generation',state='ready',audio_chunks=0)
        output.acknowledge(proof)
        await task
        await output.abort(scope)
        assert output.acknowledge(proof) is False
        chunk=ScheduledAudio(scope,0,TTSAudioChunk(0,b'opus',OPUS_FORMAT))
        with pytest.raises(ValueError): await output.write(chunk,context)
    asyncio.run(scenario())

def test_cancel_while_audio_waits_for_transport_lock():
    import asyncio
    import time
    from app.models.llm import ConversationKey
    from app.models.tts import PlaybackScope, ScheduledAudio, TTSAudioChunk
    from app.services.audio_context import AudioContext
    from app.services.robot_transport import RobotAudioOutput, OPUS_FORMAT
    class Sink:
        async def send_json(self,message): pass
        async def send_bytes(self,message): raise AssertionError('audio sent after abort')
    async def scenario():
        output=RobotAudioOutput(Sink(),'session',1)
        scope=PlaybackScope(ConversationKey('local','session','device'),'turn','generation')
        context=AudioContext(deadline=time.monotonic()+2)
        start=asyncio.create_task(output.start(scope,OPUS_FORMAT,context))
        await asyncio.sleep(0)
        output.acknowledge(dict(session_id='session',turn_id='turn',playback_id='generation',state='ready',audio_chunks=0))
        await start
        await output.lock.acquire()
        writer=asyncio.create_task(output.write(ScheduledAudio(scope,0,TTSAudioChunk(0,b'opus',OPUS_FORMAT)),context))
        await asyncio.sleep(0)
        abort=asyncio.create_task(output.abort(scope))
        await asyncio.sleep(0)
        assert output.aborted
        output.lock.release()
        with pytest.raises(ValueError): await writer
        await abort
        assert output.count==0
    asyncio.run(scenario())


def test_opus_encoder_closes_even_if_provider_cleanup_fails(monkeypatch):
    import asyncio
    from app.services import robot_transport
    class Encoder:
        closed=False
        def __init__(self,*a,**k): pass
        def finish(self): return []
        def close(self): Encoder.closed=True
    class Stream:
        def __aiter__(self): return self
        async def __anext__(self): raise StopAsyncIteration
        async def aclose(self): raise RuntimeError('fixture cleanup failure')
    class Delegate:
        def synthesize(self,*args): return Stream()
    from app.models.llm import ConversationKey
    from app.models.tts import PlaybackScope, TTSRequest, TTSConfig
    from app.services.robot_transport import OPUS_FORMAT
    monkeypatch.setattr(robot_transport,'PCMOpusFrames',Encoder)
    request=TTSRequest(PlaybackScope(ConversationKey('u','s','d'),'t','g'),0,'Chào.',TTSConfig('mock','mock','vi',OPUS_FORMAT))
    async def scenario():
        with pytest.raises(RuntimeError):
            async for _ in robot_transport.OpusTTSAdapter(Delegate()).synthesize(request,None): pass
    asyncio.run(scenario())
    assert Encoder.closed


def test_gemini_wav_tts_transport_resamples_and_encodes_ordered_frames(monkeypatch):
    import asyncio, io, wave, struct
    from app.models.audio import AudioMetadata
    from app.models.llm import ConversationKey
    from app.models.tts import PlaybackScope, TTSConfig, TTSRequest, TTSAudioChunk
    from app.services import robot_transport

    wav_stream = io.BytesIO()
    with wave.open(wav_stream, "wb") as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
        wav.writeframes(struct.pack("<" + "h" * 2400, *([700] * 2400)))
    source_format = robot_transport.AudioFormat(AudioMetadata("pcm", 24000, 1, 60, "s16le"), "wav")
    source_config = TTSConfig("gemini-tts", "Kore", "vi-VN", source_format)
    class Stream:
        def __init__(self): self.closed = False
        def __aiter__(self): return self
        async def __anext__(self):
            if hasattr(self, "sent"): raise StopAsyncIteration
            self.sent = True
            return TTSAudioChunk(0, wav_stream.getvalue(), source_format)
        async def aclose(self): self.closed = True
    stream = Stream()
    class Provider:
        def synthesize(self, request, context):
            assert request.config == source_config
            return stream
    class Encoder:
        def __init__(self, rate, duration):
            assert (rate, duration) == (16000, 60); self.frames=[]; self.closed=False
        def encode(self, pcm):
            assert len(pcm) == 1920
            self.frames.append(pcm)
            return b"encoded-opus-frame"
        def close(self): self.closed=True
    made=[]
    def factory(*args):
        encoder=Encoder(*args); made.append(encoder); return encoder
    monkeypatch.setattr(robot_transport, "OpusCodec", factory)
    scope=PlaybackScope(ConversationKey("u", "s", "d"), "turn", "gen")
    request=TTSRequest(scope, 0, "Chào AIVA", TTSConfig("gemini-tts", "Kore", "vi-VN", robot_transport.OPUS_FORMAT))
    async def scenario():
        chunks=[chunk async for chunk in robot_transport.GeminiOpusTTSAdapter(Provider(), source_config).synthesize(request, type("Context", (), {"check": lambda self: None})())]
        assert [c.sequence for c in chunks] == [0, 1]
        assert all(c.audio_format == robot_transport.OPUS_FORMAT and c.payload == b"encoded-opus-frame" for c in chunks)
    asyncio.run(scenario())
    assert stream.closed and made[0].closed and len(made[0].frames)==2
    # This test substitutes the encoder and proves adapter wiring/metadata only;
    # it does not establish that libopus emitted valid packets or prove playback.


@pytest.mark.parametrize("previous,current,valid", [(100, 160, True), (0xffffffd0, 20, True), (100, 100, False), (160, 100, False)])
def test_v2_audio_timestamp_order(previous, current, valid):
    from app.api.robot_websocket import validate_timestamp_order
    from app.models.audio import AudioFrame
    if valid:
        assert validate_timestamp_order(2, AudioFrame(b"packet", current), previous) == current
    else:
        with pytest.raises(ValueError, match="timestamp"):
            validate_timestamp_order(2, AudioFrame(b"packet", current), previous)
