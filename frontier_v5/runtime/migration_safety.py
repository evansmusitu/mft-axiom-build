#!/usr/bin/env python3
"""Fail-closed migration safety and corruption-recovery primitives for OPS-015.

This module is intentionally standard-library-only and operates on disposable
SQLite databases. It does not access production D1, Cloudflare credentials, or
the sealed public v4 runtime.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Sequence


class MigrationSafetyError(RuntimeError):
    """Raised when a migration/recovery invariant cannot be proven."""


@dataclass(frozen=True)
class MigrationSpec:
    migration_id: str
    from_version: int
    to_version: int
    forward_sql: tuple[str, ...]
    backward_sql: tuple[str, ...]

    def __post_init__(self) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", self.migration_id):
            raise ValueError("migration_id must be a safe non-empty identifier")
        if self.from_version < 0 or self.to_version < 0 or self.from_version == self.to_version:
            raise ValueError("migration versions must be distinct non-negative integers")
        if not self.forward_sql or not self.backward_sql:
            raise ValueError("forward_sql and backward_sql are required")
        if not all(isinstance(x, str) and x.strip() for x in (*self.forward_sql, *self.backward_sql)):
            raise ValueError("migration SQL statements must be non-empty strings")


@dataclass(frozen=True)
class RecoverySnapshot:
    name: str
    backup_path: str
    backup_sha256: str
    logical_sha256: str
    schema_sha256: str
    user_version: int
    protected_row_counts: dict[str, int]


class MigrationSafetyManager:
    """Validate migration reversibility, tenant integrity, and repair evidence."""

    PROTECTED_TABLES = ("api_keys", "customers", "usage_events")

    def __init__(self, database_path: Path | str, recovery_dir: Path | str):
        self.database_path = Path(database_path).resolve()
        self.recovery_dir = Path(recovery_dir).resolve()
        if not self.database_path.is_file():
            raise MigrationSafetyError(f"database does not exist: {self.database_path}")
        self.recovery_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def _stable_sha(payload: object) -> str:
        raw = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def _connect(self, path: Path | None = None) -> sqlite3.Connection:
        connection = sqlite3.connect(str(path or self.database_path))
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    @staticmethod
    def _table_names(connection: sqlite3.Connection) -> list[str]:
        return [
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
        ]

    @staticmethod
    def _schema_payload(connection: sqlite3.Connection) -> list[dict[str, object]]:
        rows = connection.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_master "
            "WHERE type IN ('table','index','trigger','view') "
            "AND name NOT LIKE 'sqlite_%' ORDER BY type,name"
        ).fetchall()
        return [
            {"type": row[0], "name": row[1], "tbl_name": row[2], "sql": row[3]}
            for row in rows
        ]

    def _protected_payload(self, connection: sqlite3.Connection) -> dict[str, object]:
        tables = set(self._table_names(connection))
        missing = [name for name in self.PROTECTED_TABLES if name not in tables]
        if missing:
            raise MigrationSafetyError(f"protected table missing: {missing!r}")
        queries = {
            "customers": "SELECT id,tenant_id,legal_name FROM customers ORDER BY id",
            "api_keys": "SELECT id,tenant_id,customer_id,key_hash FROM api_keys ORDER BY id",
            "usage_events": (
                "SELECT id,tenant_id,customer_id,request_id,units "
                "FROM usage_events ORDER BY id"
            ),
        }
        payload: dict[str, object] = {}
        for name in self.PROTECTED_TABLES:
            rows = connection.execute(queries[name]).fetchall()
            payload[name] = [list(row) for row in rows]
        return payload

    def _state_from_connection(self, connection: sqlite3.Connection) -> dict[str, object]:
        integrity = [str(row[0]) for row in connection.execute("PRAGMA integrity_check").fetchall()]
        if integrity != ["ok"]:
            raise MigrationSafetyError(f"SQLite integrity check failed: {integrity!r}")
        protected = self._protected_payload(connection)
        return {
            "user_version": int(connection.execute("PRAGMA user_version").fetchone()[0]),
            "tables": self._table_names(connection),
            "logical_sha256": self._stable_sha(protected),
            "schema_sha256": self._stable_sha(self._schema_payload(connection)),
            "protected_row_counts": {key: len(value) for key, value in protected.items()},
            "sqlite_integrity": "PASS",
        }

    def inspect_state(self) -> dict[str, object]:
        with self._connect() as connection:
            return self._state_from_connection(connection)

    @staticmethod
    def _verify_tenant_integrity_conn(connection: sqlite3.Connection) -> None:
        foreign_key_failures = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_failures:
            raise MigrationSafetyError(
                f"foreign key violation: {[tuple(row) for row in foreign_key_failures]!r}"
            )
        checks = (
            (
                "api_keys",
                "SELECT a.id,a.tenant_id,a.customer_id,c.tenant_id "
                "FROM api_keys a LEFT JOIN customers c ON c.id=a.customer_id "
                "WHERE c.id IS NULL OR a.tenant_id<>c.tenant_id ORDER BY a.id",
            ),
            (
                "usage_events",
                "SELECT a.id,a.tenant_id,a.customer_id,c.tenant_id "
                "FROM usage_events a LEFT JOIN customers c ON c.id=a.customer_id "
                "WHERE c.id IS NULL OR a.tenant_id<>c.tenant_id ORDER BY a.id",
            ),
        )
        for table, sql in checks:
            bad = connection.execute(sql).fetchall()
            if bad:
                raise MigrationSafetyError(
                    f"cross-tenant customer link in {table}: {[tuple(row) for row in bad]!r}"
                )

        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }
        if "customer_profiles" in tables:
            bad = connection.execute(
                "SELECT p.customer_id,p.tenant_id,c.tenant_id "
                "FROM customer_profiles p LEFT JOIN customers c ON c.id=p.customer_id "
                "WHERE c.id IS NULL OR p.tenant_id<>c.tenant_id ORDER BY p.customer_id"
            ).fetchall()
            if bad:
                raise MigrationSafetyError(
                    "cross-tenant customer link in customer_profiles: "
                    f"{[tuple(row) for row in bad]!r}"
                )

    def verify_tenant_integrity(self) -> str:
        with self._connect() as connection:
            self._verify_tenant_integrity_conn(connection)
        return "PASS"

    def create_recovery_snapshot(self, name: str) -> RecoverySnapshot:
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", name):
            raise MigrationSafetyError("snapshot name must be a safe non-empty identifier")
        self.verify_tenant_integrity()
        state = self.inspect_state()
        backup = (self.recovery_dir / f"{name}.sqlite3").resolve()
        if backup.parent != self.recovery_dir:
            raise MigrationSafetyError("snapshot path escaped recovery directory")
        temporary = backup.with_suffix(".sqlite3.tmp")
        if temporary.exists():
            temporary.unlink()
        source = self._connect()
        target = sqlite3.connect(str(temporary))
        try:
            source.backup(target)
            target.commit()
        finally:
            target.close()
            source.close()
        os.replace(temporary, backup)

        snapshot = RecoverySnapshot(
            name=name,
            backup_path=str(backup),
            backup_sha256=self._sha256_file(backup),
            logical_sha256=str(state["logical_sha256"]),
            schema_sha256=str(state["schema_sha256"]),
            user_version=int(state["user_version"]),
            protected_row_counts=dict(state["protected_row_counts"]),
        )
        manifest = self.recovery_dir / f"{name}.manifest.json"
        manifest.write_text(
            json.dumps(asdict(snapshot), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return snapshot

    def verify_snapshot(self, snapshot: RecoverySnapshot) -> str:
        state = self.inspect_state()
        if state["logical_sha256"] != snapshot.logical_sha256:
            raise MigrationSafetyError(
                "logical checksum mismatch: expected "
                f"{snapshot.logical_sha256}, got {state['logical_sha256']}"
            )
        if state["protected_row_counts"] != snapshot.protected_row_counts:
            raise MigrationSafetyError(
                "protected row-count mismatch: expected "
                f"{snapshot.protected_row_counts!r}, got {state['protected_row_counts']!r}"
            )
        self.verify_tenant_integrity()
        return "PASS"

    @staticmethod
    def _validate_profile_rows(connection: sqlite3.Connection) -> int | None:
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        }
        if "customer_profiles" not in tables:
            return None
        profile_count = int(
            connection.execute("SELECT COUNT(*) FROM customer_profiles").fetchone()[0]
        )
        customer_count = int(connection.execute("SELECT COUNT(*) FROM customers").fetchone()[0])
        if profile_count != customer_count:
            raise MigrationSafetyError(
                f"customer_profiles row-count mismatch: expected {customer_count}, got {profile_count}"
            )
        return profile_count

    def _apply(
        self,
        spec: MigrationSpec,
        *,
        forward: bool,
        inject_failure_after_statement: int | None = None,
    ) -> dict[str, object]:
        expected = spec.from_version if forward else spec.to_version
        target = spec.to_version if forward else spec.from_version
        statements: Sequence[str] = spec.forward_sql if forward else spec.backward_sql
        if inject_failure_after_statement is not None and (
            inject_failure_after_statement < 1
            or inject_failure_after_statement > len(statements)
        ):
            raise MigrationSafetyError("invalid injected failure statement index")

        connection = self._connect()
        try:
            current = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if current != expected:
                raise MigrationSafetyError(
                    f"migration version precondition failed: expected {expected}, got {current}"
                )
            before = self._state_from_connection(connection)
            before_sha = str(before["logical_sha256"])
            connection.execute("BEGIN IMMEDIATE")
            try:
                for index, sql in enumerate(statements, 1):
                    connection.execute(sql)
                    if inject_failure_after_statement == index:
                        raise MigrationSafetyError(
                            f"injected partial migration failure after statement {index}"
                        )
                connection.execute(f"PRAGMA user_version={int(target)}")
                self._verify_tenant_integrity_conn(connection)
                profile_rows = self._validate_profile_rows(connection)
                integrity = [
                    str(row[0])
                    for row in connection.execute("PRAGMA integrity_check").fetchall()
                ]
                if integrity != ["ok"]:
                    raise MigrationSafetyError(f"SQLite integrity check failed: {integrity!r}")
                after_sha = self._stable_sha(self._protected_payload(connection))
                if after_sha != before_sha:
                    raise MigrationSafetyError(
                        "protected customer data checksum changed: "
                        f"before {before_sha}, after {after_sha}"
                    )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        except MigrationSafetyError:
            raise
        except sqlite3.Error as exc:
            try:
                connection.rollback()
            except sqlite3.Error:
                pass
            raise MigrationSafetyError(f"SQLite migration failed: {exc}") from exc
        finally:
            connection.close()

        final = self.inspect_state()
        if int(final["user_version"]) != target:
            raise MigrationSafetyError(
                f"post-migration version mismatch: expected {target}, got {final['user_version']}"
            )
        self.verify_tenant_integrity()
        return {
            "schema": "musitu.axiom.frontier.migration-safety-receipt.v1",
            "migration_id": spec.migration_id,
            "direction": "forward" if forward else "backward",
            "from_version": expected,
            "to_version": target,
            "protected_sha256_before": before_sha,
            "protected_sha256_after": str(final["logical_sha256"]),
            "tenant_integrity": "PASS",
            "sqlite_integrity": "PASS",
            "profile_rows": profile_rows,
            "gate": "PASS",
        }

    def apply_forward(
        self,
        spec: MigrationSpec,
        inject_failure_after_statement: int | None = None,
    ) -> dict[str, object]:
        return self._apply(
            spec,
            forward=True,
            inject_failure_after_statement=inject_failure_after_statement,
        )

    def apply_backward(
        self,
        spec: MigrationSpec,
        inject_failure_after_statement: int | None = None,
    ) -> dict[str, object]:
        return self._apply(
            spec,
            forward=False,
            inject_failure_after_statement=inject_failure_after_statement,
        )

    def _clone_to(self, path: Path) -> None:
        path = path.resolve()
        if path == self.database_path:
            raise MigrationSafetyError("round-trip clone must not overwrite source database")
        if path.exists():
            path.unlink()
        source = self._connect()
        target = sqlite3.connect(str(path))
        try:
            source.backup(target)
            target.commit()
        finally:
            target.close()
            source.close()

    def validate_round_trip(
        self,
        spec: MigrationSpec,
        clone_path: Path | str,
    ) -> dict[str, object]:
        clone = Path(clone_path).resolve()
        clone.parent.mkdir(parents=True, exist_ok=True)
        self._clone_to(clone)
        clone_manager = MigrationSafetyManager(
            clone,
            clone.parent / f".{clone.name}.recovery",
        )
        initial = clone_manager.inspect_state()
        version = int(initial["user_version"])
        if version == spec.to_version:
            clone_manager.apply_backward(spec)
        elif version != spec.from_version:
            raise MigrationSafetyError(
                "round-trip source version must be "
                f"{spec.from_version} or {spec.to_version}, got {version}"
            )

        before = clone_manager.inspect_state()
        clone_manager.verify_tenant_integrity()
        clone_manager.apply_forward(spec)
        clone_manager.apply_backward(spec)
        after = clone_manager.inspect_state()
        clone_manager.verify_tenant_integrity()
        if before["logical_sha256"] != after["logical_sha256"]:
            raise MigrationSafetyError("round-trip logical checksum mismatch")
        if before["schema_sha256"] != after["schema_sha256"]:
            raise MigrationSafetyError("round-trip schema checksum mismatch")
        if int(after["user_version"]) != spec.from_version:
            raise MigrationSafetyError("round-trip did not restore original user_version")
        return {
            "schema": "musitu.axiom.frontier.migration-round-trip.v1",
            "migration_id": spec.migration_id,
            "logical_sha256_before": str(before["logical_sha256"]),
            "logical_sha256_after": str(after["logical_sha256"]),
            "schema_sha256_before": str(before["schema_sha256"]),
            "schema_sha256_after": str(after["schema_sha256"]),
            "user_version_after": int(after["user_version"]),
            "tenant_integrity": "PASS",
            "gate": "PASS",
        }

    def restore_snapshot(self, snapshot: RecoverySnapshot) -> dict[str, object]:
        backup = Path(snapshot.backup_path).resolve()
        if backup.parent != self.recovery_dir:
            raise MigrationSafetyError("snapshot backup is outside recovery directory")
        if not backup.is_file():
            raise MigrationSafetyError("snapshot backup is missing")
        actual_sha = self._sha256_file(backup)
        if actual_sha != snapshot.backup_sha256:
            raise MigrationSafetyError(
                f"backup checksum mismatch: expected {snapshot.backup_sha256}, got {actual_sha}"
            )

        # Validate the recovery material fully before touching the target database.
        backup_manager = MigrationSafetyManager(backup, self.recovery_dir / ".verify")
        backup_state = backup_manager.inspect_state()
        if backup_state["logical_sha256"] != snapshot.logical_sha256:
            raise MigrationSafetyError("backup logical checksum mismatch")
        if backup_state["schema_sha256"] != snapshot.schema_sha256:
            raise MigrationSafetyError("backup schema checksum mismatch")
        if int(backup_state["user_version"]) != snapshot.user_version:
            raise MigrationSafetyError("backup user_version mismatch")
        if backup_state["protected_row_counts"] != snapshot.protected_row_counts:
            raise MigrationSafetyError("backup protected row-count mismatch")
        backup_manager.verify_tenant_integrity()

        temporary = self.database_path.with_name(self.database_path.name + ".restore.tmp")
        if temporary.exists():
            temporary.unlink()
        source = sqlite3.connect(str(backup))
        target = sqlite3.connect(str(temporary))
        try:
            source.backup(target)
            target.commit()
        finally:
            target.close()
            source.close()

        try:
            temporary_manager = MigrationSafetyManager(
                temporary,
                self.recovery_dir / ".restore-verify",
            )
            temporary_state = temporary_manager.inspect_state()
            temporary_manager.verify_tenant_integrity()
            if temporary_state["logical_sha256"] != snapshot.logical_sha256:
                raise MigrationSafetyError("restored logical checksum mismatch")
            if temporary_state["schema_sha256"] != snapshot.schema_sha256:
                raise MigrationSafetyError("restored schema checksum mismatch")
            if int(temporary_state["user_version"]) != snapshot.user_version:
                raise MigrationSafetyError("restored user_version mismatch")
            os.replace(temporary, self.database_path)
        except Exception:
            if temporary.exists():
                temporary.unlink()
            raise

        final = self.inspect_state()
        self.verify_tenant_integrity()
        if final["logical_sha256"] != snapshot.logical_sha256:
            raise MigrationSafetyError("post-restore logical checksum mismatch")
        return {
            "schema": "musitu.axiom.frontier.migration-repair.v1",
            "snapshot": snapshot.name,
            "restored_logical_sha256": str(final["logical_sha256"]),
            "restored_schema_sha256": str(final["schema_sha256"]),
            "user_version": int(final["user_version"]),
            "tenant_integrity": "PASS",
            "sqlite_integrity": "PASS",
            "gate": "PASS",
        }
