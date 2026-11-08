#!/usr/bin/env python3
"""Behavioral contract for OPS-015 migration safety and corruption recovery.

The fixture is deliberately disposable and local.  It models the tenant/customer
relationships that a production database migration must preserve without using
Cloudflare credentials, the sealed production D1 database, or customer data.
"""
from __future__ import annotations

import json
import sqlite3
import tempfile
from pathlib import Path

try:
    from frontier_v5.runtime.migration_safety import (
        MigrationSafetyError,
        MigrationSafetyManager,
        MigrationSpec,
    )
except ModuleNotFoundError as exc:
    raise AssertionError("migration-safety runtime is missing") from exc


def expect_failure(fn, contains: str) -> None:
    try:
        fn()
    except MigrationSafetyError as exc:
        assert contains in str(exc), (contains, str(exc))
    else:
        raise AssertionError(f"expected MigrationSafetyError containing {contains!r}")


def seed_database(path: Path) -> None:
    con = sqlite3.connect(path)
    try:
        con.executescript(
            """
            PRAGMA foreign_keys=ON;
            CREATE TABLE customers (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                legal_name TEXT NOT NULL
            );
            CREATE UNIQUE INDEX idx_customers_tenant_id ON customers(tenant_id,id);
            CREATE TABLE api_keys (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                customer_id TEXT NOT NULL,
                key_hash TEXT NOT NULL,
                FOREIGN KEY(customer_id) REFERENCES customers(id)
            );
            CREATE TABLE usage_events (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                customer_id TEXT NOT NULL,
                request_id TEXT NOT NULL,
                units INTEGER NOT NULL CHECK(units >= 0),
                FOREIGN KEY(customer_id) REFERENCES customers(id)
            );
            PRAGMA user_version=1;
            """
        )
        con.executemany(
            "INSERT INTO customers(id,tenant_id,legal_name) VALUES(?,?,?)",
            [
                ("cust-a", "tenant-a", "Tenant A Test Co"),
                ("cust-b", "tenant-b", "Tenant B Test Co"),
            ],
        )
        con.executemany(
            "INSERT INTO api_keys(id,tenant_id,customer_id,key_hash) VALUES(?,?,?,?)",
            [
                ("key-a", "tenant-a", "cust-a", "hash-a"),
                ("key-b", "tenant-b", "cust-b", "hash-b"),
            ],
        )
        con.executemany(
            "INSERT INTO usage_events(id,tenant_id,customer_id,request_id,units) VALUES(?,?,?,?,?)",
            [
                ("evt-a", "tenant-a", "cust-a", "req-a", 11),
                ("evt-b", "tenant-b", "cust-b", "req-b", 17),
            ],
        )
        con.commit()
    finally:
        con.close()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="musitu-migration-safety-") as raw:
        root = Path(raw)
        db = root / "source.sqlite3"
        seed_database(db)
        manager = MigrationSafetyManager(db, root / "recovery")

        baseline = manager.create_recovery_snapshot("ops015-baseline")
        assert baseline.user_version == 1
        assert baseline.protected_row_counts == {
            "api_keys": 2,
            "customers": 2,
            "usage_events": 2,
        }
        assert len(baseline.logical_sha256) == 64
        assert len(baseline.backup_sha256) == 64
        manager.verify_tenant_integrity()
        manager.verify_snapshot(baseline)

        spec = MigrationSpec(
            migration_id="ops015_customer_profiles_v2",
            from_version=1,
            to_version=2,
            forward_sql=(
                "CREATE TABLE customer_profiles (customer_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, display_name TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(id))",
                "INSERT INTO customer_profiles(customer_id,tenant_id,display_name) SELECT id,tenant_id,legal_name FROM customers ORDER BY id",
            ),
            backward_sql=("DROP TABLE customer_profiles",),
        )

        # A clean forward migration must preserve protected customer relationships,
        # produce a deterministic receipt, and validate the migrated rows.
        receipt = manager.apply_forward(spec)
        assert receipt["migration_id"] == spec.migration_id
        assert receipt["from_version"] == 1
        assert receipt["to_version"] == 2
        assert receipt["protected_sha256_before"] == receipt["protected_sha256_after"]
        assert receipt["tenant_integrity"] == "PASS"
        assert receipt["sqlite_integrity"] == "PASS"
        assert receipt["profile_rows"] == 2
        assert receipt["gate"] == "PASS"
        manager.verify_snapshot(baseline)

        # Forward -> backward on a disposable clone must recover the exact logical
        # protected state and original schema/version.  The production file itself
        # is not used for this round-trip proof.
        round_trip = manager.validate_round_trip(spec, root / "round-trip.sqlite3")
        assert round_trip["logical_sha256_before"] == round_trip["logical_sha256_after"]
        assert round_trip["schema_sha256_before"] == round_trip["schema_sha256_after"]
        assert round_trip["user_version_after"] == 1
        assert round_trip["gate"] == "PASS"

        # Restore the source to v1 before fault-injection tests.
        manager.restore_snapshot(baseline)
        manager.verify_snapshot(baseline)

        # A partial migration fault injected after the first statement must roll
        # back atomically: no new table, no version bump, no data drift.
        expect_failure(
            lambda: manager.apply_forward(spec, inject_failure_after_statement=1),
            "injected partial migration failure",
        )
        after_partial = manager.inspect_state()
        assert after_partial["user_version"] == 1
        assert "customer_profiles" not in after_partial["tables"]
        assert after_partial["logical_sha256"] == baseline.logical_sha256
        manager.verify_tenant_integrity()

        # A valid foreign key can still be a tenant isolation violation.  Inject a
        # cross-tenant link and prove the verifier rejects it.
        con = sqlite3.connect(db)
        try:
            con.execute("PRAGMA foreign_keys=OFF")
            con.execute("UPDATE api_keys SET customer_id='cust-b' WHERE id='key-a'")
            con.commit()
        finally:
            con.close()
        expect_failure(manager.verify_tenant_integrity, "cross-tenant customer link")
        expect_failure(lambda: manager.verify_snapshot(baseline), "logical checksum mismatch")

        # Repair from the sealed recovery snapshot and prove all protected state,
        # tenant links, and SQLite integrity recover before any promotion receipt.
        repair = manager.restore_snapshot(baseline)
        assert repair["gate"] == "PASS"
        assert repair["restored_logical_sha256"] == baseline.logical_sha256
        manager.verify_snapshot(baseline)
        manager.verify_tenant_integrity()

        # Corrupt a row without breaking relational constraints: checksum validation
        # must still detect it and repair must restore the exact value.
        con = sqlite3.connect(db)
        try:
            con.execute("UPDATE usage_events SET units=999 WHERE id='evt-a'")
            con.commit()
        finally:
            con.close()
        expect_failure(lambda: manager.verify_snapshot(baseline), "logical checksum mismatch")
        manager.restore_snapshot(baseline)
        manager.verify_snapshot(baseline)

        # Corrupt the recovery material itself.  Restoration must fail closed and
        # must not overwrite a currently valid database from an untrusted backup.
        corrupted_backup = Path(baseline.backup_path)
        original_backup = corrupted_backup.read_bytes()
        corrupted_backup.write_bytes(original_backup + b"CORRUPTION")
        before_failed_restore = manager.inspect_state()["logical_sha256"]
        expect_failure(lambda: manager.restore_snapshot(baseline), "backup checksum mismatch")
        assert manager.inspect_state()["logical_sha256"] == before_failed_restore
        corrupted_backup.write_bytes(original_backup)

        # Migration receipt is JSON-serializable evidence; this also catches hidden
        # path/object leakage into the contract surface.
        json.dumps(receipt, sort_keys=True)
        json.dumps(round_trip, sort_keys=True)

    print("MUSITU_AXIOM_FRONTIER_MIGRATION_SAFETY_PASS")


if __name__ == "__main__":
    main()
