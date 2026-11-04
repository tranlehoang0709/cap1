"""One explicit real Web Chat request with hidden user JWT, no key fallback."""
import argparse
import getpass
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import httpx
from app.core.backend_config import BackendSettings


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--provider-id',required=True)
    args=parser.parse_args()
    origin=BackendSettings().url.rstrip('/')
    jwt=getpass.getpass('User access JWT (hidden): ')
    try:
        with httpx.Client(timeout=100,trust_env=False,follow_redirects=False) as client:
            response=client.post(origin+'/web-chat/messages',headers={'Authorization':'Bearer '+jwt},
                json={'content':'Trả lời ngắn gọn: 2 + 2 bằng mấy?','provider_id':args.provider_id})
        if response.status_code not in (200,201):
            print('LIVE BLOCKED/FAIL: Web Chat HTTP',response.status_code,'(no retry)')
            return 2
        data=response.json()
        if not isinstance(data.get('content'),str) or not data['content'].strip() or not data.get('usage'):
            print('LIVE FAIL: incomplete response')
            return 2
        print('LIVE response received. Verify the persisted rows before marking E2E PASS.')
        print('conversation_id:',data['conversation_id'])
        print('usage:',data['usage'])
        return 0
    except Exception as error:
        print('LIVE BLOCKED/FAIL:',type(error).__name__,'(details hidden, no retry)')
        return 2


if __name__=='__main__':
    raise SystemExit(main())
