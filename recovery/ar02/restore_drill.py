#!/usr/bin/env python3
"""Synthetic-only AR-02 backup/restore drill.

The drill never contacts a provider and never overwrites the source data plane.
It provisions the three isolated local environments, seeds a staging-only
Project/Work/Task/Artifact fixture, snapshots the canonical stores, mutates the
source after the snapshot, restores into a separate root, and proves the restored
copy matches the snapshot rather than the later mutation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any

from recovery.ar02.isolation import IsolationError, load_manifest, provision_local, verify_local


FORBIDDEN_MARKERS = {
    "musitu-axiom-prod",
    "mft-axiom-prod",
    "504029cc-f9a5-495e-818f-63c6144b4ea4",
    "4a62b374-7232-4103-b201-34443c467382",
    "axiom.mftintelligence.com",
    "app.mftintelligence.com",
}
FIXED_TIME = "2026-09-17T00:00:00Z"


class RestoreDrillError(RuntimeError):
    pass


def _safe_workspace(value: str | Path) -> Path:
    root = Path(value).expanduser().resolve()
    blocked = {Path("/").resolve(), Path.home().resolve()}
    if root in blocked:
        raise RestoreDrillError("refusing broad restore workspace")
    lowered = str(root).casefold()
    if any(marker.casefold() in lowered for marker in FORBIDDEN_MARKERS):
        raise RestoreDrillError("restore workspace references a production identifier")
    return root


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _copy_database(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as source_db:
        with sqlite3.connect(target) as target_db:
            source_db.backup(target_db)
            target_db.commit()


def _seed_staging(source_root: Path, manifest: dict[str, Any]) -> dict[str, str]:
    staging = next(row for row in manifest["environments"] if row["environment_id"] == "staging")
    database_path = source_root / staging["database_path"]
    object_root = source_root / staging["object_root"]
    payload = b'{"kind":"synthetic-report","value":42,"source":"ar02-restore-drill"}\n'
    payload_sha = _sha256_bytes(payload)
    receipt = json.dumps({"status": "SUCCEEDED", "synthetic": True, "value": 42}, sort_keys=True, separators=(",", ":"))
    receipt_sha = _sha256_bytes(receipt.encode())
    empty_sha = _sha256_bytes(b"")
    body = json.dumps({"objective": "prove isolated backup restore", "synthetic": True}, sort_keys=True, separators=(",", ":"))
    body_sha = _sha256_bytes(body.encode())
    with sqlite3.connect(database_path) as database:
        database.execute("PRAGMA foreign_keys=ON")
        database.execute("INSERT INTO axiom_tenants(environment_id,tenant_id,name,created_at) VALUES(?,?,?,?)", ("staging", "tenant-restore", "Synthetic Restore Tenant", FIXED_TIME))
        database.execute("INSERT INTO axiom_actors(environment_id,tenant_id,actor_id,actor_type,status,created_at) VALUES(?,?,?,?,?,?)", ("staging", "tenant-restore", "actor-restore", "HUMAN", "ACTIVE", FIXED_TIME))
        database.execute("INSERT INTO axiom_projects(environment_id,tenant_id,project_id,name,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", ("staging", "tenant-restore", "project-restore", "Synthetic Restore Project", 1, FIXED_TIME, FIXED_TIME))
        database.execute("INSERT INTO axiom_project_members(environment_id,tenant_id,project_id,actor_id,role,created_at) VALUES(?,?,?,?,?,?)", ("staging", "tenant-restore", "project-restore", "actor-restore", "OWNER", FIXED_TIME))
        database.execute("INSERT INTO axiom_work_objects(environment_id,tenant_id,project_id,object_id,object_type,version,body_json,body_sha256,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", ("staging", "tenant-restore", "project-restore", "work-restore", "SYNTHETIC_BRIEF", 1, body, body_sha, "actor-restore", FIXED_TIME, FIXED_TIME))
        database.execute("INSERT INTO axiom_tasks(environment_id,tenant_id,project_id,task_id,user_intent_id,objective,state,idempotency_key,plan_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)", ("staging", "tenant-restore", "project-restore", "task-restore", "intent-restore", "Synthetic restore proof", "COMPLETED", "idem-task-restore", 1, FIXED_TIME, FIXED_TIME))
        database.execute("INSERT INTO axiom_task_steps(environment_id,tenant_id,task_id,step_id,ordinal,state,tool_id,tool_version,attempt,idempotency_key,input_sha256,output_sha256,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ("staging", "tenant-restore", "task-restore", "step-restore", 0, "SUCCEEDED", "synthetic.restore.tool", "1", 1, "idem-step-restore", empty_sha, payload_sha, FIXED_TIME))
        database.execute("INSERT INTO axiom_task_events(environment_id,tenant_id,task_id,event_id,sequence,event_type,step_id,payload_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?)", ("staging", "tenant-restore", "task-restore", "event-restore", 1, "COMPLETED", "step-restore", payload_sha, FIXED_TIME))
        database.execute("INSERT INTO axiom_tool_receipts(environment_id,tenant_id,receipt_id,task_id,step_id,invocation_id,status,output_sha256,receipt_json,receipt_sha256,started_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("staging", "tenant-restore", "receipt-restore", "task-restore", "step-restore", "invoke-restore", "SUCCEEDED", payload_sha, receipt, receipt_sha, FIXED_TIME, FIXED_TIME))
        database.execute("INSERT INTO axiom_artifacts(environment_id,tenant_id,project_id,artifact_id,task_id,artifact_type,version,content_sha256,storage_ref,source_receipts_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", ("staging", "tenant-restore", "project-restore", "artifact-restore", "task-restore", "SYNTHETIC_REPORT", 1, payload_sha, "restore-proof/report.json", '["receipt-restore"]', "actor-restore", FIXED_TIME))
        database.commit()
        violations = database.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise RestoreDrillError(f"seed foreign-key violations: {violations}")
    artifact = object_root / "restore-proof" / "report.json"
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_bytes(payload)
    return {"artifact_sha256": payload_sha, "database": str(database_path), "artifact": str(artifact)}


def _fingerprint(root: Path, manifest: dict[str, Any]) -> str:
    digest = hashlib.sha256()
    for row in sorted(manifest["environments"], key=lambda item: item["environment_id"]):
        database_path = root / row["database_path"]
        with sqlite3.connect(f"file:{database_path}?mode=ro", uri=True) as database:
            tables = [
                item[0]
                for item in database.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            ]
            for table in tables:
                columns = [item[1] for item in database.execute(f"PRAGMA table_info({table})")]
                order = ",".join(f'"{name}"' for name in columns)
                rows = database.execute(f'SELECT * FROM "{table}" ORDER BY {order}').fetchall() if columns else []
                digest.update(table.encode())
                digest.update(json.dumps(rows, sort_keys=True, default=str, separators=(",", ":")).encode())
        object_root = root / row["object_root"]
        for path in sorted(item for item in object_root.rglob("*") if item.is_file()):
            digest.update(path.relative_to(object_root).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def _snapshot(source: Path, backup: Path, manifest: dict[str, Any]) -> None:
    if backup.exists():
        raise RestoreDrillError("backup target already exists")
    backup.mkdir(parents=True)
    for row in manifest["environments"]:
        source_db = source / row["database_path"]
        _copy_database(source_db, backup / row["database_path"])
        source_objects = source / row["object_root"]
        target_objects = backup / row["object_root"]
        shutil.copytree(source_objects, target_objects)
        source_queue = source / row["queue_root"]
        target_queue = backup / row["queue_root"]
        shutil.copytree(source_queue, target_queue)


def _restore(backup: Path, restored: Path, manifest: dict[str, Any]) -> None:
    if restored.exists():
        raise RestoreDrillError("restore target already exists; non-destructive restore required")
    restored.mkdir(parents=True)
    for row in manifest["environments"]:
        _copy_database(backup / row["database_path"], restored / row["database_path"])
        shutil.copytree(backup / row["object_root"], restored / row["object_root"])
        shutil.copytree(backup / row["queue_root"], restored / row["queue_root"])


def _mutate_source_after_snapshot(source: Path, manifest: dict[str, Any]) -> None:
    staging = next(row for row in manifest["environments"] if row["environment_id"] == "staging")
    database_path = source / staging["database_path"]
    with sqlite3.connect(database_path) as database:
        database.execute("INSERT INTO axiom_projects(environment_id,tenant_id,project_id,name,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", ("staging", "tenant-restore", "project-after-snapshot", "Must Not Appear After Restore", 1, FIXED_TIME, FIXED_TIME))
        database.commit()
    artifact = source / staging["object_root"] / "restore-proof" / "report.json"
    artifact.write_text('{"mutated_after_snapshot":true}\n', encoding="utf-8")


def run_restore_drill(workspace: str | Path) -> dict[str, Any]:
    workspace_root = _safe_workspace(workspace)
    if workspace_root.exists() and any(workspace_root.iterdir()):
        raise RestoreDrillError("restore workspace must be empty")
    workspace_root.mkdir(parents=True, exist_ok=True)
    source = workspace_root / "source"
    backup = workspace_root / "backup"
    restored = workspace_root / "restored"
    manifest = load_manifest()
    provision_local(source)
    seed = _seed_staging(source, manifest)
    verify_local(source)
    snapshot_fingerprint = _fingerprint(source, manifest)
    _snapshot(source, backup, manifest)
    backup_fingerprint = _fingerprint(backup, manifest)
    if backup_fingerprint != snapshot_fingerprint:
        raise RestoreDrillError("backup fingerprint does not match source snapshot")
    _mutate_source_after_snapshot(source, manifest)
    mutated_fingerprint = _fingerprint(source, manifest)
    if mutated_fingerprint == snapshot_fingerprint:
        raise RestoreDrillError("fault injection did not change source fingerprint")
    _restore(backup, restored, manifest)
    restored_evidence = verify_local(restored)
    restored_fingerprint = _fingerprint(restored, manifest)
    if restored_fingerprint != snapshot_fingerprint:
        raise RestoreDrillError("restored fingerprint does not match sealed snapshot")
    staging = next(row for row in manifest["environments"] if row["environment_id"] == "staging")
    with sqlite3.connect(restored / staging["database_path"]) as database:
        forbidden_count = database.execute("SELECT count(*) FROM axiom_projects WHERE project_id='project-after-snapshot'").fetchone()[0]
        artifact_count = database.execute("SELECT count(*) FROM axiom_artifacts WHERE artifact_id='artifact-restore'").fetchone()[0]
    if forbidden_count != 0 or artifact_count != 1:
        raise RestoreDrillError("restore recovered an invalid project/artifact state")
    return {
        "schema": "musitu.axiom.recovery.ar02-restore-drill-evidence.v1",
        "status": "PASS_SYNTHETIC_NON_DESTRUCTIVE_RESTORE",
        "environment_count": 3,
        "snapshot_sha256": snapshot_fingerprint,
        "backup_sha256": backup_fingerprint,
        "mutated_source_sha256": mutated_fingerprint,
        "restored_sha256": restored_fingerprint,
        "artifact_sha256": seed["artifact_sha256"],
        "restored_into_separate_root": True,
        "source_overwritten": False,
        "synthetic_data_only": True,
        "network_used": False,
        "provider_credentials_used": False,
        "production_authority": False,
        "cloud_isolation": "NOT_PROVEN"
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    arguments = parser.parse_args(argv)
    try:
        evidence = run_restore_drill(arguments.workspace)
    except (IsolationError, RestoreDrillError, OSError, sqlite3.DatabaseError) as exc:
        print(json.dumps({"status": "FAIL_CLOSED", "error": str(exc), "production_authority": False}), file=sys.stderr)
        return 1
    print(json.dumps(evidence, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
