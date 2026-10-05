#!/usr/bin/env python3
"""Isolated local DAST server and hostile-probe suite for the vNext static app."""

from __future__ import annotations

import argparse
import http.client
import http.server
import pathlib
import threading
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2] / "axiom_interface" / "vnext"
CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'"


class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "MUSITU-Axiom-FA17"
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_args):
        return

    def end_headers(self):
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store" if self.path.endswith(("/", ".html", ".webmanifest", "service_worker.js")) else "public, max-age=300")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        raw = urllib.parse.urlsplit(path).path
        decoded = raw
        for _ in range(3): decoded = urllib.parse.unquote(decoded)
        decoded = decoded.replace("\\", "/")
        parts = [part for part in decoded.split("/") if part]
        if "\x00" in decoded or any(part in {".", ".."} or part.startswith(".") for part in parts):
            return str(ROOT / "__blocked__")
        relative = pathlib.PurePosixPath(*parts) if parts else pathlib.PurePosixPath("index.html")
        candidate = (ROOT / pathlib.Path(*relative.parts)).resolve()
        try: candidate.relative_to(ROOT.resolve())
        except ValueError: return str(ROOT / "__blocked__")
        if candidate.is_dir(): return str(ROOT / "__blocked__")
        return str(candidate)

    def do_POST(self):
        self.send_error(405, "Method not allowed")

    def do_PUT(self):
        self.send_error(405, "Method not allowed")

    def do_DELETE(self):
        self.send_error(405, "Method not allowed")


def request(port: int, method: str, path: str) -> tuple[int, dict[str, str], bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    connection.request(method, path, headers={"Host": "127.0.0.1", "Origin": "https://evil.invalid"})
    response = connection.getresponse(); body = response.read(); headers = {key.lower(): value for key, value in response.getheaders()}; connection.close()
    return response.status, headers, body


def self_test() -> None:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start(); port = server.server_port
    try:
        status, headers, body = request(port, "GET", "/index.html")
        assert status == 200 and b"MUSITU" in body
        for required in ["content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy", "cross-origin-opener-policy", "cross-origin-resource-policy"]: assert headers.get(required), required
        assert "access-control-allow-origin" not in headers
        assert request(port, "HEAD", "/manifest.webmanifest")[0] == 200
        for method in ["POST", "PUT", "DELETE"]: assert request(port, method, "/index.html")[0] == 405
        for path in ["/../.git/config", "/%2e%2e/%2e%2e/.git/config", "/.git/config", "/%252e%252e/.git/config", "/%00"]: assert request(port, "GET", path)[0] == 404, path
        assert request(port, "GET", "/does-not-exist")[0] == 404
        print("FA17_ISOLATED_DAST_PASS")
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=5)


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--self-test", action="store_true"); parser.add_argument("--port", type=int, default=8080); args = parser.parse_args()
    if args.self_test: self_test(); return 0
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever(); return 0


if __name__ == "__main__":
    raise SystemExit(main())
