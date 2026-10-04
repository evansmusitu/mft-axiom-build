from __future__ import annotations

import json
import pathlib
import sys

from frontier_v5.scripts.deploy_claude_workers_dev import canonical_digest, snapshot_openai_surface

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXPECTED_OPENAI_SURFACE_SHA256 = "1515ae38afc222de1d29e9dbfc49830aa22ca6350bf94d84d8e506239fe7d29d"
EXPECTED_MCP_URL = "https://musitu-axiom-claude-mcp-candidate.mft-education-nexus-93f395f5.workers.dev/mcp"
ALLOWED_OAUTH_MODES = {"published_identity", "dcr"}


def evaluate(path: str | pathlib.Path) -> dict:
    evidence = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    if evidence.get("schema") != "musitu.axiom.claude_real_origin_evidence.v1":
        raise ValueError("unexpected Claude-origin evidence schema")
    if evidence.get("connector_name") != "MUSITU Axiom":
        raise ValueError("connector name mismatch")
    if evidence.get("remote_mcp_url") != EXPECTED_MCP_URL:
        raise ValueError("remote MCP URL mismatch")
    if evidence.get("oauth_client_mode") not in ALLOWED_OAUTH_MODES:
        raise ValueError("oauth_client_mode must be published_identity or dcr")
    required_true = (
        "oauth_completed",
        "tools_discovered",
        "commerce_tools_absent",
        "arithmetic_result_42",
        "npv_tool_call_passed",
        "no_secrets_exposed",
    )
    missing = [key for key in required_true if evidence.get(key) is not True]
    if missing:
        raise ValueError("real Claude-origin evidence incomplete: " + ", ".join(missing))
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
        "npv_tool_call_passed": True,
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
