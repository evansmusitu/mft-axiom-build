from __future__ import annotations

import fcntl
import gzip
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
from typing import Any, Mapping

from frontier_v5.runtime.operator_remote_core import execute_remote_mcp


class OperatorDaemonError(RuntimeError):
    pass


MAX_REQUEST_BYTES = 1_000_000
MAX_STATE_BYTES = 4_000_000


def _headers(headers: Mapping[str, Any]) -> dict[str, str]:
    return {str(k).lower(): str(v) for k, v in dict(headers or {}).items()}


def _authorized(headers: Mapping[str, Any], token: str) -> bool:
    value = _headers(headers).get("authorization", "")
    prefix = "Bearer "
    if not value.startswith(prefix):
        return False
    return hmac.compare_digest(value[len(prefix):], token)


class OperatorDaemonApplication:
    """Restart-durable private AXIOM Operator endpoint.

    Every MCP request acquires an OS-level exclusive lock over the state
    generation. Mutations write one integrity-hashed portable state pack with
    atomic replace. Read-only calls share the same serialization boundary so
    they cannot observe a half-committed generation.
    """

    def __init__(
        self,
        *,
        root: str | Path,
        tenant: str,
        actor_id: str,
        bearer_token: str,
        provider_router: Any | None = None,
    ) -> None:
        if not isinstance(bearer_token, str) or len(bearer_token) < 16 or any(ch in bearer_token for ch in "\r\n"):
            raise ValueError("bearer_token must contain at least 16 safe characters")
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.tenant = str(tenant).strip()
        self.actor_id = str(actor_id).strip()
        if not self.tenant or not self.actor_id:
            raise ValueError("tenant and actor_id are required")
        self.bearer_token = bearer_token
        self.provider_router = provider_router
        self.state_path = self.root / "operator-state-v1.json.gz"
        self.lock_path = self.root / "operator-state-v1.lock"

    @staticmethod
    def _json_error(status: int, code: str, message: str = "") -> tuple[int, dict[str, str], dict[str, Any]]:
        body: dict[str, Any] = {"error": code}
        if message:
            body["message"] = message
        return status, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
        }, body

    def _read_state(self) -> Mapping[str, Any] | None:
        if not self.state_path.exists():
            return None
        raw = self.state_path.read_bytes()
        if len(raw) > MAX_STATE_BYTES:
            raise OperatorDaemonError("compressed operator state exceeds limit")
        try:
            decoded = gzip.decompress(raw)
            if len(decoded) > MAX_STATE_BYTES * 8:
                raise OperatorDaemonError("operator state exceeds expanded limit")
            value = json.loads(decoded.decode("utf-8"))
        except OperatorDaemonError:
            raise
        except Exception as exc:
            raise OperatorDaemonError("operator state is unreadable") from exc
        if not isinstance(value, Mapping):
            raise OperatorDaemonError("operator state must be an object")
        return value

    def _write_state(self, state_pack: Mapping[str, Any]) -> None:
        raw = json.dumps(state_pack, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if len(raw) > MAX_STATE_BYTES * 8:
            raise OperatorDaemonError("operator state exceeds expanded limit")
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        if len(compressed) > MAX_STATE_BYTES:
            raise OperatorDaemonError("compressed operator state exceeds limit")
        tmp = self.state_path.with_suffix(self.state_path.suffix + ".tmp")
        with tmp.open("wb") as fh:
            fh.write(compressed)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self.state_path)
        try:
            dfd = os.open(self.root, os.O_RDONLY)
            try:
                os.fsync(dfd)
            finally:
                os.close(dfd)
        except OSError:
            pass

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
            state_present = self.state_path.exists()
            return 200, {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
            }, {
                "schema": "musitu.axiom.operator-daemon-health.v1",
                "status": "READY",
                "surface": "PRIVATE_OPERATOR_REMOTE",
                "durable_state": "LOCAL_ATOMIC_STATE_PACK_WITH_FILE_LOCK",
                "state_present": state_present,
                "production_authority": False,
                "public_submission_mutation_authority": False,
                "external_provider_execution_authority": self.provider_router is not None,
            }

        if path != "/mcp":
            return self._json_error(404, "NOT_FOUND")
        if method != "POST":
            return self._json_error(405, "METHOD_NOT_ALLOWED")
        if not _authorized(headers, self.bearer_token):
            return self._json_error(401, "UNAUTHORIZED")

        normalized = _headers(headers)
        if "application/json" not in normalized.get("content-type", "").lower():
            return self._json_error(415, "UNSUPPORTED_MEDIA_TYPE", "application/json required")
        if len(body) > MAX_REQUEST_BYTES:
            return self._json_error(413, "REQUEST_TOO_LARGE")
        try:
            message = json.loads(body.decode("utf-8"))
        except Exception:
            return self._json_error(400, "INVALID_JSON")
        if not isinstance(message, Mapping):
            return self._json_error(400, "INVALID_JSON_RPC")

        forwarded: dict[str, str] = {
            "MCP-Protocol-Version": normalized.get("mcp-protocol-version", ""),
            "Mcp-Method": normalized.get("mcp-method", ""),
        }
        if normalized.get("mcp-name"):
            forwarded["Mcp-Name"] = normalized["mcp-name"]

        self.lock_path.touch(exist_ok=True)
        try:
            with self.lock_path.open("r+b") as lock_fh:
                fcntl.flock(lock_fh.fileno(), fcntl.LOCK_EX)
                try:
                    state = self._read_state()
                    result = execute_remote_mcp(
                        state_pack=state,
                        tenant=self.tenant,
                        actor_id=self.actor_id,
                        headers=forwarded,
                        message=message,
                        provider_router=self.provider_router,
                    )
                    if result.get("mutated") and isinstance(result.get("state_pack"), Mapping):
                        self._write_state(result["state_pack"])
                finally:
                    fcntl.flock(lock_fh.fileno(), fcntl.LOCK_UN)
        except OperatorDaemonError as exc:
            return self._json_error(503, "STATE_UNAVAILABLE", str(exc))
        except Exception:
            return self._json_error(500, "OPERATOR_EXECUTION_FAILED")

        response_headers: dict[str, str] = {}
        for key, value in dict(result.get("headers") or {}).items():
            if key.lower() in {"content-type", "cache-control", "mcp-protocol-version"}:
                response_headers[str(key)] = str(value)
        response_headers.setdefault("cache-control", "no-store")
        return int(result.get("status") or 500), response_headers, dict(result.get("body") or {})


def serve_operator_daemon(
    *,
    root: str | Path,
    tenant: str,
    actor_id: str,
    bearer_token: str,
    host: str = "0.0.0.0",
    port: int = 8765,
    provider_router: Any | None = None,
) -> None:
    if isinstance(port, bool) or not isinstance(port, int) or not (1024 <= port <= 65535):
        raise OperatorDaemonError("port must be an integer from 1024 to 65535")
    app = OperatorDaemonApplication(
        root=root,
        tenant=tenant,
        actor_id=actor_id,
        bearer_token=bearer_token,
        provider_router=provider_router,
    )

    class Handler(BaseHTTPRequestHandler):
        server_version = "MUSITUAxiomOperatorDaemon/1.0"

        def _run(self) -> None:
            try:
                length = int(self.headers.get("content-length", "0"))
            except ValueError:
                length = -1
            if length < 0 or length > MAX_REQUEST_BYTES:
                status, out_headers, payload = app._json_error(413, "REQUEST_TOO_LARGE")
            else:
                raw = self.rfile.read(length) if length else b""
                status, out_headers, payload = app.handle(self.command, self.path, dict(self.headers.items()), raw)
            encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            for key, value in out_headers.items():
                self.send_header(key, value)
            self.send_header("content-length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        do_GET = _run
        do_POST = _run
        do_PUT = _run
        do_DELETE = _run

        def log_message(self, format: str, *args: Any) -> None:
            return

    server = ThreadingHTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


__all__ = [
    "OperatorDaemonApplication",
    "OperatorDaemonError",
    "serve_operator_daemon",
]
