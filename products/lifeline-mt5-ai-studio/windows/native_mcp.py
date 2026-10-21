"""Minimal privileged local connector to *official* MT5/MetaEditor MCP servers.

This module is NOT a public API, remote MCP proxy, trade executor, shell adapter, or
a broker account integration. The default policy exposes strictly informational tools.
Run it on an owner-controlled Windows host, close to MetaTrader's localhost servers.
"""
from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
import urllib.error
import urllib.request
from typing import Any, Callable


class NativeMCPError(RuntimeError):
    pass


# Audited capabilities, NOT a wildcard passthrough of MetaQuotes' native API.
# In particular: trade_*, chart_add_*, shell, write, edit, send_web_request,
# tester_run_*, tester_prepare_* and all arbitrary file mutations are absent.
# v0.9 INFORMATIONAL ONLY. No path scanning, arbitrary history ranges,
# account journals, source text, tester jobs, trading or shell.
# All exposed tools accept EXACTLY zero arguments. Additional capabilities
# need independently audited input schemas, quotas and human approval.
SAFE_TOOLS = {
    "terminal": frozenset({
        "get_time_information", "get_marketwatch_symbols", "tester_get_status",
    }),
    "metaeditor": frozenset({
        "get_workspace_info", "list_open_documents",
    }),
}
PORTS = {"terminal": 22346, "metaeditor": 22345}
MAX_INPUT = 16_384
MAX_OUTPUT = 131_072
MCP_VERSION = "2025-03-26"


@dataclass(frozen=True)
class NativeConfig:
    server: str
    token: str

    def __post_init__(self) -> None:
        if self.server not in PORTS:
            raise NativeMCPError("unknown built-in MCP server")
        if len(self.token) < 24 or any(c in self.token for c in "\r\n"):
            raise NativeMCPError("native MCP bearer token missing/invalid")

    @property
    def endpoint(self) -> str:
        # Never accept operator-provided URL or IP; preserve native loopback boundary.
        return f"http://127.0.0.1:{PORTS[self.server]}/mcp"


class HTTPTransport:
    """Exact loopback-only HTTP; disables proxies and HTTP redirects."""
    def __init__(self, timeout: int = 10) -> None:
        if not 1 <= timeout <= 30:
            raise ValueError("invalid timeout")
        self.timeout = timeout
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        self._client = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def __call__(self, endpoint: str, body: bytes, headers: dict[str, str]) -> tuple[bytes, str, str | None]:
        if endpoint not in (
            "http://127.0.0.1:22345/mcp",
            "http://127.0.0.1:22346/mcp",
        ):
            raise NativeMCPError("native MCP endpoint must be exact loopback")
        request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with self._client.open(request, timeout=self.timeout) as response:
                received = response.read(MAX_OUTPUT + 1)
                if len(received) > MAX_OUTPUT:
                    raise NativeMCPError("native MCP response exceeds size limit")
                return received, response.headers.get_content_type(), response.headers.get("Mcp-Session-Id")
        except urllib.error.HTTPError as exc:
            raise NativeMCPError(f"native MCP rejected HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError) as exc:
            raise NativeMCPError("native MCP is not reachable on Windows localhost") from exc


def _decode_response(payload: bytes, content_type: str) -> dict[str, Any]:
    if content_type == "application/json":
        try:
            obj = json.loads(payload)
        except (UnicodeDecodeError, ValueError) as exc:
            raise NativeMCPError("invalid native MCP JSON") from exc
    elif content_type == "text/event-stream":
        # The streamable-HTTP protocol can return an SSE event with the JSON-RPC reply.
        # Never accept arbitrary SSE events or unbounded text.
        candidate = None
        for line in payload.decode("utf-8", "strict").splitlines():
            if line.startswith("data: "):
                try:
                    item = json.loads(line[6:])
                except ValueError as exc:
                    raise NativeMCPError("invalid native MCP SSE") from exc
                if isinstance(item, dict) and ("result" in item or "error" in item):
                    candidate = item
        if candidate is None:
            raise NativeMCPError("native MCP SSE has no JSON-RPC result")
        obj = candidate
    else:
        raise NativeMCPError("unexpected native MCP content type")
    if not isinstance(obj, dict) or obj.get("jsonrpc") != "2.0":
        raise NativeMCPError("native MCP must speak JSON-RPC 2.0")
    return obj


class NativeMCP:
    def __init__(self, config: NativeConfig, transport: Callable | None = None):
        self.config = config
        self.transport = transport or HTTPTransport()
        self.session: str | None = None
        self.initialized = False

    def _rpc(self, method: str, params: dict | None = None) -> dict:
        rid = secrets.randbelow(2**31)
        obj = {"jsonrpc": "2.0", "id": rid, "method": method}
        if params is not None:
            obj["params"] = params
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
        if len(body) > MAX_INPUT:
            raise NativeMCPError("request exceeds size limit")
        headers = {
            "Authorization": "Bearer " + self.config.token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": MCP_VERSION,
        }
        if self.session:
            headers["Mcp-Session-Id"] = self.session
        reply = self.transport(self.config.endpoint, body, headers)
        if not isinstance(reply, tuple) or len(reply) != 3:
            raise NativeMCPError("invalid internal transport")
        raw, ct, sid = reply
        if sid is not None:
            if not isinstance(sid, str) or not 1 <= len(sid) <= 128 or any(c in sid for c in "\r\n"):
                raise NativeMCPError("invalid MCP session ID")
            self.session = sid
        response = _decode_response(raw, ct)
        if response.get("id") != rid:
            raise NativeMCPError("native MCP returned mismatched request id")
        if response.get("error") is not None:
            raise NativeMCPError("native MCP returned JSON-RPC error")
        if not isinstance(response.get("result"), dict):
            raise NativeMCPError("native MCP result must be object")
        return response["result"]

    def initialize(self) -> dict:
        result = self._rpc("initialize", {
            "protocolVersion": MCP_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "lifeline-native-research", "version": "0.5.0"},
        })
        self.initialized = True
        return {"server": self.config.server,
                "protocolVersion": result.get("protocolVersion"),
                "serverInfo": result.get("serverInfo")}

    def list_safe_tools(self) -> list[dict]:
        if not self.initialized:
            raise NativeMCPError("initialize required")
        result = self._rpc("tools/list", {})
        tools = result.get("tools")
        if not isinstance(tools, list):
            raise NativeMCPError("invalid tools/list")
        safe = []
        for tool in tools:
            if not isinstance(tool, dict):
                continue
            name = tool.get("name")
            if name in SAFE_TOOLS[self.config.server]:
                safe.append({"name": name, "description": str(tool.get("description", ""))[:250],
                             "inputSchema": {"type":"object","properties":{},"additionalProperties":False}})
        return safe

    def call_readonly(self, name: str, arguments: dict) -> dict:
        if not self.initialized:
            raise NativeMCPError("initialize required")
        if not isinstance(name, str) or name not in SAFE_TOOLS[self.config.server]:
            raise NativeMCPError("tool not permitted by LIFELINE policy")
        if not isinstance(arguments, dict):
            raise NativeMCPError("tool arguments must be object")
        if len(json.dumps(arguments, default=str).encode()) > MAX_INPUT:
            raise NativeMCPError("tool args too large")
        # Never forward arbitrary native MCP arguments, including nested paths,
        # symbol queries or filesystem options; this initial surface is status-only.
        if arguments:
            raise NativeMCPError("native read-only tool arguments are not enabled")
        return self._rpc("tools/call", {"name": name, "arguments": {}})


def native_status_from_environment() -> dict:
    """No network call, secrets never returned. Use for readiness UI."""
    return {
        "server_urls": {"terminal": "localhost:22346", "metaeditor": "localhost:22345"},
        "terminal_token_configured": len(os.environ.get("LIFELINE_TERMINAL_MCP_TOKEN", "")) >= 24,
        "metaeditor_token_configured": len(os.environ.get("LIFELINE_METAEDITOR_MCP_TOKEN", "")) >= 24,
        "native_mcp_verified": False,
        "trading_enabled": False,
        "shell_enabled": False,
    }


if __name__ == "__main__":
    print(json.dumps(native_status_from_environment(), sort_keys=True))
