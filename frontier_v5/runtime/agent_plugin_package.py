#!/usr/bin/env python3
"""Deterministic Agent Plugins 1.0 packaging for the public MUSITU Axiom surface.

The builder is deliberately repository-local and standard-library-only.  It
packages only ``MANIFEST.json`` submission skills plus the public MCP endpoint;
it never packages private Frontier skills, credentials, fixed Authorization
headers, production secrets, or private commerce/admin surfaces.

Validation follows Agent Plugins 1.0 component isolation: fatal plugin-manifest
errors reject the plugin, while invalid MCP configuration is reported as a
component failure without hiding otherwise valid skills.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import zipfile
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
PLUGIN_SPEC_VERSION = "1.0.0"

_NAME = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$")
_SKILL_NAME = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
_SAFE_SERVER_NAME = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
_SHARED_REFERENCE_FILES = ("QUALITY.md", "PROOF.md", "ROUTING.md", "COMMERCIAL.md")
_ALLOWED_MANIFEST_FIELDS = {
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "extensions",
}
_ALLOWED_AUTHOR_FIELDS = {"name", "email", "url"}
_SENSITIVE_HEADER_NAMES = {
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "api-key",
}


class AgentPluginError(RuntimeError):
    """Raised when a fatal Agent Plugin package invariant fails."""


def _stable_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n"


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise AgentPluginError(f"{label} is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise AgentPluginError(f"{label} must be a JSON object")
    return value


def _require_string(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AgentPluginError(f"{label} must be a non-empty string")
    return value.strip()


def _valid_plugin_name(name: str) -> bool:
    return (
        1 <= len(name) <= 64
        and _NAME.fullmatch(name) is not None
        and re.search(r"[._-]{2}", name) is None
    )


def _is_loopback_hostname(hostname: str | None) -> bool:
    if hostname is None:
        return False
    host = hostname.lower().strip("[]")
    return host in {"localhost", "127.0.0.1", "::1"} or host.startswith("127.")


def _skill_frontmatter_name(text: str) -> str | None:
    if not text.startswith("---"):
        return None
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    for line in lines[1:]:
        if line.strip() == "---":
            break
        match = re.match(r"^name:\s*['\"]?([^'\"\s]+)['\"]?\s*$", line.strip())
        if match:
            return match.group(1)
    return None


class AgentPluginPackage:
    """Build and validate the isolated public MUSITU Agent Plugin package."""

    def __init__(self, repository_root: Path | str):
        self.root = Path(repository_root).resolve()
        self.frontier = self.root / "frontier_v5"
        self.manifest_path = self.frontier / "MANIFEST.json"
        self.skills_root = self.frontier / "skills"
        self.shared_root = self.frontier / "shared"
        self.source_package = self.frontier / "agent_plugins" / "musitu-axiom-public"
        for required in (self.manifest_path, self.skills_root, self.shared_root, self.source_package):
            if not required.exists():
                raise AgentPluginError(f"required package source is missing: {required}")

    def validate_manifest(self, raw: Mapping[str, Any]) -> dict[str, Any]:
        if not isinstance(raw, Mapping):
            raise AgentPluginError("plugin manifest must be an object")
        manifest = dict(raw)
        if manifest.get("$schema") != PLUGIN_SCHEMA:
            raise AgentPluginError("unsupported plugin schema; Agent Plugins 1.0.0 is required")

        name = _require_string(manifest.get("name"), "plugin manifest name")
        if not _valid_plugin_name(name):
            raise AgentPluginError("plugin name violates Agent Plugins 1.0 naming rules")

        if "version" in manifest:
            version = _require_string(manifest.get("version"), "plugin manifest version")
            if _SEMVER.fullmatch(version) is None:
                raise AgentPluginError("plugin manifest version must be semantic version syntax")
        if "description" in manifest:
            _require_string(manifest.get("description"), "plugin manifest description")
        for optional in ("homepage", "repository", "license"):
            if optional in manifest:
                _require_string(manifest.get(optional), f"plugin manifest {optional}")

        if "author" in manifest:
            author = manifest["author"]
            if not isinstance(author, Mapping):
                raise AgentPluginError("plugin manifest author must be an object")
            unknown_author = sorted(set(author) - _ALLOWED_AUTHOR_FIELDS)
            if unknown_author:
                raise AgentPluginError(f"plugin manifest author contains unsupported fields: {unknown_author}")
            _require_string(author.get("name"), "plugin manifest author.name")
            for optional in ("email", "url"):
                if optional in author:
                    _require_string(author.get(optional), f"plugin manifest author.{optional}")

        ignored_unknown = sorted(set(manifest) - _ALLOWED_MANIFEST_FIELDS)
        normalized = {key: value for key, value in manifest.items() if key in _ALLOWED_MANIFEST_FIELDS}
        extensions_ignored = False
        if "extensions" in normalized and not isinstance(normalized["extensions"], Mapping):
            normalized.pop("extensions", None)
            extensions_ignored = True

        return {
            "valid": True,
            "manifest": normalized,
            "ignored_unknown_fields": ignored_unknown,
            "extensions_ignored": extensions_ignored,
        }

    def _discover_skills(self, package_root: Path) -> tuple[list[str], list[str]]:
        skills_dir = package_root / "skills"
        if not skills_dir.is_dir():
            return [], []
        valid: list[str] = []
        skipped: list[str] = []
        for candidate in sorted(skills_dir.iterdir(), key=lambda p: p.name):
            if not candidate.is_dir() or candidate.is_symlink():
                continue
            skill_md = candidate / "SKILL.md"
            if not skill_md.is_file() or skill_md.is_symlink():
                skipped.append(candidate.name)
                continue
            try:
                text = skill_md.read_text(encoding="utf-8")
            except (OSError, UnicodeError):
                skipped.append(candidate.name)
                continue
            declared = _skill_frontmatter_name(text)
            if (
                declared is None
                or declared != candidate.name
                or _SKILL_NAME.fullmatch(declared) is None
                or re.search(r"-{2}", declared) is not None
            ):
                skipped.append(candidate.name)
                continue
            valid.append(candidate.name)
        return valid, skipped

    @staticmethod
    def _validate_server(name: str, raw: object) -> bool:
        if _SAFE_SERVER_NAME.fullmatch(name) is None or not isinstance(raw, Mapping):
            return False
        server = dict(raw)
        if server.get("type") != "streamable-http":
            return False
        allowed = {"type", "url", "headers"}
        if set(server) - allowed:
            return False
        url = server.get("url")
        if not isinstance(url, str) or not url.strip():
            return False
        parsed = urlparse(url.strip())
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return False
        if parsed.username is not None or parsed.password is not None or parsed.fragment:
            return False
        if parsed.scheme == "http" and not _is_loopback_hostname(parsed.hostname):
            return False
        headers = server.get("headers")
        if headers is not None:
            if not isinstance(headers, Mapping):
                return False
            for key, value in headers.items():
                if not isinstance(key, str) or not isinstance(value, str):
                    return False
                if key.strip().lower() in _SENSITIVE_HEADER_NAMES:
                    return False
        return True

    def _validate_mcp(self, raw: object) -> dict[str, Any]:
        if not isinstance(raw, Mapping):
            return {"mcp_valid": False, "mcp_servers": [], "skipped_mcp_servers": []}
        mcp = dict(raw)
        if set(mcp) != {"$schema", "mcpServers"} or mcp.get("$schema") != MCP_SCHEMA:
            return {"mcp_valid": False, "mcp_servers": [], "skipped_mcp_servers": []}
        servers = mcp.get("mcpServers")
        if not isinstance(servers, Mapping):
            return {"mcp_valid": False, "mcp_servers": [], "skipped_mcp_servers": []}
        valid: list[str] = []
        skipped: list[str] = []
        for name in sorted(servers):
            if self._validate_server(str(name), servers[name]):
                valid.append(str(name))
            else:
                skipped.append(str(name))
        return {
            "mcp_valid": bool(valid),
            "mcp_servers": valid,
            "skipped_mcp_servers": skipped,
        }

    def validate_components(
        self,
        package_root: Path | str,
        *,
        mcp_override: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        root = Path(package_root).resolve()
        skills, skipped_skills = self._discover_skills(root)
        if mcp_override is None:
            mcp_path = root / "mcp.json"
            if mcp_path.is_file():
                try:
                    mcp_value: object = json.loads(mcp_path.read_text(encoding="utf-8"))
                except (OSError, UnicodeError, json.JSONDecodeError):
                    mcp_value = None
            else:
                mcp_value = None
        else:
            mcp_value = mcp_override
        mcp = self._validate_mcp(mcp_value)
        return {
            "skills": skills,
            "skipped_skills": skipped_skills,
            **mcp,
        }

    def validate_package(self, package_root: Path | str) -> dict[str, Any]:
        root = Path(package_root).resolve()
        plugin_path = root / "plugin.json"
        if not plugin_path.is_file():
            raise AgentPluginError("plugin.json is required at package root")
        manifest = self.validate_manifest(_read_json(plugin_path, "plugin.json"))
        components = self.validate_components(root)
        return {
            "plugin_valid": True,
            "plugin": manifest["manifest"],
            "ignored_unknown_fields": manifest["ignored_unknown_fields"],
            "extensions_ignored": manifest["extensions_ignored"],
            **components,
        }

    @staticmethod
    def _copy_file(source: Path, target: Path) -> None:
        if source.is_symlink():
            raise AgentPluginError(f"symlinks are not portable package inputs: {source}")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(source.read_bytes())

    def _copy_skill(self, skill_name: str, destination: Path) -> None:
        source = (self.skills_root / skill_name).resolve()
        if source.parent != self.skills_root.resolve() or not source.is_dir():
            raise AgentPluginError(f"authorized skill source is missing: {skill_name}")
        if source.is_symlink():
            raise AgentPluginError(f"skill source cannot be a symlink: {skill_name}")

        for path in sorted(source.rglob("*"), key=lambda p: p.as_posix()):
            if path.is_dir():
                if path.is_symlink():
                    raise AgentPluginError(f"symlink directory is not portable: {path}")
                continue
            if path.is_symlink():
                raise AgentPluginError(f"symlink file is not portable: {path}")
            relative = path.relative_to(source)
            self._copy_file(path, destination / relative)

        skill_md = destination / "SKILL.md"
        if not skill_md.is_file():
            raise AgentPluginError(f"authorized skill lacks SKILL.md: {skill_name}")
        text = skill_md.read_text(encoding="utf-8")
        text = text.replace("../../shared/", "references/")
        skill_md.write_text(text, encoding="utf-8", newline="\n")

        references = destination / "references"
        references.mkdir(parents=True, exist_ok=True)
        for filename in _SHARED_REFERENCE_FILES:
            shared = self.shared_root / filename
            if not shared.is_file() or shared.is_symlink():
                raise AgentPluginError(f"required shared reference is missing: {filename}")
            self._copy_file(shared, references / filename)

    @staticmethod
    def _write_deterministic_zip(package_root: Path, archive: Path) -> None:
        if archive.exists():
            archive.unlink()
        files = sorted(
            (path for path in package_root.rglob("*") if path.is_file()),
            key=lambda path: path.relative_to(package_root).as_posix(),
        )
        with zipfile.ZipFile(archive, "w") as bundle:
            for path in files:
                relative = path.relative_to(package_root).as_posix()
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.flag_bits |= 0x800
                bundle.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    def build(self, destination: Path | str) -> dict[str, Any]:
        destination = Path(destination).resolve()
        destination.mkdir(parents=True, exist_ok=True)
        package_root = destination / "musitu-axiom-public"
        archive = destination / "musitu-axiom-public.agent-plugin.zip"
        if package_root.exists():
            shutil.rmtree(package_root)
        package_root.mkdir(parents=True)

        plugin_source = self.source_package / "plugin.json"
        mcp_source = self.source_package / "mcp.json"
        plugin_raw = _read_json(plugin_source, "source plugin.json")
        self.validate_manifest(plugin_raw)
        mcp_raw = _read_json(mcp_source, "source mcp.json")
        mcp_report = self._validate_mcp(mcp_raw)
        if not mcp_report["mcp_valid"] or mcp_report["mcp_servers"] != ["musitu-axiom"]:
            raise AgentPluginError("source public MCP component is not valid Agent Plugins 1.0 configuration")
        public_server = mcp_raw["mcpServers"]["musitu-axiom"]
        if "headers" in public_server:
            raise AgentPluginError("public portable MCP component must not embed fixed headers")

        self._copy_file(plugin_source, package_root / "plugin.json")
        self._copy_file(mcp_source, package_root / "mcp.json")

        manifest = _read_json(self.manifest_path, "frontier_v5/MANIFEST.json")
        submission = manifest.get("submission_skills")
        private = manifest.get("frontier_skills")
        if (
            isinstance(submission, (str, bytes, bytearray))
            or not isinstance(submission, Sequence)
            or isinstance(private, (str, bytes, bytearray))
            or not isinstance(private, Sequence)
        ):
            raise AgentPluginError("MANIFEST skill authorization lists must be arrays")
        public_skills = sorted(_require_string(item, "submission skill") for item in submission)
        private_skills = sorted(_require_string(item, "private Frontier skill") for item in private)
        if len(public_skills) != len(set(public_skills)) or len(private_skills) != len(set(private_skills)):
            raise AgentPluginError("MANIFEST skill authorization lists must be unique")
        overlap = sorted(set(public_skills) & set(private_skills))
        if overlap:
            raise AgentPluginError(f"public/private skill authorization overlap: {overlap}")

        for skill_name in public_skills:
            self._copy_skill(skill_name, package_root / "skills" / skill_name)

        discovered, skipped = self._discover_skills(package_root)
        if skipped or discovered != public_skills:
            raise AgentPluginError(
                f"built public skill inventory mismatch: expected={public_skills} actual={discovered} skipped={skipped}"
            )
        if set(private_skills) & set(discovered):
            raise AgentPluginError("private Frontier skill leaked into portable public package")

        inventory = {
            "schema": "musitu.axiom.agent-plugin.inventory.v1",
            "agent_plugins_spec": PLUGIN_SPEC_VERSION,
            "authorized_profile": "submission",
            "plugin_name": "musitu-axiom",
            "skills": public_skills,
            "mcp_servers": list(mcp_report["mcp_servers"]),
            "private_frontier_components_included": False,
            "external_client_install_verified": False,
            "evidence_level": 2,
        }
        inventory_path = package_root / "INVENTORY.json"
        inventory_path.write_text(_stable_json(inventory), encoding="utf-8", newline="\n")

        loaded = self.validate_package(package_root)
        if loaded["skills"] != public_skills or loaded["mcp_servers"] != ["musitu-axiom"]:
            raise AgentPluginError("built package failed post-build component validation")

        files = sorted(
            path.relative_to(package_root).as_posix()
            for path in package_root.rglob("*")
            if path.is_file()
        )
        self._write_deterministic_zip(package_root, archive)
        return {
            "schema": "musitu.axiom.agent-plugin.build-receipt.v1",
            "gate": "PASS",
            "agent_plugins_spec": PLUGIN_SPEC_VERSION,
            "package_root": str(package_root),
            "archive_path": str(archive),
            "plugin_sha256": _sha256_file(package_root / "plugin.json"),
            "inventory_sha256": _sha256_file(inventory_path),
            "archive_sha256": _sha256_file(archive),
            "files": files,
            "skill_names": public_skills,
            "skill_count": len(public_skills),
            "mcp_servers": list(mcp_report["mcp_servers"]),
            "private_frontier_components_included": False,
            "external_client_install_verified": False,
            "evidence_level": 2,
        }


__all__ = [
    "AgentPluginError",
    "AgentPluginPackage",
    "MCP_SCHEMA",
    "PLUGIN_SCHEMA",
    "PLUGIN_SPEC_VERSION",
]
