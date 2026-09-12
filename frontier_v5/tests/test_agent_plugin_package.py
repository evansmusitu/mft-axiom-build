#!/usr/bin/env python3
"""Behavioral contract for DEF-017 Agent Plugins 1.0 portability.

The contract follows the published Agent Plugins v1.0.0 package semantics:
root plugin.json, fixed skills/ discovery, root mcp.json, canonical schema
identifiers, fatal manifest validation (except explicitly non-fatal unknown
fields/extensions), and non-fatal MCP component failures.

This test proves repository-local portability structure only.  It does not claim
that an external vendor client has installed or executed the package.
"""
from __future__ import annotations

import json
import tempfile
from copy import deepcopy
from pathlib import Path

try:
    from frontier_v5.runtime.agent_plugin_package import (
        AgentPluginError,
        AgentPluginPackage,
        MCP_SCHEMA,
        PLUGIN_SCHEMA,
    )
except ModuleNotFoundError as exc:
    raise AssertionError("Agent Plugins 1.0 package runtime is missing") from exc

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "frontier_v5/MANIFEST.json"
SOURCE_PACKAGE = ROOT / "frontier_v5/agent_plugins/musitu-axiom-public"
PUBLIC_MCP = "https://mcp.mftintelligence.com/mcp"


def expect_error(fn, contains: str) -> None:
    try:
        fn()
    except AgentPluginError as exc:
        if contains not in str(exc):
            raise AssertionError(f"expected {contains!r} in {str(exc)!r}") from exc
    else:
        raise AssertionError(f"expected AgentPluginError containing {contains!r}")


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    public_skills = sorted(manifest["submission_skills"])
    private_skills = sorted(manifest["frontier_skills"])
    assert len(public_skills) == 18
    assert len(private_skills) == 12
    assert not (set(public_skills) & set(private_skills))

    package = AgentPluginPackage(ROOT)

    # Source package declares only portable core metadata.  Component config
    # remains in the standard fixed locations rather than inline in plugin.json.
    plugin_json = json.loads((SOURCE_PACKAGE / "plugin.json").read_text(encoding="utf-8"))
    assert plugin_json["$schema"] == PLUGIN_SCHEMA
    assert plugin_json["name"] == "musitu-axiom"
    assert "skills" not in plugin_json
    assert "mcpServers" not in plugin_json

    mcp_json = json.loads((SOURCE_PACKAGE / "mcp.json").read_text(encoding="utf-8"))
    assert mcp_json == {
        "$schema": MCP_SCHEMA,
        "mcpServers": {
            "musitu-axiom": {
                "type": "streamable-http",
                "url": PUBLIC_MCP,
            }
        },
    }
    # The public package never embeds OAuth bearer material or other fixed auth.
    assert "headers" not in mcp_json["mcpServers"]["musitu-axiom"]

    # Two independent builds must be byte-identical and have deterministic,
    # sorted inventory.  This catches timestamp/order drift and hidden files.
    with tempfile.TemporaryDirectory(prefix="musitu-agent-plugin-a-") as a_raw, tempfile.TemporaryDirectory(
        prefix="musitu-agent-plugin-b-"
    ) as b_raw:
        a = package.build(Path(a_raw))
        b = package.build(Path(b_raw))
        assert a["gate"] == b["gate"] == "PASS"
        assert a["plugin_sha256"] == b["plugin_sha256"]
        assert a["inventory_sha256"] == b["inventory_sha256"]
        assert a["archive_sha256"] == b["archive_sha256"]
        assert a["files"] == b["files"] == sorted(a["files"])
        assert a["skill_names"] == b["skill_names"] == public_skills
        assert a["skill_count"] == b["skill_count"] == 18
        assert set(private_skills).isdisjoint(a["skill_names"])
        assert a["mcp_servers"] == ["musitu-axiom"]
        assert a["external_client_install_verified"] is False
        assert a["evidence_level"] == 2

        built_root = Path(a["package_root"])
        for skill in public_skills:
            skill_md = built_root / "skills" / skill / "SKILL.md"
            assert skill_md.is_file(), skill
            text = skill_md.read_text(encoding="utf-8")
            assert f"name: {skill}" in text
            # Portable package references must remain inside each skill folder.
            assert "../../shared/" not in text
            for shared in ("QUALITY.md", "PROOF.md", "ROUTING.md", "COMMERCIAL.md"):
                assert (built_root / "skills" / skill / "references" / shared).is_file()

        inventory = json.loads((built_root / "INVENTORY.json").read_text(encoding="utf-8"))
        assert inventory["schema"] == "musitu.axiom.agent-plugin.inventory.v1"
        assert inventory["agent_plugins_spec"] == "1.0.0"
        assert inventory["authorized_profile"] == "submission"
        assert inventory["skills"] == public_skills
        assert inventory["mcp_servers"] == ["musitu-axiom"]
        assert inventory["private_frontier_components_included"] is False

        # Validate the built package with the repository-local conforming loader.
        loaded = package.validate_package(built_root)
        assert loaded["plugin_valid"] is True
        assert loaded["skills"] == public_skills
        assert loaded["mcp_valid"] is True
        assert loaded["mcp_servers"] == ["musitu-axiom"]

        valid_manifest = json.loads((built_root / "plugin.json").read_text(encoding="utf-8"))

        # Fatal plugin.json schema violations reject the entire plugin.
        bad = deepcopy(valid_manifest)
        bad["$schema"] = "https://agent-plugins.org/schemas/9.9.9/plugin.schema.json"
        expect_error(lambda: package.validate_manifest(bad), "unsupported plugin schema")
        bad = deepcopy(valid_manifest)
        bad.pop("name")
        expect_error(lambda: package.validate_manifest(bad), "name")
        for invalid_name in ("MUSITU-Axiom", "-musitu", "musitu--axiom", "musitu..axiom"):
            bad = deepcopy(valid_manifest)
            bad["name"] = invalid_name
            expect_error(lambda bad=bad: package.validate_manifest(bad), "plugin name")
        bad = deepcopy(valid_manifest)
        bad["author"] = {"name": "MUSITU", "secret": "forbidden"}
        expect_error(lambda: package.validate_manifest(bad), "author")

        # Unknown top-level fields are non-fatal/report-and-ignore by Agent
        # Plugins 1.0; they must never acquire semantics in our loader.
        extended = deepcopy(valid_manifest)
        extended["inventedCapability"] = "must-not-become-a-tool"
        report = package.validate_manifest(extended)
        assert report["valid"] is True
        assert report["ignored_unknown_fields"] == ["inventedCapability"]
        assert "inventedCapability" not in report["manifest"]

        # Non-object extensions are also non-fatal and ignored.
        extended = deepcopy(valid_manifest)
        extended["extensions"] = "invalid-client-data"
        report = package.validate_manifest(extended)
        assert report["valid"] is True
        assert report["extensions_ignored"] is True
        assert "extensions" not in report["manifest"]

        valid_mcp = json.loads((built_root / "mcp.json").read_text(encoding="utf-8"))

        # Invalid top-level MCP configuration disables MCP but leaves skills
        # discoverable; version mismatch is component-level, not plugin-fatal.
        bad_mcp = deepcopy(valid_mcp)
        bad_mcp["$schema"] = "https://agent-plugins.org/schemas/9.9.9/mcp.schema.json"
        report = package.validate_components(built_root, mcp_override=bad_mcp)
        assert report["skills"] == public_skills
        assert report["mcp_valid"] is False
        assert report["mcp_servers"] == []

        # One invalid server is skipped while another valid server remains.
        mixed = deepcopy(valid_mcp)
        mixed["mcpServers"]["bad-server"] = {
            "type": "streamable-http",
            "url": "http://not-loopback.example/mcp",
        }
        report = package.validate_components(built_root, mcp_override=mixed)
        assert report["mcp_valid"] is True
        assert report["mcp_servers"] == ["musitu-axiom"]
        assert report["skipped_mcp_servers"] == ["bad-server"]

        # mcp.json has a closed top-level schema.
        bad_mcp = deepcopy(valid_mcp)
        bad_mcp["inlineAuth"] = {"token": "no"}
        report = package.validate_components(built_root, mcp_override=bad_mcp)
        assert report["mcp_valid"] is False
        assert report["skills"] == public_skills

    print("MUSITU_AXIOM_FRONTIER_AGENT_PLUGIN_1_0_PASS")


if __name__ == "__main__":
    main()
