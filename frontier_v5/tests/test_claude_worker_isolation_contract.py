from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTIER = ROOT / "frontier_v5"
CLAUDE = FRONTIER / "distribution" / "claude"

OPENAI_AUTH_BLOB_SHA1 = "8ba0dbc1b6dd1533c6c26bff23991429e03a71a5"
OPENAI_MCP_BLOB_SHA1 = "4a1ad37a5e7df0e4d3966e8b5f9f0e8f2db69167"


def git_blob_sha1(path: Path) -> str:
    data = path.read_bytes()
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def test_frozen_openai_sources_are_byte_exact():
    assert git_blob_sha1(ROOT / "auth" / "musitu_axiom_oauth_worker.mjs") == OPENAI_AUTH_BLOB_SHA1
    assert git_blob_sha1(ROOT / "mcp" / "musitu_axiom_plugin_gate_v4.mjs") == OPENAI_MCP_BLOB_SHA1


def test_claude_auth_candidate_is_isolated_and_uses_exact_callback_contract():
    src = (CLAUDE / "musitu_axiom_oauth_worker_claude_candidate.mjs").read_text()
    assert "https://claude-auth.mftintelligence.com" in src
    assert "https://claude-mcp.mftintelligence.com/mcp" in src
    assert 'u.hostname !== "claude.ai"' in src
    assert '"claude.com"' not in src
    assert 'u.pathname !== "/api/mcp/auth_callback"' in src
    assert "status: 302" in src or "status:302" in src
    assert "chatgpt.com" not in src
    assert "connector_platform_oauth_redirect" not in src


def test_claude_mcp_candidate_has_no_openai_only_surface():
    src = (CLAUDE / "musitu_axiom_mcp_gate_claude_candidate.mjs").read_text()
    assert "https://claude-auth.mftintelligence.com" in src
    assert "https://claude-mcp.mftintelligence.com" in src
    assert "openai-apps-challenge" not in src
    assert "openai/toolInvocation" not in src
    assert "OPENAI_APPS_CHALLENGE" not in src


def test_claude_mcp_candidate_uses_exact_mcp_resource_and_http_401_auth_challenge():
    src = (CLAUDE / "musitu_axiom_mcp_gate_claude_candidate.mjs").read_text()
    assert 'oauthResource:env.MCP_OAUTH_RESOURCE||"https://claude-mcp.mftintelligence.com/mcp"' in src
    assert 'publicBase:env.MCP_PUBLIC_BASE||"https://claude-mcp.mftintelligence.com"' in src
    assert 'row.resource!==c.oauthResource' in src
    assert 'new Request(c.publicBase+path' in src
    assert 'resource:c.oauthResource' in src
    assert 'return response(401' in src
    assert '"www-authenticate":challenge(c)' in src
