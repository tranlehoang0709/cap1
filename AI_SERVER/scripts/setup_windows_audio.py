"""Configure the installed PyOgg native DLL, without displaying or replacing keys."""
from pathlib import Path
import ctypes
import os
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    if os.name != 'nt':
        raise SystemExit('Windows only; install libopus using the OS package manager elsewhere.')
    from dotenv import set_key
    env = ROOT / '.env'
    if not env.exists():
        raise SystemExit('Create AI_SERVER/.env first. Existing API keys will be preserved.')
    candidates = (Path(sys.prefix) / 'Lib/site-packages/pyogg').rglob('*opus*.dll')
    for path in candidates:
        if path.name.lower() not in ('opus.dll', 'libopus.dll', 'libopus-0.dll'):
            continue
        try:
            library = ctypes.CDLL(str(path))
            library.opus_get_version_string.restype = ctypes.c_char_p
            library.opus_get_version_string()
        except (OSError, AttributeError):
            continue
        set_key(env, 'AI_SERVER_OPUS_LIBRARY', path.resolve().as_posix())
        print('Native Opus configured in .env. API keys unchanged.')
        return 0
    raise SystemExit('No compatible Opus DLL found; install requirements-windows.txt in this venv.')


if __name__ == '__main__':
    raise SystemExit(main())
