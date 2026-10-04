from __future__ import annotations

import json
from pathlib import Path

_REQUIRED_LIVE_EVIDENCE = (
    "isolated_mcp_endpoint_live",
    "isolated_auth_endpoint_live",
    "claude_oauth_completed",
    "tools_list_discovered",
    "authenticated_tool_call_passed",
    "openai_surface_unchanged_reverified",
)


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def evaluate_candidate(root: str | Path) -> dict:
    root = Path(root)
    profile_path = root / "frontier_v5/distribution/providers/claude.json"
    auth_path = root / "frontier_v5/distribution/claude/musitu_axiom_oauth_worker_claude_candidate.mjs"
    mcp_path = root / "frontier_v5/distribution/claude/musitu_axiom_mcp_gate_claude_candidate.mjs"
    submission_path = root / "submission/claude/REMOTE_MCP_SUBMISSION.md"
    checks_path = root / "submission/claude/review-checks.json"

    for path in (profile_path, auth_path, mcp_path, submission_path, checks_path):
        if not path.is_file():
            raise ValueError(f"missing Claude distribution artifact: {path.relative_to(root)}")

    profile = _read_json(profile_path)
    if profile.get("provider_id") != "claude":
        raise ValueError("Claude provider profile has wrong provider_id")
    if profile.get("distribution_mode") != "single_remote_mcp":
        raise ValueError("Claude provider profile must use single_remote_mcp")

    callbacks = profile.get("oauth", {}).get("callback_uris") or []
    expected_callbacks = ["https://claude.ai/api/mcp/auth_callback"]
    if callbacks != expected_callbacks:
        raise ValueError("Claude callback contract is not exact")
    if any("*" in str(uri) for uri in callbacks):
        raise ValueError("Claude callback wildcard is forbidden")

    auth = auth_path.read_text(encoding="utf-8")
    if "https://claude-auth.mftintelligence.com" not in auth or "https://claude-mcp.mftintelligence.com" not in auth:
        raise ValueError("Claude auth candidate is not isolated")
    if "chatgpt.com" in auth or "connector_platform_oauth_redirect" in auth:
        raise ValueError("OpenAI callback leaked into Claude auth candidate")
    if "status: 302" not in auth and "status:302" not in auth:
        raise ValueError("Claude auth candidate must return 302 on OAuth callback handoff")

    mcp = mcp_path.read_text(encoding="utf-8")
    if "https://claude-auth.mftintelligence.com" not in mcp or "https://claude-mcp.mftintelligence.com" not in mcp:
        raise ValueError("Claude MCP candidate is not isolated")
    if "openai-apps-challenge" in mcp or "OPENAI_APPS_CHALLENGE" in mcp or "openai/toolInvocation" in mcp:
        raise ValueError("OpenAI-only surface leaked into Claude MCP candidate")

    submission_text = submission_path.read_text(encoding="utf-8").casefold()
    if "best in the world" in submission_text or "globally superior" in submission_text:
        raise ValueError("unsupported superiority claim in Claude submission package")

    status = profile.get("submission", {}).get("status")
    checks = _read_json(checks_path)
    live = checks.get("live_evidence") or {}
    live_ready = all(live.get(k) is True for k in _REQUIRED_LIVE_EVIDENCE)
    if status == "ready" and not live_ready:
        raise ValueError("submission marked ready without complete live Claude evidence")

    return {
        "candidate_pass": True,
        "live_submission_ready": bool(status == "ready" and live_ready),
        "submission_status": status,
        "required_live_evidence": list(_REQUIRED_LIVE_EVIDENCE),
    }


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    result = evaluate_candidate(root)
    print(json.dumps(result, sort_keys=True))
    print("MUSITU_AXIOM_CLAUDE_DISTRIBUTION_CANDIDATE_PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
