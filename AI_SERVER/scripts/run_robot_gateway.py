"""Run only behind Tailscale Funnel on this machine."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.robot_gateway:create_gateway", factory=True,
                host="127.0.0.1", port=8081, proxy_headers=False,
                access_log=False, ws_max_size=4096, ws_max_queue=16,
                ws_ping_interval=20, ws_ping_timeout=20, timeout_keep_alive=5,
                timeout_graceful_shutdown=10, limit_concurrency=64)
