from __future__ import annotations

from frontier_v5.runtime.mcp_2026 import MCP2026Server, MCPToolExecutionError
from frontier_v5.runtime.operator_bridge import OperatorBridge, OperatorBridgeError


def _operator_error_code(message: str) -> str:
    text = str(message or "").casefold()
    if "provider router unavailable" in text:
        return "PROVIDER_UNAVAILABLE"
    if "approval required" in text:
        return "APPROVAL_REQUIRED"
    if "not found" in text:
        return "NOT_FOUND"
    if "authority mismatch" in text or "different authority" in text:
        return "AUTHORITY_MISMATCH"
    if (
        "missing required fields" in text
        or "unsupported fields" in text
        or " must be " in text
        or " invalid" in text
    ):
        return "INVALID_ARGUMENTS"
    if "unknown operator tool" in text:
        return "TOOL_NOT_FOUND"
    return "OPERATOR_ERROR"


def build_operator_mcp(bridge: OperatorBridge) -> MCP2026Server:
    if not isinstance(bridge, OperatorBridge):
        raise TypeError("bridge must be OperatorBridge")

    def call_tool(name: str, arguments: dict):
        try:
            return bridge.call_tool(name, arguments)
        except OperatorBridgeError as exc:
            raise MCPToolExecutionError(
                str(exc),
                code=_operator_error_code(str(exc)),
            ) from exc

    return MCP2026Server(
        server_name="musitu-axiom-operator",
        server_version="1.0.1",
        list_tools=bridge.list_tools,
        call_tool=call_tool,
        instructions=(
            "Private MUSITU Axiom operator surface. "
            "No production, release, public-submission mutation, plaintext-secret, "
            "or unaudited external-provider authority is implied by this server."
        ),
        list_ttl_ms=0,
    )


__all__=["build_operator_mcp"]
