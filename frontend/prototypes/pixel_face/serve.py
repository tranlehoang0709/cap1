"""Phục vụ prototype local với MIME ES module đúng trên cả Windows."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class PreviewHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".mjs": "text/javascript; charset=utf-8",
                      ".js": "text/javascript; charset=utf-8",
                      ".css": "text/css; charset=utf-8"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AIVA Pixel Face local preview")
    parser.add_argument("--port", type=int, default=8510)
    args = parser.parse_args()
    handler = partial(PreviewHandler, directory=str(Path(__file__).resolve().parent))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Pixel Face: http://127.0.0.1:{args.port}/", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
