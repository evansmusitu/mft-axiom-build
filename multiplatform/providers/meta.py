from __future__ import annotations
import os
from typing import Sequence
from .contracts import Invocation, InvocationResult, Provider, ToolDef
from .http_common import post_json, require_secret

class MetaModelAdapter:
    provider = Provider.META
    def __init__(self, base_url: str | None = None, model: str | None = None):
        self.base_url=(base_url or os.getenv("META_MODEL_API_BASE_URL","")).rstrip("/")
        self.model=model or os.getenv("META_MODEL")
    def discover_tools(self) -> Sequence[ToolDef]:
        return []
    def invoke(self, invocation: Invocation) -> InvocationResult:
        key=require_secret("META_MODEL_API_KEY")
        if not self.base_url: raise RuntimeError("MISSING_PROVIDER_CONFIG:META_MODEL_API_BASE_URL")
        if not self.model: raise RuntimeError("MISSING_PROVIDER_CONFIG:META_MODEL")
        payload={"model":self.model,"messages":[{"role":"user","content":invocation.metadata.get("prompt","")}],"tools":invocation.metadata.get("tools",[]),"tool_choice":"auto"}
        status,_,data,elapsed=post_json(self.base_url+"/chat/completions",payload,{"authorization":"Bearer "+key},invocation.timeout_ms/1000)
        return InvocationResult(self.provider,invocation.case_id,"ok" if status<400 else "error",data,None if status<400 else f"HTTP_{status}",elapsed,data.get("usage",{}) if isinstance(data,dict) else {})
