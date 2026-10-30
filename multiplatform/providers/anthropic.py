from __future__ import annotations
import os
from typing import Any, Sequence
from .boundaries import reject_known_musitu_production
from .contracts import Invocation, InvocationResult, Provider, ToolDef
from .http_common import post_json, require_secret

class AnthropicAdapter:
    provider = Provider.ANTHROPIC

    def __init__(self, api_url: str | None = None, model: str | None = None):
        self.api_url = api_url or os.getenv("ANTHROPIC_API_URL","https://api.anthropic.com/v1/messages")
        self.model = model or os.getenv("ANTHROPIC_MODEL")

    def discover_tools(self) -> Sequence[ToolDef]:
        return []

    def build_mcp_request(self, prompt: str, mcp_url: str, tool_names: list[str] | None = None) -> dict[str,Any]:
        if not mcp_url.startswith("https://"):
            raise ValueError("ANTHROPIC_MCP_URL_MUST_BE_HTTPS")
        reject_known_musitu_production(mcp_url)
        toolset = {"type":"mcp_toolset","mcp_server_name":"axiom-frontier"}
        if tool_names:
            toolset["default_config"] = {"enabled":False}
            toolset["configs"] = {name:{"enabled":True} for name in tool_names}
        return {
            "model": self.model or "REQUIRED_BY_RUNNER",
            "max_tokens": 1024,
            "messages":[{"role":"user","content":prompt}],
            "mcp_servers":[{"type":"url","url":mcp_url,"name":"axiom-frontier","authorization_token":"REQUIRED_AT_RUNTIME"}],
            "tools":[toolset],
        }

    def invoke(self, invocation: Invocation) -> InvocationResult:
        raise RuntimeError("MCP_REMOTE_EXECUTION_REQUIRES_RUNNER_CONTEXT")

    def invoke_messages(self, payload: dict[str,Any], case_id: str = "provider-api") -> InvocationResult:
        key = require_secret("ANTHROPIC_API_KEY")
        status, _, data, elapsed = post_json(
            self.api_url, payload,
            {"x-api-key":key,"anthropic-version":"2023-06-01","anthropic-beta":"mcp-client-2025-11-20"},
            30,
        )
        usage = data.get("usage",{}) if isinstance(data,dict) else {}
        return InvocationResult(self.provider, case_id,
            "ok" if status < 400 else "error", data,
            None if status < 400 else f"HTTP_{status}", elapsed, usage)

    def invoke_with_frontier_mcp(self, invocation: Invocation, mcp_url: str) -> InvocationResult:
        payload = self.build_mcp_request(invocation.metadata.get("prompt",""), mcp_url)
        return self.invoke_messages(payload, invocation.case_id)
