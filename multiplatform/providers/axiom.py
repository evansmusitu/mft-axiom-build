from __future__ import annotations
import json
import os
import time
from typing import Any, Sequence

from .boundaries import reject_known_musitu_production
from .contracts import Invocation, InvocationResult, Provider, ToolDef
from .http_common import post_json, sha256_json

class AxiomFrontierAdapter:
    provider = Provider.AXIOM

    def __init__(self, url: str | None = None):
        self.url = (url or os.getenv("AXIOM_FRONTIER_MCP_URL","")).rstrip("/")
        if not self.url:
            raise RuntimeError("MISSING_FRONTIER_STAGING_ENDPOINT")
        reject_known_musitu_production(self.url)
        if not self.url.startswith("https://"):
            raise RuntimeError("FRONTIER_ENDPOINT_MUST_BE_HTTPS")

    def _rpc(self, method: str, params: dict[str, Any], token: str | None = None) -> dict[str, Any]:
        headers = {"accept":"application/json, text/event-stream"}
        if token:
            headers["authorization"] = "Bearer " + token
        status, _, data, _ = post_json(self.url, {"jsonrpc":"2.0","id":1,"method":method,"params":params}, headers, 30)
        if status >= 400:
            raise RuntimeError(f"MCP_HTTP_{status}")
        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError("MCP_PROTOCOL_ERROR:" + json.dumps(data["error"],sort_keys=True))
        return (data or {}).get("result", {})

    def discover_tools(self) -> Sequence[ToolDef]:
        token = os.getenv("AXIOM_FRONTIER_OAUTH_TOKEN")
        if os.getenv("AXIOM_FRONTIER_SKIP_DISCOVERY") == "1":
            return []
        self._rpc("initialize", {"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"musitu-axiom-cross-eval","version":"1.0"}}, token)
        output = self._rpc("tools/list", {}, token)
        return [ToolDef(t["name"],t.get("description",""),t.get("inputSchema",{}),t.get("outputSchema"),t.get("annotations",{})) for t in output.get("tools",[])]

    def invoke(self, invocation: Invocation) -> InvocationResult:
        token = os.getenv("AXIOM_FRONTIER_OAUTH_TOKEN")
        started = time.perf_counter()
        try:
            output = self._rpc("tools/call", {"name":invocation.tool_name,"arguments":dict(invocation.arguments)}, token)
            return InvocationResult(self.provider,invocation.case_id,"ok",output,latency_ms=(time.perf_counter()-started)*1000,trace={"output_sha256":sha256_json(output),"endpoint":self.url})
        except Exception as exc:
            return InvocationResult(self.provider,invocation.case_id,"error",error_class=type(exc).__name__,latency_ms=(time.perf_counter()-started)*1000,trace={"endpoint":self.url})
