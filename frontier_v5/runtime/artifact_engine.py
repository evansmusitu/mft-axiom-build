"""Deterministic Universal Artifact Engine for Axiom interface Phase 5.

This module provides stable artifact identity, immutable version history,
deterministic diff, non-destructive rollback, permissions, comments, sources,
dependency links, machine-readable metadata, export bundles and tamper-evident
provenance. It is a local contract; it does not claim cloud collaboration or
external publication/deployment.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
import hashlib
import json
from typing import Any, Mapping, Sequence

ARTIFACT_TYPES = frozenset({"document", "sheet", "presentation", "website", "dashboard"})
ROLES = frozenset({"owner", "editor", "viewer"})
WRITERS = frozenset({"owner", "editor"})


class ArtifactError(RuntimeError):
    pass


class ArtifactIntegrityError(ArtifactError):
    pass


class ArtifactPermissionError(ArtifactError):
    pass


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _text(value: Any, name: str, max_len: int = 4000) -> str:
    if not isinstance(value, str):
        raise ArtifactError(f"{name} must be string")
    value = value.strip()
    if not value or len(value) > max_len:
        raise ArtifactError(f"{name} must be non-empty and <= {max_len} chars")
    return value


def _time(value: Any, name: str) -> str:
    text = _text(value, name, 96)
    try:
        dt = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise ArtifactError(f"{name} must be ISO-8601") from exc
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ArtifactError(f"{name} must include timezone")
    return text


def _json_value(value: Any, name: str) -> Any:
    try:
        encoded = _canonical(value)
        return json.loads(encoded)
    except (TypeError, ValueError) as exc:
        raise ArtifactError(f"{name} must be JSON-serializable") from exc


def _unique_texts(values: Sequence[Any], name: str, max_len: int = 500) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        item = _text(value, name, max_len)
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _permissions(values: Sequence[Mapping[str, Any]], owner_id: str) -> list[dict[str, str]]:
    if not values:
        raise ArtifactError("permissions required")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    owns = False
    for grant in values:
        principal = _text(grant.get("principal_id"), "principal_id", 180)
        role = _text(grant.get("role"), "role", 32)
        if role not in ROLES or principal in seen:
            raise ArtifactError("invalid artifact permissions")
        seen.add(principal)
        owns = owns or (principal == owner_id and role == "owner")
        out.append({"principal_id": principal, "role": role})
    if not owns:
        raise ArtifactError("owner permission required")
    return sorted(out, key=lambda g: g["principal_id"])


def _diff(before: Any, after: Any, path: str = "") -> list[dict[str, Any]]:
    if type(before) is not type(after):
        return [{"path": path or "/", "before": deepcopy(before), "after": deepcopy(after)}]
    if isinstance(before, dict):
        rows: list[dict[str, Any]] = []
        for key in sorted(set(before) | set(after)):
            child = f"{path}/{key.replace('~','~0').replace('/','~1')}"
            if key not in before:
                rows.append({"path": child, "before": None, "after": deepcopy(after[key])})
            elif key not in after:
                rows.append({"path": child, "before": deepcopy(before[key]), "after": None})
            else:
                rows.extend(_diff(before[key], after[key], child))
        return rows
    if isinstance(before, list):
        rows: list[dict[str, Any]] = []
        for index in range(max(len(before), len(after))):
            child = f"{path}/{index}"
            if index >= len(before):
                rows.append({"path": child, "before": None, "after": deepcopy(after[index])})
            elif index >= len(after):
                rows.append({"path": child, "before": deepcopy(before[index]), "after": None})
            else:
                rows.extend(_diff(before[index], after[index], child))
        return rows
    return [] if before == after else [{"path": path or "/", "before": before, "after": after}]


class UniversalArtifactEngine:
    """In-memory reference contract for first-class artifact semantics."""

    def __init__(self) -> None:
        self.artifacts: dict[str, dict[str, Any]] = {}
        self.versions: dict[str, list[dict[str, Any]]] = {}
        self.comments: dict[str, list[dict[str, Any]]] = {}

    def _artifact(self, artifact_id: str) -> dict[str, Any]:
        try:
            return self.artifacts[artifact_id]
        except KeyError as exc:
            raise ArtifactError("artifact not found") from exc

    @staticmethod
    def _role(row: Mapping[str, Any], actor_id: str) -> str | None:
        for grant in row["permissions"]:
            if grant["principal_id"] == actor_id:
                return grant["role"]
        return None

    def _authorize(self, row: Mapping[str, Any], actor_id: str, write: bool = False) -> str:
        role = self._role(row, actor_id)
        if role is None or (write and role not in WRITERS):
            raise ArtifactPermissionError("artifact permission denied")
        return role

    def _validate_dependencies(self, artifact_id: str, project_id: str, deps: Sequence[str]) -> list[str]:
        out = _unique_texts(deps, "dependency_artifact_id", 180)
        if artifact_id in out:
            raise ArtifactError("artifact cannot depend on itself")
        for dep in out:
            row = self.artifacts.get(dep)
            if row is None or row["project_id"] != project_id:
                raise ArtifactError("dependency must exist in same project")
        return sorted(out)

    def _validate_acyclic(self, override: tuple[str, Sequence[str]] | None = None) -> None:
        graph = {aid: list(row["dependency_artifact_ids"]) for aid, row in self.artifacts.items()}
        if override:
            graph[override[0]] = list(override[1])
        visiting: set[str] = set()
        visited: set[str] = set()
        def visit(node: str) -> None:
            if node in visiting:
                raise ArtifactError("artifact dependency cycle detected")
            if node in visited:
                return
            visiting.add(node)
            for dep in graph.get(node, []):
                if dep not in graph:
                    raise ArtifactError("artifact dependency missing")
                visit(dep)
            visiting.remove(node)
            visited.add(node)
        for node in sorted(graph):
            visit(node)

    def _snapshot(self, row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "content": deepcopy(row["content"]),
            "source_refs": list(row["source_refs"]),
            "dependency_artifact_ids": list(row["dependency_artifact_ids"]),
            "metadata": deepcopy(row["metadata"]),
            "permissions": deepcopy(row["permissions"]),
        }

    def _append_version(
        self,
        row: dict[str, Any],
        *,
        actor_id: str,
        at: str,
        change_type: str,
        provenance_source: str,
        rollback_of_version_id: str | None = None,
    ) -> dict[str, Any]:
        at = _time(at, "version timestamp")
        provenance_source = _text(provenance_source, "provenance_source", 500)
        history = self.versions.setdefault(row["artifact_id"], [])
        prior = history[-1] if history else None
        version_number = len(history)
        body = {
            "schema": "musitu.axiom.artifact-version.v1",
            "artifact_id": row["artifact_id"],
            "project_id": row["project_id"],
            "version_id": f"{row['artifact_id']}:v{version_number}",
            "version_number": version_number,
            "artifact_type": row["artifact_type"],
            "snapshot": self._snapshot(row),
            "snapshot_sha256": _sha(self._snapshot(row)),
            "change_type": change_type,
            "rollback_of_version_id": rollback_of_version_id,
            "actor_id": actor_id,
            "created_at": at,
            "provenance": {
                "source": provenance_source,
                "actor_id": actor_id,
                "created_at": at,
            },
            "previous_version_sha256": prior["version_sha256"] if prior else None,
        }
        version = {**body, "version_sha256": _sha(body)}
        history.append(version)
        row["current_version_id"] = version["version_id"]
        row["current_version_number"] = version_number
        row["updated_at"] = at
        return deepcopy(version)

    def create_artifact(
        self,
        *,
        artifact_id: str,
        project_id: str,
        artifact_type: str,
        title: str,
        owner_id: str,
        content: Any,
        created_at: str,
        provenance_source: str,
        permissions: Sequence[Mapping[str, Any]] | None = None,
        source_refs: Sequence[str] = (),
        dependency_artifact_ids: Sequence[str] = (),
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        artifact_id = _text(artifact_id, "artifact_id", 180)
        if artifact_id in self.artifacts:
            raise ArtifactError("duplicate artifact_id")
        project_id = _text(project_id, "project_id", 180)
        artifact_type = _text(artifact_type, "artifact_type", 48)
        if artifact_type not in ARTIFACT_TYPES:
            raise ArtifactError("unsupported artifact type")
        title = _text(title, "title", 240)
        owner_id = _text(owner_id, "owner_id", 180)
        created_at = _time(created_at, "created_at")
        perms = _permissions(permissions or ({"principal_id": owner_id, "role": "owner"},), owner_id)
        deps = self._validate_dependencies(artifact_id, project_id, dependency_artifact_ids)
        row = {
            "schema": "musitu.axiom.artifact.v1",
            "artifact_id": artifact_id,
            "project_id": project_id,
            "artifact_type": artifact_type,
            "title": title,
            "owner_id": owner_id,
            "content": _json_value(content, "content"),
            "source_refs": _unique_texts(source_refs, "source_ref"),
            "dependency_artifact_ids": deps,
            "metadata": _json_value(dict(metadata or {}), "metadata"),
            "permissions": perms,
            "created_at": created_at,
            "updated_at": created_at,
            "current_version_id": None,
            "current_version_number": -1,
            "persistence_scope": "LOCAL_CONTRACT",
            "cloud_collaboration_claimed": False,
            "external_publication_claimed": False,
        }
        self.artifacts[artifact_id] = row
        self.comments[artifact_id] = []
        try:
            self._validate_acyclic()
            self._append_version(row, actor_id=owner_id, at=created_at, change_type="create", provenance_source=provenance_source)
        except Exception:
            self.artifacts.pop(artifact_id, None)
            self.versions.pop(artifact_id, None)
            self.comments.pop(artifact_id, None)
            raise
        return deepcopy(row)

    def edit_artifact(
        self,
        artifact_id: str,
        *,
        actor_id: str,
        expected_version: int,
        at: str,
        provenance_source: str,
        content: Any | None = None,
        source_refs: Sequence[str] | None = None,
        dependency_artifact_ids: Sequence[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
        permissions: Sequence[Mapping[str, Any]] | None = None,
    ) -> dict[str, Any]:
        row = self._artifact(artifact_id)
        self._authorize(row, actor_id, write=True)
        if row["current_version_number"] != expected_version:
            raise ArtifactError("artifact version conflict")
        next_row = deepcopy(row)
        if content is not None:
            next_row["content"] = _json_value(content, "content")
        if source_refs is not None:
            next_row["source_refs"] = _unique_texts(source_refs, "source_ref")
        if dependency_artifact_ids is not None:
            next_row["dependency_artifact_ids"] = self._validate_dependencies(artifact_id, row["project_id"], dependency_artifact_ids)
            self._validate_acyclic((artifact_id, next_row["dependency_artifact_ids"]))
        if metadata is not None:
            next_row["metadata"] = _json_value(dict(metadata), "metadata")
        if permissions is not None:
            if self._role(row, actor_id) != "owner":
                raise ArtifactPermissionError("only owner may change permissions")
            next_row["permissions"] = _permissions(permissions, row["owner_id"])
        self.artifacts[artifact_id] = next_row
        try:
            version = self._append_version(next_row, actor_id=actor_id, at=at, change_type="edit", provenance_source=provenance_source)
        except Exception:
            self.artifacts[artifact_id] = row
            raise
        return {"artifact": deepcopy(next_row), "version": version}

    def rollback(
        self,
        artifact_id: str,
        *,
        actor_id: str,
        target_version: int,
        expected_version: int,
        at: str,
        provenance_source: str,
    ) -> dict[str, Any]:
        row = self._artifact(artifact_id)
        self._authorize(row, actor_id, write=True)
        if row["current_version_number"] != expected_version:
            raise ArtifactError("artifact version conflict")
        history = self.versions[artifact_id]
        if target_version < 0 or target_version >= len(history) or target_version == expected_version:
            raise ArtifactError("rollback target must be an earlier version")
        target = history[target_version]
        snap = target["snapshot"]
        restored = deepcopy(row)
        for key in ("content", "source_refs", "dependency_artifact_ids", "metadata", "permissions"):
            restored[key] = deepcopy(snap[key])
        self._validate_acyclic((artifact_id, restored["dependency_artifact_ids"]))
        self.artifacts[artifact_id] = restored
        try:
            version = self._append_version(
                restored,
                actor_id=actor_id,
                at=at,
                change_type="rollback",
                provenance_source=provenance_source,
                rollback_of_version_id=target["version_id"],
            )
        except Exception:
            self.artifacts[artifact_id] = row
            raise
        return {"artifact": deepcopy(restored), "version": version}

    def diff_versions(self, artifact_id: str, before_version: int, after_version: int) -> dict[str, Any]:
        self._artifact(artifact_id)
        history = self.versions[artifact_id]
        if min(before_version, after_version) < 0 or max(before_version, after_version) >= len(history):
            raise ArtifactError("version index out of range")
        before = history[before_version]
        after = history[after_version]
        changes = _diff(before["snapshot"], after["snapshot"])
        return {
            "schema": "musitu.axiom.artifact-diff.v1",
            "artifact_id": artifact_id,
            "before_version_id": before["version_id"],
            "after_version_id": after["version_id"],
            "change_count": len(changes),
            "changes": changes,
            "diff_sha256": _sha(changes),
        }

    def add_comment(self, artifact_id: str, *, actor_id: str, text: str, at: str) -> dict[str, Any]:
        row = self._artifact(artifact_id)
        self._authorize(row, actor_id, write=False)
        at = _time(at, "comment timestamp")
        body = {
            "schema": "musitu.axiom.artifact-comment.v1",
            "artifact_id": artifact_id,
            "comment_id": f"{artifact_id}:c{len(self.comments[artifact_id])}",
            "actor_id": actor_id,
            "text": _text(text, "comment", 4000),
            "created_at": at,
        }
        comment = {**body, "comment_sha256": _sha(body)}
        self.comments[artifact_id].append(comment)
        return deepcopy(comment)

    def verify_integrity(self, artifact_id: str | None = None) -> dict[str, Any]:
        ids = [artifact_id] if artifact_id else sorted(self.artifacts)
        errors: list[str] = []
        try:
            self._validate_acyclic()
        except ArtifactError:
            errors.append("dependency_graph")
        for aid in ids:
            row = self.artifacts.get(aid)
            if row is None:
                errors.append(f"artifact_missing:{aid}")
                continue
            history = self.versions.get(aid, [])
            previous = None
            for index, version in enumerate(history):
                body = {k: deepcopy(v) for k, v in version.items() if k != "version_sha256"}
                if version["version_number"] != index or version["previous_version_sha256"] != previous:
                    errors.append(f"version_chain:{aid}:{index}")
                if _sha(body) != version["version_sha256"]:
                    errors.append(f"version_hash:{aid}:{index}")
                if _sha(version["snapshot"]) != version["snapshot_sha256"]:
                    errors.append(f"snapshot_hash:{aid}:{index}")
                previous = version["version_sha256"]
            if not history or row["current_version_id"] != history[-1]["version_id"] or row["current_version_number"] != len(history)-1:
                errors.append(f"current_version:{aid}")
            for comment in self.comments.get(aid, []):
                body = {k: deepcopy(v) for k, v in comment.items() if k != "comment_sha256"}
                if _sha(body) != comment["comment_sha256"]:
                    errors.append(f"comment_hash:{comment['comment_id']}")
        result = {
            "schema": "musitu.axiom.artifact-integrity.v1",
            "status": "PASS" if not errors else "FAIL",
            "artifact_ids": ids,
            "artifact_count": len(ids),
            "errors": sorted(set(errors)),
        }
        result["integrity_sha256"] = _sha(result)
        return result

    def export_bundle(self, artifact_id: str) -> dict[str, Any]:
        row = deepcopy(self._artifact(artifact_id))
        self._authorize(row, row["owner_id"], write=False)
        payload = {
            "schema": "musitu.axiom.artifact-export.v1",
            "artifact": row,
            "versions": deepcopy(self.versions[artifact_id]),
            "comments": deepcopy(self.comments[artifact_id]),
            "integrity": self.verify_integrity(artifact_id),
            "export_scope": "MACHINE_READABLE_LOCAL_BUNDLE",
        }
        payload["bundle_sha256"] = _sha(payload)
        return payload


__all__ = [
    "ARTIFACT_TYPES",
    "ArtifactError",
    "ArtifactIntegrityError",
    "ArtifactPermissionError",
    "UniversalArtifactEngine",
]
