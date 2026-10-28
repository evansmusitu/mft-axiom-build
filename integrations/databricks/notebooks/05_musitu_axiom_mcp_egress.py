# Databricks notebook source
# Public MCP handshake probe only. No Axiom credentials, no tool execution.
# One serverless job, bounded by GitHub Actions and Databricks Jobs timeouts.
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ENDPOINT = "https://mcp.mftintelligence.com/mcp"
MCP_PROTOCOL = "2025-06-18"
MAX_RESPONSE = 300_000
ALLOWED_TOOLS = frozenset({"investment_npv", "option_black_scholes", "historical_var"})


def decode_payload(raw: bytes):
    txt = raw.decode("utf-8", "replace")
    if txt.lstrip().startswith("{"):
        return json.loads(txt)
    # Streamable HTTP may respond using text/event-stream. Process one bounded event.
    for chunk in txt.splitlines():
        if chunk.startswith("data:"):
            try:
                v = json.loads(chunk[5:].strip())
                if isinstance(v, dict):
                    return v
            except ValueError:
                continue
    return {}


def public_mcp_request(method: str, params: dict):
    if method not in ("initialize", "tools/list"):
        raise ValueError("MCP tool execution is prohibited")
    payload = {
        "jsonrpc": "2.0",
        "id": 1 if method == "initialize" else 2,
        "method": method,
        "params": params,
    }
    request = Request(
        ENDPOINT, method="POST", data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": "MUSITU-Databricks-MCP-Egress-Probe/1",
        },
    )
    try:
        with urlopen(request, timeout=12) as response:
            status = response.status
            data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                return status, {"error": "RESPONSE_TOO_LARGE"}
            return status, decode_payload(data)
    except HTTPError as error:
        return error.code, {}
    except (URLError, TimeoutError):
        return 0, {}


def run_probe(send):
    init_status, init_body = send("initialize", {
        "protocolVersion": MCP_PROTOCOL,
        "capabilities": {},
        "clientInfo": {"name": "musitu-databricks-egress-probe", "version": "1.0"},
    })
    if init_status != 200 or not isinstance(init_body, dict) or not isinstance(init_body.get("result"), dict):
        return {
            "schema": "musitu.axiom.databricks.public-mcp-egress.v1",
            "initialize_http": init_status,
            "initialize_supported": False,
            "tools_http": None,
            "tools_count": None,
            "approved_tools_visible": 0,
            "unrestricted_execute_advertised": None,
            "axiom_tool_calls_executed": 0,
            "axiom_authenticated": False,
            "status": "BLOCKED_OR_UNSUPPORTED",
        }
    tools_status, tools_body = send("tools/list", {})
    listing = (tools_body.get("result") or {}).get("tools") if isinstance(tools_body, dict) else None
    if not isinstance(listing, list):
        listing = []
    names = {x.get("name") for x in listing if isinstance(x, dict) and isinstance(x.get("name"), str)}
    return {
        "schema": "musitu.axiom.databricks.public-mcp-egress.v1",
        "initialize_http": init_status,
        "initialize_supported": True,
        "tools_http": tools_status,
        "tools_count": len(listing) if tools_status == 200 else None,
        "approved_tools_visible": len(ALLOWED_TOOLS & names),
        "unrestricted_execute_advertised": "musitu_axiom_execute" in names if tools_status == 200 else None,
        "axiom_tool_calls_executed": 0,
        "axiom_authenticated": False,
        "status": "REACHABLE_PUBLIC_MCP" if tools_status == 200 else "TOOLS_DISCOVERY_FAILED",
    }


RESULT = run_probe(public_mcp_request)
print("MUSITU_DATABRICKS_AXIOM_MCP_EGRESS_PROBED")
print("MUSITU_DATABRICKS_AXIOM_MCP_EGRESS=" + json.dumps(RESULT, sort_keys=True))
dbutils.notebook.exit(json.dumps(RESULT, sort_keys=True))
