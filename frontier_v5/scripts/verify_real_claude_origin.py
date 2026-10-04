from __future__ import annotations

import json
import math
import pathlib
import sys

from frontier_v5.scripts.deploy_claude_workers_dev import canonical_digest, snapshot_openai_surface

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXPECTED_OPENAI_SURFACE_SHA256 = "1515ae38afc222de1d29e9dbfc49830aa22ca6350bf94d84d8e506239fe7d29d"
EXPECTED_MCP_URL = "https://claude-mcp.mftintelligence.com/mcp"
ALLOWED_OAUTH_MODES = {"published_identity", "dynamic_client_registration"}


def evaluate(path: str | pathlib.Path) -> dict:
    evidence = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    if evidence.get("schema") != "musitu.axiom.claude_real_origin_evidence.v1":
        raise ValueError("unexpected Claude-origin evidence schema")
    if evidence.get("connector_name") != "MUSITU Axiom":
        raise ValueError("connector name mismatch")
    if evidence.get("remote_mcp_url") != EXPECTED_MCP_URL:
        raise ValueError("remote MCP URL mismatch")
    if evidence.get("oauth_client_mode") not in ALLOWED_OAUTH_MODES:
        raise ValueError("oauth_client_mode must be published_identity or dynamic_client_registration")
    required_true = (
        "oauth_completed",
        "tools_discovered",
        "commerce_tools_absent",
        "arithmetic_result_42",
        "npv_tool_call_passed",
        "no_secrets_exposed",
        "arithmetic_tool_invoked",
        "npv_tool_invoked",
    )
    missing = [key for key in required_true if evidence.get(key) is not True]
    if missing:
        raise ValueError("real Claude-origin evidence incomplete: " + ", ".join(missing))
    arithmetic = evidence.get("arithmetic_result")
    npv = evidence.get("npv_result")
    if type(arithmetic) not in (int, float) or arithmetic != 42:
        raise ValueError("actual Axiom arithmetic_result must be 42")
    if type(npv) not in (int, float) or not math.isfinite(npv):
        raise ValueError("actual Axiom npv_result must be a finite number")
    if evidence.get("arithmetic_operation") != "arithmetic.evaluate" or evidence.get("npv_operation") != "finance.npv":
        raise ValueError("actual Axiom operation names are required")
    if not str(evidence.get("npv_tool_name") or "").strip():
        raise ValueError("npv_tool_name is required")
    for key in ("arithmetic_http_status", "npv_http_status"):
        status = evidence.get(key)
        if status is not None and (type(status) is not int or not 200 <= status < 300):
            raise ValueError("failed execution HTTP status cannot pass: " + key)
    if not str(evidence.get("claude_surface") or "").strip():
        raise ValueError("claude_surface is required")
    if not str(evidence.get("arithmetic_tool_name") or "").strip():
        raise ValueError("arithmetic_tool_name is required")
    if not str(evidence.get("timestamp_utc") or "").strip():
        raise ValueError("timestamp_utc is required")

    live = snapshot_openai_surface()
    live_sha = canonical_digest(live)
    if live_sha != EXPECTED_OPENAI_SURFACE_SHA256:
        raise ValueError("frozen OpenAI live surface drifted after Claude-origin test")

    return {
        "real_claude_origin_pass": True,
        "openai_surface_unchanged_reverified": True,
        "openai_surface_sha256": live_sha,
        "connector_name": evidence["connector_name"],
        "remote_mcp_url": evidence["remote_mcp_url"],
        "oauth_client_mode": evidence["oauth_client_mode"],
        "arithmetic_tool_name": evidence["arithmetic_tool_name"],
        "arithmetic_result_42": True,
        "arithmetic_result": arithmetic,
        "npv_tool_call_passed": True,
        "npv_tool_name": evidence["npv_tool_name"],
        "npv_result": npv,
        "commerce_tools_absent": True,
        "no_secrets_exposed": True,
    }


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        raise SystemExit("usage: verify_real_claude_origin.py <evidence.json>")
    result = evaluate(argv[0])
    print(json.dumps(result, sort_keys=True))
    print("MUSITU_AXIOM_CLAUDE_REAL_ORIGIN_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
