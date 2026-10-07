from __future__ import annotations

import json

from frontier_v5.runtime.mcp_2026 import (
    MCP2026Server,
    MCPToolExecutionError,
    PROTOCOL_META,
    PROTOCOL_VERSION,
)
from frontier_v5.runtime.operator_bridge import TOOL_SPECS


def headers(name: str) -> dict[str, str]:
    return {
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": name,
    }


def message(name: str, request_id: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "tools/call",
        "params": {
            "name": name,
            "arguments": {},
            "_meta": {PROTOCOL_META: PROTOCOL_VERSION},
        },
    }


def assert_call_tool_result(body: dict, *, request_id: str, is_error: bool, name: str) -> None:
    assert body["jsonrpc"] == "2.0"
    assert body["id"] == request_id
    assert "error" not in body
    result = body["result"]
    assert isinstance(result["content"], list) and result["content"]
    first = result["content"][0]
    assert first["type"] == "text"
    assert isinstance(first["text"], str) and first["text"]
    assert isinstance(result["structuredContent"], dict)
    assert result["isError"] is is_error
    assert result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "operator-response-contract"
    # Text must be valid JSON mirroring the structured payload so clients that
    # only render content still receive a deterministic, inspectable result.
    assert json.loads(first["text"]) == result["structuredContent"]
    assert result["structuredContent"]["tool"] == name


def main() -> None:
    names = [row["name"] for row in TOOL_SPECS]
    assert len(names) == 27
    assert len(set(names)) == 27

    def list_tools():
        return list(TOOL_SPECS)

    def success(name: str, arguments: dict):
        return {
            "tool": name,
            "schema": "musitu.axiom.operator-response-contract.v1",
            "status": "OK",
        }

    server = MCP2026Server(
        server_name="operator-response-contract",
        server_version="1.0.0",
        list_tools=list_tools,
        call_tool=success,
    )

    for index, name in enumerate(names):
        request_id = f"success-{index}"
        status, _, body = server.handle(headers(name), message(name, request_id))
        assert status == 200
        assert_call_tool_result(body, request_id=request_id, is_error=False, name=name)

    def governed_error(name: str, arguments: dict):
        raise MCPToolExecutionError(
            f"{name}: governed outcome unavailable",
            code="GOVERNED_OUTCOME_UNAVAILABLE",
        )

    error_server = MCP2026Server(
        server_name="operator-response-contract",
        server_version="1.0.0",
        list_tools=list_tools,
        call_tool=governed_error,
    )
    for index, name in enumerate(names):
        request_id = f"error-{index}"
        status, _, body = error_server.handle(headers(name), message(name, request_id))
        assert status == 200
        assert_call_tool_result(body, request_id=request_id, is_error=True, name=name)
        structured = body["result"]["structuredContent"]
        assert structured["error"]["code"] == "GOVERNED_OUTCOME_UNAVAILABLE"
        assert "governed outcome unavailable" in structured["error"]["message"]

    print("MUSITU_AXIOM_OPERATOR_MCP_RESPONSE_CONTRACT_PASS")


if __name__ == "__main__":
    main()
