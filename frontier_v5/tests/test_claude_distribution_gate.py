from __future__ import annotations

import json
from pathlib import Path

import pytest

from frontier_v5.scripts.claude_distribution_gate import evaluate_candidate


def make_repo(tmp_path: Path, *, status="blocked_pending_isolated_endpoint_deployment", live=None):
    (tmp_path / "frontier_v5/distribution/providers").mkdir(parents=True)
    (tmp_path / "frontier_v5/distribution/claude").mkdir(parents=True)
    (tmp_path / "auth").mkdir()
    (tmp_path / "mcp").mkdir()
    (tmp_path / "submission/claude").mkdir(parents=True)

    (tmp_path / "frontier_v5/distribution/providers/claude.json").write_text(json.dumps({
        "provider_id":"claude","display_name":"Claude","distribution_mode":"single_remote_mcp",
        "mcp":{"canonical_upstream":"https://mcp.mftintelligence.com/mcp","submission_url":"https://claude-mcp.mftintelligence.com/mcp"},
        "oauth":{"registration":"dcr_or_published_identity","pkce":"S256","callback_uris":["https://claude.ai/api/mcp/auth_callback"]},
        "submission":{"status":status,"portal_requires_paid_plan":True,"route":"developer_portal_single_remote_mcp"}
    }))
    (tmp_path / "frontier_v5/distribution/claude/musitu_axiom_oauth_worker_claude_candidate.mjs").write_text(
        'https://claude-auth.mftintelligence.com https://claude-mcp.mftintelligence.com '
        'u.hostname !== "claude.ai" && u.hostname !== "claude.com" '
        'u.pathname !== "/api/mcp/auth_callback" '
        'return html(200, callbackPage(url), extra) http-equiv="refresh" data-oauth-callback= '
        "form-action 'self' default-src 'none' "
        '\"referrer-policy\": \"no-referrer\"'
    )
    (tmp_path / "frontier_v5/distribution/claude/musitu_axiom_mcp_gate_claude_candidate.mjs").write_text(
        "https://claude-auth.mftintelligence.com https://claude-mcp.mftintelligence.com"
    )
    (tmp_path / "submission/claude/REMOTE_MCP_SUBMISSION.md").write_text("Claude remote MCP submission candidate\nNo leadership claim.\n")
    (tmp_path / "submission/claude/review-checks.json").write_text(json.dumps({"live_evidence": live or {}}))
    return tmp_path


def test_static_candidate_passes_while_live_submission_stays_blocked(tmp_path):
    result = evaluate_candidate(make_repo(tmp_path))
    assert result["candidate_pass"] is True
    assert result["live_submission_ready"] is False
    assert result["submission_status"] == "blocked_pending_isolated_endpoint_deployment"


def test_ready_status_is_rejected_without_live_claude_evidence(tmp_path):
    with pytest.raises(ValueError, match="live Claude evidence"):
        evaluate_candidate(make_repo(tmp_path, status="ready"))


def test_cross_origin_post_redirect_and_relaxed_form_policy_are_rejected(tmp_path):
    root = make_repo(tmp_path)
    auth = root / "frontier_v5/distribution/claude/musitu_axiom_oauth_worker_claude_candidate.mjs"
    source = auth.read_text()
    for invalid in (
        source.replace("return html(200, callbackPage(url), extra)", "status: 302"),
        source.replace("form-action 'self'", "form-action *"),
        source + "<script>window.location.replace(url)</script>",
    ):
        auth.write_text(invalid)
        with pytest.raises(ValueError, match="Claude callback"):
            evaluate_candidate(root)


def test_ready_status_requires_all_live_evidence(tmp_path):
    live = {
        "isolated_mcp_endpoint_live": True,
        "isolated_auth_endpoint_live": True,
        "claude_oauth_completed": True,
        "tools_list_discovered": True,
        "authenticated_tool_call_passed": True,
        "openai_surface_unchanged_reverified": True,
    }
    result = evaluate_candidate(make_repo(tmp_path, status="ready", live=live))
    assert result["candidate_pass"] is True
    assert result["live_submission_ready"] is True
