from __future__ import annotations

from http.server import BaseHTTPRequestHandler
import json
import os

from frontier_v5.runtime.operator_remote_core import execute_remote_mcp


MAX_BODY_BYTES=4_000_000


def _token_ok(value: str | None, expected: str) -> bool:
    if not value or not expected:
        return False
    prefix="Bearer "
    if not value.startswith(prefix):
        return False
    import hmac
    return hmac.compare_digest(value[len(prefix):], expected)


class handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        encoded=json.dumps(payload,separators=(",",":"),ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type","application/json; charset=utf-8")
        self.send_header("cache-control","no-store")
        self.send_header("content-length",str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self) -> None:
        expected=os.environ.get("AXIOM_OPERATOR_INTERNAL_TOKEN","")
        if not _token_ok(self.headers.get("authorization"),expected):
            self._json(401,{"error":"UNAUTHORIZED"})
            return
        try:
            length=int(self.headers.get("content-length","0"))
        except ValueError:
            length=-1
        if length < 0 or length > MAX_BODY_BYTES:
            self._json(413,{"error":"REQUEST_TOO_LARGE"})
            return
        try:
            raw=self.rfile.read(length) if length else b"{}"
            payload=json.loads(raw.decode("utf-8"))
        except Exception:
            self._json(400,{"error":"INVALID_JSON"})
            return
        if not isinstance(payload,dict):
            self._json(400,{"error":"INVALID_REQUEST"})
            return
        tenant=os.environ.get("AXIOM_OPERATOR_TENANT","operator")
        actor_id=os.environ.get("AXIOM_OPERATOR_ACTOR","operator-owner")
        try:
            result=execute_remote_mcp(
                state_pack=payload.get("state_pack"),
                tenant=tenant,
                actor_id=actor_id,
                headers=payload.get("headers") or {},
                message=payload.get("message") or {},
            )
        except Exception:
            self._json(500,{"error":"OPERATOR_CORE_FAILED"})
            return
        self._json(200,result)

    def do_GET(self) -> None:
        self._json(405,{"error":"METHOD_NOT_ALLOWED"})

    def log_message(self, format, *args):
        return
