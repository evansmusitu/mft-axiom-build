from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "frontier_v5/scripts/claude_oauth_fixture_e2e.py"


def test_fixture_e2e_uses_exact_claude_callback_and_synthetic_identity():
    src = SCRIPT.read_text(encoding="utf-8")
    assert 'https://claude.ai/api/mcp/auth_callback' in src
    assert "fixture_claude_oauth_" in src
    assert "@invalid.example" in src
    assert "40+2" in src


def test_fixture_e2e_is_cleanup_first_and_never_uses_real_user_credentials():
    src = SCRIPT.read_text(encoding="utf-8")
    assert "finally:" in src
    assert "DELETE FROM usage_events" in src
    assert "DELETE FROM oauth_access_tokens" in src
    assert "DELETE FROM oauth_refresh_tokens" in src
    assert "DELETE FROM oauth_authorization_codes" in src
    assert "DELETE FROM oauth_authorization_flows" in src
    assert "DELETE FROM oauth_clients" in src
    assert "DELETE FROM api_keys" in src
    assert "DELETE FROM customers" in src
    assert "MUSITU_ACCOUNT_KEY" not in src


def test_fixture_e2e_reverifies_openai_surface_and_does_not_claim_real_claude_origin():
    src = SCRIPT.read_text(encoding="utf-8")
    assert "snapshot_openai_surface" in src
    assert "server_side_claude_callback_e2e" in src
    assert '"claude_origin_verified": False' in src


def test_fixture_e2e_uses_exact_mcp_resource_and_proves_http_401_challenge():
    src = SCRIPT.read_text(encoding="utf-8")
    assert 'MCP_RESOURCE = MCP_URL + "/mcp"' in src
    assert '"resource": MCP_RESOURCE' in src
    assert "unauth_code != 401" in src
    assert "WWW-Authenticate" in src
    assert 'scope="axiom.execute"' in src
