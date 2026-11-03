"""Offline provenance and safe extraction; never download during tests."""
import hashlib
import importlib.util
from pathlib import Path
import zipfile

import pytest

ROOT = Path(__file__).resolve().parents[1]

@pytest.fixture
def restore_module():
    spec = importlib.util.spec_from_file_location('restore_firmware_dependency', ROOT/'scripts/restore_firmware_dependency.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def package(tmp_path, module, monkeypatch, extra=None):
    archive=tmp_path/'component.zip'
    with zipfile.ZipFile(archive,'w') as z:
        for name in module.FILES: z.writestr('esp-ml307/'+name,b'fixture')
        if extra: z.writestr(extra,b'escape')
    monkeypatch.setattr(module,'ARCHIVE_SHA256',hashlib.sha256(archive.read_bytes()).hexdigest())
    monkeypatch.setattr(module,'FILES',{k:hashlib.sha256(b'fixture').hexdigest() for k in module.FILES})
    return archive


def test_restore_refuses_wrong_archive(tmp_path,restore_module):
    archive=tmp_path/'bad.zip'; archive.write_bytes(b'invalid')
    destination=tmp_path/'out'
    with pytest.raises(ValueError,match='SHA-256'): restore_module.restore(archive,destination)
    assert not destination.exists()


def test_restore_complete_and_no_overwrite(tmp_path,restore_module,monkeypatch):
    archive=package(tmp_path,restore_module,monkeypatch)
    destination=tmp_path/'managed'/'component'
    restore_module.restore(archive,destination)
    assert (destination/'include/web_socket.h').read_bytes()==b'fixture'
    with pytest.raises(ValueError,match='already exists'): restore_module.restore(archive,destination)
    assert not list(destination.parent.glob('.ml307-restore-*'))


@pytest.mark.parametrize('bad',['esp-ml307/../../escape','/absolute','other/file','esp-ml307/..\\escape'])
def test_restore_rejects_unsafe_members(tmp_path,restore_module,monkeypatch,bad):
    archive=package(tmp_path,restore_module,monkeypatch,bad)
    with pytest.raises(ValueError,match='Unsafe'): restore_module.restore(archive,tmp_path/'out')
    assert not (tmp_path/'out').exists()
