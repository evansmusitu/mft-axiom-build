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
    assert "workflow_dispatch:" in workflow
    assert "\n  push:" not in workflow
    assert "authorization:" in workflow
    assert "ATTACH_CLAUDE_PUBLICATION_DOMAINS" in workflow
    assert "CLAUDE_PUBLICATION_CONFIRM" in workflow
    assert "deploy_claude_publication_domains.py" in workflow


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
