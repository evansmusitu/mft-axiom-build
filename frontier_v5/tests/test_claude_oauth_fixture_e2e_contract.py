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


def test_fixture_e2e_executes_all_canonical_operation_fixtures_through_claude_mcp():
    src = SCRIPT.read_text(encoding="utf-8")
    assert 'submission/claude/operation-fixtures.json' in src
    assert 'operation_count") != 74' in src or "operation_count') != 74" in src
    assert "functional_operation_pass_count" in src
    assert "functional_operation_failures" in src
    assert "for operation, args in sorted(fixtures.items())" in src
    assert '"name": "musitu_axiom_execute"' in src


def test_fixture_e2e_runs_official_mcp_inspector_across_all_exposed_tools():
    src = SCRIPT.read_text(encoding="utf-8")
    assert "run_mcp_inspector_preflight" in src
    assert "@modelcontextprotocol/inspector@2.5.0" in src
    assert "mcp-inspector" in src
    assert "tempfile.TemporaryDirectory" in src
    assert "inspector_tool_count" in src
    assert "inspector_tool_pass_count" in src
    assert "inspector_tool_failures" in src
    assert "inspector_tool_count != 108" in src
    assert "raw_inspector_access_token_published" in src
    assert '"raw_inspector_access_token_published": False' in src


def test_oauth_workflow_pins_supported_node_and_inspector_version():
    workflow = (ROOT / ".github/workflows/axiom-frontier-v5-claude-oauth-fixture-e2e.yml").read_text(encoding="utf-8")
    assert "actions/setup-node@v4" in workflow
    assert 'node-version: "22.19.0"' in workflow
    assert "@modelcontextprotocol/inspector@2.5.0" in workflow


def test_fixture_e2e_requires_arithmetic_result_in_text_content_for_claude():
    src = SCRIPT.read_text(encoding="utf-8")
    assert "arithmetic_text_42_observed" in src
    assert "Claude arithmetic result 42 is absent from MCP text content" in src
    assert '"arithmetic_40_plus_2_text_result_42"' in src
