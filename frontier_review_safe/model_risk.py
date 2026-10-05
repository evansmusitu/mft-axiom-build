from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any, Mapping
import json

from .core import FrontierSafetyError, atomic_write, canonical, parse_time, sha256, utcnow

SCHEMA = "musitu.axiom.model-risk-governance.v1"
EVENT_TYPES = frozenset({"APPROVAL", "PROMOTION", "ROLLBACK", "RETIREMENT"})


def _is_sha256(value: str | None) -> bool:
    return bool(value) and len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


@dataclass(frozen=True)
class ModelRegistration:
    model_id: str
    version: str
    purpose: str
    domains: frozenset[str]
    validation_dataset_hash: str
    evaluation_hash: str
    calibrated: bool
    approved: bool
    approval_id: str | None
    validated_at: str
    max_validation_age_seconds: int
    limitations: tuple[str, ...]
    rollback_version: str | None

    def __post_init__(self) -> None:
        parse_time(self.validated_at)
        if not self.model_id or not self.version or not self.purpose:
            raise ValueError("model identity, version and purpose required")
        if not self.domains or any(not str(x).strip() for x in self.domains):
            raise ValueError("one or more non-empty model domains required")
        if not _is_sha256(self.validation_dataset_hash) or not _is_sha256(self.evaluation_hash):
            raise ValueError("validation/evaluation hashes must be SHA-256")
        if self.max_validation_age_seconds <= 0:
            raise ValueError("positive validation freshness required")
        if self.approved and not self.approval_id:
            raise ValueError("approved registration requires approval_id")
        if self.rollback_version == self.version:
            raise ValueError("rollback_version cannot equal current version")

    @property
    def normalized(self) -> dict[str, Any]:
        return {
            "model_id": self.model_id,
            "version": self.version,
            "purpose": self.purpose,
            "domains": sorted(self.domains),
            "validation_dataset_hash": self.validation_dataset_hash,
            "evaluation_hash": self.evaluation_hash,
            "calibrated": bool(self.calibrated),
            "approved": bool(self.approved),
            "approval_id": self.approval_id,
            "validated_at": self.validated_at,
            "max_validation_age_seconds": int(self.max_validation_age_seconds),
            "limitations": list(self.limitations),
            "rollback_version": self.rollback_version,
        }

    @property
    def fingerprint(self) -> str:
        return sha256(self.normalized)

    @classmethod
    def from_normalized(cls, payload: Mapping[str, Any]) -> "ModelRegistration":
        return cls(
            model_id=str(payload["model_id"]),
            version=str(payload["version"]),
            purpose=str(payload["purpose"]),
            domains=frozenset(str(x) for x in payload["domains"]),
            validation_dataset_hash=str(payload["validation_dataset_hash"]),
            evaluation_hash=str(payload["evaluation_hash"]),
            calibrated=bool(payload["calibrated"]),
            approved=bool(payload["approved"]),
            approval_id=(str(payload["approval_id"]) if payload.get("approval_id") is not None else None),
            validated_at=str(payload["validated_at"]),
            max_validation_age_seconds=int(payload["max_validation_age_seconds"]),
            limitations=tuple(str(x) for x in payload.get("limitations", ())),
            rollback_version=(str(payload["rollback_version"]) if payload.get("rollback_version") is not None else None),
        )


class ModelRiskGovernance:
    """Durable model-risk registry with replayable approval and release history.

    The legacy in-memory API remains valid: ``ModelRiskGovernance()``, ``register``
    and ``authorize_use``. Supplying a path adds durable state. A model can be
    authorized without an active-version pointer for backward compatibility, but
    once a version is promoted all other versions of that model fail closed until
    an explicit promotion or rollback changes the active pointer.
    """

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else None
        self._models: dict[tuple[str, str], ModelRegistration] = {}
        self._events: list[dict[str, Any]] = []
        self._lock = RLock()
        if self.path and self.path.exists():
            self._load()

    def _load(self) -> None:
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        if raw.get("schema") != SCHEMA:
            raise FrontierSafetyError("unsupported model-risk schema")
        models: dict[tuple[str, str], ModelRegistration] = {}
        for row in raw.get("models", []):
            body = dict(row)
            expected = body.pop("_fingerprint", None)
            model = ModelRegistration.from_normalized(body)
            if not expected or expected != model.fingerprint:
                raise FrontierSafetyError("model registration integrity failure")
            key = (model.model_id, model.version)
            if key in models:
                raise FrontierSafetyError("duplicate persisted model registration")
            models[key] = model
        self._models = models
        self._events = list(raw.get("events", []))
        self.verify()

    def _persist(self) -> None:
        if not self.path:
            return
        payload = {
            "schema": SCHEMA,
            "models": [
                {**model.normalized, "_fingerprint": model.fingerprint}
                for model in sorted(self._models.values(), key=lambda x: (x.model_id, x.version))
            ],
            "events": self._events,
        }
        atomic_write(self.path, canonical(payload))

    def register(self, model: ModelRegistration) -> str:
        with self._lock:
            key = (model.model_id, model.version)
            old = self._models.get(key)
            if old and old != model:
                raise FrontierSafetyError("model registration collision")
            if model.rollback_version and (model.model_id, model.rollback_version) not in self._models:
                raise FrontierSafetyError("rollback version must already be registered")
            self._models[key] = model
            self._persist()
            return model.fingerprint

    def _append_event(
        self,
        event_type: str,
        model_id: str,
        version: str,
        payload: Mapping[str, Any],
        occurred_at: str,
    ) -> str:
        if event_type not in EVENT_TYPES:
            raise ValueError("unsupported model-risk event type")
        parse_time(occurred_at)
        if (model_id, version) not in self._models:
            raise FrontierSafetyError("model-risk event references unregistered version")
        body = {
            "sequence": len(self._events),
            "event_type": event_type,
            "model_id": model_id,
            "version": version,
            "occurred_at": occurred_at,
            "payload": dict(payload),
            "previous_sha256": self._events[-1]["event_sha256"] if self._events else None,
        }
        body["event_sha256"] = sha256(body)
        self._events.append(body)
        self._persist()
        return body["event_sha256"]

    def _events_for(self, model_id: str, version: str | None = None) -> list[dict[str, Any]]:
        return [
            event for event in self._events
            if event.get("model_id") == model_id and (version is None or event.get("version") == version)
        ]

    def _effective_approval(self, model: ModelRegistration) -> tuple[bool, str | None, str | None]:
        approved = bool(model.approved)
        approval_id = model.approval_id
        approval_event_hash: str | None = None
        for event in self._events_for(model.model_id, model.version):
            if event["event_type"] == "APPROVAL":
                approved = bool(event["payload"]["approved"])
                approval_id = event["payload"].get("approval_id")
                approval_event_hash = event["event_sha256"]
        return approved, approval_id, approval_event_hash

    def _retired(self, model_id: str, version: str) -> bool:
        return any(event["event_type"] == "RETIREMENT" for event in self._events_for(model_id, version))

    def active_version(self, model_id: str) -> str | None:
        active: str | None = None
        for event in self._events_for(model_id):
            if event["event_type"] in {"PROMOTION", "ROLLBACK"}:
                active = str(event["version"])
        return active

    def record_approval(
        self,
        model_id: str,
        version: str,
        *,
        approved: bool,
        approver_id: str,
        approval_id: str | None,
        evidence_hash: str,
        occurred_at: str | None = None,
    ) -> str:
        if not approver_id or not _is_sha256(evidence_hash):
            raise ValueError("approver and SHA-256 approval evidence required")
        if approved and not approval_id:
            raise ValueError("positive approval requires approval_id")
        with self._lock:
            return self._append_event(
                "APPROVAL",
                model_id,
                version,
                {
                    "approved": bool(approved),
                    "approver_id": approver_id,
                    "approval_id": approval_id,
                    "evidence_hash": evidence_hash,
                },
                occurred_at or utcnow(),
            )

    def authorize_use(
        self,
        model_id: str,
        version: str,
        domain: str,
        at: str,
        *,
        high_consequence: bool,
    ) -> dict[str, Any]:
        when = parse_time(at)
        with self._lock:
            model = self._models.get((model_id, version))
            if not model:
                return {"status": "ABSTAIN", "reasons": ["unregistered_model"]}
            reasons: list[str] = []
            age = (when - parse_time(model.validated_at)).total_seconds()
            if age < 0 or age > model.max_validation_age_seconds:
                reasons.append("model_validation_stale")
            if domain not in model.domains:
                reasons.append("domain_out_of_scope")
            if self._retired(model_id, version):
                reasons.append("model_retired")
            active = self.active_version(model_id)
            if active is not None and active != version:
                reasons.append("model_version_not_active")
            approved, approval_id, approval_event_hash = self._effective_approval(model)
            if high_consequence and not approved:
                reasons.append("model_not_approved")
            if high_consequence and not approval_id:
                reasons.append("approval_provenance_missing")
            if high_consequence and not model.calibrated:
                reasons.append("model_not_calibrated")
            return {
                "status": "PASS" if not reasons else "ABSTAIN",
                "reasons": sorted(set(reasons)),
                "model_fingerprint": model.fingerprint,
                "approval_id": approval_id,
                "approval_event_sha256": approval_event_hash,
                "active_version": active,
                "limitations": list(model.limitations),
            }

    def promote(
        self,
        model_id: str,
        version: str,
        domain: str,
        at: str,
        *,
        actor_id: str,
        promotion_evidence_hash: str,
    ) -> str:
        if not actor_id or not _is_sha256(promotion_evidence_hash):
            raise ValueError("actor and SHA-256 promotion evidence required")
        with self._lock:
            auth = self.authorize_use(model_id, version, domain, at, high_consequence=True)
            blockers = [reason for reason in auth["reasons"] if reason != "model_version_not_active"]
            if blockers:
                raise FrontierSafetyError("model promotion blocked: " + ",".join(blockers))
            if (model_id, version) not in self._models:
                raise FrontierSafetyError("model promotion blocked: unregistered_model")
            previous_active = self.active_version(model_id)
            return self._append_event(
                "PROMOTION",
                model_id,
                version,
                {
                    "actor_id": actor_id,
                    "promotion_evidence_hash": promotion_evidence_hash,
                    "previous_active_version": previous_active,
                    "domain": domain,
                },
                at,
            )

    def rollback(
        self,
        model_id: str,
        at: str,
        *,
        actor_id: str,
        reason_hash: str,
    ) -> str:
        if not actor_id or not _is_sha256(reason_hash):
            raise ValueError("actor and SHA-256 rollback reason required")
        with self._lock:
            current = self.active_version(model_id)
            if current is None:
                raise FrontierSafetyError("no active version to roll back")
            current_model = self._models[(model_id, current)]
            target = current_model.rollback_version
            if not target or (model_id, target) not in self._models:
                raise FrontierSafetyError("no registered rollback target")
            target_model = self._models[(model_id, target)]
            approved, approval_id, _ = self._effective_approval(target_model)
            if self._retired(model_id, target) or not approved or not approval_id:
                raise FrontierSafetyError("rollback target is not operationally approved")
            return self._append_event(
                "ROLLBACK",
                model_id,
                target,
                {
                    "actor_id": actor_id,
                    "reason_hash": reason_hash,
                    "rolled_back_from": current,
                },
                at,
            )

    def retire(
        self,
        model_id: str,
        version: str,
        *,
        actor_id: str,
        reason_hash: str,
        occurred_at: str | None = None,
    ) -> str:
        if not actor_id or not _is_sha256(reason_hash):
            raise ValueError("actor and SHA-256 retirement reason required")
        with self._lock:
            if self.active_version(model_id) == version:
                raise FrontierSafetyError("active model cannot be retired before replacement/rollback")
            return self._append_event(
                "RETIREMENT",
                model_id,
                version,
                {"actor_id": actor_id, "reason_hash": reason_hash},
                occurred_at or utcnow(),
            )

    def history(self, model_id: str, version: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(event) for event in self._events_for(model_id, version)]

    def verify(self) -> bool:
        with self._lock:
            previous = None
            for i, event in enumerate(self._events):
                body = dict(event)
                actual = body.pop("event_sha256", None)
                if body.get("sequence") != i or body.get("previous_sha256") != previous:
                    raise FrontierSafetyError("model-risk event sequence integrity failure")
                if body.get("event_type") not in EVENT_TYPES:
                    raise FrontierSafetyError("unknown model-risk event type")
                key = (str(body.get("model_id")), str(body.get("version")))
                if key not in self._models:
                    raise FrontierSafetyError("model-risk event references unknown registration")
                parse_time(str(body.get("occurred_at")))
                if sha256(body) != actual:
                    raise FrontierSafetyError("model-risk event integrity failure")
                previous = actual
            for model in self._models.values():
                if model.rollback_version and (model.model_id, model.rollback_version) not in self._models:
                    raise FrontierSafetyError("registered rollback target missing")
            return True

    @property
    def fingerprint(self) -> str:
        with self._lock:
            self.verify()
            return sha256({
                "models": sorted((m.model_id, m.version, m.fingerprint) for m in self._models.values()),
                "events": [event["event_sha256"] for event in self._events],
            })
