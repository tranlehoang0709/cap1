"""Two real TCP WebSocket clients, native Opus and mocked playback ACK; no robot."""
import argparse
import asyncio
import ipaddress
import json
import math
import os
from pathlib import Path
import struct
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from websockets.asyncio.client import connect
from app.models.audio import AudioFrame
from app.protocol.audio_framing import FramingConfig, encode_audio_frame, validate_audio_frame
from app.services.opus_codec import OpusCodec


async def exercise(url, token, version):
    parts = urlsplit(url)
    if parts.scheme != 'ws' or parts.username or parts.password or parts.query:
        raise ValueError('Private ws:// URL without credentials/query required')
    if parts.hostname != 'localhost':
        address = ipaddress.ip_address(parts.hostname)
        allowed = ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7']
        if not any(address in ipaddress.ip_network(n) for n in allowed):
            raise ValueError('Local/private development only')
    headers = {'Authorization':'Bearer '+token,'Protocol-Version':str(version),'Device-Id':'mock-device-'+str(version),'Client-Id':'mock-client-'+str(version)}
    codec=OpusCodec(16000,60)
    async def receive(ws):
        return await asyncio.wait_for(ws.recv(),5)
    try:
        async with connect(url,additional_headers=headers,compression=None,ping_interval=None,max_size=4096) as ws:
            await ws.send(json.dumps(dict(type='hello',version=version,transport='websocket',features={'aiva_half_duplex_v1':True},audio_params=dict(format='opus',sample_rate=16000,channels=1,frame_duration=60))))
            session=json.loads(await receive(ws))['session_id']
            await ws.send(json.dumps(dict(type='listen',state='start',mode='auto',session_id=session)))
            pcm=struct.pack('<960h',*(int(4000*math.sin(i*.15)) for i in range(960)))
            await ws.send(encode_audio_frame(AudioFrame(codec.encode(pcm),0),FramingConfig(version,4096)))
            await ws.send(json.dumps(dict(type='listen',state='stop',session_id=session)))
            start=json.loads(await receive(ws))
            assert start['state']=='start'
            proof={k:start[k] for k in ('session_id','turn_id','playback_id')}
            # SIMULATED firmware readiness and drain: not physical playback proof.
            await ws.send(json.dumps(proof|dict(type='playback',state='ready',audio_chunks=0)))
            count=0
            while True:
                message=await receive(ws)
                if isinstance(message,bytes):
                    packet=validate_audio_frame(message,FramingConfig(version,1275))
                    assert len(codec.decode(packet.payload))==1920
                    count+=1
                else:
                    stop=json.loads(message)
                    assert stop['state']=='stop' and stop['audio_chunks']==count==2
                    break
            await ws.send(json.dumps(proof|dict(type='playback',state='complete',audio_chunks=count)))
            # Confirm server accepts next turn only after processing completion proof.
            await ws.send(json.dumps(dict(type='listen',state='start',mode='auto',session_id=session)))
            await ws.send(json.dumps(dict(type='abort',session_id=session)))
            from websockets.exceptions import ConnectionClosedOK
            try:
                await receive(ws)
            except ConnectionClosedOK:
                pass
            return dict(session_id=session,version=version,audio_chunks=count,decoded_samples=count*960,proof='SIMULATED, NOT HARDWARE')
    finally:
        codec.close()


async def main(url,token):
    results=await asyncio.gather(exercise(url,token,1),exercise(url,token,3))
    assert results[0]['session_id']!=results[1]['session_id']
    print(json.dumps(dict(result='PASS local TCP + native Opus + mock AI/ACK',sessions=results),ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='ws://127.0.0.1:8000/ws/dev-robot')
    args=parser.parse_args()
    asyncio.run(main(args.url,os.environ['AI_SERVER_ROBOT_TOKEN']))
