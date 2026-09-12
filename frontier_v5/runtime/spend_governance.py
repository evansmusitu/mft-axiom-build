#!/usr/bin/env python3
"""Persistent enterprise quota, rate, concurrency and spend governance.

Frontier-only candidate. This module is not wired into the sealed v4 public
Plugin, production OAuth worker, billing rails or production customer store.
It provides deterministic fail-closed controls that can be integration-tested
before any separately governed promotion.

Security and correctness properties:
* tenant-wide rolling request rate and concurrency limits;
* rolling spend budgets with a per-request anomaly ceiling;
* request-id idempotency so retries cannot double-reserve quota or spend;
* bounded monotonic server-clock handling to prevent rollback bypasses;
* temporary explicit spend overrides that require caller authorization;
* tenant-isolated persistent state; and
* per-tenant SHA-256 hash-chained audit events so direct DB tampering is
  detectable.
"""
from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any
from datetime import datetime, timezone
import hashlib
import json
import re
import sqlite3
import uuid


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$")


class SpendGovernanceError(RuntimeError):
    """Base class for enterprise spend-governance failures."""


class SpendAuthorizationError(SpendGovernanceError):
    """Raised when an administrative mutation lacks explicit authority."""


class SpendLimitError(SpendGovernanceError):
    """Raised when a request violates a configured quota or safety limit."""


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _required_id(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SpendGovernanceError(f"{name} is required")
    text = value.strip()
    if not _ID.fullmatch(text):
        raise SpendGovernanceError(f"{name} has invalid format")
    return text


def _positive_int(value: Any, name: str, *, allow_zero: bool = False) -> int:
    if type(value) is not int:
        raise SpendGovernanceError(f"{name} must be an integer")
    minimum = 0 if allow_zero else 1
    if value < minimum:
        raise SpendGovernanceError(f"{name} must be >= {minimum}")
    return value


def _epoch(value: Any, name: str = "now_epoch") -> int:
    return _positive_int(value, name, allow_zero=True)


def _utc_from_epoch(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


class EnterpriseSpendGovernor:
    """SQLite-backed tenant quota/rate/concurrency/spend governor."""

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
            CREATE TABLE IF NOT EXISTS spend_policies(
              tenant_id TEXT PRIMARY KEY,
              version INTEGER NOT NULL,
              rate_limit INTEGER NOT NULL,
              rate_window_seconds INTEGER NOT NULL,
              concurrency_limit INTEGER NOT NULL,
              spend_limit_microunits INTEGER NOT NULL,
              spend_window_seconds INTEGER NOT NULL,
              max_request_microunits INTEGER NOT NULL,
              clock_skew_tolerance_seconds INTEGER NOT NULL,
              updated_by TEXT NOT NULL,
              updated_epoch INTEGER NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS spend_clock(
              tenant_id TEXT PRIMARY KEY,
              last_epoch INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS spend_reservations(
              reservation_id TEXT PRIMARY KEY,
              tenant_id TEXT NOT NULL,
              request_id TEXT NOT NULL,
              principal_id TEXT NOT NULL,
              estimated_cost_microunits INTEGER NOT NULL,
              actual_cost_microunits INTEGER,
              status TEXT NOT NULL CHECK(status IN ('reserved','completed')),
              created_epoch INTEGER NOT NULL,
              completed_epoch INTEGER,
              UNIQUE(tenant_id,request_id)
            );
            CREATE INDEX IF NOT EXISTS idx_spend_reservations_tenant_time
              ON spend_reservations(tenant_id,created_epoch,status);

            CREATE TABLE IF NOT EXISTS spend_overrides(
              tenant_id TEXT NOT NULL,
              override_id TEXT NOT NULL,
              extra_spend_microunits INTEGER NOT NULL,
              expires_at_epoch INTEGER NOT NULL,
              reason TEXT NOT NULL,
              actor TEXT NOT NULL,
              created_epoch INTEGER NOT NULL,
              PRIMARY KEY(tenant_id,override_id)
            );
            CREATE INDEX IF NOT EXISTS idx_spend_overrides_tenant_expiry
              ON spend_overrides(tenant_id,expires_at_epoch);

            CREATE TABLE IF NOT EXISTS spend_audit(
              sequence INTEGER PRIMARY KEY AUTOINCREMENT,
              tenant_id TEXT NOT NULL,
              actor TEXT NOT NULL,
              event_type TEXT NOT NULL,
              target_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              previous_sha256 TEXT,
              event_sha256 TEXT NOT NULL,
              created_epoch INTEGER NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_spend_audit_tenant_sequence
              ON spend_audit(tenant_id,sequence);
            """
        )
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    # ------------------------------------------------------------------
    # Audit lineage
    # ------------------------------------------------------------------
    def _append_audit(
        self,
        tenant_id: str,
        *,
        actor: str,
        event_type: str,
        target_id: str,
        payload: Mapping[str, Any],
        now_epoch: int,
    ) -> str:
        previous = self._db.execute(
            "SELECT event_sha256 FROM spend_audit WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1",
            (tenant_id,),
        ).fetchone()
        previous_sha = str(previous[0]) if previous else None
        created_at = _utc_from_epoch(now_epoch)
        payload_json = _canonical(dict(payload))
        body = {
            "tenant_id": tenant_id,
            "actor": actor,
            "event_type": event_type,
            "target_id": target_id,
            "payload_json": payload_json,
            "previous_sha256": previous_sha,
            "created_epoch": now_epoch,
            "created_at": created_at,
        }
        event_sha = _sha256(body)
        self._db.execute(
            """INSERT INTO spend_audit(
              tenant_id,actor,event_type,target_id,payload_json,previous_sha256,
              event_sha256,created_epoch,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                tenant_id, actor, event_type, target_id, payload_json,
                previous_sha, event_sha, now_epoch, created_at,
            ),
        )
        return event_sha

    def verify_audit_chain(self, tenant_id: str) -> bool:
        try:
            tenant_id = _required_id(tenant_id, "tenant_id")
        except SpendGovernanceError:
            return False
        rows = self._db.execute(
            "SELECT * FROM spend_audit WHERE tenant_id=? ORDER BY sequence", (tenant_id,)
        ).fetchall()
        if not rows:
            return False
        previous: str | None = None
        for row in rows:
            if row["previous_sha256"] != previous:
                return False
            body = {
                "tenant_id": row["tenant_id"],
                "actor": row["actor"],
                "event_type": row["event_type"],
                "target_id": row["target_id"],
                "payload_json": row["payload_json"],
                "previous_sha256": row["previous_sha256"],
                "created_epoch": row["created_epoch"],
                "created_at": row["created_at"],
            }
            if _sha256(body) != row["event_sha256"]:
                return False
            previous = str(row["event_sha256"])
        return True

    # ------------------------------------------------------------------
    # Policy and clock controls
    # ------------------------------------------------------------------
    def _policy(self, tenant_id: str) -> sqlite3.Row:
        row = self._db.execute(
            "SELECT * FROM spend_policies WHERE tenant_id=?", (tenant_id,)
        ).fetchone()
        if row is None:
            raise SpendLimitError("tenant spend policy is not configured")
        return row

    def _check_clock(self, tenant_id: str, now_epoch: int, tolerance: int) -> None:
        row = self._db.execute(
            "SELECT last_epoch FROM spend_clock WHERE tenant_id=?", (tenant_id,)
        ).fetchone()
        if row is not None:
            last_epoch = int(row["last_epoch"])
            if now_epoch < last_epoch - tolerance:
                self._append_audit(
                    tenant_id,
                    actor="system",
                    event_type="request.rejected.clock",
                    target_id="clock",
                    payload={"now_epoch": now_epoch, "last_epoch": last_epoch, "tolerance": tolerance},
                    now_epoch=max(now_epoch, 0),
                )
                self._db.commit()
                raise SpendLimitError("clock rollback exceeds configured tolerance")
            now_epoch = max(now_epoch, last_epoch)
        self._db.execute(
            """INSERT INTO spend_clock(tenant_id,last_epoch) VALUES(?,?)
               ON CONFLICT(tenant_id) DO UPDATE SET last_epoch=max(spend_clock.last_epoch,excluded.last_epoch)""",
            (tenant_id, now_epoch),
        )
        self._db.commit()

    def set_policy(
        self,
        tenant_id: str,
        *,
        actor: str,
        authorized: bool,
        rate_limit: int,
        rate_window_seconds: int,
        concurrency_limit: int,
        spend_limit_microunits: int,
        spend_window_seconds: int,
        max_request_microunits: int,
        clock_skew_tolerance_seconds: int,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        actor = _required_id(actor, "actor")
        if authorized is not True:
            raise SpendAuthorizationError("authorized tenant administrator required")
        now_epoch = _epoch(now_epoch)
        rate_limit = _positive_int(rate_limit, "rate_limit")
        rate_window_seconds = _positive_int(rate_window_seconds, "rate_window_seconds")
        concurrency_limit = _positive_int(concurrency_limit, "concurrency_limit")
        spend_limit_microunits = _positive_int(spend_limit_microunits, "spend_limit_microunits")
        spend_window_seconds = _positive_int(spend_window_seconds, "spend_window_seconds")
        max_request_microunits = _positive_int(max_request_microunits, "max_request_microunits")
        clock_skew_tolerance_seconds = _positive_int(
            clock_skew_tolerance_seconds, "clock_skew_tolerance_seconds", allow_zero=True
        )

        existing = self._db.execute(
            "SELECT * FROM spend_policies WHERE tenant_id=?", (tenant_id,)
        ).fetchone()
        if existing is not None:
            self._check_clock(
                tenant_id, now_epoch, int(existing["clock_skew_tolerance_seconds"])
            )
            version = int(existing["version"]) + 1
        else:
            version = 1

        with self._db:
            self._db.execute(
                """INSERT INTO spend_policies(
                  tenant_id,version,rate_limit,rate_window_seconds,concurrency_limit,
                  spend_limit_microunits,spend_window_seconds,max_request_microunits,
                  clock_skew_tolerance_seconds,updated_by,updated_epoch,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(tenant_id) DO UPDATE SET
                  version=excluded.version,
                  rate_limit=excluded.rate_limit,
                  rate_window_seconds=excluded.rate_window_seconds,
                  concurrency_limit=excluded.concurrency_limit,
                  spend_limit_microunits=excluded.spend_limit_microunits,
                  spend_window_seconds=excluded.spend_window_seconds,
                  max_request_microunits=excluded.max_request_microunits,
                  clock_skew_tolerance_seconds=excluded.clock_skew_tolerance_seconds,
                  updated_by=excluded.updated_by,
                  updated_epoch=excluded.updated_epoch,
                  updated_at=excluded.updated_at""",
                (
                    tenant_id, version, rate_limit, rate_window_seconds,
                    concurrency_limit, spend_limit_microunits, spend_window_seconds,
                    max_request_microunits, clock_skew_tolerance_seconds,
                    actor, now_epoch, _utc_from_epoch(now_epoch),
                ),
            )
            self._db.execute(
                """INSERT INTO spend_clock(tenant_id,last_epoch) VALUES(?,?)
                   ON CONFLICT(tenant_id) DO UPDATE SET last_epoch=max(spend_clock.last_epoch,excluded.last_epoch)""",
                (tenant_id, now_epoch),
            )
            self._append_audit(
                tenant_id,
                actor=actor,
                event_type="policy.set",
                target_id=f"policy-v{version}",
                payload={
                    "version": version,
                    "rate_limit": rate_limit,
                    "rate_window_seconds": rate_window_seconds,
                    "concurrency_limit": concurrency_limit,
                    "spend_limit_microunits": spend_limit_microunits,
                    "spend_window_seconds": spend_window_seconds,
                    "max_request_microunits": max_request_microunits,
                    "clock_skew_tolerance_seconds": clock_skew_tolerance_seconds,
                },
                now_epoch=now_epoch,
            )
        return {
            "tenant_id": tenant_id,
            "version": version,
            "rate_limit": rate_limit,
            "concurrency_limit": concurrency_limit,
            "spend_limit_microunits": spend_limit_microunits,
        }

    # ------------------------------------------------------------------
    # Limit accounting
    # ------------------------------------------------------------------
    def _active_concurrency(self, tenant_id: str) -> int:
        return int(
            self._db.execute(
                "SELECT count(*) FROM spend_reservations WHERE tenant_id=? AND status='reserved'",
                (tenant_id,),
            ).fetchone()[0]
        )

    def _rate_count(self, tenant_id: str, *, now_epoch: int, window: int) -> int:
        cutoff = now_epoch - window
        return int(
            self._db.execute(
                """SELECT count(*) FROM spend_reservations
                   WHERE tenant_id=? AND created_epoch>? AND created_epoch<=?""",
                (tenant_id, cutoff, now_epoch),
            ).fetchone()[0]
        )

    def _consumed_spend(self, tenant_id: str, *, now_epoch: int, window: int) -> int:
        cutoff = now_epoch - window
        row = self._db.execute(
            """SELECT coalesce(sum(
                 CASE WHEN status='completed' THEN actual_cost_microunits
                      ELSE estimated_cost_microunits END
               ),0) AS consumed
               FROM spend_reservations
               WHERE tenant_id=? AND created_epoch>? AND created_epoch<=?""",
            (tenant_id, cutoff, now_epoch),
        ).fetchone()
        return int(row["consumed"] or 0)

    def _active_override_spend(self, tenant_id: str, *, now_epoch: int) -> int:
        row = self._db.execute(
            """SELECT coalesce(sum(extra_spend_microunits),0) AS extra
               FROM spend_overrides
               WHERE tenant_id=? AND created_epoch<=? AND expires_at_epoch>?""",
            (tenant_id, now_epoch, now_epoch),
        ).fetchone()
        return int(row["extra"] or 0)

    def _reject(
        self,
        tenant_id: str,
        *,
        principal_id: str,
        request_id: str,
        reason: str,
        payload: Mapping[str, Any],
        now_epoch: int,
    ) -> None:
        self._append_audit(
            tenant_id,
            actor=principal_id,
            event_type=f"request.rejected.{reason}",
            target_id=request_id,
            payload=payload,
            now_epoch=now_epoch,
        )
        self._db.commit()
        raise SpendLimitError(reason.replace("_", " "))

    def reserve(
        self,
        tenant_id: str,
        request_id: str,
        *,
        principal_id: str,
        estimated_cost_microunits: int,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        request_id = _required_id(request_id, "request_id")
        principal_id = _required_id(principal_id, "principal_id")
        estimated = _positive_int(estimated_cost_microunits, "estimated_cost_microunits")
        now_epoch = _epoch(now_epoch)
        policy = self._policy(tenant_id)
        self._check_clock(tenant_id, now_epoch, int(policy["clock_skew_tolerance_seconds"]))

        existing = self._db.execute(
            "SELECT * FROM spend_reservations WHERE tenant_id=? AND request_id=?",
            (tenant_id, request_id),
        ).fetchone()
        if existing is not None:
            if (
                str(existing["principal_id"]) != principal_id
                or int(existing["estimated_cost_microunits"]) != estimated
            ):
                self._reject(
                    tenant_id,
                    principal_id=principal_id,
                    request_id=request_id,
                    reason="idempotency_mismatch",
                    payload={"message": "request_id replay parameters differ"},
                    now_epoch=now_epoch,
                )
            return self._reservation_dict(existing, replayed=True)

        if estimated > int(policy["max_request_microunits"]):
            self._reject(
                tenant_id,
                principal_id=principal_id,
                request_id=request_id,
                reason="request_cost_anomaly",
                payload={
                    "estimated_cost_microunits": estimated,
                    "max_request_microunits": int(policy["max_request_microunits"]),
                },
                now_epoch=now_epoch,
            )

        active = self._active_concurrency(tenant_id)
        if active >= int(policy["concurrency_limit"]):
            self._reject(
                tenant_id,
                principal_id=principal_id,
                request_id=request_id,
                reason="concurrency_limit",
                payload={"active": active, "limit": int(policy["concurrency_limit"])},
                now_epoch=now_epoch,
            )

        rate_count = self._rate_count(
            tenant_id, now_epoch=now_epoch, window=int(policy["rate_window_seconds"])
        )
        if rate_count >= int(policy["rate_limit"]):
            self._reject(
                tenant_id,
                principal_id=principal_id,
                request_id=request_id,
                reason="rate_limit",
                payload={"count": rate_count, "limit": int(policy["rate_limit"])},
                now_epoch=now_epoch,
            )

        consumed = self._consumed_spend(
            tenant_id, now_epoch=now_epoch, window=int(policy["spend_window_seconds"])
        )
        extra = self._active_override_spend(tenant_id, now_epoch=now_epoch)
        effective_limit = int(policy["spend_limit_microunits"]) + extra
        if consumed + estimated > effective_limit:
            self._reject(
                tenant_id,
                principal_id=principal_id,
                request_id=request_id,
                reason="budget_limit",
                payload={
                    "consumed_spend_microunits": consumed,
                    "estimated_cost_microunits": estimated,
                    "effective_spend_limit_microunits": effective_limit,
                },
                now_epoch=now_epoch,
            )

        reservation_id = uuid.uuid4().hex
        with self._db:
            self._db.execute(
                """INSERT INTO spend_reservations(
                  reservation_id,tenant_id,request_id,principal_id,
                  estimated_cost_microunits,actual_cost_microunits,status,
                  created_epoch,completed_epoch
                ) VALUES(?,?,?,?,?,NULL,'reserved',?,NULL)""",
                (reservation_id, tenant_id, request_id, principal_id, estimated, now_epoch),
            )
            self._append_audit(
                tenant_id,
                actor=principal_id,
                event_type="request.reserved",
                target_id=request_id,
                payload={
                    "reservation_id": reservation_id,
                    "estimated_cost_microunits": estimated,
                    "policy_version": int(policy["version"]),
                },
                now_epoch=now_epoch,
            )
        row = self._db.execute(
            "SELECT * FROM spend_reservations WHERE reservation_id=?", (reservation_id,)
        ).fetchone()
        assert row is not None
        return self._reservation_dict(row, replayed=False)

    def complete(
        self,
        tenant_id: str,
        request_id: str,
        *,
        actual_cost_microunits: int,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        request_id = _required_id(request_id, "request_id")
        actual = _positive_int(actual_cost_microunits, "actual_cost_microunits", allow_zero=True)
        now_epoch = _epoch(now_epoch)
        policy = self._policy(tenant_id)
        self._check_clock(tenant_id, now_epoch, int(policy["clock_skew_tolerance_seconds"]))
        row = self._db.execute(
            "SELECT * FROM spend_reservations WHERE tenant_id=? AND request_id=?",
            (tenant_id, request_id),
        ).fetchone()
        if row is None:
            raise SpendGovernanceError("reservation does not exist")
        if row["status"] == "completed":
            if int(row["actual_cost_microunits"]) != actual:
                raise SpendLimitError("completed request cost cannot be changed")
            return self._reservation_dict(row, replayed=True)
        if actual > int(row["estimated_cost_microunits"]):
            raise SpendLimitError("actual cost exceeds reserved amount")
        principal_id = str(row["principal_id"])
        with self._db:
            self._db.execute(
                """UPDATE spend_reservations
                   SET actual_cost_microunits=?,status='completed',completed_epoch=?
                   WHERE tenant_id=? AND request_id=? AND status='reserved'""",
                (actual, now_epoch, tenant_id, request_id),
            )
            self._append_audit(
                tenant_id,
                actor=principal_id,
                event_type="request.completed",
                target_id=request_id,
                payload={
                    "actual_cost_microunits": actual,
                    "reserved_cost_microunits": int(row["estimated_cost_microunits"]),
                },
                now_epoch=now_epoch,
            )
        updated = self._db.execute(
            "SELECT * FROM spend_reservations WHERE tenant_id=? AND request_id=?",
            (tenant_id, request_id),
        ).fetchone()
        assert updated is not None
        return self._reservation_dict(updated, replayed=False)

    def grant_override(
        self,
        tenant_id: str,
        override_id: str,
        *,
        actor: str,
        authorized: bool,
        extra_spend_microunits: int,
        expires_at_epoch: int,
        reason: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        override_id = _required_id(override_id, "override_id")
        actor = _required_id(actor, "actor")
        if authorized is not True:
            raise SpendAuthorizationError("authorized tenant administrator required")
        extra = _positive_int(extra_spend_microunits, "extra_spend_microunits")
        expires = _epoch(expires_at_epoch, "expires_at_epoch")
        now_epoch = _epoch(now_epoch)
        if not isinstance(reason, str) or not reason.strip():
            raise SpendGovernanceError("override reason is required")
        reason = reason.strip()
        if len(reason) > 500:
            raise SpendGovernanceError("override reason exceeds maximum length")
        if expires <= now_epoch:
            raise SpendGovernanceError("override expiry must be in the future")
        policy = self._policy(tenant_id)
        self._check_clock(tenant_id, now_epoch, int(policy["clock_skew_tolerance_seconds"]))

        existing = self._db.execute(
            "SELECT * FROM spend_overrides WHERE tenant_id=? AND override_id=?",
            (tenant_id, override_id),
        ).fetchone()
        if existing is not None:
            if (
                int(existing["extra_spend_microunits"]) != extra
                or int(existing["expires_at_epoch"]) != expires
                or str(existing["reason"]) != reason
                or str(existing["actor"]) != actor
            ):
                raise SpendGovernanceError("override_id replay parameters differ")
            return {
                "tenant_id": tenant_id,
                "override_id": override_id,
                "extra_spend_microunits": extra,
                "expires_at_epoch": expires,
                "replayed": True,
            }

        with self._db:
            self._db.execute(
                """INSERT INTO spend_overrides(
                  tenant_id,override_id,extra_spend_microunits,expires_at_epoch,
                  reason,actor,created_epoch
                ) VALUES(?,?,?,?,?,?,?)""",
                (tenant_id, override_id, extra, expires, reason, actor, now_epoch),
            )
            self._append_audit(
                tenant_id,
                actor=actor,
                event_type="override.granted",
                target_id=override_id,
                payload={
                    "extra_spend_microunits": extra,
                    "expires_at_epoch": expires,
                    "reason": reason,
                },
                now_epoch=now_epoch,
            )
        return {
            "tenant_id": tenant_id,
            "override_id": override_id,
            "extra_spend_microunits": extra,
            "expires_at_epoch": expires,
            "replayed": False,
        }

    def snapshot(self, tenant_id: str, *, now_epoch: int) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        now_epoch = _epoch(now_epoch)
        policy = self._policy(tenant_id)
        self._check_clock(tenant_id, now_epoch, int(policy["clock_skew_tolerance_seconds"]))
        consumed = self._consumed_spend(
            tenant_id, now_epoch=now_epoch, window=int(policy["spend_window_seconds"])
        )
        extra = self._active_override_spend(tenant_id, now_epoch=now_epoch)
        return {
            "tenant_id": tenant_id,
            "policy_version": int(policy["version"]),
            "active_concurrency": self._active_concurrency(tenant_id),
            "rate_count": self._rate_count(
                tenant_id, now_epoch=now_epoch, window=int(policy["rate_window_seconds"])
            ),
            "consumed_spend_microunits": consumed,
            "base_spend_limit_microunits": int(policy["spend_limit_microunits"]),
            "active_override_microunits": extra,
            "effective_spend_limit_microunits": int(policy["spend_limit_microunits"]) + extra,
        }

    @staticmethod
    def _reservation_dict(row: sqlite3.Row, *, replayed: bool) -> dict[str, Any]:
        return {
            "reservation_id": str(row["reservation_id"]),
            "tenant_id": str(row["tenant_id"]),
            "request_id": str(row["request_id"]),
            "principal_id": str(row["principal_id"]),
            "estimated_cost_microunits": int(row["estimated_cost_microunits"]),
            "actual_cost_microunits": (
                None if row["actual_cost_microunits"] is None else int(row["actual_cost_microunits"])
            ),
            "status": str(row["status"]),
            "replayed": replayed,
        }


__all__ = [
    "EnterpriseSpendGovernor",
    "SpendAuthorizationError",
    "SpendGovernanceError",
    "SpendLimitError",
]
