"""Standalone local process. Reads only .env.local, never the cloud .env."""
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
import uvicorn


def main():
    load_dotenv(ROOT / ".env.local", override=False)
    os.environ["AI_RUNTIME"] = "local"
    uvicorn.run("app.main:app", host="127.0.0.1", port=8002, reload=False,
                proxy_headers=False)


if __name__ == "__main__":
    main()
