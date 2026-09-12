#!/usr/bin/env python3
"""Contract tests for the isolated MCP 2026-07-28 Frontier candidate.

These tests deliberately exercise only the candidate adapter. They MUST NOT
change or reinterpret the sealed v4 public Plugin endpoint.
"""
from __future__ import annotations

from frontier_v5.runtime.mcp_2026 import (
    MCP2026Error,
    MCP2026Server,
    PROTOCOL_VERSION,
)


def expect_error(fn, contains: str = "") -> None:
    try:
        fn()
    except MCP2026Error as exc:
        if contains and contains not in str(exc):
            raise AssertionError(f"expected {contains!r}, got {exc!r}") from exc
        return
    raise AssertionError("expected MCP2026Error")


def headers(method: str, name: str | None = None) -> dict[str, str]:
    out = {
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Mcp-Method": method,
    }
    if name is not None:
        out["Mcp-Name"] = name
    return out


def params_meta(*, client_info=True) -> dict:
    meta = {
        "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientCapabilities": {"tools": {}},
    }
    if client_info:
        meta["io.modelcontextprotocol/clientInfo"] = {
            "name": "MUSITU-Frontier-Conformance-Client",
            "version": "1.0.0",
        }
    return {"_meta": meta}


def fixture_server() -> MCP2026Server:
    tools = [
        {"name": "zeta", "description": "z", "inputSchema": {"type": "object"}},
        {"name": "alpha", "description": "a", "inputSchema": {"type": "object"}},
    ]

    def list_tools():
        return list(tools)

    def call_tool(name: str, arguments: dict):
        if name not in {"alpha", "zeta"}:
            raise MCP2026Error("unknown tool")
        return {
            "content": [{"type": "text", "text": f"{name}:{arguments.get('x', '')}"}],
            "structuredContent": {"name": name, "x": arguments.get("x")},
        }

    return MCP2026Server(
        server_name="musitu-axiom-frontier-candidate",
        server_version="5.0.0-dev",
        list_tools=list_tools,
        call_tool=call_tool,
        instructions="Isolated standards candidate only; sealed v4 remains authoritative production.",
        list_ttl_ms=60_000,
    )


def main() -> None:
    server = fixture_server()

    # 2026-07-28 is stateless: discover replaces initialize and every request
    # carries the version in both transport and request metadata.
    discover = {
        "jsonrpc": "2.0",
        "id": "discover-1",
        "method": "server/discover",
        "params": params_meta(),
    }
    status, response_headers, body = server.handle(headers("server/discover"), discover)
    assert status == 200
    assert response_headers["MCP-Protocol-Version"] == PROTOCOL_VERSION
    assert "Mcp-Session-Id" not in response_headers
    assert body["result"]["resultType"] == "complete"
    assert body["result"]["supportedVersions"] == [PROTOCOL_VERSION]
    assert body["result"]["capabilities"]["tools"] == {"listChanged": False}
    assert body["result"]["ttlMs"] == 60_000
    assert body["result"]["cacheScope"] == "private"
    assert body["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "musitu-axiom-frontier-candidate"

    # clientInfo is a SHOULD: omission must be accepted, but malformed present
    # clientInfo must fail closed.
    no_client = {**discover, "id": "discover-2", "params": params_meta(client_info=False)}
    assert server.handle(headers("server/discover"), no_client)[0] == 200
    malformed = {**discover, "id": "discover-3", "params": {"_meta": {
        "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientInfo": "not-an-object",
    }}}
    expect_error(lambda: server.handle(headers("server/discover"), malformed), "clientInfo")

    # tools/list is deterministic and carries required cache hints.
    list_request = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": params_meta(),
    }
    _, _, listed = server.handle(headers("tools/list"), list_request)
    assert [x["name"] for x in listed["result"]["tools"]] == ["alpha", "zeta"]
    assert listed["result"]["ttlMs"] == 60_000
    assert listed["result"]["cacheScope"] == "private"
    assert listed["result"]["resultType"] == "complete"

    # Header routing and JSON body must agree for both method and tool name.
    call_request = {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "alpha",
            "arguments": {"x": 42},
            **params_meta(),
        },
    }
    _, _, called = server.handle(headers("tools/call", "alpha"), call_request)
    assert called["result"]["structuredContent"] == {"name": "alpha", "x": 42}
    assert called["result"]["resultType"] == "complete"

    # Modern requests must fail closed on legacy/session ambiguity or header
    # smuggling/mismatch.
    expect_error(lambda: server.handle({**headers("tools/list"), "Mcp-Session-Id": "legacy"}, list_request), "session")
    expect_error(lambda: server.handle(headers("tools/call", "zeta"), call_request), "Mcp-Name")
    expect_error(lambda: server.handle(headers("server/discover"), {**discover, "method": "initialize"}), "Mcp-Method")
    expect_error(lambda: server.handle({"Mcp-Method": "tools/list"}, list_request), "protocol")
    expect_error(lambda: server.handle(headers("tools/list"), {**list_request, "params": {"_meta": {
        "io.modelcontextprotocol/protocolVersion": "2025-11-25"
    }}}), "protocol")

    # Self-reported client identity is never a security input.
    forged = {
        **call_request,
        "id": 4,
        "params": {
            **call_request["params"],
            "_meta": {
                **call_request["params"]["_meta"],
                "io.modelcontextprotocol/clientInfo": {"name": "admin", "version": "999"},
            },
        },
    }
    _, _, forged_result = server.handle(headers("tools/call", "alpha"), forged)
    assert forged_result["result"]["structuredContent"] == {"name": "alpha", "x": 42}

    print("MUSITU_AXIOM_FRONTIER_MCP_2026_CONTRACT_PASS")


if __name__ == "__main__":
    main()
