"""Restore the unmodified official ML307 archive, only after provenance checks."""
import argparse
import hashlib
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
import zipfile

ARCHIVE_SHA256 = '6fc750a6dfe8e5723ea8884bb7f5296a3cc03d1f2d4226f742c4be860dc6e6d0'
FILES = {
    'idf_component.yml': '0a57a79752066530dc83dc9744f248ffa9a4edfa9631430decd4beff04526dd1',
    'include/web_socket.h': '89575b7197fdc66472571b97257284e92195f7506f10ca33e7adfeb4b7f7ab59',
    'src/web_socket.cc': 'b7709bfcc4db43e554b8f06d310553aa3663207935b06bef41bd98765517b852',
}


def restore(archive: Path, destination: Path):
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA256:
        raise ValueError('Archive SHA-256 mismatch; refusing restoration')
    if destination.exists():
        raise ValueError('Destination already exists; refusing overwrite')
    with zipfile.ZipFile(archive) as package:
        for name, expected in FILES.items():
            canonical = package.read('esp-ml307/' + name).replace(b'\r\n', b'\n')
            if hashlib.sha256(canonical).hexdigest() != expected:
                raise ValueError('Component source mismatch')
        members = []
        total = 0
        for info in package.infolist():
            path = PurePosixPath(info.filename)
            if (not path.parts or path.parts[0] != 'esp-ml307' or '..' in path.parts
                or path.is_absolute() or '\\' in info.filename
                or stat.S_ISLNK(info.external_attr >> 16)):
                raise ValueError('Unsafe archive member')
            total += info.file_size
            if total > 2_000_000:
                raise ValueError('Archive extraction budget exceeded')
            members.append((info, Path(*path.parts[1:])))
        destination.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix='.ml307-restore-', dir=destination.parent))
        try:
            for info, relative in members:
                target = staging / relative
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(package.read(info))
            staging.rename(destination)
        finally:
            if staging.exists():
                shutil.rmtree(staging)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True, type=Path)
    args = parser.parse_args()
    destination = Path(__file__).resolve().parents[2] / 'xiaozhi-esp32/managed_components/78__esp-ml307'
    restore(args.archive, destination)
    print('Restored verified ML307 3.6.6 archive; not an SDK build or full dependency resolution.')
