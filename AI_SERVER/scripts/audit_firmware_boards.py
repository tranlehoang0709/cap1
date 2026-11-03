"""Read-only inventory; firmware profile existence does not prove physical identity."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
FIRMWARE = ROOT / 'xiaozhi-esp32'


def inventory():
    boards = []
    kconfig = (FIRMWARE / 'main/Kconfig.projbuild').read_text(encoding='utf-8-sig')
    cmake = (FIRMWARE / 'main/CMakeLists.txt').read_text(encoding='utf-8-sig')
    for path in sorted((FIRMWARE / 'main/boards').rglob('config.json')):
        config = json.loads(path.read_text(encoding='utf-8-sig'))
        files = sorted(p for p in path.parent.rglob('*') if p.is_file() and p.suffix in ('.h','.cc','.cpp','.txt'))
        texts = [(str(p.relative_to(FIRMWARE)),p.read_text(encoding='utf-8-sig',errors='replace')) for p in files]
        pins = {name: [line.strip() for line in text.splitlines() if re.search(r'^\s*#define\s+.*(?:GPIO|DISPLAY_|AUDIO_)',line)] for name,text in texts}
        boards.append(dict(path=str(path.parent.relative_to(FIRMWARE)),target=config.get('target'),type=config.get('type'),
            variants=config.get('builds',[]),cmake_mentions_directory=path.parent.name in cmake,
            pins={key:value for key,value in pins.items() if value},
            codec_classes=sorted(set(re.findall(r'\b\w*(?:AudioCodec|AudioCodecSimplex|AudioCodecDuplex)\b','\n'.join(t for _,t in texts)))),
            factory_count=sum(text.count('DECLARE_BOARD(') for _,text in texts),
            physical_identity='UNVERIFIED'))
    defaults={str(p.relative_to(FIRMWARE)):p.read_text() for p in sorted(FIRMWARE.glob('sdkconfig.defaults*'))}
    return dict(board_count=len(boards),variant_count=sum(len(b['variants']) for b in boards),
        note='Source inventory only. No selected sdkconfig, approved two-board mapping or physical validation inferred.',
        kconfig_board_options=re.findall(r'^\s*config (BOARD_TYPE_\w+)',kconfig,re.M),sdkconfig_defaults=defaults,boards=boards)

if __name__ == '__main__':
    print(json.dumps(inventory(),ensure_ascii=False,indent=2))
