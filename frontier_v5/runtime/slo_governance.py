#!/usr/bin/env python3
"""Persistent enterprise SLO/SLI/error-budget governance candidate.

Frontier-only. This module is intentionally not wired to the sealed v4 public
Plugin, production telemetry, production alerting, or customer-facing SLAs.
It provides deterministic controls that can be verified before any separately
governed production promotion.

Properties:
* tenant/service-scoped SLO definitions with versioning;
* trusted telemetry ingestion with semantic idempotency;
* bounded lateness, future-event, and clock-rollback rejection;
* explicit authorized maintenance exclusions that remain persisted/audited;
* availability and latency SLIs plus error-budget consumption;
* fast/slow multi-window burn-rate alerting;
* tenant isolation; and
* per-tenant SHA-256 hash-chained audit lineage.
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import hashlib
import json
import re
import sqlite3


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$")


class SLOGovernanceError(RuntimeError):
    """Base error for SLO-governance failures."""


class SLOAuthorizationError(SLOGovernanceError):
    """Administrative SLO mutation lacked explicit authority."""


class SLOTelemetryError(SLOGovernanceError):
    """Telemetry or evaluation input violated the trusted SLO contract."""


def _canonical(value: Any) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _utc(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _required_id(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SLOGovernanceError(f"{name} is required")
    text = value.strip()
    if not _ID.fullmatch(text):
        raise SLOGovernanceError(f"{name} has invalid format")
    return text


def _integer(value: Any, name: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise SLOGovernanceError(f"{name} must be an integer >= {minimum}")
    return value


def _number(value: Any, name: str, *, minimum: float = 0.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SLOGovernanceError(f"{name} must be numeric")
    number = float(value)
    if number < minimum:
        raise SLOGovernanceError(f"{name} must be >= {minimum}")
    return number


class EnterpriseSLOGovernor:
    """SQLite-backed tenant/service SLO governor."""

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
            CREATE TABLE IF NOT EXISTS slo_policies(
              tenant_id TEXT NOT NULL,
              service_id TEXT NOT NULL,
              version INTEGER NOT NULL,
              availability_target_bps INTEGER NOT NULL,
              latency_threshold_ms INTEGER NOT NULL,
              latency_target_bps INTEGER NOT NULL,
              evaluation_window_seconds INTEGER NOT NULL,
              fast_window_seconds INTEGER NOT NULL,
              slow_window_seconds INTEGER NOT NULL,
              fast_burn_threshold REAL NOT NULL,
              slow_burn_threshold REAL NOT NULL,
              min_samples INTEGER NOT NULL,
              max_lateness_seconds INTEGER NOT NULL,
              clock_skew_tolerance_seconds INTEGER NOT NULL,
              updated_by TEXT NOT NULL,
              updated_epoch INTEGER NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY(tenant_id, service_id)
            );

            CREATE TABLE IF NOT EXISTS slo_clock(
              tenant_id TEXT NOT NULL,
              service_id TEXT NOT NULL,
              last_epoch INTEGER NOT NULL,
              PRIMARY KEY(tenant_id, service_id)
            );

            CREATE TABLE IF NOT EXISTS slo_maintenance(
              tenant_id TEXT NOT NULL,
              service_id TEXT NOT NULL,
              maintenance_id TEXT NOT NULL,
              starts_at_epoch INTEGER NOT NULL,
              ends_at_epoch INTEGER NOT NULL,
              reason TEXT NOT NULL,
              actor TEXT NOT NULL,
              created_epoch INTEGER NOT NULL,
              PRIMARY KEY(tenant_id, service_id, maintenance_id)
            );
            CREATE INDEX IF NOT EXISTS idx_slo_maintenance_lookup
              ON slo_maintenance(tenant_id, service_id, starts_at_epoch, ends_at_epoch);

            CREATE TABLE IF NOT EXISTS slo_telemetry(
              tenant_id TEXT NOT NULL,
              service_id TEXT NOT NULL,
              request_id TEXT NOT NULL,
              success INTEGER NOT NULL CHECK(success IN (0,1)),
              latency_ms INTEGER NOT NULL,
              event_epoch INTEGER NOT NULL,
              first_observed_epoch INTEGER NOT NULL,
              excluded_from_sli INTEGER NOT NULL CHECK(excluded_from_sli IN (0,1)),
              maintenance_id TEXT,
              PRIMARY KEY(tenant_id, service_id, request_id)
            );
            CREATE INDEX IF NOT EXISTS idx_slo_telemetry_window
              ON slo_telemetry(tenant_id, service_id, event_epoch, excluded_from_sli);

            CREATE TABLE IF NOT EXISTS slo_audit(
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
            CREATE INDEX IF NOT EXISTS idx_slo_audit_tenant_sequence
              ON slo_audit(tenant_id, sequence);
            """
        )
        self._db.commit()

    def close(self) -> None:
        self._db.close()

    # ------------------------------------------------------------------
    # Audit proof
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
            "SELECT event_sha256 FROM slo_audit WHERE tenant_id=? ORDER BY sequence DESC LIMIT 1",
            (tenant_id,),
        ).fetchone()
        previous_sha = str(previous[0]) if previous else None
        created_at = _utc(now_epoch)
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
            """INSERT INTO slo_audit(
              tenant_id,actor,event_type,target_id,payload_json,previous_sha256,
              event_sha256,created_epoch,created_at
            ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                tenant_id,
                actor,
                event_type,
                target_id,
                payload_json,
                previous_sha,
                event_sha,
                now_epoch,
                created_at,
            ),
        )
        return event_sha

    def verify_audit_chain(self, tenant_id: str) -> bool:
        try:
            tenant_id = _required_id(tenant_id, "tenant_id")
        except SLOGovernanceError:
            return False
        rows = self._db.execute(
            "SELECT * FROM slo_audit WHERE tenant_id=? ORDER BY sequence",
            (tenant_id,),
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
    # Policy / clock helpers
    # ------------------------------------------------------------------
    def _policy(self, tenant_id: str, service_id: str) -> sqlite3.Row:
        row = self._db.execute(
            "SELECT * FROM slo_policies WHERE tenant_id=? AND service_id=?",
            (tenant_id, service_id),
        ).fetchone()
        if row is None:
            raise SLOTelemetryError("SLO policy is not configured")
        return row

    def _check_clock(
        self,
        tenant_id: str,
        service_id: str,
        now_epoch: int,
        tolerance: int,
        *,
        commit: bool = True,
    ) -> int:
        row = self._db.execute(
            "SELECT last_epoch FROM slo_clock WHERE tenant_id=? AND service_id=?",
            (tenant_id, service_id),
        ).fetchone()
        last_epoch = int(row["last_epoch"]) if row is not None else now_epoch
        if now_epoch < last_epoch - tolerance:
            raise SLOTelemetryError("clock rollback exceeds configured tolerance")
        effective = max(now_epoch, last_epoch)
        self._db.execute(
            """INSERT INTO slo_clock(tenant_id,service_id,last_epoch) VALUES(?,?,?)
               ON CONFLICT(tenant_id,service_id) DO UPDATE SET
               last_epoch=max(slo_clock.last_epoch,excluded.last_epoch)""",
            (tenant_id, service_id, effective),
        )
        if commit:
            self._db.commit()
        return effective

    def define_slo(
        self,
        tenant_id: str,
        service_id: str,
        *,
        actor: str,
        authorized: bool,
        availability_target_bps: int,
        latency_threshold_ms: int,
        latency_target_bps: int,
        evaluation_window_seconds: int,
        fast_window_seconds: int,
        slow_window_seconds: int,
        fast_burn_threshold: float,
        slow_burn_threshold: float,
        min_samples: int,
        max_lateness_seconds: int,
        clock_skew_tolerance_seconds: int,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        service_id = _required_id(service_id, "service_id")
        actor = _required_id(actor, "actor")
        if authorized is not True:
            raise SLOAuthorizationError("authorized tenant administrator required")

        availability_target_bps = _integer(
            availability_target_bps, "availability_target_bps", minimum=1
        )
        latency_target_bps = _integer(latency_target_bps, "latency_target_bps", minimum=1)
        if availability_target_bps >= 10_000 or latency_target_bps >= 10_000:
            raise SLOGovernanceError("SLO targets must be below 10000 bps to define an error budget")
        latency_threshold_ms = _integer(latency_threshold_ms, "latency_threshold_ms", minimum=1)
        evaluation_window_seconds = _integer(
            evaluation_window_seconds, "evaluation_window_seconds", minimum=1
        )
        fast_window_seconds = _integer(fast_window_seconds, "fast_window_seconds", minimum=1)
        slow_window_seconds = _integer(slow_window_seconds, "slow_window_seconds", minimum=1)
        if not fast_window_seconds <= slow_window_seconds <= evaluation_window_seconds:
            raise SLOGovernanceError("SLO windows must satisfy fast <= slow <= evaluation")
        fast_burn_threshold = _number(fast_burn_threshold, "fast_burn_threshold", minimum=0.000001)
        slow_burn_threshold = _number(slow_burn_threshold, "slow_burn_threshold", minimum=0.000001)
        min_samples = _integer(min_samples, "min_samples", minimum=1)
        max_lateness_seconds = _integer(max_lateness_seconds, "max_lateness_seconds", minimum=0)
        clock_skew_tolerance_seconds = _integer(
            clock_skew_tolerance_seconds, "clock_skew_tolerance_seconds", minimum=0
        )
        now_epoch = _integer(now_epoch, "now_epoch", minimum=0)

        existing = self._db.execute(
            "SELECT * FROM slo_policies WHERE tenant_id=? AND service_id=?",
            (tenant_id, service_id),
        ).fetchone()
        if existing is not None:
            self._check_clock(
                tenant_id,
                service_id,
                now_epoch,
                int(existing["clock_skew_tolerance_seconds"]),
            )
            version = int(existing["version"]) + 1
        else:
            version = 1

        with self._db:
            self._db.execute(
                """INSERT INTO slo_policies(
                  tenant_id,service_id,version,availability_target_bps,
                  latency_threshold_ms,latency_target_bps,evaluation_window_seconds,
                  fast_window_seconds,slow_window_seconds,fast_burn_threshold,
                  slow_burn_threshold,min_samples,max_lateness_seconds,
                  clock_skew_tolerance_seconds,updated_by,updated_epoch,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(tenant_id,service_id) DO UPDATE SET
                  version=excluded.version,
                  availability_target_bps=excluded.availability_target_bps,
                  latency_threshold_ms=excluded.latency_threshold_ms,
                  latency_target_bps=excluded.latency_target_bps,
                  evaluation_window_seconds=excluded.evaluation_window_seconds,
                  fast_window_seconds=excluded.fast_window_seconds,
                  slow_window_seconds=excluded.slow_window_seconds,
                  fast_burn_threshold=excluded.fast_burn_threshold,
                  slow_burn_threshold=excluded.slow_burn_threshold,
                  min_samples=excluded.min_samples,
                  max_lateness_seconds=excluded.max_lateness_seconds,
                  clock_skew_tolerance_seconds=excluded.clock_skew_tolerance_seconds,
                  updated_by=excluded.updated_by,
                  updated_epoch=excluded.updated_epoch,
                  updated_at=excluded.updated_at""",
                (
                    tenant_id,
                    service_id,
                    version,
                    availability_target_bps,
                    latency_threshold_ms,
                    latency_target_bps,
                    evaluation_window_seconds,
                    fast_window_seconds,
                    slow_window_seconds,
                    fast_burn_threshold,
                    slow_burn_threshold,
                    min_samples,
                    max_lateness_seconds,
                    clock_skew_tolerance_seconds,
                    actor,
                    now_epoch,
                    _utc(now_epoch),
                ),
            )
            self._db.execute(
                """INSERT INTO slo_clock(tenant_id,service_id,last_epoch) VALUES(?,?,?)
                   ON CONFLICT(tenant_id,service_id) DO UPDATE SET
                   last_epoch=max(slo_clock.last_epoch,excluded.last_epoch)""",
                (tenant_id, service_id, now_epoch),
            )
            self._append_audit(
                tenant_id,
                actor=actor,
                event_type="slo.defined",
                target_id=service_id,
                payload={
                    "version": version,
                    "availability_target_bps": availability_target_bps,
                    "latency_threshold_ms": latency_threshold_ms,
                    "latency_target_bps": latency_target_bps,
                    "evaluation_window_seconds": evaluation_window_seconds,
                    "fast_window_seconds": fast_window_seconds,
                    "slow_window_seconds": slow_window_seconds,
                    "fast_burn_threshold": fast_burn_threshold,
                    "slow_burn_threshold": slow_burn_threshold,
                    "min_samples": min_samples,
                    "max_lateness_seconds": max_lateness_seconds,
                    "clock_skew_tolerance_seconds": clock_skew_tolerance_seconds,
                },
                now_epoch=now_epoch,
            )
        return {
            "tenant_id": tenant_id,
            "service_id": service_id,
            "version": version,
        }

    # ------------------------------------------------------------------
    # Maintenance exclusions
    # ------------------------------------------------------------------
    def schedule_maintenance(
        self,
        tenant_id: str,
        service_id: str,
        maintenance_id: str,
        *,
        actor: str,
        authorized: bool,
        starts_at_epoch: int,
        ends_at_epoch: int,
        reason: str,
        now_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        service_id = _required_id(service_id, "service_id")
        maintenance_id = _required_id(maintenance_id, "maintenance_id")
        actor = _required_id(actor, "actor")
        if authorized is not True:
            raise SLOAuthorizationError("authorized tenant administrator required")
        starts = _integer(starts_at_epoch, "starts_at_epoch", minimum=0)
        ends = _integer(ends_at_epoch, "ends_at_epoch", minimum=0)
        now_epoch = _integer(now_epoch, "now_epoch", minimum=0)
        if ends <= starts:
            raise SLOGovernanceError("maintenance end must follow start")
        if not isinstance(reason, str) or not reason.strip():
            raise SLOGovernanceError("maintenance reason is required")
        reason = reason.strip()
        if len(reason) > 500:
            raise SLOGovernanceError("maintenance reason exceeds maximum length")
        policy = self._policy(tenant_id, service_id)
        self._check_clock(
            tenant_id,
            service_id,
            now_epoch,
            int(policy["clock_skew_tolerance_seconds"]),
        )

        existing = self._db.execute(
            """SELECT * FROM slo_maintenance
               WHERE tenant_id=? AND service_id=? AND maintenance_id=?""",
            (tenant_id, service_id, maintenance_id),
        ).fetchone()
        if existing is not None:
            if (
                int(existing["starts_at_epoch"]) != starts
                or int(existing["ends_at_epoch"]) != ends
                or str(existing["reason"]) != reason
                or str(existing["actor"]) != actor
            ):
                raise SLOGovernanceError("maintenance_id replay parameters differ")
            return {
                "tenant_id": tenant_id,
                "service_id": service_id,
                "maintenance_id": maintenance_id,
                "replayed": True,
            }

        with self._db:
            self._db.execute(
                """INSERT INTO slo_maintenance(
                  tenant_id,service_id,maintenance_id,starts_at_epoch,ends_at_epoch,
                  reason,actor,created_epoch
                ) VALUES(?,?,?,?,?,?,?,?)""",
                (tenant_id, service_id, maintenance_id, starts, ends, reason, actor, now_epoch),
            )
            self._append_audit(
                tenant_id,
                actor=actor,
                event_type="maintenance.scheduled",
                target_id=f"{service_id}:{maintenance_id}",
                payload={
                    "starts_at_epoch": starts,
                    "ends_at_epoch": ends,
                    "reason": reason,
                },
                now_epoch=now_epoch,
            )
        return {
            "tenant_id": tenant_id,
            "service_id": service_id,
            "maintenance_id": maintenance_id,
            "replayed": False,
        }

    def _maintenance_for_event(
        self, tenant_id: str, service_id: str, event_epoch: int
    ) -> str | None:
        row = self._db.execute(
            """SELECT maintenance_id FROM slo_maintenance
               WHERE tenant_id=? AND service_id=?
                 AND starts_at_epoch<=? AND ends_at_epoch>?
               ORDER BY starts_at_epoch, maintenance_id LIMIT 1""",
            (tenant_id, service_id, event_epoch, event_epoch),
        ).fetchone()
        return str(row["maintenance_id"]) if row is not None else None

    # ------------------------------------------------------------------
    # Telemetry ingestion
    # ------------------------------------------------------------------
    def ingest(
        self,
        tenant_id: str,
        service_id: str,
        request_id: str,
        *,
        success: bool,
        latency_ms: int,
        event_epoch: int,
        observed_epoch: int,
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        service_id = _required_id(service_id, "service_id")
        request_id = _required_id(request_id, "request_id")
        if type(success) is not bool:
            raise SLOTelemetryError("success must be boolean")
        latency_ms = _integer(latency_ms, "latency_ms", minimum=0)
        event_epoch = _integer(event_epoch, "event_epoch", minimum=0)
        observed_epoch = _integer(observed_epoch, "observed_epoch", minimum=0)
        policy = self._policy(tenant_id, service_id)
        tolerance = int(policy["clock_skew_tolerance_seconds"])

        # Validate event-time trust before advancing the service clock. Rejected
        # late/future telemetry must not itself move the trusted clock forward.
        if event_epoch > observed_epoch + tolerance:
            raise SLOTelemetryError("future telemetry exceeds configured clock tolerance")
        lateness = observed_epoch - event_epoch
        if lateness > int(policy["max_lateness_seconds"]):
            raise SLOTelemetryError("late telemetry exceeds configured lateness envelope")
        self._check_clock(tenant_id, service_id, observed_epoch, tolerance)

        existing = self._db.execute(
            """SELECT * FROM slo_telemetry
               WHERE tenant_id=? AND service_id=? AND request_id=?""",
            (tenant_id, service_id, request_id),
        ).fetchone()
        if existing is not None:
            if (
                bool(existing["success"]) != success
                or int(existing["latency_ms"]) != latency_ms
                or int(existing["event_epoch"]) != event_epoch
            ):
                raise SLOTelemetryError("idempotency mismatch for request_id")
            return {
                "tenant_id": tenant_id,
                "service_id": service_id,
                "request_id": request_id,
                "excluded_from_sli": bool(existing["excluded_from_sli"]),
                "replayed": True,
            }

        maintenance_id = self._maintenance_for_event(tenant_id, service_id, event_epoch)
        excluded = maintenance_id is not None
        with self._db:
            self._db.execute(
                """INSERT INTO slo_telemetry(
                  tenant_id,service_id,request_id,success,latency_ms,event_epoch,
                  first_observed_epoch,excluded_from_sli,maintenance_id
                ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    tenant_id,
                    service_id,
                    request_id,
                    int(success),
                    latency_ms,
                    event_epoch,
                    observed_epoch,
                    int(excluded),
                    maintenance_id,
                ),
            )
            self._append_audit(
                tenant_id,
                actor="telemetry",
                event_type="telemetry.ingested",
                target_id=f"{service_id}:{request_id}",
                payload={
                    "success": success,
                    "latency_ms": latency_ms,
                    "event_epoch": event_epoch,
                    "excluded_from_sli": excluded,
                    "maintenance_id": maintenance_id,
                },
                now_epoch=observed_epoch,
            )
        return {
            "tenant_id": tenant_id,
            "service_id": service_id,
            "request_id": request_id,
            "excluded_from_sli": excluded,
            "replayed": False,
        }

    # ------------------------------------------------------------------
    # SLI / error-budget evaluation
    # ------------------------------------------------------------------
    @staticmethod
    def _bps(good: int, total: int) -> int:
        if total <= 0:
            return 0
        return int(round((good * 10_000) / total))

    @staticmethod
    def _burn_rate(good: int, total: int, target_bps: int) -> float:
        if total <= 0:
            return 0.0
        observed_bad = (total - good) / total
        allowed_bad = (10_000 - target_bps) / 10_000
        if allowed_bad <= 0:
            return float("inf") if observed_bad > 0 else 0.0
        return observed_bad / allowed_bad

    def _window_stats(
        self,
        tenant_id: str,
        service_id: str,
        *,
        now_epoch: int,
        window_seconds: int,
        latency_threshold_ms: int,
    ) -> tuple[int, int, int]:
        cutoff = now_epoch - window_seconds
        row = self._db.execute(
            """SELECT
                 count(*) AS total,
                 coalesce(sum(CASE WHEN success=1 THEN 1 ELSE 0 END),0) AS availability_good,
                 coalesce(sum(CASE WHEN latency_ms<=? THEN 1 ELSE 0 END),0) AS latency_good
               FROM slo_telemetry
               WHERE tenant_id=? AND service_id=? AND excluded_from_sli=0
                 AND event_epoch>? AND event_epoch<=?""",
            (latency_threshold_ms, tenant_id, service_id, cutoff, now_epoch),
        ).fetchone()
        return int(row["total"]), int(row["availability_good"]), int(row["latency_good"])

    def evaluate(
        self, tenant_id: str, service_id: str, *, now_epoch: int
    ) -> dict[str, Any]:
        tenant_id = _required_id(tenant_id, "tenant_id")
        service_id = _required_id(service_id, "service_id")
        now_epoch = _integer(now_epoch, "now_epoch", minimum=0)
        policy = self._policy(tenant_id, service_id)
        self._check_clock(
            tenant_id,
            service_id,
            now_epoch,
            int(policy["clock_skew_tolerance_seconds"]),
        )

        threshold = int(policy["latency_threshold_ms"])
        total, availability_good, latency_good = self._window_stats(
            tenant_id,
            service_id,
            now_epoch=now_epoch,
            window_seconds=int(policy["evaluation_window_seconds"]),
            latency_threshold_ms=threshold,
        )
        fast_total, fast_availability_good, fast_latency_good = self._window_stats(
            tenant_id,
            service_id,
            now_epoch=now_epoch,
            window_seconds=int(policy["fast_window_seconds"]),
            latency_threshold_ms=threshold,
        )
        slow_total, slow_availability_good, slow_latency_good = self._window_stats(
            tenant_id,
            service_id,
            now_epoch=now_epoch,
            window_seconds=int(policy["slow_window_seconds"]),
            latency_threshold_ms=threshold,
        )

        availability_bps = self._bps(availability_good, total)
        latency_bps = self._bps(latency_good, total)
        availability_budget = self._burn_rate(
            availability_good, total, int(policy["availability_target_bps"])
        )
        latency_budget = self._burn_rate(
            latency_good, total, int(policy["latency_target_bps"])
        )

        fast_availability_burn = self._burn_rate(
            fast_availability_good,
            fast_total,
            int(policy["availability_target_bps"]),
        )
        fast_latency_burn = self._burn_rate(
            fast_latency_good,
            fast_total,
            int(policy["latency_target_bps"]),
        )
        slow_availability_burn = self._burn_rate(
            slow_availability_good,
            slow_total,
            int(policy["availability_target_bps"]),
        )
        slow_latency_burn = self._burn_rate(
            slow_latency_good,
            slow_total,
            int(policy["latency_target_bps"]),
        )
        fast_burn = max(fast_availability_burn, fast_latency_burn)
        slow_burn = max(slow_availability_burn, slow_latency_burn)

        min_samples = int(policy["min_samples"])
        if total < min_samples or fast_total < min_samples or slow_total < min_samples:
            alert_state = "insufficient_samples"
        elif (
            fast_burn >= float(policy["fast_burn_threshold"])
            and slow_burn >= float(policy["slow_burn_threshold"])
        ):
            alert_state = "burning"
        else:
            alert_state = "healthy"

        result = {
            "tenant_id": tenant_id,
            "service_id": service_id,
            "policy_version": int(policy["version"]),
            "total_samples": total,
            "good_availability_samples": availability_good,
            "availability_bps": availability_bps,
            "latency_good_samples": latency_good,
            "latency_bps": latency_bps,
            "availability_error_budget_consumed_ratio": round(availability_budget, 6),
            "latency_error_budget_consumed_ratio": round(latency_budget, 6),
            "fast_burn_rate": round(fast_burn, 6),
            "slow_burn_rate": round(slow_burn, 6),
            "fast_window_samples": fast_total,
            "slow_window_samples": slow_total,
            "alert_state": alert_state,
        }
        with self._db:
            self._append_audit(
                tenant_id,
                actor="slo-evaluator",
                event_type="slo.evaluated",
                target_id=service_id,
                payload=result,
                now_epoch=now_epoch,
            )
        return result


__all__ = [
    "EnterpriseSLOGovernor",
    "SLOAuthorizationError",
    "SLOGovernanceError",
    "SLOTelemetryError",
]
