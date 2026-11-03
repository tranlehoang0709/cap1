"""Inspect DNS, TCP/TLS, proxy, and unauthenticated Gemini endpoint reachability.

Never reads or prints Gemini credentials and does not make a billable API call.
"""

import importlib.metadata
import os
import socket
import ssl
import sys
import time
import urllib.parse

import httpx


HOST = "generativelanguage.googleapis.com"


def main() -> int:
    proxy = (os.getenv("HTTPS_PROXY") or os.getenv("https_proxy") or
             os.getenv("ALL_PROXY") or os.getenv("all_proxy"))
    if proxy:
        parsed = urllib.parse.urlsplit(proxy if "://" in proxy else "http://" + proxy)
        print(f"proxy=present scheme={parsed.scheme} host={parsed.hostname or 'invalid'} port={parsed.port or 'default'} auth_configured={bool(parsed.username or parsed.password)}")
    else:
        print("proxy=not_configured (SDK/httpx uses direct network)")

    dns_started = time.perf_counter()
    try:
        addresses = socket.getaddrinfo(HOST, 443, type=socket.SOCK_STREAM)
        dns_ms = (time.perf_counter() - dns_started) * 1000
        print(f"dns=PASS addresses={len(addresses)} latency_ms={dns_ms:.1f}")
    except Exception as error:
        dns_ms = None
        print(f"dns=FAIL error_type={type(error).__name__}")
        addresses = []

    direct_tcp = False
    if addresses:
        try:
            tcp_started = time.perf_counter()
            with socket.create_connection((HOST, 443), timeout=5) as connection:
                direct_tcp = True
                print(f"tcp_direct=PASS latency_ms={(time.perf_counter() - tcp_started) * 1000:.1f}")
                try:
                    tls_started = time.perf_counter()
                    with ssl.create_default_context().wrap_socket(connection, server_hostname=HOST) as tls:
                        print(f"tls_direct=PASS latency_ms={(time.perf_counter() - tls_started) * 1000:.1f} version={tls.version()} certificate_verified={bool(tls.getpeercert())}")
                except Exception as error:
                    print(f"tls_direct=FAIL error_type={type(error).__name__}")
        except Exception as error:
            print(f"tcp_direct=FAIL error_type={type(error).__name__}")
    else:
        print("tcp_direct=NOT_RUN (DNS failed)")
        print("tls_direct=NOT_RUN (DNS failed)")

    try:
        https_started = time.perf_counter()
        response = httpx.get(f"https://{HOST}/", timeout=8, follow_redirects=False)
        print(f"https_via_environment=PASS latency_ms={(time.perf_counter() - https_started) * 1000:.1f} status={response.status_code}; root-path status is not an API/model verdict")
    except Exception as error:
        chain = []
        current = error
        seen = set()
        while current is not None and id(current) not in seen:
            seen.add(id(current))
            chain.append(type(current).__name__)
            current = current.__cause__ or current.__context__
        print("https_via_environment=FAIL exception_chain=" + ">".join(chain[:5]))

    try:
        version = importlib.metadata.version("google-genai")
        print(f"google_genai_sdk=installed version={version}")
    except importlib.metadata.PackageNotFoundError:
        print("google_genai_sdk=missing")
    if not direct_tcp and not proxy:
        print("diagnosis=direct_outbound_blocked_before_TLS; not DNS, certificate, key, or model evidence")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
