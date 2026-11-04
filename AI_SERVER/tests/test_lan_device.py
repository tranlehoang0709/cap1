from types import SimpleNamespace
from unittest.mock import Mock
import pytest
import serial
from app.models.backend import DeviceProof
from scripts import lan_device, sd2_console


def test_provision_requires_ack_and_never_sends_cloud_key(monkeypatch):
    credential = 'D' * 43
    proof = DeviceProof(deviceUid='sd2-provisioned', credential=credential)
    monkeypatch.setenv('GEMINI_API_KEY', 'cloud-key-must-stay-server-side')
    port = Mock()
    monkeypatch.setattr(serial, 'Serial', lambda: port)
    read = Mock(side_effect=[[], ['AIVA_PROOF saved; reboot required']])
    monkeypatch.setattr(sd2_console, 'read_lines', read)
    lan_device.provision('COM99', proof)
    wire = b''.join(call.args[0] for call in port.write.call_args_list)
    assert wire == b'\nproof sd2-provisioned ' + credential.encode() + b'\n'
    assert b'cloud-key' not in wire
    assert read.call_args.args[2] == (credential,)
    port.close.assert_called_once()


def test_provision_failure_does_not_report_success(monkeypatch):
    port = Mock()
    monkeypatch.setattr(serial, 'Serial', lambda: port)
    monkeypatch.setattr(sd2_console, 'read_lines', lambda *args: [])
    with pytest.raises(ValueError, match='did not acknowledge'):
        lan_device.provision('COM99', DeviceProof(deviceUid='sd2', credential='D' * 43))
    port.close.assert_called_once()
