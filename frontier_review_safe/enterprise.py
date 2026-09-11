from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
from threading import RLock
from typing import Any, Mapping, Sequence
import json
import math
import time

from .core import AuthorizationDenied, FrontierSafetyError, atomic_write, canonical, parse_time, sha256


def _valid_sha256(value: str | None) -> bool:
    return bool(value) and len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


@dataclass(frozen=True)
class EnterpriseGovernanceContract:
    tenant_isolation: bool
    identity_enforced: bool
    rbac_abac_enforced: bool
    audit_enabled: bool
    retention_policy_version: str | None
    privacy_policy_version: str | None
    incident_response_version: str | None
    backup_restore_tested_at: str | None
    disaster_recovery_tested_at: str | None
    slo_version: str | None
    spend_governance_version: str | None
    migration_rollback_tested: bool
    secret_scanning: bool
    supply_chain_lock: bool
    evidence_hashes: Mapping[str, str] = field(default_factory=dict)
    require_operational_evidence: bool = False
    max_drill_age_seconds: int | None = None
    evaluated_at: str | None = None

    def readiness(self) -> dict[str, Any]:
        required = {
            "tenant_isolation": self.tenant_isolation,
            "identity_enforced": self.identity_enforced,
            "rbac_abac_enforced": self.rbac_abac_enforced,
            "audit_enabled": self.audit_enabled,
            "retention_policy_version": self.retention_policy_version,
            "privacy_policy_version": self.privacy_policy_version,
            "incident_response_version": self.incident_response_version,
            "backup_restore_tested_at": self.backup_restore_tested_at,
            "disaster_recovery_tested_at": self.disaster_recovery_tested_at,
            "slo_version": self.slo_version,
            "spend_governance_version": self.spend_governance_version,
            "migration_rollback_tested": self.migration_rollback_tested,
            "secret_scanning": self.secret_scanning,
            "supply_chain_lock": self.supply_chain_lock,
        }
        missing = [k for k, v in required.items() if v in (False, None, "")]
        drill_times: dict[str, Any] = {}
        for key in ("backup_restore_tested_at", "disaster_recovery_tested_at"):
            if required[key]:
                drill_times[key] = parse_time(str(required[key]))

        evidence_required = {
            "tenant_isolation",
            "retention",
            "backup_restore",
            "disaster_recovery",
            "incident_response",
            "slo",
            "spend_governance",
            "migration_rollback",
            "secret_scanning",
            "supply_chain",
        }
        invalid_evidence: list[str] = []
        if self.require_operational_evidence:
            for key in sorted(evidence_required):
                if not _valid_sha256(self.evidence_hashes.get(key)):
                    invalid_evidence.append(key)

        stale_drills: list[str] = []
        if self.max_drill_age_seconds is not None:
            if self.max_drill_age_seconds <= 0 or not self.evaluated_at:
                stale_drills.extend(["backup_restore_tested_at", "disaster_recovery_tested_at"])
            else:
                now = parse_time(self.evaluated_at)
                for key, when in drill_times.items():
                    age = (now - when).total_seconds()
                    if age < 0 or age > self.max_drill_age_seconds:
                        stale_drills.append(key)

        status = "PASS" if not missing and not invalid_evidence and not stale_drills else "FAIL"
        return {
            "status": status,
            "missing": sorted(missing),
            "invalid_evidence": invalid_evidence,
            "stale_drills": sorted(stale_drills),
            "contract_sha256": sha256({
                "required": required,
                "evidence_hashes": dict(sorted(self.evidence_hashes.items())),
                "require_operational_evidence": self.require_operational_evidence,
                "max_drill_age_seconds": self.max_drill_age_seconds,
                "evaluated_at": self.evaluated_at,
            }),
        }


@dataclass(frozen=True)
class TenantConfig:
    tenant_id: str
    data_region: str
    jurisdictions: tuple[str, ...]
    retention_policy_version: str
    encryption_key_id: str
    created_at: str

    def __post_init__(self) -> None:
        parse_time(self.created_at)
        if not self.tenant_id or not self.data_region or not self.jurisdictions:
            raise ValueError("tenant identity, data region and jurisdictions are required")
        if not self.retention_policy_version or not self.encryption_key_id:
            raise ValueError("retention policy and encryption-key identifiers are required")


@dataclass(frozen=True)
class BackupArtifact:
    schema: str
    created_at: str
    event_count: int
    source_fingerprint: str
    events_hash: str
    events: tuple[Mapping[str, Any], ...]
    artifact_sha256: str

    def __post_init__(self) -> None:
        parse_time(self.created_at)
        if self.event_count < 0 or self.event_count != len(self.events):
            raise ValueError("backup event count mismatch")
        for value in (self.source_fingerprint, self.events_hash, self.artifact_sha256):
            if not _valid_sha256(value):
                raise ValueError("backup hashes must be SHA-256")


class EnterpriseStateStore:
    """Local review-safe, tenant-scoped, append-only operational state.

    The store is integrity-oriented rather than an encryption layer. Payload
    confidentiality remains the responsibility of the storage/runtime boundary;
    ``encryption_key_id`` records the governing key identity without pretending
    this JSON test store encrypts data.
    """

    SCHEMA = "musitu.axiom.enterprise-state.v1"
    BACKUP_SCHEMA = "musitu.axiom.enterprise-backup.v1"

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = RLock()
        self.events: list[dict[str, Any]] = []
        if self.path.exists():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if raw.get("schema") != self.SCHEMA:
                raise FrontierSafetyError("unsupported enterprise state schema")
            self.events = list(raw.get("events") or [])
            self.verify()

    def _persist(self) -> None:
        atomic_write(self.path, canonical({"schema": self.SCHEMA, "events": self.events}))

    def verify(self) -> bool:
        previous = None
        seen_idempotency: dict[str, str] = {}
        for index, event in enumerate(self.events):
            body = dict(event)
            actual = body.pop("event_sha256", None)
            if body.get("sequence") != index:
                raise FrontierSafetyError("enterprise event sequence integrity failure")
            if body.get("previous_sha256") != previous:
                raise FrontierSafetyError("enterprise event chain integrity failure")
            parse_time(str(body.get("occurred_at") or ""))
            if sha256(body) != actual:
                raise FrontierSafetyError("enterprise event content integrity failure")
            idem = body.get("idempotency_key")
            if idem:
                old = seen_idempotency.get(str(idem))
                if old and old != actual:
                    raise FrontierSafetyError("duplicate enterprise idempotency key")
                seen_idempotency[str(idem)] = str(actual)
            previous = actual
        return True

    @property
    def fingerprint(self) -> str:
        self.verify()
        return sha256(self.events)

    def _append(
        self,
        event_type: str,
        tenant_id: str,
        data: Mapping[str, Any],
        occurred_at: str,
        *,
        idempotency_key: str | None = None,
    ) -> str:
        parse_time(occurred_at)
        if not event_type or not tenant_id:
            raise ValueError("event type and tenant are required")
        normalized = json.loads(canonical(dict(data)))
        with self._lock:
            if idempotency_key:
                for event in self.events:
                    if event.get("idempotency_key") != idempotency_key:
                        continue
                    if (
                        event.get("event_type") == event_type
                        and event.get("tenant_id") == tenant_id
                        and event.get("data") == normalized
                    ):
                        return str(event["event_sha256"])
                    raise FrontierSafetyError("enterprise idempotency conflict")
            body = {
                "sequence": len(self.events),
                "event_type": event_type,
                "tenant_id": tenant_id,
                "data": normalized,
                "occurred_at": occurred_at,
                "idempotency_key": idempotency_key,
                "previous_sha256": self.events[-1]["event_sha256"] if self.events else None,
            }
            body["event_sha256"] = sha256(body)
            self.events.append(body)
            self._persist()
            return str(body["event_sha256"])

    def tenant_config(self, tenant_id: str) -> TenantConfig | None:
        for event in reversed(self.events):
            if event.get("event_type") == "tenant.register" and event.get("tenant_id") == tenant_id:
                return TenantConfig(**event["data"])
        return None

    def register_tenant(self, config: TenantConfig, *, idempotency_key: str | None = None) -> str:
        existing = self.tenant_config(config.tenant_id)
        if existing and existing != config:
            raise FrontierSafetyError("tenant registration collision")
        return self._append(
            "tenant.register",
            config.tenant_id,
            asdict(config),
            config.created_at,
            idempotency_key=idempotency_key or f"tenant:{config.tenant_id}",
        )

    def _require_tenant(self, tenant_id: str) -> TenantConfig:
        config = self.tenant_config(tenant_id)
        if not config:
            raise AuthorizationDenied("unknown tenant")
        return config

    @staticmethod
    def _require_same_tenant(requesting_tenant_id: str, resource_tenant_id: str) -> None:
        if not requesting_tenant_id or requesting_tenant_id != resource_tenant_id:
            raise AuthorizationDenied("cross-tenant access denied")

    def put_object(
        self,
        requesting_tenant_id: str,
        resource_tenant_id: str,
        object_id: str,
        payload: Mapping[str, Any],
        *,
        created_at: str,
        retention_days: int,
        classification: str = "internal",
        idempotency_key: str | None = None,
    ) -> str:
        self._require_same_tenant(requesting_tenant_id, resource_tenant_id)
        self._require_tenant(resource_tenant_id)
        parse_time(created_at)
        if not object_id or retention_days <= 0 or not classification:
            raise ValueError("object ID, positive retention and classification are required")
        data = {
            "object_id": object_id,
            "payload": json.loads(canonical(dict(payload))),
            "created_at": created_at,
            "retention_days": int(retention_days),
            "classification": classification,
        }
        return self._append(
            "object.put", resource_tenant_id, data, created_at,
            idempotency_key=idempotency_key,
        )

    def set_legal_hold(
        self,
        requesting_tenant_id: str,
        resource_tenant_id: str,
        object_id: str,
        enabled: bool,
        *,
        occurred_at: str,
        reason: str,
    ) -> str:
        self._require_same_tenant(requesting_tenant_id, resource_tenant_id)
        self._require_tenant(resource_tenant_id)
        if not object_id or not reason:
            raise ValueError("object ID and legal-hold reason required")
        return self._append(
            "object.legal_hold",
            resource_tenant_id,
            {"object_id": object_id, "enabled": bool(enabled), "reason": reason},
            occurred_at,
        )

    def _legal_hold(self, tenant_id: str, object_id: str) -> bool:
        for event in reversed(self.events):
            if (
                event.get("event_type") == "object.legal_hold"
                and event.get("tenant_id") == tenant_id
                and event.get("data", {}).get("object_id") == object_id
            ):
                return bool(event["data"].get("enabled"))
        return False

    def _active_objects(self, tenant_id: str) -> dict[str, dict[str, Any]]:
        state: dict[str, dict[str, Any]] = {}
        for event in self.events:
            if event.get("tenant_id") != tenant_id:
                continue
            object_id = str(event.get("data", {}).get("object_id") or "")
            if not object_id:
                continue
            if event.get("event_type") == "object.put":
                state[object_id] = dict(event["data"])
            elif event.get("event_type") == "object.delete":
                state.pop(object_id, None)
        return state

    def get_object(self, requesting_tenant_id: str, resource_tenant_id: str, object_id: str) -> dict[str, Any] | None:
        self._require_same_tenant(requesting_tenant_id, resource_tenant_id)
        self._require_tenant(resource_tenant_id)
        value = self._active_objects(resource_tenant_id).get(object_id)
        return json.loads(canonical(value)) if value is not None else None

    def enforce_retention(self, tenant_id: str, *, now: str) -> dict[str, Any]:
        self._require_tenant(tenant_id)
        when = parse_time(now)
        deleted: list[str] = []
        held: list[str] = []
        for object_id, obj in sorted(self._active_objects(tenant_id).items()):
            created = parse_time(str(obj["created_at"]))
            age_days = (when - created).total_seconds() / 86400.0
            if age_days < 0 or age_days < int(obj["retention_days"]):
                continue
            if self._legal_hold(tenant_id, object_id):
                held.append(object_id)
                continue
            self._append(
                "object.delete",
                tenant_id,
                {"object_id": object_id, "reason": "retention_expired", "source_created_at": obj["created_at"]},
                now,
                idempotency_key=f"retention:{tenant_id}:{object_id}:{obj['created_at']}",
            )
            deleted.append(object_id)
        result = {"status": "PASS", "deleted": deleted, "legal_hold_preserved": held, "evaluated_at": now}
        result["evidence_sha256"] = sha256(result)
        return result

    def create_backup(self, *, created_at: str) -> BackupArtifact:
        parse_time(created_at)
        with self._lock:
            self.verify()
            events = tuple(json.loads(canonical(x)) for x in self.events)
            body = {
                "schema": self.BACKUP_SCHEMA,
                "created_at": created_at,
                "event_count": len(events),
                "source_fingerprint": sha256(events),
                "events_hash": sha256(events),
                "events": events,
            }
            return BackupArtifact(**body, artifact_sha256=sha256(body))

    @classmethod
    def verify_backup(cls, artifact: BackupArtifact) -> bool:
        body = {
            "schema": artifact.schema,
            "created_at": artifact.created_at,
            "event_count": artifact.event_count,
            "source_fingerprint": artifact.source_fingerprint,
            "events_hash": artifact.events_hash,
            "events": artifact.events,
        }
        if artifact.schema != cls.BACKUP_SCHEMA:
            raise FrontierSafetyError("unsupported enterprise backup schema")
        if artifact.event_count != len(artifact.events):
            raise FrontierSafetyError("enterprise backup count mismatch")
        if sha256(artifact.events) != artifact.events_hash or artifact.events_hash != artifact.source_fingerprint:
            raise FrontierSafetyError("enterprise backup content integrity failure")
        if sha256(body) != artifact.artifact_sha256:
            raise FrontierSafetyError("enterprise backup envelope integrity failure")
        return True

    @classmethod
    def restore_backup(cls, artifact: BackupArtifact, path: str | Path) -> "EnterpriseStateStore":
        cls.verify_backup(artifact)
        target = Path(path)
        atomic_write(target, canonical({"schema": cls.SCHEMA, "events": list(artifact.events)}))
        restored = cls(target)
        if restored.fingerprint != artifact.source_fingerprint:
            raise FrontierSafetyError("restored enterprise state differs from backup")
        return restored

    def disaster_recovery_drill(
        self,
        artifact: BackupArtifact,
        restore_path: str | Path,
        *,
        max_rpo_events: int,
        max_rto_ms: float,
    ) -> dict[str, Any]:
        if max_rpo_events < 0 or max_rto_ms <= 0:
            raise ValueError("non-negative RPO and positive RTO budgets required")
        start = time.perf_counter()
        restored = self.restore_backup(artifact, restore_path)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        rpo_events = max(0, len(self.events) - artifact.event_count)
        reasons = []
        if rpo_events > max_rpo_events:
            reasons.append("rpo_exceeded")
        if elapsed_ms > max_rto_ms:
            reasons.append("rto_exceeded")
        if restored.fingerprint != artifact.source_fingerprint:
            reasons.append("restore_fingerprint_mismatch")
        result = {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": reasons,
            "rpo_events": rpo_events,
            "rto_ms": round(elapsed_ms, 6),
            "restored_event_count": len(restored.events),
            "backup_sha256": artifact.artifact_sha256,
            "restored_fingerprint": restored.fingerprint,
        }
        result["evidence_sha256"] = sha256(result)
        return result

    INCIDENT_TRANSITIONS = {
        None: frozenset({"OPEN"}),
        "OPEN": frozenset({"ACKNOWLEDGED", "CONTAINED"}),
        "ACKNOWLEDGED": frozenset({"CONTAINED"}),
        "CONTAINED": frozenset({"RECOVERED"}),
        "RECOVERED": frozenset({"CLOSED"}),
        "CLOSED": frozenset(),
    }

    def incident_state(self, tenant_id: str, incident_id: str) -> str | None:
        for event in reversed(self.events):
            if (
                event.get("event_type") == "incident.transition"
                and event.get("tenant_id") == tenant_id
                and event.get("data", {}).get("incident_id") == incident_id
            ):
                return str(event["data"]["to_state"])
        return None

    def transition_incident(
        self,
        tenant_id: str,
        incident_id: str,
        to_state: str,
        *,
        occurred_at: str,
        severity: str,
        evidence_hash: str,
    ) -> str:
        self._require_tenant(tenant_id)
        if not incident_id or not severity or not _valid_sha256(evidence_hash):
            raise ValueError("incident identity, severity and evidence hash required")
        current = self.incident_state(tenant_id, incident_id)
        if to_state not in self.INCIDENT_TRANSITIONS.get(current, frozenset()):
            raise FrontierSafetyError(f"invalid incident transition {current!r}->{to_state!r}")
        return self._append(
            "incident.transition",
            tenant_id,
            {
                "incident_id": incident_id,
                "from_state": current,
                "to_state": to_state,
                "severity": severity,
                "evidence_hash": evidence_hash,
            },
            occurred_at,
            idempotency_key=f"incident:{tenant_id}:{incident_id}:{to_state}",
        )


@dataclass(frozen=True)
class SLOContract:
    version: str
    target_availability: float
    max_p95_latency_ms: float
    minimum_requests: int

    def __post_init__(self) -> None:
        if not self.version or not 0 < self.target_availability <= 1:
            raise ValueError("valid SLO version and availability target required")
        if self.max_p95_latency_ms <= 0 or self.minimum_requests <= 0:
            raise ValueError("positive latency and request-count targets required")


def evaluate_slo(contract: SLOContract, successes: Sequence[bool], latencies_ms: Sequence[float]) -> dict[str, Any]:
    if len(successes) != len(latencies_ms) or len(successes) < contract.minimum_requests:
        return {"status": "FAIL", "reasons": ["insufficient_or_mismatched_samples"]}
    if any((not math.isfinite(float(x)) or float(x) < 0) for x in latencies_ms):
        return {"status": "FAIL", "reasons": ["invalid_latency_sample"]}
    total = len(successes)
    success_count = sum(1 for x in successes if x)
    availability = success_count / total
    ordered = sorted(float(x) for x in latencies_ms)
    p95 = ordered[min(total - 1, max(0, math.ceil(total * 0.95) - 1))]
    allowed_error_rate = max(0.0, 1.0 - contract.target_availability)
    observed_error_rate = 1.0 - availability
    if allowed_error_rate == 0:
        budget_consumed = 0.0 if observed_error_rate == 0 else math.inf
    else:
        budget_consumed = observed_error_rate / allowed_error_rate
    reasons = []
    if availability < contract.target_availability:
        reasons.append("availability_slo_breached")
    if p95 > contract.max_p95_latency_ms:
        reasons.append("latency_slo_breached")
    result = {
        "status": "PASS" if not reasons else "FAIL",
        "reasons": reasons,
        "version": contract.version,
        "requests": total,
        "availability": availability,
        "p95_latency_ms": p95,
        "error_budget_consumed_ratio": budget_consumed,
    }
    result["evidence_sha256"] = sha256(result)
    return result


@dataclass(frozen=True)
class SpendPolicy:
    version: str
    monthly_unit_limit: float
    per_request_unit_limit: float
    concurrency_limit: int

    def __post_init__(self) -> None:
        if not self.version or self.monthly_unit_limit <= 0 or self.per_request_unit_limit <= 0 or self.concurrency_limit <= 0:
            raise ValueError("positive versioned spend limits required")


def authorize_spend(
    policy: SpendPolicy,
    *,
    month_units_used: float,
    request_units: float,
    concurrent_requests: int,
) -> dict[str, Any]:
    reasons = []
    if min(month_units_used, request_units, concurrent_requests) < 0:
        reasons.append("invalid_negative_usage")
    if request_units > policy.per_request_unit_limit:
        reasons.append("per_request_limit_exceeded")
    if month_units_used + request_units > policy.monthly_unit_limit:
        reasons.append("monthly_limit_exceeded")
    if concurrent_requests >= policy.concurrency_limit:
        reasons.append("concurrency_limit_exceeded")
    result = {
        "status": "ALLOW" if not reasons else "DENY",
        "reasons": reasons,
        "policy_version": policy.version,
        "projected_month_units": month_units_used + request_units,
        "request_units": request_units,
        "concurrent_requests": concurrent_requests,
    }
    result["evidence_sha256"] = sha256(result)
    return result


@dataclass(frozen=True)
class MigrationContract:
    migration_id: str
    from_version: str
    to_version: str
    dry_run_evidence_hash: str
    backup_artifact_hash: str
    rollback_plan_hash: str
    reversible: bool

    def validate(self) -> dict[str, Any]:
        reasons = []
        if not self.migration_id or not self.from_version or not self.to_version or self.from_version == self.to_version:
            reasons.append("invalid_migration_identity")
        for key, value in {
            "dry_run_evidence_hash": self.dry_run_evidence_hash,
            "backup_artifact_hash": self.backup_artifact_hash,
            "rollback_plan_hash": self.rollback_plan_hash,
        }.items():
            if not _valid_sha256(value):
                reasons.append(key + "_invalid")
        if not self.reversible:
            reasons.append("rollback_not_proven")
        result = {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": reasons,
            "migration_id": self.migration_id,
            "from_version": self.from_version,
            "to_version": self.to_version,
        }
        result["evidence_sha256"] = sha256(result)
        return result
