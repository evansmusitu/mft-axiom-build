from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "frontier_v5/scripts/deploy_claude_publication_domains.py"
WORKFLOW = ROOT / ".github/workflows/axiom-frontier-v5-claude-publication-domain.yml"
PREFLIGHT = ROOT / "frontier_v5/scripts/check_claude_publication_domain_preflight.py"
PREFLIGHT_WORKFLOW = ROOT / ".github/workflows/axiom-frontier-v5-claude-publication-domain-preflight.yml"


def test_publication_domain_deploy_is_manual_only_and_separate_from_test_workers():
    assert SCRIPT.exists(), "Claude publication deploy script is missing"
    src = SCRIPT.read_text(encoding="utf-8")
    assert 'EXPECTED_BRANCH = "distribution/claude-remote-mcp-20261004"' in src
    assert 'PUBLIC_AUTH_WORKER = "musitu-axiom-claude-auth-publication"' in src
    assert 'PUBLIC_MCP_WORKER = "musitu-axiom-claude-mcp-publication"' in src
    assert 'TEST_AUTH_WORKER = "musitu-axiom-claude-auth-candidate"' in src
    assert 'TEST_MCP_WORKER = "musitu-axiom-claude-mcp-candidate"' in src
    assert 'PUBLIC_AUTH_HOST = "claude-auth.mftintelligence.com"' in src
    assert 'PUBLIC_MCP_HOST = "claude-mcp.mftintelligence.com"' in src
    assert 'ATTACH_CLAUDE_PUBLICATION_DOMAINS' in src
    assert 'GITHUB_EVENT_NAME' in src
    assert '"workflow_dispatch"' in src


def test_publication_domain_deploy_preserves_openai_and_fails_closed_on_collision():
    src = SCRIPT.read_text(encoding="utf-8")
    assert 'EXPECTED_OPENAI_AUTH_BLOB = "8ba0dbc1b6dd1533c6c26bff23991429e03a71a5"' in src
    assert 'EXPECTED_OPENAI_MCP_BLOB = "4a1ad37a5e7df0e4d3966e8b5f9f0e8f2db69167"' in src
    assert "snapshot_openai_surface" in src
    assert "canonical_digest" in src
    assert "hostname already belongs to another Worker" in src
    assert "preexisting DNS record" in src
    assert "cleanup_created_publication_surface" in src


def test_publication_bindings_use_owned_domains_without_mutating_candidate_workers():
    src = SCRIPT.read_text(encoding="utf-8")
    assert '"OAUTH_ISSUER", "text": PUBLIC_AUTH_URL' in src
    assert '"MCP_RESOURCE", "text": PUBLIC_MCP_RESOURCE' in src
    assert '"AUTH_ISSUER", "text": PUBLIC_AUTH_URL' in src
    assert '"MCP_PUBLIC_BASE", "text": PUBLIC_MCP_URL' in src
    assert '"MCP_OAUTH_RESOURCE", "text": PUBLIC_MCP_RESOURCE' in src
    assert "TEST_AUTH_WORKER" in src and "TEST_MCP_WORKER" in src
    assert "upload_worker(headers, PUBLIC_AUTH_WORKER" in src
    assert "upload_worker(headers, PUBLIC_MCP_WORKER" in src


def test_publication_workflow_requires_explicit_manual_authorization():
    assert WORKFLOW.exists(), "Claude publication workflow is missing"
    workflow = WORKFLOW.read_text(encoding="utf-8")
    sentinel = ROOT / "submission/claude/ATTACH_CLAUDE_PUBLICATION_DOMAINS.authorized"
    assert "workflow_dispatch:" in workflow
    assert "authorization:" in workflow
    assert "ATTACH_CLAUDE_PUBLICATION_DOMAINS" in workflow
    assert "CLAUDE_PUBLICATION_CONFIRM" in workflow
    assert "deploy_claude_publication_domains.py" in workflow
    if sentinel.exists():
        assert sentinel.read_text(encoding="utf-8").strip() == "ATTACH_CLAUDE_PUBLICATION_DOMAINS"
        assert "\n  push:" in workflow
        assert 'submission/claude/ATTACH_CLAUDE_PUBLICATION_DOMAINS.authorized' in workflow
    else:
        assert "\n  push:" not in workflow


def test_publication_domain_preflight_is_read_only():
    assert PREFLIGHT.exists(), "Claude publication-domain preflight script is missing"
    src = PREFLIGHT.read_text(encoding="utf-8")
    assert 'PUBLIC_AUTH_HOST = "claude-auth.mftintelligence.com"' in src
    assert 'PUBLIC_MCP_HOST = "claude-mcp.mftintelligence.com"' in src
    assert "workers/domains" in src
    assert "dns_records" in src
    assert '"PUT"' not in src
    assert '"POST"' not in src
    assert '"DELETE"' not in src
    assert "write_performed" in src
    assert '"write_performed": False' in src


def test_publication_domain_preflight_workflow_is_non_mutating():
    assert PREFLIGHT_WORKFLOW.exists(), "Claude publication-domain preflight workflow is missing"
    workflow = PREFLIGHT_WORKFLOW.read_text(encoding="utf-8")
    assert "workflow_dispatch:" in workflow
    assert "check_claude_publication_domain_preflight.py" in workflow
    assert "deploy_claude_publication_domains.py" not in workflow
    assert "CLAUDE_PUBLICATION_CONFIRM" not in workflow


def test_publication_domain_uses_hostname_scoped_config_rules_via_phase_entrypoint():
    src = SCRIPT.read_text(encoding="utf-8")
    assert '/rulesets/phases/http_config_settings/entrypoint' in src
    cfg = src[src.index("def _configuration_ruleset"):src.index("def _assert_machine_rule_available")]
    assert '/rulesets/phases/http_config_settings/entrypoint' in cfg
    assert 'f"/zones/{zone_id}/rulesets"' not in cfg

    main = src[src.index("def main()"):]
    assert "_assert_machine_rule_available(" in main
    assert "_create_machine_rule(" in main
    assert "MACHINE_RULE_REF" in main
    assert main.count("_create_machine_rule(") == 1
    assert 'rules_headers = _ruleset_headers()' in main
    assert "CLOUDFLARE_RULESETS_API_TOKEN" in src

    assert '"action": "set_config"' in src
    assert '"security_level": "essentially_off"' in src
    assert '"bic": False' in src
    assert 'def _machine_rule_expression()' in src
    assert 'http.host eq "{PUBLIC_AUTH_HOST}" or ' in src
    assert 'http.host eq "{PUBLIC_MCP_HOST}"' in src
    assert '"global_security_policy_mutated": False' in src


def test_publication_rollback_removes_created_scoped_rules_domains_and_workers():
    src = SCRIPT.read_text(encoding="utf-8")
    main = src[src.index("def main()"):]
    assert "created_rules" in main
    assert "cleanup_created_publication_surface(" in main
    assert "_delete_machine_rule(" in src
    assert "created_domains" in main
    assert "created_workers" in main
    assert "Claude publication rollback incomplete" in src


def test_publication_security_exception_is_one_two_hostname_rule_not_zone_global_settings():
    src = SCRIPT.read_text(encoding="utf-8")
    main = src[src.index("def main()"):]
    assert "PUBLIC_AUTH_HOST" in main
    assert "PUBLIC_MCP_HOST" in main
    assert "MACHINE_RULE_REF" in main
    assert '"count": len(created_rules)' in src
    assert "hostnames" in src
    assert '"/settings/security_level"' not in main
    assert '"/settings/browser_check"' not in main
    assert "_ruleset_headers()" in main
    assert "CLOUDFLARE_RULESETS_API_TOKEN" in src
    workflow = WORKFLOW.read_text(encoding="utf-8")
    assert 'CLOUDFLARE_RULESETS_API_TOKEN: ${{ secrets.CLOUDFLARE_RULESETS_API_TOKEN }}' in workflow
    assert '"global_security_policy_mutated": False' in src
