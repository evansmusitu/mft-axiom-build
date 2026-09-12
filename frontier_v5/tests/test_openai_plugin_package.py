#!/usr/bin/env python3
"""Behavioral contract for OAI-002 current OpenAI plugin packaging.

This contract follows the current OpenAI Plugins package model: a required
``.codex-plugin/plugin.json`` manifest, bundled ``skills/``, an optional
registered-MCP compatibility ``.app.json``, and a repo marketplace at
``.agents/plugins/marketplace.json``.  MUSITU must not fabricate the external
``plugin_asdk_app...`` registration required to bind its public remote MCP.

The test proves repository-local package correctness only.  It does not claim
ChatGPT desktop installation, Developer Mode MCP registration, workspace
publication, universal directory publication, or production cutover.
"""
from __future__ import annotations

import json
import shutil
import tempfile
from copy import deepcopy
from pathlib import Path

try:
    from frontier_v5.runtime.openai_plugin_package import (
        OpenAIPluginPackage,
        OpenAIPluginPackageError,
    )
except ModuleNotFoundError as exc:
    raise AssertionError("OpenAI current plugin package runtime is missing") from exc

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "frontier_v5/MANIFEST.json"
SOURCE = ROOT / "frontier_v5/openai_plugins/musitu-axiom-public"
MARKETPLACE = ROOT / ".agents/plugins/marketplace.json"
EXPECTED_SOURCE = "./frontier_v5/openai_plugins/musitu-axiom-public"


def expect_error(fn, contains: str) -> None:
    try:
        fn()
    except OpenAIPluginPackageError as exc:
        if contains not in str(exc):
            raise AssertionError(f"expected {contains!r} in {str(exc)!r}") from exc
    else:
        raise AssertionError(f"expected OpenAIPluginPackageError containing {contains!r}")


def main() -> None:
    authority = json.loads(MANIFEST.read_text(encoding="utf-8"))
    public_skills = sorted(authority["submission_skills"])
    private_skills = sorted(authority["frontier_skills"])
    assert len(public_skills) == 18
    assert len(private_skills) == 12
    assert set(public_skills).isdisjoint(private_skills)

    package = OpenAIPluginPackage(ROOT)
    source = package.validate_source()

    # Current OpenAI package entry point and local marketplace are mandatory.
    manifest = source["manifest"]
    assert manifest["name"] == "musitu-axiom"
    assert manifest["version"] == "1.0.0"
    assert manifest["skills"] == "./skills/"
    assert manifest["interface"]["displayName"] == "MUSITU Axiom"
    assert manifest["interface"]["developerName"] == "MUSITU"
    assert manifest["interface"]["category"] == "Finance"
    assert manifest["interface"]["capabilities"] == ["Read"]
    assert "apps" not in manifest
    assert "mcpServers" not in manifest
    assert source["remote_mcp_binding_status"] == "EXTERNAL_REGISTRATION_REQUIRED"
    assert source["registered_mcp_technical_id"] is None

    marketplace = source["marketplace"]
    assert marketplace["name"] == "musitu-frontier"
    assert marketplace["interface"]["displayName"] == "MUSITU Frontier"
    assert len(marketplace["plugins"]) == 1
    entry = marketplace["plugins"][0]
    assert entry["name"] == "musitu-axiom"
    assert entry["source"] == {"source": "local", "path": EXPECTED_SOURCE}
    assert entry["policy"] == {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL",
    }
    assert entry["category"] == "Finance"

    # The canonical source must not pretend that ChatGPT has already registered
    # the remote MCP connection.  That identifier can only come from Developer
    # Mode after external platform registration.
    assert not (SOURCE / ".app.json").exists()
    assert not (SOURCE / ".mcp.json").exists()

    # Independent builds must produce the same package bytes and inventory.
    with tempfile.TemporaryDirectory(prefix="musitu-openai-plugin-a-") as a_raw, tempfile.TemporaryDirectory(
        prefix="musitu-openai-plugin-b-"
    ) as b_raw:
        a = package.build(Path(a_raw))
        b = package.build(Path(b_raw))
        assert a["gate"] == b["gate"] == "PASS"
        assert a["manifest_sha256"] == b["manifest_sha256"]
        assert a["inventory_sha256"] == b["inventory_sha256"]
        assert a["archive_sha256"] == b["archive_sha256"]
        assert a["files"] == b["files"] == sorted(a["files"])
        assert a["skill_names"] == b["skill_names"] == public_skills
        assert a["skill_count"] == b["skill_count"] == 18
        assert a["private_frontier_components_included"] is False
        assert a["remote_mcp_binding_status"] == "EXTERNAL_REGISTRATION_REQUIRED"
        assert a["registered_mcp_technical_id"] is None
        assert a["external_client_install_verified"] is False
        assert a["evidence_level"] == 2

        built = Path(a["package_root"])
        plugin_dir = built / ".codex-plugin"
        assert sorted(path.name for path in plugin_dir.iterdir()) == ["plugin.json"]
        assert not (built / ".app.json").exists()
        assert not (built / ".mcp.json").exists()

        built_manifest = json.loads((plugin_dir / "plugin.json").read_text(encoding="utf-8"))
        assert built_manifest == manifest
        assert "apps" not in built_manifest
        assert "mcpServers" not in built_manifest

        for skill in public_skills:
            skill_md = built / "skills" / skill / "SKILL.md"
            assert skill_md.is_file(), skill
            assert f"name: {skill}" in skill_md.read_text(encoding="utf-8")
            for shared in ("QUALITY.md", "PROOF.md", "ROUTING.md", "COMMERCIAL.md"):
                assert (built / "skills" / skill / "references" / shared).is_file()
        for skill in private_skills:
            assert not (built / "skills" / skill).exists(), skill

        inventory = json.loads((built / "INVENTORY.json").read_text(encoding="utf-8"))
        assert inventory["schema"] == "musitu.axiom.openai-plugin.inventory.v1"
        assert inventory["authorized_profile"] == "submission"
        assert inventory["skills"] == public_skills
        assert inventory["private_frontier_components_included"] is False
        assert inventory["remote_mcp_binding_status"] == "EXTERNAL_REGISTRATION_REQUIRED"

        loaded = package.validate_package(built)
        assert loaded["valid"] is True
        assert loaded["skills"] == public_skills
        assert loaded["remote_mcp_binding_status"] == "EXTERNAL_REGISTRATION_REQUIRED"

        # Fatal manifest path and identity attacks.
        valid_manifest = deepcopy(built_manifest)
        bad = deepcopy(valid_manifest)
        bad["name"] = "MUSITU Axiom"
        expect_error(lambda: package.validate_manifest(bad), "plugin name")
        bad = deepcopy(valid_manifest)
        bad["version"] = "latest"
        expect_error(lambda: package.validate_manifest(bad), "semantic version")
        for unsafe in ("skills/", "../skills", "/tmp/skills", "./../skills"):
            bad = deepcopy(valid_manifest)
            bad["skills"] = unsafe
            expect_error(lambda bad=bad: package.validate_manifest(bad), "skills path")

        # A registered-MCP compatibility mapping is prohibited until the real
        # external ChatGPT registration has been supplied and promoted.
        tampered = Path(a_raw) / "tampered-app"
        shutil.copytree(built, tampered)
        app_manifest = json.loads((tampered / ".codex-plugin/plugin.json").read_text(encoding="utf-8"))
        app_manifest["apps"] = "./.app.json"
        (tampered / ".codex-plugin/plugin.json").write_text(
            json.dumps(app_manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8"
        )
        (tampered / ".app.json").write_text(
            json.dumps({"musitu-axiom": "plugin_asdk_app_unverified"}) + "\n", encoding="utf-8"
        )
        expect_error(lambda: package.validate_package(tampered), "external MCP registration")

        # Missing or private skills fail closed rather than silently changing
        # the public capability surface.
        tampered = Path(a_raw) / "tampered-missing"
        shutil.copytree(built, tampered)
        shutil.rmtree(tampered / "skills" / public_skills[0])
        expect_error(lambda: package.validate_package(tampered), "authorized public skills")

        tampered = Path(a_raw) / "tampered-private"
        shutil.copytree(built, tampered)
        private_source = ROOT / "frontier_v5/skills" / private_skills[0]
        shutil.copytree(private_source, tampered / "skills" / private_skills[0])
        expect_error(lambda: package.validate_package(tampered), "private Frontier skill")

        # Marketplace source/path/policy cannot drift outside the reviewed repo
        # package or silently auto-install without the declared auth boundary.
        bad_market = deepcopy(marketplace)
        bad_market["plugins"][0]["source"]["path"] = "../outside"
        expect_error(lambda: package.validate_marketplace(bad_market), "marketplace source path")
        bad_market = deepcopy(marketplace)
        bad_market["plugins"][0]["policy"]["installation"] = "INSTALLED_BY_DEFAULT"
        expect_error(lambda: package.validate_marketplace(bad_market), "installation policy")
        bad_market = deepcopy(marketplace)
        bad_market["plugins"][0]["policy"]["authentication"] = "NEVER"
        expect_error(lambda: package.validate_marketplace(bad_market), "authentication policy")

    print("MUSITU_AXIOM_FRONTIER_OPENAI_PLUGIN_PACKAGE_PASS")


if __name__ == "__main__":
    main()
