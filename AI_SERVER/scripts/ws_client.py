"""Finite local echo client, not a robot emulator or an AI protocol client."""

import argparse
import asyncio
from ipaddress import ip_address
import math
from pathlib import Path
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidHandshake

from app.core.config import ConfigurationError, get_settings


def local_url(value: str) -> str:
    try:
        url = urlsplit(value)
        host = url.hostname
        local = host == "localhost" or (host is not None and ip_address(host).is_loopback)
        if (
            url.scheme != "ws" or not local or url.username is not None
            or url.password is not None or url.query or url.fragment
            or url.path != "/ws/dev-echo" or (url.port is not None and url.port < 1)
        ):
            raise ValueError
    except ValueError:
        raise argparse.ArgumentTypeError("Use a loopback ws:// URL with path /ws/dev-echo, without credentials") from None
    return value


def positive_timeout(value: str) -> float:
    try:
        timeout = float(value)
        if not math.isfinite(timeout) or timeout <= 0:
            raise ValueError
    except ValueError:
        raise argparse.ArgumentTypeError("timeout must be a finite positive number") from None
    return timeout


async def exchange(url: str, message: str, timeout: float, limit: int, binary: bool) -> None:
    # Bound the entire exchange as well as individual network operations.
    async with asyncio.timeout(timeout * 4):
        async with connect(
            url, open_timeout=timeout, close_timeout=timeout, ping_interval=None,
            max_size=limit, compression=None, proxy=None,
        ) as websocket:
            print("Handshake OK (Development echo; no Xiaozhi compatibility claim)")
            await asyncio.wait_for(websocket.send(message.encode("utf-8") if binary else message), timeout)
            reply = await asyncio.wait_for(websocket.recv(), timeout)
            if not isinstance(reply, str) or reply != message:
                raise ValueError("Unexpected echo response")
            print(f"Echo OK: {len(reply.encode('utf-8'))} UTF-8 bytes")
        code = websocket.close_code if websocket.close_code is not None else 1006
        if code != 1000:
            print(f"Connection closed: code {code}", file=sys.stderr)
            raise ValueError("Expected normal close code 1000")
        print(f"Connection closed cleanly ({code})")


def main() -> int:
    try:
        settings = get_settings()
    except ConfigurationError as error:
        print(str(error), file=sys.stderr)
        return 2
    host = f"[{settings.host}]" if ":" in settings.host else settings.host
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", type=local_url, default=f"ws://{host}:{settings.port}/ws/dev-echo")
    parser.add_argument("--message", default="AIVA-IoT transport test")
    parser.add_argument("--timeout", type=positive_timeout, default=5.0)
    parser.add_argument("--binary", action="store_true", help="Negative test: server should close with 1003")
    args = parser.parse_args()
    try:
        asyncio.run(exchange(args.url, args.message, args.timeout, settings.ws_max_message_bytes, args.binary))
    except ConnectionClosed as error:
        code = error.rcvd.code if error.rcvd is not None else 1006
        print(f"Server closed connection: code {code}", file=sys.stderr)
        return 1
    except (TimeoutError, OSError, InvalidHandshake, ValueError):
        print("Connection failed, timed out, or returned an invalid echo; check local server and URL", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Client stopped", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
