from __future__ import annotations

from pathlib import Path
import tempfile
from typing import Any, Mapping

from frontier_v5.runtime.mcp_2026 import MCP2026Error
from frontier_v5.runtime.operator_bridge import OperatorBridge
from frontier_v5.runtime.operator_mcp import build_operator_mcp
from frontier_v5.runtime.operator_state import export_operator_state, restore_operator_state


READ_ONLY_TOOLS=frozenset({
    "axiom.project.status",
    "axiom.work.status",
    "axiom.work.ready",
    "axiom.agent.integrity",
    "axiom.artifact.export",
    "axiom.evidence.verify",
    "axiom.computer.integrity",
    "axiom.provider.status",
})


def _mutates(message: Mapping[str, Any]) -> bool:
    if message.get("method")!="tools/call":
        return False
    params=message.get("params") or {}
    if not isinstance(params, Mapping):
        return False
    name=str(params.get("name") or "")
    return name not in READ_ONLY_TOOLS


def execute_remote_mcp(
    *,
    state_pack: Mapping[str, Any] | None,
    tenant: str,
    actor_id: str,
    headers: Mapping[str, Any],
    message: Mapping[str, Any],
    provider_router: Any | None = None,
) -> dict[str, Any]:
    """Execute exactly one MCP request against an isolated reconstructed bridge.

    A new state pack is returned only for mutating tool calls. Stateless
    discovery/list/read-only calls cannot advance persisted operator state.
    """
    with tempfile.TemporaryDirectory(prefix="axiom-operator-remote-") as td:
        root=Path(td)
        if state_pack is None:
            bridge=OperatorBridge(root=root,tenant=tenant,actor_id=actor_id,provider_router=provider_router)
        else:
            bridge=restore_operator_state(
                root=root,state_pack=state_pack,tenant=tenant,actor_id=actor_id,provider_router=provider_router
            )
        try:
            server=build_operator_mcp(bridge)
            status,response_headers,body=server.handle(headers,message)
            mutating=_mutates(message) and status==200
            next_state=export_operator_state(bridge) if mutating else None
            return {
                "status":status,
                "headers":dict(response_headers),
                "body":body,
                "mutated":mutating,
                "state_pack":next_state,
            }
        except MCP2026Error as exc:
            return {
                "status":400,
                "headers":{"content-type":"application/json; charset=utf-8","cache-control":"no-store"},
                "body":{"error":"MCP_REQUEST_REJECTED","message":str(exc)},
                "mutated":False,
                "state_pack":None,
            }
        finally:
            bridge.close()


__all__=["READ_ONLY_TOOLS","execute_remote_mcp"]
