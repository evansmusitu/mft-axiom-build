#!/usr/bin/env python3
"""Isolated MCP 2026-07-28 protocol candidate for MUSITU Axiom Frontier v5.

This module is deliberately NOT wired to the sealed public v4 Plugin endpoint.
It implements a small, fail-closed, transport-neutral contract for the modern
stateless MCP core so the Frontier branch can prove interoperability semantics
before any separately governed production promotion is considered.

Security boundary:
* caller-supplied clientInfo/capabilities are descriptive only;
* this adapter performs no authentication or entitlement elevation;
* tool authorization remains the responsibility of the injected tool adapter;
* legacy session/initialize semantics are rejected rather than silently mixed
  with the modern stateless protocol.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
import json
from typing import Any


PROTOCOL_VERSION = "2026-07-28"
PROTOCOL_META = "io.modelcontextprotocol/protocolVersion"
CLIENT_INFO_META = "io.modelcontextprotocol/clientInfo"
CLIENT_CAPS_META = "io.modelcontextprotocol/clientCapabilities"
SERVER_INFO_META = "io.modelcontextprotocol/serverInfo"


class MCP2026Error(RuntimeError):
    """Raised when a modern MCP request violates the candidate contract."""


class MCPToolExecutionError(RuntimeError):
    """Governed tool/business outcome that must remain a valid MCP tool result."""

    def __init__(self, message: str, *, code: str = "TOOL_EXECUTION_ERROR") -> None:
        super().__init__(str(message))
        self.code = _nonempty_string(code, "tool error code")


def _nonempty_string(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise MCP2026Error(f"{name} must be a non-empty string")
    return value.strip()


def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise MCP2026Error(f"{name} must be an object")
    return value


def _normalize_headers(headers: Mapping[str, Any]) -> dict[str, str]:
    if not isinstance(headers, Mapping):
        raise MCP2026Error("headers must be an object")
    out: dict[str, str] = {}
    for key, value in headers.items():
        name = str(key).strip().casefold()
        if not name:
            raise MCP2026Error("header name cannot be empty")
        if name in out:
            raise MCP2026Error(f"duplicate header after normalization: {name}")
        out[name] = str(value).strip()
    return out


class MCP2026Server:
    """Small stateless MCP 2026-07-28 candidate server contract.

    ``list_tools`` and ``call_tool`` are injected so this protocol layer never
    broadens the sealed public tool surface by itself. A future deployment may
    bind these callbacks to a separately reviewed OAuth/entitlement adapter.
    """

    def __init__(
        self,
        *,
        server_name: str,
        server_version: str,
        list_tools: Callable[[], Sequence[Mapping[str, Any]]],
        call_tool: Callable[[str, dict[str, Any]], Mapping[str, Any]],
        instructions: str = "",
        list_ttl_ms: int = 0,
    ) -> None:
        self.server_name = _nonempty_string(server_name, "server_name")
        self.server_version = _nonempty_string(server_version, "server_version")
        if not callable(list_tools) or not callable(call_tool):
            raise MCP2026Error("list_tools and call_tool must be callable")
        if isinstance(list_ttl_ms, bool) or not isinstance(list_ttl_ms, int) or list_ttl_ms < 0:
            raise MCP2026Error("list_ttl_ms must be an integer >= 0")
        self._list_tools = list_tools
        self._call_tool = call_tool
        self.instructions = str(instructions or "")
        self.list_ttl_ms = list_ttl_ms

    @property
    def server_info(self) -> dict[str, str]:
        return {"name": self.server_name, "version": self.server_version}

    def _response_headers(self) -> dict[str, str]:
        # Stateless modern core: intentionally no Mcp-Session-Id.
        return {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
        }

    def _validate_request_meta(self, params: Mapping[str, Any]) -> Mapping[str, Any]:
        meta = params.get("_meta", {})
        meta = _mapping(meta, "params._meta")

        declared = meta.get(PROTOCOL_META)
        if declared != PROTOCOL_VERSION:
            raise MCP2026Error(
                f"protocol metadata mismatch: expected {PROTOCOL_VERSION}, got {declared!r}"
            )

        # clientInfo is descriptive/self-reported and therefore never an auth
        # or privilege signal. Omission is accepted; malformed presence fails.
        if CLIENT_INFO_META in meta:
            info = _mapping(meta[CLIENT_INFO_META], "clientInfo")
            _nonempty_string(info.get("name"), "clientInfo.name")
            _nonempty_string(info.get("version"), "clientInfo.version")

        if CLIENT_CAPS_META in meta:
            _mapping(meta[CLIENT_CAPS_META], "clientCapabilities")

        return meta

    def _validate_envelope(
        self,
        headers: Mapping[str, Any],
        message: Mapping[str, Any],
    ) -> tuple[dict[str, str], Mapping[str, Any], str, Any, Mapping[str, Any]]:
        normalized = _normalize_headers(headers)
        if "mcp-session-id" in normalized:
            raise MCP2026Error("legacy session header is prohibited by stateless MCP 2026")

        if normalized.get("mcp-protocol-version") != PROTOCOL_VERSION:
            raise MCP2026Error(
                f"protocol header must be MCP-Protocol-Version: {PROTOCOL_VERSION}"
            )

        message = _mapping(message, "JSON-RPC request")
        if message.get("jsonrpc") != "2.0":
            raise MCP2026Error("JSON-RPC version must be 2.0")
        if "id" not in message or message.get("id") is None:
            raise MCP2026Error("JSON-RPC request id is required")

        method = _nonempty_string(message.get("method"), "method")
        header_method = normalized.get("mcp-method")
        if header_method != method:
            raise MCP2026Error("Mcp-Method header does not match JSON-RPC method")
        if method == "initialize":
            raise MCP2026Error("initialize is legacy and unsupported in MCP 2026 stateless core")

        raw_params = message.get("params", {})
        params = _mapping(raw_params, "params")
        self._validate_request_meta(params)

        if method == "tools/call":
            tool_name = _nonempty_string(params.get("name"), "params.name")
            if normalized.get("mcp-name") != tool_name:
                raise MCP2026Error("Mcp-Name header does not match tools/call name")
        elif "mcp-name" in normalized:
            raise MCP2026Error("Mcp-Name header is valid only for tools/call")

        return normalized, message, method, message["id"], params

    def _success(self, request_id: Any, result: Mapping[str, Any]) -> tuple[int, dict[str, str], dict[str, Any]]:
        payload = dict(_mapping(result, "result"))
        payload.setdefault("resultType", "complete")
        existing_meta = payload.get("_meta", {})
        existing_meta = dict(_mapping(existing_meta, "result._meta"))
        # Server identity is descriptive metadata only; keep it out of auth.
        existing_meta[SERVER_INFO_META] = self.server_info
        payload["_meta"] = existing_meta
        return (
            200,
            self._response_headers(),
            {"jsonrpc": "2.0", "id": request_id, "result": payload},
        )

    def _call_tool_result(
        self,
        request_id: Any,
        structured: Mapping[str, Any],
        *,
        is_error: bool,
    ) -> tuple[int, dict[str, str], dict[str, Any]]:
        payload = dict(_mapping(structured, "structuredContent"))
        try:
            text = json.dumps(
                payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
        except Exception as exc:
            fallback = {
                "error": {
                    "code": "TOOL_RESULT_SERIALIZATION_FAILED",
                    "message": "Tool result could not be serialized safely.",
                }
            }
            text = json.dumps(fallback, sort_keys=True, separators=(",", ":"))
            payload = fallback
            is_error = True

        return (
            200,
            self._response_headers(),
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "content": [{"type": "text", "text": text}],
                    "structuredContent": payload,
                    "isError": bool(is_error),
                    "_meta": {SERVER_INFO_META: self.server_info},
                },
            },
        )

    def _tool_error(
        self,
        request_id: Any,
        *,
        name: str,
        code: str,
        message: str,
    ) -> tuple[int, dict[str, str], dict[str, Any]]:
        return self._call_tool_result(
            request_id,
            {
                "tool": name,
                "error": {
                    "code": _nonempty_string(code, "tool error code"),
                    "message": _nonempty_string(message, "tool error message"),
                },
            },
            is_error=True,
        )

    @staticmethod
    def _looks_like_call_tool_result(result: Mapping[str, Any]) -> bool:
        content = result.get("content")
        if not isinstance(content, list) or not content:
            return False
        for item in content:
            if not isinstance(item, Mapping):
                return False
            part_type = item.get("type")
            if not isinstance(part_type, str) or not part_type.strip():
                return False
        return True

    def _validated_call_tool_result(
        self,
        request_id: Any,
        result: Mapping[str, Any],
    ) -> tuple[int, dict[str, str], dict[str, Any]]:
        value = dict(_mapping(result, "tool result"))
        content = value.get("content")
        if not isinstance(content, list) or not content:
            raise MCP2026Error("tool result content must be a non-empty array")
        normalized_content: list[dict[str, Any]] = []
        for index, item in enumerate(content):
            part = dict(_mapping(item, f"tool result content[{index}]"))
            part_type = _nonempty_string(part.get("type"), f"tool result content[{index}].type")
            if part_type == "text":
                _nonempty_string(part.get("text"), f"tool result content[{index}].text")
            normalized_content.append(part)
        value["content"] = normalized_content

        if "structuredContent" in value:
            value["structuredContent"] = dict(
                _mapping(value["structuredContent"], "tool result structuredContent")
            )
        value["isError"] = bool(value.get("isError", False))
        existing_meta = value.get("_meta", {})
        existing_meta = dict(_mapping(existing_meta, "tool result _meta"))
        existing_meta[SERVER_INFO_META] = self.server_info
        value["_meta"] = existing_meta
        return (
            200,
            self._response_headers(),
            {"jsonrpc": "2.0", "id": request_id, "result": value},
        )

    def _discover(self, request_id: Any) -> tuple[int, dict[str, str], dict[str, Any]]:
        return self._success(
            request_id,
            {
                "supportedVersions": [PROTOCOL_VERSION],
                "capabilities": {"tools": {"listChanged": False}},
                "instructions": self.instructions,
                "ttlMs": self.list_ttl_ms,
                # Private is the fail-closed cache scope for a future
                # authenticated MUSITU binding; public shared caching must be
                # an explicit separately reviewed decision.
                "cacheScope": "private",
            },
        )

    def _tools_list(self, request_id: Any) -> tuple[int, dict[str, str], dict[str, Any]]:
        try:
            raw = self._list_tools()
        except MCP2026Error:
            raise
        except Exception as exc:
            raise MCP2026Error("tool registry unavailable") from exc
        if isinstance(raw, (str, bytes, bytearray)) or not isinstance(raw, Sequence):
            raise MCP2026Error("tool registry must return a sequence")

        tools: list[dict[str, Any]] = []
        names: set[str] = set()
        for index, item in enumerate(raw):
            tool = dict(_mapping(item, f"tools[{index}]"))
            name = _nonempty_string(tool.get("name"), f"tools[{index}].name")
            if name in names:
                raise MCP2026Error(f"duplicate tool name: {name}")
            names.add(name)
            schema = tool.get("inputSchema", {"type": "object"})
            _mapping(schema, f"tools[{index}].inputSchema")
            tool["inputSchema"] = dict(schema)
            tools.append(tool)

        tools.sort(key=lambda item: str(item["name"]))
        return self._success(
            request_id,
            {
                "tools": tools,
                "ttlMs": self.list_ttl_ms,
                "cacheScope": "private",
            },
        )

    def _tools_call(
        self, request_id: Any, params: Mapping[str, Any]
    ) -> tuple[int, dict[str, str], dict[str, Any]]:
        name = _nonempty_string(params.get("name"), "params.name")
        arguments = params.get("arguments", {})
        arguments = dict(_mapping(arguments, "params.arguments"))
        try:
            raw_result = self._call_tool(name, arguments)
        except MCPToolExecutionError as exc:
            return self._tool_error(
                request_id,
                name=name,
                code=exc.code,
                message=str(exc),
            )
        except MCP2026Error:
            raise
        except Exception:
            return self._tool_error(
                request_id,
                name=name,
                code="TOOL_EXECUTION_FAILED",
                message="Tool execution failed.",
            )
        result = dict(_mapping(raw_result, "tool result"))
        if self._looks_like_call_tool_result(result):
            return self._validated_call_tool_result(request_id, result)
        return self._call_tool_result(request_id, result, is_error=False)

    def handle(
        self,
        headers: Mapping[str, Any],
        message: Mapping[str, Any],
    ) -> tuple[int, dict[str, str], dict[str, Any]]:
        """Validate and execute one stateless modern MCP request."""
        _, _, method, request_id, params = self._validate_envelope(headers, message)
        if method == "server/discover":
            return self._discover(request_id)
        if method == "tools/list":
            return self._tools_list(request_id)
        if method == "tools/call":
            return self._tools_call(request_id, params)
        raise MCP2026Error(f"unsupported MCP 2026 method: {method}")


__all__ = [
    "CLIENT_CAPS_META",
    "CLIENT_INFO_META",
    "MCP2026Error",
    "MCP2026Server",
    "MCPToolExecutionError",
    "PROTOCOL_META",
    "PROTOCOL_VERSION",
    "SERVER_INFO_META",
]
