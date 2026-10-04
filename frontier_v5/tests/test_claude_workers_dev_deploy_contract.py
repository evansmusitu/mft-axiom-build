from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEPLOY = ROOT / "frontier_v5/scripts/deploy_claude_workers_dev.py"


def test_claude_workers_dev_deployer_exists_and_is_isolated():
    src = DEPLOY.read_text(encoding="utf-8")
    assert 'musitu-axiom-claude-auth-candidate' in src
    assert 'musitu-axiom-claude-mcp-candidate' in src
    assert 'musitu-axiom-oauth"' not in src
    assert 'musitu-axiom-mcp"' not in src
    assert '/workers/subdomain' in src
    assert 'workers.dev' in src


def test_deployer_never_mutates_dns_zones_or_custom_domains():
    src = DEPLOY.read_text(encoding="utf-8")
    forbidden = [
        "/dns_records",
        "/workers/domains",
        "/workers/routes",
        "/zones/",
        "override_existing_origin",
    ]
    for needle in forbidden:
        assert needle not in src


def test_deployer_pins_frozen_openai_sources_and_does_not_run_oauth_writes():
    src = DEPLOY.read_text(encoding="utf-8")
    assert '8ba0dbc1b6dd1533c6c26bff23991429e03a71a5' in src
    assert '4a1ad37a5e7df0e4d3966e8b5f9f0e8f2db69167' in src
    assert "/oauth/register" not in src
    assert "/oauth/token" not in src
    assert "/oauth/authorize" not in src
    assert "/d1/database/" not in src


def test_deployer_has_failure_cleanup_and_live_openai_reverification():
    src = DEPLOY.read_text(encoding="utf-8")
    assert "cleanup_created_candidates" in src
    assert "snapshot_openai_surface" in src
    assert "openai_surface_unchanged" in src
