#!/usr/bin/env python3
"""Provision and verify local AR-02 non-production data planes.

Only Python's standard library is used. The module performs no network calls,
does not read provider credentials, and refuses production identifiers.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any


PACKAGE_ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = PACKAGE_ROOT.parents[1]
MANIFEST_PATH = PACKAGE_ROOT / "environment_manifest.json"
EXPECTED_TABLES = {
    "ar02_environment",
    "axiom_tenants",
    "axiom_actors",
    "axiom_projects",
    "axiom_project_members",
    "axiom_work_objects",
    "axiom_work_edges",
    "axiom_tasks",
    "axiom_task_steps",
    "axiom_task_events",
    "axiom_idempotency_keys",
    "axiom_approval_grants",
    "axiom_tool_receipts",
    "axiom_artifacts",
}
EXPECTED_ENVIRONMENTS = {"development", "staging", "canary"}


class IsolationError(RuntimeError):
    """Raised when AR-02 isolation cannot be proven safely."""


def load_manifest(path: Path | str = MANIFEST_PATH) -> dict[str, Any]:
    target = Path(path)
    try:
        value = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise IsolationError(f"cannot load environment manifest: {exc}") from exc
    if not isinstance(value, dict):
        raise IsolationError("environment manifest must contain a JSON object")
    return value


def _safe_relative(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise IsolationError(f"{field} must be a non-empty relative path")
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts or "." in path.parts:
        raise IsolationError(f"{field} must not escape its isolation root")
    return path.as_posix()


def _walk_strings(value: Any):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _walk_strings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_strings(child)


def validate_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    if manifest.get("schema") != "musitu.axiom.recovery.ar02-environment-manifest.v1":
        raise IsolationError("environment manifest schema mismatch")
    required_truth = {
        "phase": "AR-02",
        "mode": "LOCAL_ZERO_COST",
        "estimated_external_cost_usd": 0,
        "network_required": False,
        "provider_api_key_required": False,
        "synthetic_fixtures_only": True,
        "production_authority": False,
        "cloud_resources_created": False,
    }
    drift = {key: (manifest.get(key), expected) for key, expected in required_truth.items() if manifest.get(key) != expected}
    if drift:
        raise IsolationError(f"zero-cost authority drift: {drift}")

    environments = manifest.get("environments")
    if not isinstance(environments, list) or len(environments) != 3:
        raise IsolationError("exactly three non-production environments are required")
    if {row.get("environment_id") for row in environments if isinstance(row, dict)} != EXPECTED_ENVIRONMENTS:
        raise IsolationError("environment set must be development, staging, and canary")

    forbidden = manifest.get("forbidden_identifiers")
    if not isinstance(forbidden, list) or not forbidden or not all(isinstance(value, str) and value for value in forbidden):
        raise IsolationError("forbidden production identifier list is required")
    lowered_forbidden = [value.casefold() for value in forbidden]
    unique_fields = ("database_path", "object_root", "queue_root", "identity_audience")
    seen = {field: set() for field in unique_fields}
    for row in environments:
        if not isinstance(row, dict):
            raise IsolationError("environment rows must be objects")
        environment = row.get("environment_id")
        if row.get("synthetic_data_only") is not True or row.get("cloud_binding_status") != "NOT_CREATED":
            raise IsolationError(f"{environment} is not synthetic-only and unbound")
        for field in ("database_path", "object_root", "queue_root"):
            row[field] = _safe_relative(row.get(field), field)
        if not row["database_path"].endswith(".sqlite3"):
            raise IsolationError(f"{environment} database path must end in .sqlite3")
        audience = row.get("identity_audience")
        if not isinstance(audience, str) or not audience.startswith("urn:musitu:axiom:ar02:"):
            raise IsolationError(f"{environment} identity audience is invalid")
        for field in unique_fields:
            value = row[field]
            if value in seen[field]:
                raise IsolationError(f"duplicate {field}: {value}")
            seen[field].add(value)
        for value in _walk_strings(row):
            lowered = value.casefold()
            if any(marker in lowered for marker in lowered_forbidden):
                raise IsolationError(f"{environment} references a forbidden production identifier")

    return manifest


def _schema_path(manifest: dict[str, Any]) -> Path:
    relative = _safe_relative(manifest.get("canonical_schema"), "canonical_schema")
    target = (REPOSITORY_ROOT / relative).resolve()
    if not target.is_relative_to(REPOSITORY_ROOT.resolve()) or not target.is_file():
        raise IsolationError("canonical schema is unavailable or outside the repository")
    return target


def _safe_root(root: Path | str) -> Path:
    target = Path(root).expanduser().resolve()
    forbidden_roots = {Path("/").resolve(), Path.home().resolve(), REPOSITORY_ROOT.resolve()}
    if target in forbidden_roots:
        raise IsolationError("refusing a broad or repository root as isolation target")
    return target


def _target(root: Path, relative: str) -> Path:
    target = (root / relative).resolve()
    if not target.is_relative_to(root):
        raise IsolationError("resource path escaped isolation root")
    return target


def _database_truth(path: Path, environment: str, schema_digest: str) -> dict[str, Any]:
    try:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as database:
            tables = {
                row[0]
                for row in database.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            }
            if tables != EXPECTED_TABLES:
                raise IsolationError(f"{environment} canonical table mismatch")
            marker = database.execute(
                "SELECT environment_id,schema_version,schema_sha256,synthetic_data_only,production_authority "
                "FROM ar02_environment"
            ).fetchall()
            if marker != [(environment, 1, schema_digest, 1, 0)]:
                raise IsolationError(f"{environment} isolation marker mismatch")
            foreign_keys = database.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_keys:
                raise IsolationError(f"{environment} foreign key violations present")
            user_version = database.execute("PRAGMA user_version").fetchone()[0]
            if user_version != 1:
                raise IsolationError(f"{environment} schema version mismatch")
    except sqlite3.DatabaseError as exc:
        raise IsolationError(f"{environment} database verification failed: {exc}") from exc
    return {
        "environment_id": environment,
        "database_path": path,
        "schema_version": 1,
        "table_count": len(EXPECTED_TABLES),
    }


def _provision_database(path: Path, environment: str, schema: str, schema_digest: str) -> dict[str, Any]:
    if path.exists():
        return _database_truth(path, environment, schema_digest)
    path.parent.mkdir(parents=True, exist_ok=True)
    created = False
    try:
        with sqlite3.connect(path) as database:
            created = True
            database.executescript(schema)
            database.execute(
                "INSERT INTO ar02_environment(environment_id,schema_version,schema_sha256,synthetic_data_only,production_authority,provisioned_at) "
                "VALUES(?,?,?,?,?,?)",
                (environment, 1, schema_digest, 1, 0, datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")),
            )
            database.commit()
    except (OSError, sqlite3.DatabaseError) as exc:
        if created and path.is_file():
            path.unlink()
        raise IsolationError(f"cannot provision {environment} database: {exc}") from exc
    return _database_truth(path, environment, schema_digest)


def _evidence(root: Path, manifest: dict[str, Any], rows: list[dict[str, Any]], schema_digest: str) -> dict[str, Any]:
    database_paths = [row["database_path"].resolve() for row in rows]
    inodes = [path.stat().st_ino for path in database_paths]
    physically_separate = len(database_paths) == len(set(database_paths)) == len(set(inodes)) == 3
    if not physically_separate:
        raise IsolationError("physical database separation was not proven")
    return {
        "schema": "musitu.axiom.recovery.ar02-local-isolation-evidence.v1",
        "status": "PASS_LOCAL_NON_PRODUCTION_ISOLATION",
        "authority_commit": manifest["authority_commit"],
        "mode": manifest["mode"],
        "environment_count": len(rows),
        "environments": [
            {
                "environment_id": row["environment_id"],
                "database_path": next(
                    item["database_path"]
                    for item in manifest["environments"]
                    if item["environment_id"] == row["environment_id"]
                ),
                "schema_version": row["schema_version"],
                "table_count": row["table_count"],
            }
            for row in rows
        ],
        "schema_sha256": schema_digest,
        "physical_database_separation_verified": True,
        "synthetic_data_only": True,
        "network_used": False,
        "provider_api_key_used": False,
        "estimated_external_cost_usd": 0,
        "cloud_resources_created": False,
        "production_authority": False,
        "production_data_accessed": False,
        "root_digest": hashlib.sha256(str(root).encode("utf-8")).hexdigest(),
    }


def provision_local(root: Path | str, manifest_path: Path | str = MANIFEST_PATH) -> dict[str, Any]:
    manifest = validate_manifest(load_manifest(manifest_path))
    target_root = _safe_root(root)
    target_root.mkdir(parents=True, exist_ok=True)
    schema_path = _schema_path(manifest)
    schema_bytes = schema_path.read_bytes()
    schema = schema_bytes.decode("utf-8")
    schema_digest = hashlib.sha256(schema_bytes).hexdigest()
    rows = []
    for environment in manifest["environments"]:
        database_path = _target(target_root, environment["database_path"])
        rows.append(_provision_database(database_path, environment["environment_id"], schema, schema_digest))
        _target(target_root, environment["object_root"]).mkdir(parents=True, exist_ok=True)
        _target(target_root, environment["queue_root"]).mkdir(parents=True, exist_ok=True)
    return _evidence(target_root, manifest, rows, schema_digest)


def verify_local(root: Path | str, manifest_path: Path | str = MANIFEST_PATH) -> dict[str, Any]:
    manifest = validate_manifest(load_manifest(manifest_path))
    target_root = _safe_root(root)
    schema_path = _schema_path(manifest)
    schema_digest = hashlib.sha256(schema_path.read_bytes()).hexdigest()
    rows = []
    for environment in manifest["environments"]:
        for field in ("object_root", "queue_root"):
            path = _target(target_root, environment[field])
            if not path.is_dir():
                raise IsolationError(f"{environment['environment_id']} {field} is missing")
        database_path = _target(target_root, environment["database_path"])
        if not database_path.is_file():
            raise IsolationError(f"{environment['environment_id']} database is missing")
        rows.append(_database_truth(database_path, environment["environment_id"], schema_digest))
    return _evidence(target_root, manifest, rows, schema_digest)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("provision-local", "verify-local"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--root", required=True, help="Explicit non-production isolation root")
        subparser.add_argument("--manifest", default=str(MANIFEST_PATH))
    arguments = parser.parse_args(argv)
    try:
        operation = provision_local if arguments.command == "provision-local" else verify_local
        result = operation(arguments.root, arguments.manifest)
    except IsolationError as exc:
        print(json.dumps({"status": "FAIL_CLOSED", "error": str(exc), "production_authority": False}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
