from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/axiom-claude-runtime-repair-deploy.yml"


def test_claude_runtime_repair_workflow_is_isolated():
    src = WORKFLOW.read_text(encoding="utf-8")
    assert "musitu-axiom-claude-runtime-candidate" in src
    assert "musitu-axiom-claude-mcp-core-candidate" in src
    assert "musitu-axiom-claude-kernel-candidate" in src
    assert "musitu-axiom-prod" in src
    assert "504029cc-f9a5-495e-818f-63c6144b4ea4" in src
    assert "musitu-axiom-modal-edge-stage" not in src


def test_repair_is_exact_json_key_stringification():
    src = WORKFLOW.read_text(encoding="utf-8")
    assert "return {str(k):encode(val) for k,val in v.items()}" in src
    assert "expected encoder source not found exactly once" in src
    assert "algebra.solve" in src


def test_repair_does_not_touch_dns_or_openai_workers():
    src = WORKFLOW.read_text(encoding="utf-8")
    for needle in ("/dns_records", "/workers/domains", "/workers/routes", "override_existing_origin"):
        assert needle not in src
    assert "8ba0dbc1b6dd1533c6c26bff23991429e03a71a5" in src
    assert "4a1ad37a5e7df0e4d3966e8b5f9f0e8f2db69167" in src
    assert "snapshot_openai_surface" in src
    assert "openai_surface_unchanged" in src


def test_claude_gate_has_fail_closed_rollback():
    src = WORKFLOW.read_text(encoding="utf-8")
    assert "CANONICAL_CORE = \"musitu-axiom-mcp-core\"" in src
    assert "CLAUDE_CORE = \"musitu-axiom-claude-mcp-core-candidate\"" in src
    assert "rollback_claude_gate" in src
    assert "MCP_CORE" in src
