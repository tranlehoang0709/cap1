from types import SimpleNamespace
from unittest.mock import Mock
import pytest
import serial
from scripts import sd2_console
from app.core import robot_config


def configure_args(monkeypatch, url):
    monkeypatch.setattr(sd2_console.sys, 'argv', ['sd2_console.py', 'configure', '--port', 'COM3', '--url', url])


def test_usb_configuration_sends_only_device_token_and_restarts(monkeypatch):
    lan_token = 'local-device-token-' + 'x' * 32
    cloud_key = 'fixture-cloud-key-must-stay-server-side'
    monkeypatch.setenv('GEMINI_API_KEY', cloud_key)
    monkeypatch.setattr(robot_config, 'RobotSettings', lambda: SimpleNamespace(token=SimpleNamespace(get_secret_value=lambda: lan_token)))
    port = Mock()
    monkeypatch.setattr(serial, 'Serial', lambda: port)
    monkeypatch.setattr(sd2_console, 'read_lines', Mock(side_effect=[[], ['AIVA_WS saved'], ['AIVA_USB_READY']]))
    configure_args(monkeypatch, 'ws://192.168.1.95:8000/ws/dev-robot')
    sd2_console.main()
    wire = b''.join(call.args[0] for call in port.write.call_args_list)
    assert lan_token.encode() in wire and cloud_key.encode() not in wire
    assert wire.endswith(b'reboot\n')
    assert wire.startswith(b'\nws ws://192.168.1.95:8000/ws/dev-robot ')
    port.close.assert_called_once()


def test_lan_wss_configuration_uses_provisioned_device_proof_not_shared_token(monkeypatch):
    cloud_key = 'fixture-cloud-key-must-stay-server-side'
    monkeypatch.setenv('GEMINI_API_KEY', cloud_key)
    monkeypatch.setattr(robot_config, 'RobotSettings', lambda: SimpleNamespace(
        token=None, local_device_credentials={'sd2-test': object()}))
    port = Mock()
    monkeypatch.setattr(serial, 'Serial', lambda: port)
    monkeypatch.setattr(sd2_console, 'read_lines', Mock(side_effect=[[], ['AIVA_WS saved'], ['AIVA_USB_READY']]))
    configure_args(monkeypatch, 'wss://192.168.0.104:8000/ws/robot')
    sd2_console.main()
    wire = b''.join(call.args[0] for call in port.write.call_args_list)
    assert b'ws wss://192.168.0.104:8000/ws/robot - 1\n' in wire
    assert cloud_key.encode() not in wire
    assert b'reboot\n' in wire
    port.close.assert_called_once()


@pytest.mark.parametrize('url', ['ws://8.8.8.8:8000/ws/dev-robot', 'ws://user:password@192.168.1.95:8000/ws/dev-robot'])
def test_usb_configuration_rejects_public_or_embedded_credentials(monkeypatch, url):
    monkeypatch.setattr(robot_config, 'RobotSettings', lambda: SimpleNamespace(token=SimpleNamespace(get_secret_value=lambda: 'x' * 43)))
    factory = Mock()
    monkeypatch.setattr(serial, 'Serial', factory)
    configure_args(monkeypatch, url)
    with pytest.raises(SystemExit): sd2_console.main()
    factory.assert_not_called()


def test_usb_configuration_requires_device_ack(monkeypatch):
    monkeypatch.setattr(robot_config, 'RobotSettings', lambda: SimpleNamespace(token=SimpleNamespace(get_secret_value=lambda: 'x' * 43)))
    port = Mock()
    monkeypatch.setattr(serial, 'Serial', lambda: port)
    monkeypatch.setattr(sd2_console, 'read_lines', lambda *a, **k: [])
    configure_args(monkeypatch, 'ws://192.168.1.95:8000/ws/dev-robot')
    with pytest.raises(SystemExit, match='did not confirm'): sd2_console.main()
    assert b'reboot\n' not in [call.args[0] for call in port.write.call_args_list]
    port.close.assert_called_once()
