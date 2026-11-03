import asyncio
import time
from types import SimpleNamespace
import pytest
from app.services.audio_context import AudioContext
from app.services.robot_transport import RobotAudioOutput


def test_opus_delivery_is_paced_but_never_proves_playback_complete():
    class Socket:
        def __init__(self): self.times = []
        async def send_bytes(self, packet): self.times.append(time.monotonic())
        async def send_json(self, payload): pass
    async def scenario():
        socket = Socket()
        output = RobotAudioOutput(socket, 'session', 1)
        scope = SimpleNamespace(turn_id='turn', generation='playback')
        output.scope = scope
        output.ready.set()
        context = AudioContext(deadline=time.monotonic()+3)
        audio = SimpleNamespace(scope=scope, chunk=SimpleNamespace(payload=b'opus-packet'))
        for _ in range(3): await output.write(audio, context)
        assert len(socket.times) == 3
        assert all(b-a >= .05 for a,b in zip(socket.times, socket.times[1:]))
        await output.finish(scope, context)
        assert not output.complete.is_set()
        output.acknowledge({'session_id':'session', 'turn_id':'turn', 'playback_id':'playback',
                            'state':'complete', 'audio_chunks':3})
        assert output.complete.is_set()
    asyncio.run(scenario())


def test_cancelled_turn_sends_no_packet_while_pacing():
    class Socket:
        async def send_bytes(self, packet): raise AssertionError('cancelled packet sent')
    async def scenario():
        output = RobotAudioOutput(Socket(), 'session', 1)
        scope = SimpleNamespace(turn_id='turn', generation='playback')
        output.scope = scope; output.ready.set()
        output.next_packet_at = time.monotonic()+1
        context = AudioContext(deadline=time.monotonic()+2)
        async def cancel():
            await asyncio.sleep(.02)
            context.cancel()
        task = asyncio.create_task(cancel())
        from app.models.audio import AudioError
        with pytest.raises(AudioError):
            await output.write(SimpleNamespace(scope=scope,chunk=SimpleNamespace(payload=b'packet')),context)
        await task
        assert output.count == 0
    asyncio.run(scenario())
