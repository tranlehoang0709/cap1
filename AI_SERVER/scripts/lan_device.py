"""One-time USB proof provisioning or authenticated LAN control simulation."""
import argparse
import asyncio
import getpass
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.models.backend import DeviceProof


async def simulate(origin, proof):
    import httpx
    from websockets.asyncio.client import connect
    from app.api.lan_robot import AUDIO_PARAMS
    headers = {"Device-Uid": proof.deviceUid, "Device-Credential": proof.credential.get_secret_value(),
               "Protocol-Version": "1"}
    async with httpx.AsyncClient(timeout=10, trust_env=False, follow_redirects=False) as client:
        response = await client.post(origin.rstrip('/') + '/xiaozhi/ota/', headers=headers, json={"application": {"version": "simulator"}})
        print('OTA HTTP:', response.status_code)
        if response.status_code != 200:
            return 2
        url = response.json()['websocket']['url']
    expected = origin.replace('https://', 'wss://', 1).replace('http://', 'ws://', 1).rstrip('/') + '/ws/robot'
    if url != expected:
        raise ValueError('Advertised URL does not match the selected origin')
    sessions = set()
    for _ in range(2):
        async with connect(url, additional_headers=headers, compression=None, proxy=None,
                           max_size=4096, open_timeout=10, close_timeout=3) as ws:
            await ws.send(json.dumps({"type": "hello", "version": 1, "transport": "websocket",
                "audio_params": AUDIO_PARAMS, "features": {"aiva_half_duplex_v1": True, "aiva_lan_v1": True}}))
            session = json.loads(await asyncio.wait_for(ws.recv(), 10))['session_id']
            if session in sessions:
                raise ValueError('Session reused on reconnect')
            sessions.add(session)
            await ws.send(json.dumps({"type": "heartbeat", "session_id": session}))
            heartbeat = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if heartbeat.get('type') != 'heartbeat' or heartbeat.get('session_id') != session:
                raise ValueError('Invalid heartbeat response')
    print('PASS: authenticated OTA, hello, heartbeat and new session on reconnect.')
    print('Audio, Gemini execution and Wi-Fi hardware were not tested by this control-only simulator.')
    return 0


def provision(port_name, proof):
    import serial
    from scripts.sd2_console import read_lines
    credential = proof.credential.get_secret_value()
    port = serial.Serial()
    port.port, port.baudrate, port.timeout = port_name, 115200, .1
    port.dtr = port.rts = False
    port.open()
    try:
        port.write(b'\n')
        port.flush()
        read_lines(port, .2, (credential,))
        port.write(f'proof {proof.deviceUid} {credential}\n'.encode('ascii'))
        port.flush()
        lines = read_lines(port, 3, (credential,))
        if not any('AIVA_PROOF saved' in line for line in lines):
            raise ValueError('Device did not acknowledge proof; check LAN firmware and state')
        print('Proof stored. Configure Wi-Fi/OTA through the device captive portal, then power-cycle.')
    finally:
        port.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('provision', 'simulate'))
    parser.add_argument('--uid', required=True)
    parser.add_argument('--port')
    parser.add_argument('--origin')
    args = parser.parse_args()
    if args.command == 'provision' and not args.port:
        parser.error('--port is required')
    if args.command == 'simulate':
        from app.core.lan_config import LanSettings
        if not args.origin:
            parser.error('--origin is required')
        origin = LanSettings(_env_file=None, public_origin=args.origin).public_origin
    try:
        proof = DeviceProof(deviceUid=args.uid, credential=getpass.getpass('BE device credential (hidden): '))
        if not proof.deviceUid.isascii():
            raise ValueError('Firmware console requires ASCII device UID')
        if args.command == 'provision':
            provision(args.port, proof)
            return 0
        return asyncio.run(simulate(origin, proof))
    except Exception as error:
        # SDK, serial and validation errors must not expose credentials.
        print('Diagnostic failed:', type(error).__name__, '(check device, BE and server logs; values hidden)')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
