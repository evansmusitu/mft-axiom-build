#!/usr/bin/env python3
"""Behavior contract for Frontier enterprise disaster-recovery governance."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
from pathlib import Path

try:
    from frontier_v5.runtime.disaster_recovery import (
        DRAuthorizationError,
        DRInputError,
        DRIntegrityError,
        DRNotFoundError,
        DRObjectiveError,
        EnterpriseDisasterRecoveryManager,
    )
except ModuleNotFoundError as exc:  # explicit red phase
    raise AssertionError("enterprise disaster-recovery runtime is missing") from exc


def expect_raises(exc_type, fn, contains: str | None = None) -> None:
    try:
        fn()
    except exc_type as exc:
        if contains is not None:
            assert contains in str(exc), (contains, str(exc))
        return
    raise AssertionError(f"expected {exc_type.__name__}")


def audit_hash(tenant: str, sequence: int, payload_json: str, previous: str | None) -> str:
    body = json.dumps(
        {
            "tenant_id": tenant,
            "sequence": sequence,
            "payload_json": payload_json,
            "previous_sha256": previous,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def make_tenant_db(path: Path, tenant: str, *, foreign_tenant: str | None = None) -> None:
    db = sqlite3.connect(path)
    db.executescript(
        """
        CREATE TABLE tenant_records(
          tenant_id TEXT NOT NULL,
          record_id TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY(tenant_id, record_id)
        );
        CREATE TABLE audit_log(
          sequence INTEGER PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          previous_sha256 TEXT,
          event_sha256 TEXT NOT NULL
        );
        """
    )
    db.executemany(
        "INSERT INTO tenant_records(tenant_id,record_id,value) VALUES(?,?,?)",
        [
            (tenant, "r-1", "alpha"),
            (tenant, "r-2", "beta"),
        ],
    )
    if foreign_tenant is not None:
        db.execute(
            "INSERT INTO tenant_records(tenant_id,record_id,value) VALUES(?,?,?)",
            (foreign_tenant, "foreign", "must-fail-closed"),
        )

    previous = None
    for sequence, payload in enumerate(("created", "updated"), start=1):
        payload_json = json.dumps({"event": payload}, sort_keys=True, separators=(",", ":"))
        event_sha = audit_hash(tenant, sequence, payload_json, previous)
        db.execute(
            "INSERT INTO audit_log(sequence,tenant_id,payload_json,previous_sha256,event_sha256) VALUES(?,?,?,?,?)",
            (sequence, tenant, payload_json, previous, event_sha),
        )
        previous = event_sha
    db.commit()
    db.close()


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        control_db = root / "dr-control.sqlite3"
        recovery_root = root / "recovery-store"
        source_a = root / "org-a.sqlite3"
        source_bad = root / "mixed.sqlite3"
        key_a = root / "org-a.synthetic.key"
        make_tenant_db(source_a, "org-a")
        make_tenant_db(source_bad, "org-a", foreign_tenant="org-b")
        key_a.write_bytes(b"synthetic-frontier-key-org-a")

        mgr = EnterpriseDisasterRecoveryManager(control_db, recovery_root)

        expect_raises(
            DRAuthorizationError,
            lambda: mgr.declare_objectives(
                "org-a", max_rpo_seconds=30, max_rto_seconds=20,
                actor="viewer", authorized=False, now_epoch=90,
            ),
            "authorized",
        )
        expect_raises(
            DRInputError,
            lambda: mgr.declare_objectives(
                "org-a", max_rpo_seconds=0, max_rto_seconds=20,
                actor="owner", authorized=True, now_epoch=91,
            ),
            "RPO",
        )
        objectives = mgr.declare_objectives(
            "org-a", max_rpo_seconds=30, max_rto_seconds=20,
            actor="owner", authorized=True, now_epoch=92,
        )
        assert objectives["max_rpo_seconds"] == 30
        assert objectives["max_rto_seconds"] == 20

        expect_raises(
            DRIntegrityError,
            lambda: mgr.create_backup(
                "org-a", "backup-mixed", source_db_path=source_bad,
                key_path=key_a, source_region="africa-south",
                recovery_point_epoch=99, actor="backup-controller",
                authorized=True, now_epoch=100,
            ),
            "tenant isolation",
        )

        backup = mgr.create_backup(
            "org-a", "backup-1", source_db_path=source_a,
            key_path=key_a, source_region="africa-south",
            recovery_point_epoch=100, actor="backup-controller",
            authorized=True, now_epoch=105,
        )
        assert backup["status"] == "verified"
        assert len(backup["database_sha256"]) == 64
        assert len(backup["key_sha256"]) == 64
        assert backup["tenant_isolated"] is True
        assert backup["audit_valid"] is True

        expect_raises(
            DRNotFoundError,
            lambda: mgr.restore_backup(
                "org-b", "backup-1", recovery_id="restore-cross-tenant",
                restore_dir=root / "restore-cross-tenant", target_region="eu-west",
                disaster_epoch=120, restore_started_epoch=121,
                restore_completed_epoch=125, actor="recovery-controller",
                authorized=True,
            ),
            "not found",
        )

        expect_raises(
            DRObjectiveError,
            lambda: mgr.restore_backup(
                "org-a", "backup-1", recovery_id="restore-stale",
                restore_dir=root / "restore-stale", target_region="eu-west",
                disaster_epoch=200, restore_started_epoch=201,
                restore_completed_epoch=205, actor="recovery-controller",
                authorized=True,
            ),
            "RPO",
        )

        restored = mgr.restore_backup(
            "org-a", "backup-1", recovery_id="restore-1",
            restore_dir=root / "restore-1", target_region="eu-west",
            disaster_epoch=120, restore_started_epoch=121,
            restore_completed_epoch=130, actor="recovery-controller",
            authorized=True,
        )
        assert restored["status"] == "verified"
        assert restored["measured_rpo_seconds"] == 20
        assert restored["measured_rto_seconds"] == 9
        assert restored["objectives_met"] is True
        assert restored["tenant_isolated"] is True
        assert restored["audit_preserved"] is True
        assert restored["key_recovered"] is True

        restored_db = Path(restored["database_path"])
        recovered_key = Path(restored["key_path"])
        assert restored_db.is_file()
        assert recovered_key.read_bytes() == key_a.read_bytes()
        db = sqlite3.connect(restored_db)
        tenants = {row[0] for row in db.execute("SELECT DISTINCT tenant_id FROM tenant_records")}
        values = [row[0] for row in db.execute("SELECT value FROM tenant_records ORDER BY record_id")]
        db.close()
        assert tenants == {"org-a"}
        assert values == ["alpha", "beta"]

        expect_raises(
            DRInputError,
            lambda: mgr.record_failover(
                "org-a", "restore-1", from_region="africa-south",
                to_region="africa-south", actor="recovery-controller",
                authorized=True, now_epoch=131,
            ),
            "different region",
        )
        failover = mgr.record_failover(
            "org-a", "restore-1", from_region="africa-south",
            to_region="eu-west", actor="recovery-controller",
            authorized=True, now_epoch=132,
        )
        assert failover["status"] == "recorded"

        ready = mgr.promotion_readiness("org-a", "restore-1")
        assert ready["promotable"] is True
        assert ready["objectives_met"] is True
        assert ready["tenant_isolated"] is True
        assert ready["audit_preserved"] is True
        assert ready["key_recovered"] is True
        assert ready["failover_recorded"] is True
        assert mgr.verify_audit_chain("org-a") is True

        # Promotion must fail closed if the restored audit history is altered.
        tampered = sqlite3.connect(restored_db)
        tampered.execute("UPDATE audit_log SET payload_json='{}' WHERE sequence=1")
        tampered.commit()
        tampered.close()
        expect_raises(
            DRIntegrityError,
            lambda: mgr.promotion_readiness("org-a", "restore-1"),
            "audit",
        )
        mgr.close()

    print("MUSITU_AXIOM_FRONTIER_ENTERPRISE_DISASTER_RECOVERY_PASS")


if __name__ == "__main__":
    main()
