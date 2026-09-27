from __future__ import annotations
import os
from typing import Any, Sequence
from .contracts import Invocation, InvocationResult, Provider, ToolDef
from .boundaries import reject_known_musitu_production
from .http_common import post_json, require_secret

class XAIAdapter:
    provider = Provider.XAI

    def __init__(self, api_url: str | None = None, model: str | None = None):
        self.api_url=(api_url or os.getenv("XAI_API_URL","https://api.x.ai/v1/responses")).rstrip("/")
        self.model=model or os.getenv("XAI_MODEL")
    def discover_tools(self) -> Sequence[ToolDef]:
        return []
    def _payload(self, invocation: Invocation, mcp_url: str | None = None) -> dict[str, Any]:
        if not self.model: raise RuntimeError("MISSING_PROVIDER_CONFIG:XAI_MODEL")
        payload={"model":self.model,"input":[{"role":"user","content":invocation.metadata.get("prompt","")}]}
        if mcp_url:
            if not mcp_url.startswith("https://"): raise ValueError("XAI_MCP_URL_MUST_BE_HTTPS")
            reject_known_musitu_production(mcp_url)
            payload["tools"]=[{"type":"mcp","server_url":mcp_url,"server_label":"axiom_frontier"}]
        return payload
    def invoke(self, invocation: Invocation) -> InvocationResult:
        key=require_secret("XAI_API_KEY")
        status,_,data,elapsed=post_json(self.api_url,self._payload(invocation),{"authorization":"Bearer "+key},invocation.timeout_ms/1000)
        usage=data.get("usage",{}) if isinstance(data,dict) else {}
        return InvocationResult(self.provider,invocation.case_id,"ok" if status<400 else "error",data,None if status<400 else f"HTTP_{status}",elapsed,usage,{"api":"xai_responses"})
    def invoke_with_frontier_mcp(self, invocation: Invocation, mcp_url: str) -> InvocationResult:
        key=require_secret("XAI_API_KEY")
        status,_,data,elapsed=post_json(self.api_url,self._payload(invocation,mcp_url),{"authorization":"Bearer "+key},invocation.timeout_ms/1000)
        usage=data.get("usage",{}) if isinstance(data,dict) else {}
        return InvocationResult(self.provider,invocation.case_id,"ok" if status<400 else "error",data,None if status<400 else f"HTTP_{status}",elapsed,usage,{"api":"xai_responses","mcp_endpoint":mcp_url})
