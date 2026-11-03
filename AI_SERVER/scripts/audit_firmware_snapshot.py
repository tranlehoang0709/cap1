"""Read-only hash audit. Never updates baselines or downloads dependencies."""
import argparse
import hashlib
import json
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = SERVER_ROOT.parent


def audit(snapshot, server_root=SERVER_ROOT):
    problems = []
    for entry in snapshot['files']:
        path = (server_root / entry['path']).resolve()
        if not path.is_relative_to(server_root.parent.resolve()):
            problems.append({'path':entry['path'], 'status':'OUTSIDE_WORKSPACE'})
        elif not path.is_file():
            problems.append({'path':entry['path'], 'status':'MISSING'})
        else:
            actual = hashlib.sha256(path.read_bytes().replace(b'\r\n',b'\n')).hexdigest()
            if actual != entry['sha256']:
                problems.append({'path':entry['path'], 'status':'CHANGED',
                                 'expected':entry['sha256'], 'actual':actual})
    return problems

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',type=Path,default=SERVER_ROOT/'docs/firmware-snapshot-d2-s2-05-fix.json')
    args = parser.parse_args()
    result = audit(json.loads(args.snapshot.read_text()))
    print(json.dumps({'snapshot':args.snapshot.name,'problems':result},ensure_ascii=False,indent=2))
    raise SystemExit(bool(result))
