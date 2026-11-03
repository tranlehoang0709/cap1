from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.services import opus_codec
from app.services.opus_codec import CodecError
from app.core.config import Settings


def test_empty_optional_opus_path_uses_system_discovery():
    assert Settings(_env_file=None, opus_library='').opus_library is None


def test_system_opus_discovery_remains_supported(monkeypatch):
    monkeypatch.setattr(opus_codec, 'get_settings', lambda: SimpleNamespace(opus_library=None))
    monkeypatch.setattr(opus_codec.ctypes.util, 'find_library', lambda name: 'system-opus')
    loader = Mock(return_value=object())
    monkeypatch.setattr(opus_codec.c, 'CDLL', loader)
    assert opus_codec._load_opus_library() is loader.return_value
    loader.assert_called_once_with('system-opus')


def test_explicit_opus_library_does_not_search_global_path(monkeypatch):
    monkeypatch.setattr(opus_codec, 'get_settings', lambda: SimpleNamespace(opus_library='local/opus.dll'))
    finder = Mock(side_effect=AssertionError('must not search PATH'))
    loader = Mock(return_value=object())
    monkeypatch.setattr(opus_codec.ctypes.util, 'find_library', finder)
    monkeypatch.setattr(opus_codec.c, 'CDLL', loader)
    assert opus_codec._load_opus_library() is loader.return_value
    loader.assert_called_once_with('local/opus.dll')


def test_missing_native_library_fails_closed(monkeypatch):
    monkeypatch.setattr(opus_codec, 'get_settings', lambda: SimpleNamespace(opus_library=None))
    monkeypatch.setattr(opus_codec.ctypes.util, 'find_library', lambda name: None)
    with pytest.raises(CodecError, match='libopus unavailable'):
        opus_codec._load_opus_library()


def test_bad_dll_is_normalized_without_leaking_os_error(monkeypatch):
    monkeypatch.setattr(opus_codec, 'get_settings', lambda: SimpleNamespace(opus_library='local/opus.dll'))
    monkeypatch.setattr(opus_codec.c, 'CDLL', Mock(side_effect=OSError('private loader details')))
    with pytest.raises(CodecError) as error:
        opus_codec._load_opus_library()
    assert str(error.value) == 'libopus unavailable'
