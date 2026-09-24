from __future__ import annotations
import os
from typing import Any, Sequence
from .boundaries import reject_known_musitu_production
from .contracts import Invocation, InvocationResult, Provider, ToolDef
from .http_common import post_json, require_secret

class OpenAIAdapter:
    provider = Provider.OPENAI

    def __init__(self, base_url: str | None = None, model: str | None = None):
        self.base_url = (base_url or os.getenv("OPENAI_BASE_URL","https://api.openai.com/v1")).rstrip("/")
        self.model = model or os.getenv("OPENAI_MODEL")

    def discover_tools(self) -> Sequence[ToolDef]:
        return []

    def build_responses_mcp_request(self, prompt: str, mcp_url: str, approval: str = "never") -> dict[str, Any]:
        if not mcp_url.startswith("https://"):
            raise ValueError("OPENAI_MCP_URL_MUST_BE_HTTPS")
        reject_known_musitu_production(mcp_url)
        if approval not in {"always","never"}:
            raise ValueError("INVALID_MCP_APPROVAL_POLICY")
        if not self.model:
            raise RuntimeError("MISSING_PROVIDER_CONFIG:OPENAI_MODEL")
        return {
            "model": self.model,
            "tools": [{
                "type": "mcp",
                "server_label": "axiom-frontier",
                "server_description": "MUSITU Axiom Frontier isolated evaluation server.",
                "server_url": mcp_url,
                "require_approval": approval,
            }],
            "input": prompt,
        }

    def invoke(self, invocation: Invocation) -> InvocationResult:
        key = require_secret("OPENAI_API_KEY")
        if not self.model:
            raise RuntimeError("MISSING_PROVIDER_CONFIG:OPENAI_MODEL")
        payload = {
            "model": self.model,
            "input": invocation.metadata.get("prompt",""),
            "tools": invocation.metadata.get("tools", []),
        }
        status, _, data, elapsed = post_json(
            self.base_url + "/responses",
            payload,
            {"authorization": "Bearer " + key},
            invocation.timeout_ms / 1000,
        )
        usage = data.get("usage", {}) if isinstance(data,dict) else {}
        return InvocationResult(
            self.provider, invocation.case_id, "ok" if status < 400 else "error",
            data, None if status < 400 else f"HTTP_{status}", elapsed, usage
        )
