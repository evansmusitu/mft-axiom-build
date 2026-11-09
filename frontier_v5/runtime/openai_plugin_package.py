#!/usr/bin/env python3
"""Deterministic current-format OpenAI plugin packaging for MUSITU Axiom.

This module implements only repository-local evidence.  It packages the 18
public submission skills under the current ``.codex-plugin/plugin.json``
format and validates the repo marketplace used by ChatGPT/Codex authoring
surfaces.  It deliberately does not fabricate ``.app.json`` or an
``plugin_asdk_app...`` identifier: the public remote MCP must first be
registered in ChatGPT Developer Mode and that external state must be supplied
and separately promoted.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from frontier_v5.runtime.agent_plugin_package import AgentPluginError, AgentPluginPackage


PLUGIN_REL = Path("frontier_v5/openai_plugins/musitu-axiom-public")
MARKETPLACE_REL = Path(".agents/plugins/marketplace.json")
MARKETPLACE_SOURCE = "./frontier_v5/openai_plugins/musitu-axiom-public"
REMOTE_MCP_BINDING_STATUS = "EXTERNAL_REGISTRATION_REQUIRED"

_NAME = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
_SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
_ALLOWED_MANIFEST_FIELDS = {
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "skills",
    "mcpServers",
    "apps",
    "hooks",
    "interface",
}
_ALLOWED_AUTHOR_FIELDS = {"name", "email", "url"}
_ALLOWED_INTERFACE_FIELDS = {
    "displayName",
    "shortDescription",
    "longDescription",
    "developerName",
    "category",
    "capabilities",
    "websiteURL",
    "privacyPolicyURL",
    "termsOfServiceURL",
    "defaultPrompt",
    "brandColor",
    "composerIcon",
    "logo",
    "screenshots",
}


class OpenAIPluginPackageError(RuntimeError):
    """Raised when a current OpenAI plugin package invariant fails."""


def _stable_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise OpenAIPluginPackageError(f"{label} is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise OpenAIPluginPackageError(f"{label} must be a JSON object")
    return value


def _required_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OpenAIPluginPackageError(f"{label} must be a non-empty string")
    return value.strip()


def _safe_component_path(value: object, label: str) -> str:
    path = _required_string(value, label)
    if not path.startswith("./"):
        raise OpenAIPluginPackageError(f"{label} must be a ./-relative path")
    if "\\" in path:
        raise OpenAIPluginPackageError(f"{label} must use portable forward slashes")
    relative = path[2:]
    parts = [part for part in relative.split("/") if part]
    if not parts or any(part in {".", ".."} for part in parts):
        raise OpenAIPluginPackageError(f"{label} must stay inside the plugin root")
    return path


def _frontmatter_name(path: Path) -> str | None:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None
    if not text.startswith("---"):
        return None
    for line in text.splitlines()[1:]:
        if line.strip() == "---":
            break
        match = re.fullmatch(r"name:\s*['\"]?([^'\"\s]+)['\"]?\s*", line.strip())
        if match:
            return match.group(1)
    return None


class OpenAIPluginPackage:
    """Build and validate MUSITU's isolated current OpenAI plugin source."""

    def __init__(self, repository_root: Path | str):
        self.root = Path(repository_root).resolve()
        self.frontier = self.root / "frontier_v5"
        self.authority_path = self.frontier / "MANIFEST.json"
        self.source = self.root / PLUGIN_REL
        self.marketplace_path = self.root / MARKETPLACE_REL
        self.skills_root = self.frontier / "skills"
        self.portable = AgentPluginPackage(self.root)
        for required in (self.authority_path, self.skills_root):
            if not required.exists():
                raise OpenAIPluginPackageError(f"required repository source is missing: {required}")

    def _authority(self) -> tuple[list[str], list[str]]:
        raw = _read_json(self.authority_path, "frontier_v5/MANIFEST.json")
        public = raw.get("submission_skills")
        private = raw.get("frontier_skills")
        if not isinstance(public, list) or not all(isinstance(item, str) for item in public):
            raise OpenAIPluginPackageError("MANIFEST submission_skills must be a string list")
        if not isinstance(private, list) or not all(isinstance(item, str) for item in private):
            raise OpenAIPluginPackageError("MANIFEST frontier_skills must be a string list")
        public_names = sorted(public)
        private_names = sorted(private)
        if len(public_names) != 18 or len(private_names) != 12:
            raise OpenAIPluginPackageError("authorized public/private skill counts changed without review")
        if set(public_names) & set(private_names):
            raise OpenAIPluginPackageError("public and private skill authorities overlap")
        return public_names, private_names

    def validate_manifest(self, raw: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(raw, Mapping):
            raise OpenAIPluginPackageError("plugin manifest must be an object")
        manifest = dict(raw)
        unknown = sorted(set(manifest) - _ALLOWED_MANIFEST_FIELDS)
        if unknown:
            raise OpenAIPluginPackageError(f"plugin manifest contains unsupported fields: {unknown}")

        name = _required_string(manifest.get("name"), "plugin name")
        if _NAME.fullmatch(name) is None or "--" in name:
            raise OpenAIPluginPackageError("plugin name must use stable kebab-case")
        version = _required_string(manifest.get("version"), "plugin version")
        if _SEMVER.fullmatch(version) is None:
            raise OpenAIPluginPackageError("plugin version must use semantic version syntax")
        _required_string(manifest.get("description"), "plugin description")

        if "skills" in manifest:
            skills_path = _safe_component_path(manifest["skills"], "skills path")
            if skills_path != "./skills/":
                raise OpenAIPluginPackageError("skills path must be ./skills/")
        if "apps" in manifest:
            apps_path = _safe_component_path(manifest["apps"], "apps path")
            if apps_path != "./.app.json":
                raise OpenAIPluginPackageError("apps path must be ./.app.json")
        if "mcpServers" in manifest:
            _safe_component_path(manifest["mcpServers"], "mcpServers path")
        if "hooks" in manifest and isinstance(manifest["hooks"], str):
            _safe_component_path(manifest["hooks"], "hooks path")

        author = manifest.get("author")
        if author is not None:
            if not isinstance(author, Mapping):
                raise OpenAIPluginPackageError("plugin author must be an object")
            unknown_author = sorted(set(author) - _ALLOWED_AUTHOR_FIELDS)
            if unknown_author:
                raise OpenAIPluginPackageError(f"plugin author contains unsupported fields: {unknown_author}")
            _required_string(author.get("name"), "plugin author.name")

        interface = manifest.get("interface")
        if interface is not None:
            if not isinstance(interface, Mapping):
                raise OpenAIPluginPackageError("plugin interface must be an object")
            unknown_interface = sorted(set(interface) - _ALLOWED_INTERFACE_FIELDS)
            if unknown_interface:
                raise OpenAIPluginPackageError(
                    f"plugin interface contains unsupported fields: {unknown_interface}"
                )
            for key in ("displayName", "shortDescription", "longDescription", "developerName", "category"):
                if key in interface:
                    _required_string(interface[key], f"plugin interface.{key}")
            capabilities = interface.get("capabilities")
            if capabilities is not None:
                if not isinstance(capabilities, Sequence) or isinstance(capabilities, (str, bytes)):
                    raise OpenAIPluginPackageError("plugin interface.capabilities must be a list")
                if not capabilities or any(value not in {"Read", "Write"} for value in capabilities):
                    raise OpenAIPluginPackageError("plugin interface.capabilities contains unsupported values")
            prompts = interface.get("defaultPrompt")
            if prompts is not None:
                if not isinstance(prompts, Sequence) or isinstance(prompts, (str, bytes)):
                    raise OpenAIPluginPackageError("plugin interface.defaultPrompt must be a list")
                if not prompts or any(not isinstance(item, str) or not item.strip() for item in prompts):
                    raise OpenAIPluginPackageError("plugin interface.defaultPrompt contains invalid prompt text")

        return manifest

    def validate_marketplace(self, raw: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(raw, Mapping):
            raise OpenAIPluginPackageError("marketplace must be an object")
        marketplace = dict(raw)
        if marketplace.get("name") != "musitu-frontier":
            raise OpenAIPluginPackageError("marketplace name must remain musitu-frontier")
        interface = marketplace.get("interface")
        if not isinstance(interface, Mapping) or interface.get("displayName") != "MUSITU Frontier":
            raise OpenAIPluginPackageError("marketplace display name drifted")
        plugins = marketplace.get("plugins")
        if not isinstance(plugins, list) or len(plugins) != 1 or not isinstance(plugins[0], Mapping):
            raise OpenAIPluginPackageError("marketplace must expose exactly one reviewed plugin")
        entry = dict(plugins[0])
        if entry.get("name") != "musitu-axiom":
            raise OpenAIPluginPackageError("marketplace plugin name drifted")
        source = entry.get("source")
        if not isinstance(source, Mapping) or source.get("source") != "local":
            raise OpenAIPluginPackageError("marketplace source must be local")
        if source.get("path") != MARKETPLACE_SOURCE:
            raise OpenAIPluginPackageError("marketplace source path must remain inside the reviewed Frontier package")
        policy = entry.get("policy")
        if not isinstance(policy, Mapping):
            raise OpenAIPluginPackageError("marketplace policy is required")
        if policy.get("installation") != "AVAILABLE":
            raise OpenAIPluginPackageError("marketplace installation policy must remain AVAILABLE")
        if policy.get("authentication") != "ON_INSTALL":
            raise OpenAIPluginPackageError("marketplace authentication policy must remain ON_INSTALL")
        if entry.get("category") != "Finance":
            raise OpenAIPluginPackageError("marketplace category must remain Finance")
        return marketplace

    def validate_source(self) -> dict[str, Any]:
        plugin_path = self.source / ".codex-plugin" / "plugin.json"
        if not plugin_path.is_file():
            raise OpenAIPluginPackageError("current OpenAI .codex-plugin/plugin.json is required")
        codex_dir = plugin_path.parent
        if sorted(path.name for path in codex_dir.iterdir()) != ["plugin.json"]:
            raise OpenAIPluginPackageError("only plugin.json may exist inside .codex-plugin")
        manifest = self.validate_manifest(_read_json(plugin_path, "source .codex-plugin/plugin.json"))
        if manifest.get("name") != "musitu-axiom" or manifest.get("version") != "1.0.0":
            raise OpenAIPluginPackageError("canonical MUSITU plugin identity/version drifted")
        if manifest.get("skills") != "./skills/":
            raise OpenAIPluginPackageError("canonical MUSITU plugin must declare ./skills/")
        if "apps" in manifest or (self.source / ".app.json").exists():
            raise OpenAIPluginPackageError(
                "external MCP registration is required before .app.json/apps may be included"
            )
        if "mcpServers" in manifest or (self.source / ".mcp.json").exists():
            raise OpenAIPluginPackageError(
                "public remote MCP must use a registered app mapping rather than a fabricated bundled MCP"
            )
        interface = manifest.get("interface")
        if not isinstance(interface, Mapping):
            raise OpenAIPluginPackageError("canonical MUSITU plugin interface is required")
        required_interface = {
            "displayName": "MUSITU Axiom",
            "developerName": "MUSITU",
            "category": "Finance",
            "capabilities": ["Read"],
        }
        for key, value in required_interface.items():
            if interface.get(key) != value:
                raise OpenAIPluginPackageError(f"canonical MUSITU plugin interface.{key} drifted")
        marketplace = self.validate_marketplace(_read_json(self.marketplace_path, "repo marketplace"))
        return {
            "manifest": manifest,
            "marketplace": marketplace,
            "remote_mcp_binding_status": REMOTE_MCP_BINDING_STATUS,
            "registered_mcp_technical_id": None,
        }

    def validate_package(self, package_root: Path | str) -> dict[str, Any]:
        root = Path(package_root).resolve()
        plugin_path = root / ".codex-plugin" / "plugin.json"
        if not plugin_path.is_file():
            raise OpenAIPluginPackageError(".codex-plugin/plugin.json is required")
        codex_dir = plugin_path.parent
        if sorted(path.name for path in codex_dir.iterdir()) != ["plugin.json"]:
            raise OpenAIPluginPackageError("only plugin.json may exist inside .codex-plugin")
        manifest = self.validate_manifest(_read_json(plugin_path, ".codex-plugin/plugin.json"))

        if "apps" in manifest or (root / ".app.json").exists():
            raise OpenAIPluginPackageError(
                "external MCP registration is required before .app.json/apps may be included"
            )
        if "mcpServers" in manifest or (root / ".mcp.json").exists():
            raise OpenAIPluginPackageError(
                "public remote MCP cannot be represented as a bundled MCP in this package"
            )

        public, private = self._authority()
        skills_dir = root / "skills"
        if not skills_dir.is_dir():
            raise OpenAIPluginPackageError("authorized public skills directory is missing")
        actual = sorted(path.name for path in skills_dir.iterdir() if path.is_dir())
        leaked = sorted(set(actual) & set(private))
        if leaked:
            raise OpenAIPluginPackageError(f"private Frontier skill leaked into public package: {leaked}")
        if actual != public:
            raise OpenAIPluginPackageError(
                f"authorized public skills changed: expected {public}, found {actual}"
            )
        for skill in public:
            skill_md = skills_dir / skill / "SKILL.md"
            if not skill_md.is_file() or _frontmatter_name(skill_md) != skill:
                raise OpenAIPluginPackageError(f"authorized public skills contain invalid SKILL.md: {skill}")
            for shared in ("QUALITY.md", "PROOF.md", "ROUTING.md", "COMMERCIAL.md"):
                if not (skills_dir / skill / "references" / shared).is_file():
                    raise OpenAIPluginPackageError(
                        f"authorized public skills missing portable reference {shared}: {skill}"
                    )

        return {
            "valid": True,
            "manifest": manifest,
            "skills": public,
            "remote_mcp_binding_status": REMOTE_MCP_BINDING_STATUS,
            "registered_mcp_technical_id": None,
            "external_client_install_verified": False,
            "evidence_level": 2,
        }

    def build(self, destination: Path | str) -> dict[str, Any]:
        source = self.validate_source()
        public, private = self._authority()
        destination = Path(destination).resolve()
        destination.mkdir(parents=True, exist_ok=True)
        package_root = destination / "musitu-axiom-public"
        archive = destination / "musitu-axiom-public.openai-plugin.zip"
        if package_root.exists():
            shutil.rmtree(package_root)
        package_root.mkdir(parents=True)

        plugin_dir = package_root / ".codex-plugin"
        plugin_dir.mkdir(parents=True)
        manifest_path = plugin_dir / "plugin.json"
        manifest_path.write_text(_stable_json(source["manifest"]), encoding="utf-8", newline="\n")

        for skill in public:
            try:
                self.portable._copy_skill(skill, package_root / "skills" / skill)
            except AgentPluginError as exc:
                raise OpenAIPluginPackageError(str(exc)) from exc

        inventory = {
            "schema": "musitu.axiom.openai-plugin.inventory.v1",
            "format": "openai.plugins.current",
            "authorized_profile": "submission",
            "skills": public,
            "private_frontier_components_included": False,
            "remote_mcp_binding_status": REMOTE_MCP_BINDING_STATUS,
            "registered_mcp_technical_id": None,
            "external_client_install_verified": False,
            "evidence_level": 2,
        }
        inventory_path = package_root / "INVENTORY.json"
        inventory_path.write_text(_stable_json(inventory), encoding="utf-8", newline="\n")

        self.validate_package(package_root)
        try:
            self.portable._write_deterministic_zip(package_root, archive)
        except AgentPluginError as exc:
            raise OpenAIPluginPackageError(str(exc)) from exc

        files = sorted(
            path.relative_to(package_root).as_posix()
            for path in package_root.rglob("*")
            if path.is_file()
        )
        skill_names = sorted(path.name for path in (package_root / "skills").iterdir() if path.is_dir())
        if skill_names != public or set(skill_names) & set(private):
            raise OpenAIPluginPackageError("final public skill inventory does not match authority")

        return {
            "gate": "PASS",
            "package_root": str(package_root),
            "archive": str(archive),
            "manifest_sha256": _sha256_file(manifest_path),
            "inventory_sha256": _sha256_file(inventory_path),
            "archive_sha256": _sha256_file(archive),
            "files": files,
            "skill_names": skill_names,
            "skill_count": len(skill_names),
            "private_frontier_components_included": False,
            "remote_mcp_binding_status": REMOTE_MCP_BINDING_STATUS,
            "registered_mcp_technical_id": None,
            "external_client_install_verified": False,
            "evidence_level": 2,
        }
