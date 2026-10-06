from __future__ import annotations

import json
from typing import Any, Mapping

PROTOCOL_VERSION="2026-07-28"
PROTOCOL_META="io.modelcontextprotocol/protocolVersion"


def trusted_operator_headers(headers: Mapping[str, Any], body: bytes) -> dict[str,str]:
    if not isinstance(headers, Mapping):
        raise ValueError("headers must be an object")
    normalized={str(k).strip().lower():str(v).strip() for k,v in headers.items() if str(k).strip()}
    try:
        message=json.loads(body.decode("utf-8"))
    except Exception as exc:
        raise ValueError("valid UTF-8 JSON-RPC body required") from exc
    if not isinstance(message,dict) or message.get("jsonrpc")!="2.0":
        raise ValueError("JSON-RPC 2.0 body required")
    method=str(message.get("method") or "").strip()
    if not method:
        raise ValueError("JSON-RPC method required")
    params=message.get("params") or {}
    if not isinstance(params,dict):
        raise ValueError("JSON-RPC params must be an object")
    meta=params.get("_meta") or {}
    if not isinstance(meta,dict):
        raise ValueError("params._meta must be an object")

    header_protocol=normalized.get("mcp-protocol-version")
    meta_protocol=meta.get(PROTOCOL_META)
    if header_protocol and meta_protocol and header_protocol!=meta_protocol:
        raise ValueError("protocol header/body metadata mismatch")
    protocol=header_protocol or str(meta_protocol or "")
    if protocol!=PROTOCOL_VERSION:
        raise ValueError("unsupported MCP protocol version")

    normalized["mcp-protocol-version"]=PROTOCOL_VERSION
    normalized["mcp-method"]=method
    normalized.pop("mcp-name",None)
    if method=="tools/call":
        name=str(params.get("name") or "").strip()
        if not name:
            raise ValueError("tools/call name required")
        normalized["mcp-name"]=name
    return normalized


__all__=["PROTOCOL_META","PROTOCOL_VERSION","trusted_operator_headers"]
