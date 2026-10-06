from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
import json
from typing import Any, Mapping

from frontier_v5.runtime.mcp_2026 import MCP2026Error
from frontier_v5.runtime.operator_bridge import OperatorBridge
from frontier_v5.runtime.operator_mcp import build_operator_mcp


class OperatorHTTPError(RuntimeError):
    pass


class OperatorHTTPApplication:
    """Private authenticated HTTP adapter for the AXIOM Operator MCP.

    Authentication is a caller-supplied bearer token. The adapter grants no
    authority beyond the injected OperatorBridge. It does not implement OAuth,
    TLS termination, public discovery, deployment, or secret retrieval.
    """

    def __init__(self, *, bridge: OperatorBridge, bearer_token: str) -> None:
        if not isinstance(bridge, OperatorBridge):
            raise TypeError("bridge must be OperatorBridge")
        if not isinstance(bearer_token, str) or len(bearer_token) < 16 or any(ch in bearer_token for ch in "\r\n"):
            raise ValueError("bearer_token must be a non-empty secret of at least 16 characters")
        self.bridge = bridge
        self._bearer_token = bearer_token
        self.mcp = build_operator_mcp(bridge)

    @staticmethod
    def _headers(headers: Mapping[str, Any]) -> dict[str, str]:
        return {str(k).lower(): str(v) for k, v in dict(headers or {}).items()}

    def _authorized(self, headers: Mapping[str, Any]) -> bool:
        value = self._headers(headers).get("authorization", "")
        prefix = "Bearer "
        if not value.startswith(prefix):
            return False
        return hmac.compare_digest(value[len(prefix):], self._bearer_token)

    @staticmethod
    def _json_error(status: int, code: str, message: str) -> tuple[int, dict[str, str], dict[str, Any]]:
        return status, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        }, {"error": code, "message": message}

    def handle(
        self,
        method: str,
        path: str,
        headers: Mapping[str, Any],
        body: bytes,
    ) -> tuple[int, dict[str, str], dict[str, Any]]:
        method = str(method or "").upper()
        path = str(path or "").split("?", 1)[0]

        if method == "GET" and path == "/health":
            return 200, {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
            }, {
                "schema": "musitu.axiom.operator-health.v1",
                "status": "READY",
                "surface": "PRIVATE_OPERATOR",
                "production_authority": False,
                "public_submission_mutation_authority": False,
                "external_provider_execution_authority": self.bridge.provider_router is not None,
            }

        if path != "/mcp":
            return self._json_error(404, "NOT_FOUND", "private operator endpoint not found")
        if method != "POST":
            return self._json_error(405, "METHOD_NOT_ALLOWED", "POST required")
        if not self._authorized(headers):
            return self._json_error(401, "UNAUTHORIZED", "valid private operator bearer authorization required")

        normalized = self._headers(headers)
        content_type = normalized.get("content-type", "")
        if "application/json" not in content_type.lower():
            return self._json_error(415, "UNSUPPORTED_MEDIA_TYPE", "application/json required")
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            return self._json_error(400, "INVALID_JSON", "valid UTF-8 JSON request required")
        if not isinstance(payload, Mapping):
            return self._json_error(400, "INVALID_JSON_RPC", "JSON-RPC request must be an object")

        try:
            status, response_headers, response = self.mcp.handle(headers, payload)
            return status, response_headers, response
        except MCP2026Error as exc:
            return self._json_error(400, "MCP_REQUEST_REJECTED", str(exc))
        except Exception:
            return self._json_error(500, "OPERATOR_INTERNAL_ERROR", "operator request failed")


def serve_operator_http(
    *,
    bridge: OperatorBridge,
    bearer_token: str,
    host: str = "127.0.0.1",
    port: int = 8765,
) -> None:
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise OperatorHTTPError("direct non-loopback binding is forbidden; use a separately reviewed TLS/auth proxy")
    if isinstance(port, bool) or not isinstance(port, int) or not (1 <= port <= 65535):
        raise OperatorHTTPError("port must be an integer from 1 to 65535")
    app = OperatorHTTPApplication(bridge=bridge, bearer_token=bearer_token)

    class Handler(BaseHTTPRequestHandler):
        server_version = "MUSITUAxiomOperator/1.0"

        def _run(self) -> None:
            length = self.headers.get("Content-Length", "0")
            try:
                size = int(length)
            except ValueError:
                size = -1
            if size < 0 or size > 2_000_000:
                status, response_headers, payload = app._json_error(413, "REQUEST_TOO_LARGE", "request body exceeds operator limit")
            else:
                raw = self.rfile.read(size) if size else b""
                status, response_headers, payload = app.handle(self.command, self.path, dict(self.headers.items()), raw)
            encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            for key, value in response_headers.items():
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self) -> None:
            self._run()

        def do_POST(self) -> None:
            self._run()

        def do_PUT(self) -> None:
            self._run()

        def do_DELETE(self) -> None:
            self._run()

        def log_message(self, format: str, *args: Any) -> None:
            return

    server = ThreadingHTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


__all__ = ["OperatorHTTPApplication", "OperatorHTTPError", "serve_operator_http"]
