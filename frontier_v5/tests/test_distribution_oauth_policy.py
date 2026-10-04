import json
from pathlib import Path

import pytest

from frontier_v5.distribution.oauth_redirect_policy import (
    classify_redirect,
    is_allowed_redirect,
)
from frontier_v5.distribution.provider_registry import load_provider_profile


def test_openai_redirect_contract_remains_exact():
    assert classify_redirect("https://chatgpt.com/connector_platform_oauth_redirect") == "openai"
    assert classify_redirect("https://chatgpt.com/connector/oauth/example") == "openai"
    assert not is_allowed_redirect("https://chatgpt.com/anything-else", provider="openai")
    assert not is_allowed_redirect("https://evil.example/connector_platform_oauth_redirect", provider="openai")


def test_claude_redirect_contract_accepts_current_documented_host_only():
    assert classify_redirect("https://claude.ai/api/mcp/auth_callback") == "claude"
    assert classify_redirect("https://claude.com/api/mcp/auth_callback") is None
    assert is_allowed_redirect("https://claude.ai/api/mcp/auth_callback", provider="claude")
    assert not is_allowed_redirect("https://claude.com/api/mcp/auth_callback", provider="claude")
    assert not is_allowed_redirect("https://claude.ai/api/mcp/auth_callback/extra", provider="claude")
    assert not is_allowed_redirect("http://claude.ai/api/mcp/auth_callback", provider="claude")
    assert not is_allowed_redirect("https://sub.claude.ai/api/mcp/auth_callback", provider="claude")


def test_provider_mismatch_fails_closed():
    assert not is_allowed_redirect("https://claude.ai/api/mcp/auth_callback", provider="openai")
    assert not is_allowed_redirect("https://chatgpt.com/connector_platform_oauth_redirect", provider="claude")
    assert not is_allowed_redirect("https://claude.ai/api/mcp/auth_callback", provider="unknown")


def test_claude_profile_is_live_single_remote_mcp_but_blocked_until_execution_and_submission_gates_pass():
    root = Path(__file__).resolve().parents[1]
    profile = load_provider_profile(root / "distribution" / "providers" / "claude.json")
    assert profile["provider_id"] == "claude"
    assert profile["distribution_mode"] == "single_remote_mcp"
    assert profile["oauth"]["callback_uris"] == ["https://claude.ai/api/mcp/auth_callback"]
    assert profile["submission"]["status"] == "blocked_pending_authenticated_claude_execution_and_submission_requirements"
    assert profile["submission"]["portal_requires_paid_plan"] is True
    assert profile["submission"]["team_enterprise_org_connector_admin_controls"] is True
    assert profile["submission"]["remote_mcp_directory_submission_requires_team_or_enterprise"] is False
    assert profile["submission"]["directory_management_access_required"] is True
    assert profile["mcp"]["canonical_upstream"] == "https://mcp.mftintelligence.com/mcp"
    assert profile["mcp"]["submission_url"] != profile["mcp"]["canonical_upstream"]
    assert profile["mcp"]["submission_url"].endswith("/mcp")
    assert profile["oauth"]["issuer"].startswith("https://")
    assert profile["mcp"]["submission_url"] == "https://claude-mcp.mftintelligence.com/mcp"
    assert profile["oauth"]["issuer"] == "https://claude-auth.mftintelligence.com"
    assert profile["submission"]["publication_domain_deployment_succeeded"] is True
    assert profile["submission"]["claude_oauth_completed"] is True
    assert profile["submission"]["authenticated_tool_call_passed"] is False
    assert profile["submission"]["claude_origin_verified"] is False


def test_profile_validation_rejects_wildcard_redirects(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text(json.dumps({
        "provider_id": "claude",
        "display_name": "Claude",
        "distribution_mode": "single_remote_mcp",
        "mcp": {
            "canonical_upstream": "https://mcp.mftintelligence.com/mcp",
            "submission_url": "https://claude-mcp.mftintelligence.com/mcp",
        },
        "oauth": {
            "callback_uris": ["https://*.claude.ai/api/mcp/auth_callback"],
            "registration": "dcr",
        },
        "submission": {
            "status": "blocked_pending_isolated_endpoint_deployment",
            "portal_requires_paid_plan": False,
            "team_enterprise_org_connector_admin_controls": True,
            "remote_mcp_directory_submission_requires_team_or_enterprise": True,
            "directory_management_access_required": True,
        },
    }))
    with pytest.raises(ValueError, match="wildcard"):
        load_provider_profile(p)
