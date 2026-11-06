"""Explicit offline browser fixture. Never start this as the production app."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", action="store_true", required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--browser-script", type=Path, default=Path(__file__).with_name("restored_browser.mjs"))
    args = parser.parse_args()
    artifacts = args.artifacts.resolve()
    if artifacts == ROOT or ROOT in artifacts.parents:
        raise SystemExit("Keep generated browser evidence outside the repository.")
    artifacts.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location("restoration_fixture", ROOT/"checks/test_restored_frontend.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fixture = module.UIBackendFixture()
    fixture.devices = [{"id": str(i), "device_uid": "fixture-robot-"+str(i), "display_name": "Xiaozhi fixture "+str(i),
                        "connection_status": "online" if i % 2 else "offline", "lifecycle_status": "assigned",
                        "battery_percent": 82, "wifi_rssi": -55, "last_seen_at": "2026-11-06T00:00:00Z"}
                       for i in range(1, 7)]
    fixture.conversations = [{"id": str(90+i), "user_id": "7", "title": "Fixture conversation "+str(i+1),
                              "started_at": "2026-11-06T00:00:00Z", "status": "completed", "channel": "web"}
                             for i in range(12)]
    fixture.details = {row["id"]: {"id": row["id"], "user_id": "7",
                       "messages": [{"role": "user", "content": "Synthetic fixture question"},
                                    {"role": "assistant", "content": "Saved fixture answer"}]}
                       for row in fixture.conversations}
    lock = threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *unused):
            pass
        def do_GET(self):
            self.respond("GET")
        def do_POST(self):
            self.respond("POST")
        def do_PATCH(self):
            self.respond("PATCH")
        def do_DELETE(self):
            self.respond("DELETE")
        def do_PUT(self):
            self.respond("PUT")
        def respond(self, method):
            from urllib.parse import urlsplit, parse_qs
            parts = urlsplit(self.path)
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0")))) if method != "GET" and self.headers.get("Content-Length") else None
            query = {k:v[0] for k,v in parse_qs(parts.query).items()}
            status = 200
            with lock:
                fixture.role = "ADMIN" if self.headers.get("Authorization") == "Bearer fixture-admin" else "USER"
                if parts.path.startswith("/admin") and fixture.role != "ADMIN":
                    status, value = 403, {"message": "Fixture permission denied"}
                elif parts.path == "/web-chat/messages":
                    if fixture.role != "USER" or set(body or {}) != {"content"}:
                        status, value = 400, {"message": "Content-only fixture contract required"}
                    else:
                        fixture.calls.append((parts.path, method, None, None))
                        value = {"id": "110", "user_id": "7", "messages": [
                            {"role": "user", "content": body["content"]},
                            {"role": "assistant", "content": "Fixture browser answer. No provider was called."}]}
                else:
                    try:
                        value = fixture.api(parts.path, method, body, query=query)
                    except module.BackendError as error:
                        status, value = error.status or 503, {"message": error.message}
            data = json.dumps(value).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    env = dict(os.environ)
    env.update(AIVA_BACKEND_URL=f"http://127.0.0.1:{server.server_port}", AIVA_DATA_MODE="API",
               PYTHONDONTWRITEBYTECODE="1", STREAMLIT_BROWSER_GATHER_USAGE_STATS="false")
    log = (artifacts/"streamlit.log").open("w", encoding="utf-8")
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = subprocess.Popen([sys.executable, "-B", "-m", "streamlit", "run", str(ROOT/"app.py"),
        "--server.address", "127.0.0.1", "--server.port", str(port), "--server.headless", "true",
        "--browser.gatherUsageStats", "false"], cwd=ROOT, env=env, stdout=log, stderr=log,
        creationflags=creationflags)
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError("Fixture Streamlit exited; see isolated artifact log.")
            try:
                with urlopen(f"http://127.0.0.1:{port}/_stcore/health", timeout=.2) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError("Fixture Streamlit did not start.")
        browser_env = dict(env, AIVA_RESTORED_URL=f"http://127.0.0.1:{port}", AIVA_RESTORED_ARTIFACTS=str(artifacts))
        print(json.dumps({"fixture_only": True, "url": browser_env["AIVA_RESTORED_URL"]}), flush=True)
        result = subprocess.run(["node", str(args.browser_script)], env=browser_env, cwd=ROOT, timeout=900)
        (artifacts/"request-summary.json").write_text(json.dumps({
            "fixture_only": True, "requests": len(fixture.calls),
            "mutations": [{"path": item[0], "method": item[1]} for item in fixture.calls if item[1] != "GET"]}, indent=2))
        return result.returncode
    finally:
        server.shutdown()
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        log.close()


if __name__ == "__main__":
    raise SystemExit(main())
