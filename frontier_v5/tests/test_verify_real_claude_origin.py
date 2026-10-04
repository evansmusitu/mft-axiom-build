from __future__ import annotations

import json

import pytest

from frontier_v5.scripts import verify_real_claude_origin as mod


def base():
    return {
        "schema": "musitu.axiom.claude_real_origin_evidence.v1",
        "timestamp_utc": "2026-10-04T03:20:00Z",
        "claude_surface": "claude.ai web",
        "connector_name": "MUSITU Axiom",
        "remote_mcp_url": mod.EXPECTED_MCP_URL,
        "oauth_client_mode": "dcr",
        "oauth_completed": True,
        "tools_discovered": True,
        "commerce_tools_absent": True,
        "arithmetic_tool_name": "musitu_axiom_execute",
        "arithmetic_result_42": True,
        "npv_tool_call_passed": True,
        "no_secrets_exposed": True,
        "notes": "",
    }


def test_real_origin_evidence_requires_all_gates(tmp_path, monkeypatch):
    p = tmp_path / "evidence.json"
    p.write_text(json.dumps(base()))
    monkeypatch.setattr(mod, "snapshot_openai_surface", lambda: {"stable": True})
    monkeypatch.setattr(mod, "canonical_digest", lambda _: mod.EXPECTED_OPENAI_SURFACE_SHA256)
    result = mod.evaluate(p)
    assert result["real_claude_origin_pass"] is True
    assert result["openai_surface_unchanged_reverified"] is True


def test_real_origin_evidence_fails_closed_on_missing_proof(tmp_path, monkeypatch):
    x = base()
    x["arithmetic_result_42"] = False
    p = tmp_path / "evidence.json"
    p.write_text(json.dumps(x))
    monkeypatch.setattr(mod, "snapshot_openai_surface", lambda: {"stable": True})
    monkeypatch.setattr(mod, "canonical_digest", lambda _: mod.EXPECTED_OPENAI_SURFACE_SHA256)
    with pytest.raises(ValueError, match="arithmetic_result_42"):
        mod.evaluate(p)


def test_real_origin_evidence_fails_if_openai_surface_drifted(tmp_path, monkeypatch):
    p = tmp_path / "evidence.json"
    p.write_text(json.dumps(base()))
    monkeypatch.setattr(mod, "snapshot_openai_surface", lambda: {"changed": True})
    monkeypatch.setattr(mod, "canonical_digest", lambda _: "0" * 64)
    with pytest.raises(ValueError, match="OpenAI live surface drifted"):
        mod.evaluate(p)
