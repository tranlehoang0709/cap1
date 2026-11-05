"""Private SD2 USB diagnostic commands; Cloud API keys never leave AI_SERVER."""
import argparse
import ipaddress
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def read_lines(port, seconds, redact=()):
    deadline = time.monotonic() + seconds
    buffer = bytearray()
    lines = []
    while time.monotonic() < deadline:
        data = port.read(port.in_waiting or 1)
        if not data:
            continue
        buffer.extend(data)
        while b'\n' in buffer:
            raw, _, rest = buffer.partition(b'\n')
            buffer = bytearray(rest)
            line = re.sub(r'\x1b\[[0-9;]*m', '', raw.decode('utf-8', errors='replace')).strip()
            for secret in redact:
                if secret:
                    line = line.replace(secret, '<redacted>')
            lines.append(line)
            if any(marker in line for marker in ('AIVA_', 'WS:', 'WebSocket:', 'StateMachine:',
                                                  'LAN server admitted microphone turn',
                                                  'LAN microphone turn ended',
                                                  'Guru Meditation', 'Backtrace', 'panic', 'ERROR', 'failed')):
                print(line, flush=True)
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('configure', 'status', 'record', 'stop'))
    parser.add_argument('--port', required=True)
    parser.add_argument('--url')
    parser.add_argument('--version', type=int, choices=(1, 2, 3), default=1)
    parser.add_argument('--seconds', type=float, default=5)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 12:
        parser.error('--seconds must be between 1 and 12')
    import serial
    from app.core.robot_config import RobotSettings
    settings = RobotSettings()
    token = settings.token.get_secret_value() if settings.token else ''
    command_token = token
    if args.command == 'configure':
        if not args.url:
            parser.error('--url is required for configure')
        parsed = urlsplit(args.url)
        try:
            private = ipaddress.ip_address(parsed.hostname).is_private
        except ValueError:
            private = False
        if parsed.scheme not in ('ws', 'wss') or not private or parsed.username or parsed.password or parsed.query or len(args.url) > 256:
            parser.error('Use an explicit private IP WebSocket URL without embedded credentials')
        lan_device_auth = parsed.scheme == 'wss' and bool(settings.local_device_credentials)
        if lan_device_auth:
            # LAN firmware authenticates with the separately provisioned per-device proof.
            command_token = '-'
        elif not 32 <= len(token) <= 128 or any(c.isspace() for c in token):
            parser.error('Configure AI_SERVER_ROBOT_TOKEN in .env first')
    port = serial.Serial()
    port.port, port.baudrate, port.timeout = args.port, 115200, .1
    port.dtr = port.rts = False
    port.open()
    try:
        port.write(b'\n')  # Discard any partial command left by a closed USB host.
        port.flush()
        read_lines(port, .2, (token, command_token))
        if args.command == 'configure':
            port.write(f'ws {args.url} {command_token} {args.version}\n'.encode('ascii'))
            lines = read_lines(port, 3, (token, command_token))
            if not any('AIVA_WS saved' in line for line in lines):
                raise SystemExit('SD2 did not confirm configuration; check dev-voice firmware and idle state.')
            port.write(b'reboot\n')
            port.flush()
            read_lines(port, 2, (token, command_token))
            print('SD2 restarting to apply the connection settings.', flush=True)
        elif args.command == 'record':
            port.write(b'record\n')
            lines = read_lines(port, 3, (token,))
            if any('AIVA_RECORD rejected' in line for line in lines):
                raise SystemExit('Device is busy; recording was not started.')
            print('Speak now. USB stop will be sent automatically.', flush=True)
            read_lines(port, args.seconds, (token,))
            port.write(b'stop\n')
            read_lines(port, 50, (token,))
            port.write(b'status\n')
            read_lines(port, 2, (token,))
        else:
            port.write((args.command+'\n').encode('ascii'))
            read_lines(port, 2, (token,))
    finally:
        port.close()


if __name__ == '__main__':
    main()
