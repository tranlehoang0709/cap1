"""Run with .env port, explicit advertised LAN origin and integrated auth."""
from pathlib import Path
import ssl
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import get_settings
from app.core.backend_config import BackendSettings
from app.core.lan_config import LanSettings
from app.core.robot_config import RobotSettings


def main():
    settings, backend, lan, robot = get_settings(), BackendSettings(), LanSettings(), RobotSettings()
    local_ready = (backend.mode == 'development-mock' and robot.enabled
                   and robot.ai_mode == 'gemini' and bool(robot.local_device_credentials))
    if settings.host != '0.0.0.0' or settings.reload or not (backend.mode == 'integrated' or local_ready):
        raise SystemExit('Use integrated Backend mode, or explicitly enable development-mock with Gemini and provisioned local device credentials.')
    from urllib.parse import urlsplit
    if not lan.public_origin or urlsplit(lan.public_origin).scheme != 'https' or (urlsplit(lan.public_origin).port or 443) != settings.port:
        raise SystemExit('Set AI_SERVER_LAN_PUBLIC_ORIGIN to an https:// LAN origin using AI_SERVER_PORT.')
    if not settings.tls_certfile or not settings.tls_keyfile:
        raise SystemExit('Set AI_SERVER_TLS_CERTFILE and AI_SERVER_TLS_KEYFILE; plaintext LAN gateway is disabled.')
    if not settings.tls_certfile.is_absolute() or not settings.tls_keyfile.is_absolute():
        raise SystemExit('TLS certificate and private key paths must be absolute.')
    if not settings.tls_certfile.is_file() or not settings.tls_keyfile.is_file():
        raise SystemExit('Configured TLS certificate or private key file is unavailable.')
    try:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(settings.tls_certfile, settings.tls_keyfile)
    except (OSError, ssl.SSLError, ValueError):
        raise SystemExit('Configured TLS certificate/key could not be loaded.') from None
    print('OTA:', lan.public_origin + '/xiaozhi/ota/')
    print('WebSocket:', lan.websocket_url())
    print('TLS: enabled (TLS 1.2 minimum; certificate verification is required by clients).')
    if backend.mode == 'integrated':
        print('Integrated media requires approved BE contracts, quota schema/policy, enabled Gemini model and valid BE-stored credential.')
    else:
        print('Standalone local Gemini mode: device UID/credential allowlist + private network ACL; 12 turns/minute per local credential. No Backend user/quota claim.')
    from scripts.run_dev import main as run
    run()


if __name__ == '__main__':
    main()
