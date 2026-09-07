#!/usr/bin/env python3
"""Tenant-safe enterprise data lifecycle controls for MUSITU Axiom Frontier v5.

Frontier-only candidate. This module implements retention assignment, legal
holds, deterministic exports, idempotent deletion/tombstones, expiry purge and
a tamper-evident lifecycle audit chain. It does not claim that production D1,
object storage, analytics systems or backups are already wired to this control
plane; those integrations require separate Level-3 verification.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import hashlib
import json
import re
import sqlite3


_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$")


class DataLifecycleError(RuntimeError):
    """Raised when a lifecycle operation is invalid or must fail closed."""


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _text(value: Any, name: str, *, max_len: int = 256) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DataLifecycleError(f"{name} is required")
    text = value.strip()
    if len(text) > max_len:
        raise DataLifecycleError(f"{name} exceeds maximum length")
    return text


def _id(value: Any, name: str) -> str:
    text = _text(value, name, max_len=192)
    if not _ID.fullmatch(text):
        raise DataLifecycleError(f"{name} has invalid format")
    return text


def _instant(value: datetime, name: str = "time") -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise DataLifecycleError(f"{name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _parse_instant(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except Exception as exc:
        raise DataLifecycleError("stored lifecycle timestamp is invalid") from exc
    return _instant(parsed, "stored time")


@dataclass(frozen=True)
class RetentionPolicy:
    policy_id: str
    category_days: Mapping[str, int]

    def __post_init__(self) -> None:
        policy_id = _id(self.policy_id, "policy_id")
        object.__setattr__(self, "policy_id", policy_id)
        if not isinstance(self.category_days, Mapping) or not self.category_days:
            raise DataLifecycleError("category_days must be a non-empty object")
        normalized: dict[str, int] = {}
        for raw_category, raw_days in self.category_days.items():
            category = _id(raw_category, "category").casefold()
            if isinstance(raw_days, bool) or not isinstance(raw_days, int) or not 1 <= raw_days <= 36500:
                raise DataLifecycleError("retention days must be an integer within 1..36500")
            if category in normalized:
                raise DataLifecycleError("retention category is duplicated")
            normalized[category] = raw_days
        object.__setattr__(self, "category_days", normalized)


class DataLifecycleStore:
    """SQLite lifecycle control plane with tenant isolation and proof receipts."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA foreign_keys=ON")
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA busy_timeout=5000")
        self._migrate()

    def _migrate(self) -> None:
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS lifecycle_policies(
              tenant_id TEXT PRIMARY KEY,
              policy_id TEXT NOT NULL,
              category_days_json TEXT NOT NULL,
              installed_by TEXT NOT NULL,
              installed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lifecycle_records(
              tenant_id TEXT NOT NULL,
              category TEXT NOT NULL,
              object_id TEXT NOT NULL,
              payload_json TEXT,
              source_sha256 TEXT NOT NULL,
              created_at TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              state TEXT NOT NULL CHECK(state IN ('active','deleted')),
              legal_hold INTEGER NOT NULL DEFAULT 0 CHECK(legal_hold IN (0,1)),
              legal_hold_reason TEXT,
              deleted_at TEXT,
              deletion_receipt_sha256 TEXT,
              PRIMARY KEY(tenant_id,category,object_id)
            );
            CREATE INDEX IF NOT EXISTS idx_lifecycle_expiry
              ON lifecycle_records(tenant_id,state,expires_at);

            CREATE TABLE IF NOT EXISTS lifecycle_delete_requests(
              request_id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL,
              category TEXT NOT NULL,
              object_id TEXT NOT NULL,
              receipt_json TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lifecycle_audit(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              tenant_id TEXT NOT NULL,
              actor TEXT NOT NULL,
              event_type TEXT NOT NULL,
              target_type TEXT NOT NULL,
              target_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_sha256 TEXT,
              event_sha256 TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_lifecycle_audit_tenant_sequence
              ON lifecycle_audit(tenant_id,sequence);
            """
        )
        self._db.commit()

    def _append_audit(
        self,
        tenant_id: str,
        actor: str,
        event_type: str,
        target_type: str,
        target_id: str,
        payload: Mapping[str, Any],
        now: datetime,
    ) -> str:
        previous = self._db.execute(
            "SELECT event_sha256 FROM lifecycle_audit WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1",
            (tenant_id,),
        ).fetchone()
        previous_sha = str(previous[0]) if previous else None
        created_at = _instant(now).isoformat()
        payload_json = _canonical(dict(payload))
        body = {
            "tenant_id": tenant_id,
            "actor": actor,
            "event_type": event_type,
            "target_type": target_type,
            "target_id": target_id,
            "payload_json": payload_json,
            "previous_sha256": previous_sha,
            "created_at": created_at,
        }
        event_sha = _sha(body)
        self._db.execute(
            """INSERT INTO lifecycle_audit(
              tenant_id,actor,event_type,target_type,target_id,payload_json,
              previous_sha256,event_sha256,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                tenant_id, actor, event_type, target_type, target_id, payload_json,
                previous_sha, event_sha, created_at,
            ),
        )
        return event_sha

    def verify_audit_chain(self, tenant_id: str) -> bool:
        try:
            tenant_id = _id(tenant_id, "tenant_id")
        except DataLifecycleError:
            return False
        rows = self._db.execute(
            "SELECT * FROM lifecycle_audit WHERE tenant_id=? ORDER BY sequence", (tenant_id,)
        ).fetchall()
        previous: str | None = None
        for row in rows:
            if row["previous_sha256"] != previous:
                return False
            body = {
                "tenant_id": row["tenant_id"],
                "actor": row["actor"],
                "event_type": row["event_type"],
                "target_type": row["target_type"],
                "target_id": row["target_id"],
                "payload_json": row["payload_json"],
                "previous_sha256": row["previous_sha256"],
                "created_at": row["created_at"],
            }
            if _sha(body) != row["event_sha256"]:
                return False
            previous = str(row["event_sha256"])
        return True

    def install_policy(self, tenant_id: str, policy: RetentionPolicy, *, actor: str, now: datetime) -> None:
        tenant_id = _id(tenant_id, "tenant_id")
        actor = _id(actor, "actor")
        if not isinstance(policy, RetentionPolicy):
            raise DataLifecycleError("policy must be a RetentionPolicy")
        now = _instant(now)
        category_json = _canonical(dict(policy.category_days))
        try:
            with self._db:
                self._db.execute(
                    """INSERT INTO lifecycle_policies(
                      tenant_id,policy_id,category_days_json,installed_by,installed_at
                    ) VALUES(?,?,?,?,?)""",
                    (tenant_id, policy.policy_id, category_json, actor, now.isoformat()),
                )
                self._append_audit(
                    tenant_id, actor, "policy.install", "policy", policy.policy_id,
                    {"category_days": dict(policy.category_days)}, now,
                )
        except sqlite3.IntegrityError as exc:
            raise DataLifecycleError("retention policy already installed for tenant") from exc

    def _policy(self, tenant_id: str) -> tuple[str, dict[str, int]]:
        row = self._db.execute(
            "SELECT policy_id,category_days_json FROM lifecycle_policies WHERE tenant_id=?", (tenant_id,)
        ).fetchone()
        if row is None:
            raise DataLifecycleError("tenant retention policy is not installed")
        try:
            categories = json.loads(row["category_days_json"])
        except Exception as exc:
            raise DataLifecycleError("stored retention policy is invalid") from exc
        if not isinstance(categories, dict):
            raise DataLifecycleError("stored retention policy is invalid")
        return str(row["policy_id"]), {str(k): int(v) for k, v in categories.items()}

    def put(
        self,
        tenant_id: str,
        category: str,
        object_id: str,
        payload: Any,
        *,
        source_sha256: str,
        actor: str,
        now: datetime,
    ) -> dict[str, Any]:
        tenant_id = _id(tenant_id, "tenant_id")
        category = _id(category, "category").casefold()
        object_id = _id(object_id, "object_id")
        actor = _id(actor, "actor")
        source_sha256 = _text(source_sha256, "source_sha256", max_len=64).casefold()
        if not _HEX64.fullmatch(source_sha256):
            raise DataLifecycleError("source_sha256 must be a 64-character SHA-256 digest")
        now = _instant(now)
        policy_id, categories = self._policy(tenant_id)
        if category not in categories:
            raise DataLifecycleError("category is not covered by tenant retention policy")
        expires = now + timedelta(days=categories[category])
        payload_json = _canonical(payload)
        try:
            with self._db:
                self._db.execute(
                    """INSERT INTO lifecycle_records(
                      tenant_id,category,object_id,payload_json,source_sha256,
                      created_at,expires_at,state,legal_hold,legal_hold_reason,
                      deleted_at,deletion_receipt_sha256
                    ) VALUES(?,?,?,?,?,?,?,'active',0,NULL,NULL,NULL)""",
                    (
                        tenant_id, category, object_id, payload_json, source_sha256,
                        now.isoformat(), expires.isoformat(),
                    ),
                )
                self._append_audit(
                    tenant_id, actor, "record.create", category, object_id,
                    {"policy_id": policy_id, "expires_at": expires.isoformat(), "source_sha256": source_sha256},
                    now,
                )
        except sqlite3.IntegrityError as exc:
            raise DataLifecycleError("lifecycle object already exists") from exc
        return {
            "tenant_id": tenant_id,
            "category": category,
            "object_id": object_id,
            "state": "active",
            "expires_at": expires.isoformat(),
            "source_sha256": source_sha256,
        }

    def _record_row(self, tenant_id: str, category: str, object_id: str) -> sqlite3.Row | None:
        return self._db.execute(
            "SELECT * FROM lifecycle_records WHERE tenant_id=? AND category=? AND object_id=?",
            (tenant_id, category, object_id),
        ).fetchone()

    @staticmethod
    def _record_dict(row: sqlite3.Row) -> dict[str, Any]:
        payload = None
        if row["payload_json"] is not None:
            try:
                payload = json.loads(row["payload_json"])
            except Exception as exc:
                raise DataLifecycleError("stored lifecycle payload is invalid") from exc
        return {
            "tenant_id": row["tenant_id"],
            "category": row["category"],
            "object_id": row["object_id"],
            "payload": payload,
            "source_sha256": row["source_sha256"],
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            "state": row["state"],
            "legal_hold": bool(row["legal_hold"]),
            "legal_hold_reason": row["legal_hold_reason"],
            "deleted_at": row["deleted_at"],
            "deletion_receipt_sha256": row["deletion_receipt_sha256"],
        }

    def get(self, tenant_id: str, category: str, object_id: str, *, include_deleted: bool = False) -> dict[str, Any] | None:
        tenant_id = _id(tenant_id, "tenant_id")
        category = _id(category, "category").casefold()
        object_id = _id(object_id, "object_id")
        row = self._record_row(tenant_id, category, object_id)
        if row is None or (row["state"] == "deleted" and not include_deleted):
            return None
        return self._record_dict(row)

    def set_legal_hold(
        self,
        tenant_id: str,
        category: str,
        object_id: str,
        enabled: bool,
        *,
        reason: str,
        actor: str,
        now: datetime,
    ) -> None:
        tenant_id = _id(tenant_id, "tenant_id")
        category = _id(category, "category").casefold()
        object_id = _id(object_id, "object_id")
        actor = _id(actor, "actor")
        if type(enabled) is not bool:
            raise DataLifecycleError("legal hold enabled flag must be boolean")
        reason = _text(reason, "legal hold reason", max_len=512)
        now = _instant(now)
        row = self._record_row(tenant_id, category, object_id)
        if row is None or row["state"] != "active":
            raise DataLifecycleError("lifecycle object not found or already deleted")
        with self._db:
            self._db.execute(
                """UPDATE lifecycle_records
                   SET legal_hold=?,legal_hold_reason=?
                   WHERE tenant_id=? AND category=? AND object_id=?""",
                (int(enabled), reason if enabled else None, tenant_id, category, object_id),
            )
            self._append_audit(
                tenant_id, actor, "legal_hold.set", category, object_id,
                {"enabled": enabled, "reason": reason}, now,
            )

    def delete(
        self,
        tenant_id: str,
        category: str,
        object_id: str,
        *,
        request_id: str,
        actor: str,
        reason: str,
        now: datetime,
    ) -> dict[str, Any]:
        tenant_id = _id(tenant_id, "tenant_id")
        category = _id(category, "category").casefold()
        object_id = _id(object_id, "object_id")
        request_id = _id(request_id, "request_id")
        actor = _id(actor, "actor")
        reason = _text(reason, "deletion reason", max_len=512)
        now = _instant(now)

        prior = self._db.execute(
            "SELECT * FROM lifecycle_delete_requests WHERE request_id=?", (request_id,)
        ).fetchone()
        if prior is not None:
            if (
                prior["tenant_id"] != tenant_id
                or prior["category"] != category
                or prior["object_id"] != object_id
            ):
                raise DataLifecycleError("request_id was already used for a different lifecycle object")
            try:
                receipt = json.loads(prior["receipt_json"])
            except Exception as exc:
                raise DataLifecycleError("stored deletion receipt is invalid") from exc
            if not isinstance(receipt, dict):
                raise DataLifecycleError("stored deletion receipt is invalid")
            return receipt

        row = self._record_row(tenant_id, category, object_id)
        # Cross-tenant and unknown identifiers intentionally collapse to the
        # same error so existence is not disclosed.
        if row is None:
            raise DataLifecycleError("lifecycle object not found")
        if row["state"] == "deleted":
            raise DataLifecycleError("lifecycle object not found")
        if bool(row["legal_hold"]):
            raise DataLifecycleError("lifecycle object is protected by legal hold")

        deleted_at = now.isoformat()
        receipt_basis = {
            "tenant_id": tenant_id,
            "category": category,
            "object_id": object_id,
            "request_id": request_id,
            "source_sha256": row["source_sha256"],
            "created_at": row["created_at"],
            "deleted_at": deleted_at,
            "reason": reason,
            "status": "DELETED",
        }
        receipt_sha = _sha(receipt_basis)
        receipt = {**receipt_basis, "receipt_sha256": receipt_sha}
        with self._db:
            self._db.execute(
                """UPDATE lifecycle_records
                   SET payload_json=NULL,state='deleted',legal_hold=0,
                       legal_hold_reason=NULL,deleted_at=?,deletion_receipt_sha256=?
                   WHERE tenant_id=? AND category=? AND object_id=?""",
                (deleted_at, receipt_sha, tenant_id, category, object_id),
            )
            self._db.execute(
                """INSERT INTO lifecycle_delete_requests(
                  request_id,tenant_id,category,object_id,receipt_json,created_at
                ) VALUES(?,?,?,?,?,?)""",
                (request_id, tenant_id, category, object_id, _canonical(receipt), deleted_at),
            )
            self._append_audit(
                tenant_id, actor, "record.delete", category, object_id,
                {"request_id": request_id, "reason": reason, "receipt_sha256": receipt_sha}, now,
            )
        return receipt

    def purge_expired(self, tenant_id: str, *, actor: str, now: datetime) -> dict[str, Any]:
        tenant_id = _id(tenant_id, "tenant_id")
        actor = _id(actor, "actor")
        now = _instant(now)
        # Require an installed tenant policy so a guessed tenant cannot be used
        # as an existence probe over the lifecycle tables.
        self._policy(tenant_id)
        rows = self._db.execute(
            """SELECT * FROM lifecycle_records
               WHERE tenant_id=? AND state='active' AND expires_at<=?
               ORDER BY category,object_id""",
            (tenant_id, now.isoformat()),
        ).fetchall()
        deleted: list[str] = []
        held: list[str] = []
        for row in rows:
            key = f"{row['category']}:{row['object_id']}"
            if bool(row["legal_hold"]):
                held.append(key)
                continue
            request_material = {
                "tenant_id": tenant_id,
                "category": row["category"],
                "object_id": row["object_id"],
                "expires_at": row["expires_at"],
            }
            request_id = "retention-" + _sha(request_material)[:32]
            self.delete(
                tenant_id,
                row["category"],
                row["object_id"],
                request_id=request_id,
                actor=actor,
                reason="retention-expiry",
                now=now,
            )
            deleted.append(key)
        return {"tenant_id": tenant_id, "deleted": deleted, "held": held, "evaluated_at": now.isoformat()}

    def export_tenant(
        self,
        tenant_id: str,
        *,
        actor: str,
        now: datetime,
        include_deleted: bool = False,
    ) -> dict[str, Any]:
        tenant_id = _id(tenant_id, "tenant_id")
        actor = _id(actor, "actor")
        if type(include_deleted) is not bool:
            raise DataLifecycleError("include_deleted must be boolean")
        now = _instant(now)
        policy_id, categories = self._policy(tenant_id)
        sql = "SELECT * FROM lifecycle_records WHERE tenant_id=?"
        params: list[Any] = [tenant_id]
        if not include_deleted:
            sql += " AND state='active'"
        sql += " ORDER BY category,object_id"
        rows = self._db.execute(sql, params).fetchall()
        records = [self._record_dict(row) for row in rows]
        # Deleted records are tombstones only; assert erasure invariant before
        # exporting proof metadata.
        for record in records:
            if record["state"] == "deleted" and record["payload"] is not None:
                raise DataLifecycleError("deleted lifecycle record still contains payload")
        basis = {
            "tenant_id": tenant_id,
            "policy_id": policy_id,
            "category_days": categories,
            "include_deleted": include_deleted,
            "exported_at": now.isoformat(),
            "records": records,
        }
        export_sha = _sha(basis)
        with self._db:
            self._append_audit(
                tenant_id, actor, "tenant.export", "tenant", tenant_id,
                {"include_deleted": include_deleted, "record_count": len(records), "export_sha256": export_sha},
                now,
            )
        return {**basis, "export_sha256": export_sha}

    def close(self) -> None:
        self._db.close()


__all__ = ["DataLifecycleError", "DataLifecycleStore", "RetentionPolicy"]
