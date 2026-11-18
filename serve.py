#!/usr/bin/env python3
"""
serve.py — CLIN-7 진료 프로토콜 로컬 웹서버 (M0)

- 바인딩: 127.0.0.1:8765 전용 (외부 노출 금지)
- 정적 파일: web/ 디렉터리
- 데이터 계약: /tree.json (루트 tree.json 제공)
"""

from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
from pathlib import Path
import sys
from urllib.parse import unquote, urlparse

WORKSPACE_ROOT = Path(__file__).resolve().parent
WEB_DIR = WORKSPACE_ROOT / "web"
TREE_JSON_PATH = WORKSPACE_ROOT / "tree.json"

HOST = "127.0.0.1"
PORT = 8765

mimetypes.add_type("application/json; charset=utf-8", ".json")
mimetypes.add_type("application/javascript; charset=utf-8", ".js")
mimetypes.add_type("text/css; charset=utf-8", ".css")
mimetypes.add_type("text/html; charset=utf-8", ".html")
mimetypes.add_type("application/manifest+json; charset=utf-8", ".webmanifest")


class ProtocolRequestHandler(SimpleHTTPRequestHandler):
    """web/ 정적 파일과 루트 tree.json을 제공하는 핸들러."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        clean_path = unquote(parsed.path)

        if clean_path == "/tree.json":
            self._serve_file(TREE_JSON_PATH, "application/json; charset=utf-8")
            return

        if clean_path in ("/", "/index.html"):
            self._serve_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
            return

        super().do_GET()

    def _serve_file(self, file_path: Path, content_type: str) -> None:
        if not file_path.exists() or not file_path.is_file():
            self.send_error(404, f"File not found: {file_path.name}")
            return
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(f"[serve] {self.address_string()} - {fmt % args}\n")


def run_server(host: str = HOST, port: int = PORT) -> None:
    if not TREE_JSON_PATH.exists():
        import build_tree
        build_tree.main()

    server = ThreadingHTTPServer((host, port), ProtocolRequestHandler)
    print(f"[serve] CLIN-7 진료 프로토콜 뷰 서버 시작: http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] 서버 종료")
    finally:
        server.server_close()


if __name__ == "__main__":
    run_server()
