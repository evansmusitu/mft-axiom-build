from __future__ import annotations

from frontier_v5.runtime.mcp_2026 import MCP2026Server
from frontier_v5.runtime.operator_bridge import OperatorBridge


def build_operator_mcp(bridge: OperatorBridge) -> MCP2026Server:
    if not isinstance(bridge, OperatorBridge):
        raise TypeError("bridge must be OperatorBridge")
    return MCP2026Server(
        server_name="musitu-axiom-operator",
        server_version="1.0.0",
        list_tools=bridge.list_tools,
        call_tool=bridge.call_tool,
        instructions=(
            "Private MUSITU Axiom operator surface. "
            "No production, release, public-submission mutation, plaintext-secret, "
            "or unaudited external-provider authority is implied by this server."
        ),
        list_ttl_ms=0,
    )


__all__=["build_operator_mcp"]
