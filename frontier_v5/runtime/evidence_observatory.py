#!/usr/bin/env python3
"""Fail-closed Phase-13 Evidence Observatory and Trust Center substrate.

This module creates an append-only, hash-linked public-read evaluation ledger,
machine-readable trust documentation, downloadable evidence bundles, and an
explicit claim-authorization view.  It intentionally cannot authenticate an
external reviewer or turn repository-local assertions into independent
evidence.  Phase 13 therefore remains unearned until a separately authenticated
review is bound to the exact candidate outside this candidate-under-test.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence
import hashlib
import json
import re


class EvidenceObservatoryError(RuntimeError):
    """Base error for malformed, mutable, or over-claimed evidence."""


class ImmutableHistoryViolation(EvidenceObservatoryError):
    """Raised when an append-only identity would be overwritten."""


class ClaimBoundaryViolation(EvidenceObservatoryError):
    """Raised when local material attempts to authorize an external claim."""


PUBLICATION_MODE = "PUBLIC_READ_STATIC_LEDGER_AND_EXPORT_PREVIEW_NO_DEPLOYMENT_CLAIM"
HISTORY_POLICY = "APPEND_ONLY_SHA256_LINKED_NO_DELETE_OR_OVERWRITE"
FAILURE_POLICY = "FAILED_RETIRED_AND_CONTAMINATED_RESULTS_REMAIN_VISIBLE"
CLAIM_POLICY = "FAIL_CLOSED_NO_SELF_ATTESTED_EXTERNAL_OR_SUPERIORITY_CLAIMS"
REVIEW_POLICY = "AUTHENTICATED_INDEPENDENT_REVIEW_REQUIRED_OUTSIDE_CANDIDATE"
ALLOWED_STATUSES = frozenset({"PASS", "FAIL", "NOT_RUN", "RETIRED", "CONTAMINATED"})
ALLOWED_CLAIM_CLASSES = frozenset({
    "LOCAL_FUNCTIONAL_QUALIFICATION",
    "EXTERNAL_COMPARATIVE",
    "GLOBAL_SUPERIORITY",
    "PRODUCTION_SECURITY_CERTIFICATION",
    "WCAG_CONFORMANCE_CERTIFICATION",
})
EXTERNAL_CLAIM_CLASSES = ALLOWED_CLAIM_CLASSES - {"LOCAL_FUNCTIONAL_QUALIFICATION"}
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_SECRET_RX = re.compile(
    r"(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)\s*[:=]"
    r"|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}|\bbearer\s+[A-Za-z0-9._~-]{12,}", re.I
)


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required(value: Any, label: str, limit: int = 500) -> str:
    text = str(value if value is not None else "").replace("\x00", " ").strip()[:limit]
    if not text:
        raise EvidenceObservatoryError(f"{label} required")
    return text


def _sha_value(value: Any, label: str, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    text = _required(value, label, 64).lower()
    if not _HEX64.fullmatch(text):
        raise EvidenceObservatoryError(f"{label} must be a lowercase SHA-256 digest")
    return text


def _safe(value: Any, label: str) -> None:
    if _SECRET_RX.search(_canonical(value)):
        raise EvidenceObservatoryError(f"{label} contains secret-like material")


def _sequence(value: Any, label: str, *, allow_empty: bool = False) -> list[Any]:
    if isinstance(value, (str, bytes, bytearray)) or not isinstance(value, Sequence):
        raise EvidenceObservatoryError(f"{label} must be a sequence")
    rows = list(value)
    if not allow_empty and not rows:
        raise EvidenceObservatoryError(f"{label} cannot be empty")
    return rows


def _timestamp(value: Any, label: str) -> str:
    text = _required(value, label, 80)
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise EvidenceObservatoryError(f"{label} must be ISO-8601") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise EvidenceObservatoryError(f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat()


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EvidenceObservatoryError(f"{label} must be numeric")
    result = float(value)
    if not 0.0 <= result <= 1.0:
        raise EvidenceObservatoryError(f"{label} must be between 0 and 1")
    return result


class EvidenceObservatoryLedger:
    """Append-only reference ledger for the Phase-13 public-read surface."""

    def __init__(self, *, ledger_id: str) -> None:
        self.ledger_id = _required(ledger_id, "ledger_id", 180)
        self.definitions: dict[str, dict[str, Any]] = {}
        self.evaluations: dict[str, dict[str, Any]] = {}
        self.events: list[dict[str, Any]] = []

    def _event(self, kind: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        body = {
            "schema": "musitu.axiom.evidence-observatory-event.v1",
            "event_id": f"observatory-event:{len(self.events)}",
            "sequence": len(self.events),
            "ledger_id": self.ledger_id,
            "kind": _required(kind, "event kind", 100),
            "payload": deepcopy(dict(payload)),
            "created_at": _now(),
            "previous_event_sha256": self.events[-1]["event_sha256"] if self.events else None,
        }
        row = {**body, "event_sha256": _sha(body)}
        self.events.append(row)
        return deepcopy(row)

    def register_definition(
        self,
        *,
        definition_id: str,
        name: str,
        methodology: str,
        metrics: Sequence[str],
        source_sha256: str,
    ) -> dict[str, Any]:
        definition_id = _required(definition_id, "definition_id", 180)
        if definition_id in self.definitions:
            raise ImmutableHistoryViolation("evaluation definition identity already exists")
        metrics_list = [_required(item, "metric", 100) for item in _sequence(metrics, "metrics")]
        if len(metrics_list) != len(set(metrics_list)):
            raise EvidenceObservatoryError("metrics must be unique")
        body = {
            "schema": "musitu.axiom.evaluation-definition.v1",
            "definition_id": definition_id,
            "name": _required(name, "definition name", 200),
            "methodology": _required(methodology, "methodology", 5000),
            "metrics": metrics_list,
            "source_sha256": _sha_value(source_sha256, "definition source_sha256"),
            "registered_at": _now(),
            "history_policy": HISTORY_POLICY,
        }
        _safe(body, "evaluation definition")
        row = {**body, "definition_sha256": _sha(body)}
        self.definitions[definition_id] = row
        self._event("DEFINITION_PUBLISHED", {"definition_id": definition_id, "definition_sha256": row["definition_sha256"]})
        return deepcopy(row)

    @staticmethod
    def _baseline(raw: Mapping[str, Any], index: int) -> dict[str, Any]:
        if not isinstance(raw, Mapping):
            raise EvidenceObservatoryError(f"baseline[{index}] must be an object")
        allowed = {"provider", "system", "version", "evidence_status", "results_sha256", "external_origin_authenticated"}
        if set(raw) - allowed:
            raise EvidenceObservatoryError(f"baseline[{index}] contains unsupported fields")
        status = _required(raw.get("evidence_status"), f"baseline[{index}].evidence_status", 80)
        authenticated = raw.get("external_origin_authenticated")
        if type(authenticated) is not bool:
            raise EvidenceObservatoryError(f"baseline[{index}].external_origin_authenticated must be boolean")
        version = _required(raw.get("version"), f"baseline[{index}].version", 180)
        results = _sha_value(raw.get("results_sha256"), f"baseline[{index}].results_sha256", nullable=True)
        if status == "AUTHENTICATED_EXTERNAL_RUN":
            if version == "NOT_CAPTURED" or results is None or authenticated is not True:
                raise ClaimBoundaryViolation("authenticated external baseline requires version, results digest and authenticated origin")
        elif authenticated or results is not None:
            raise ClaimBoundaryViolation("non-authenticated baseline cannot carry authenticated results")
        return {
            "provider": _required(raw.get("provider"), f"baseline[{index}].provider", 180),
            "system": _required(raw.get("system"), f"baseline[{index}].system", 180),
            "version": version,
            "evidence_status": status,
            "results_sha256": results,
            "external_origin_authenticated": authenticated,
        }

    @staticmethod
    def _intervals(raw: Mapping[str, Any]) -> dict[str, dict[str, float]]:
        if not isinstance(raw, Mapping):
            raise EvidenceObservatoryError("confidence_intervals must be an object")
        result: dict[str, dict[str, float]] = {}
        for name, interval in raw.items():
            if not isinstance(interval, Mapping) or set(interval) != {"low", "high", "level"}:
                raise EvidenceObservatoryError(f"confidence interval {name} must contain low/high/level")
            low = _number(interval["low"], f"{name}.low")
            high = _number(interval["high"], f"{name}.high")
            level = _number(interval["level"], f"{name}.level")
            if low > high:
                raise EvidenceObservatoryError(f"confidence interval {name} is inverted")
            result[_required(name, "confidence interval name", 100)] = {"low": low, "high": high, "level": level}
        return result

    def publish_evaluation(
        self,
        *,
        evaluation_id: str,
        definition_id: str,
        candidate_version: str,
        baseline_versions: Sequence[Mapping[str, Any]],
        sealed_test_identities: Sequence[str],
        evaluation_date: str,
        environment: Mapping[str, Any],
        failures: Sequence[Mapping[str, Any]],
        scores: Mapping[str, Any],
        confidence_intervals: Mapping[str, Any],
        external_attestations: Sequence[Mapping[str, Any]],
        status: str,
        evidence_artifact_digests: Sequence[str],
    ) -> dict[str, Any]:
        evaluation_id = _required(evaluation_id, "evaluation_id", 180)
        if evaluation_id in self.evaluations:
            raise ImmutableHistoryViolation("evaluation identity already exists")
        definition_id = _required(definition_id, "definition_id", 180)
        definition = self.definitions.get(definition_id)
        if definition is None:
            raise EvidenceObservatoryError("registered evaluation definition required")
        status = _required(status, "evaluation status", 40).upper()
        if status not in ALLOWED_STATUSES:
            raise EvidenceObservatoryError("evaluation status is invalid")
        baselines = [self._baseline(raw, index) for index, raw in enumerate(_sequence(baseline_versions, "baseline_versions"))]
        sealed = [_sha_value(value, "sealed test identity") for value in _sequence(sealed_test_identities, "sealed_test_identities", allow_empty=status == "NOT_RUN")]
        artifacts = [_sha_value(value, "evidence artifact digest") for value in _sequence(evidence_artifact_digests, "evidence_artifact_digests", allow_empty=status != "PASS")]
        if not isinstance(environment, Mapping) or not environment:
            raise EvidenceObservatoryError("environment must be a non-empty object")
        if not isinstance(scores, Mapping):
            raise EvidenceObservatoryError("scores must be an object")
        normalized_scores = {_required(name, "score name", 100): _number(value, f"score {name}") for name, value in scores.items()}
        normalized_failures: list[dict[str, str]] = []
        for index, raw in enumerate(_sequence(failures, "failures", allow_empty=True)):
            if not isinstance(raw, Mapping):
                raise EvidenceObservatoryError(f"failure[{index}] must be an object")
            normalized_failures.append({
                "failure_id": _required(raw.get("failure_id"), f"failure[{index}].failure_id", 180),
                "summary": _required(raw.get("summary"), f"failure[{index}].summary", 1000),
                "status": _required(raw.get("status"), f"failure[{index}].status", 80),
            })
        attestations = list(_sequence(external_attestations, "external_attestations", allow_empty=True))
        if attestations:
            raise ClaimBoundaryViolation("repository-local publication cannot authenticate external attestations")
        if status == "PASS" and not artifacts:
            raise EvidenceObservatoryError("passing evaluation requires evidence artifact digests")
        if status in {"FAIL", "CONTAMINATED"} and not normalized_failures:
            raise EvidenceObservatoryError("failed or contaminated evaluation must retain failure details")
        body = {
            "schema": "musitu.axiom.public-evaluation-ledger-entry.v1",
            "ledger_id": self.ledger_id,
            "evaluation_id": evaluation_id,
            "definition_id": definition_id,
            "definition_sha256": definition["definition_sha256"],
            "candidate_version": _required(candidate_version, "candidate_version", 180),
            "baseline_versions": baselines,
            "sealed_test_identities": sealed,
            "evaluation_date": _timestamp(evaluation_date, "evaluation_date"),
            "environment": deepcopy(dict(environment)),
            "methodology": definition["methodology"],
            "failures": normalized_failures,
            "scores": normalized_scores,
            "confidence_intervals": self._intervals(confidence_intervals),
            "external_attestations": [],
            "evidence_artifact_digests": artifacts,
            "status": status,
            "published_at": _now(),
            "history_policy": HISTORY_POLICY,
            "failure_policy": FAILURE_POLICY,
            "claim_policy": CLAIM_POLICY,
        }
        _safe(body, "evaluation ledger entry")
        row = {**body, "entry_sha256": _sha(body)}
        self.evaluations[evaluation_id] = row
        self._event("EVALUATION_PUBLISHED", {"evaluation_id": evaluation_id, "entry_sha256": row["entry_sha256"], "status": status})
        return deepcopy(row)

    def append_lifecycle_status(self, *, evaluation_id: str, status: str, reason: str) -> dict[str, Any]:
        if evaluation_id not in self.evaluations:
            raise EvidenceObservatoryError("evaluation not found")
        status = _required(status, "lifecycle status", 40).upper()
        if status not in {"RETIRED", "CONTAMINATED"}:
            raise EvidenceObservatoryError("only retired or contaminated lifecycle events are appendable")
        return self._event("EVALUATION_STATUS_APPENDED", {
            "evaluation_id": evaluation_id,
            "status": status,
            "reason": _required(reason, "lifecycle reason", 1000),
            "original_entry_sha256": self.evaluations[evaluation_id]["entry_sha256"],
        })

    def claim_authorization(self, *, evaluation_id: str, claim_class: str) -> dict[str, Any]:
        evaluation = self.evaluations.get(_required(evaluation_id, "evaluation_id", 180))
        if evaluation is None:
            raise EvidenceObservatoryError("evaluation not found")
        claim_class = _required(claim_class, "claim_class", 100).upper()
        if claim_class not in ALLOWED_CLAIM_CLASSES:
            raise EvidenceObservatoryError("claim class is invalid")
        lifecycle = [event for event in self.events if event["kind"] == "EVALUATION_STATUS_APPENDED" and event["payload"].get("evaluation_id") == evaluation_id]
        disqualified = any(event["payload"].get("status") in {"RETIRED", "CONTAMINATED"} for event in lifecycle)
        local_ready = evaluation["status"] == "PASS" and bool(evaluation["evidence_artifact_digests"]) and not disqualified
        external = claim_class in EXTERNAL_CLAIM_CLASSES
        authorized = local_ready and not external
        blockers: list[str] = []
        if not local_ready:
            blockers.append("exact passing non-retired evaluation evidence required")
        if external:
            blockers.extend([
                "authenticated external origin required",
                "independent review required",
                "candidate-local ledger cannot self-authorize this claim class",
            ])
        return {
            "schema": "musitu.axiom.claim-authorization-display.v1",
            "evaluation_id": evaluation_id,
            "entry_sha256": evaluation["entry_sha256"],
            "claim_class": claim_class,
            "authorized": authorized,
            "status": "AUTHORIZED_LOCAL_SCOPE" if authorized else "BLOCKED",
            "blockers": blockers,
            "claim_policy": CLAIM_POLICY,
            "independent_review_complete": False,
            "global_superiority_claim_allowed": False,
        }

    def verify(self) -> dict[str, Any]:
        errors: list[str] = []
        for key, row in self.definitions.items():
            body = {name: value for name, value in row.items() if name != "definition_sha256"}
            if _sha(body) != row["definition_sha256"]:
                errors.append(f"definition_hash:{key}")
        for key, row in self.evaluations.items():
            body = {name: value for name, value in row.items() if name != "entry_sha256"}
            if _sha(body) != row["entry_sha256"]:
                errors.append(f"evaluation_hash:{key}")
        previous = None
        for index, row in enumerate(self.events):
            body = {name: value for name, value in row.items() if name != "event_sha256"}
            if row["sequence"] != index or row["previous_event_sha256"] != previous or _sha(body) != row["event_sha256"]:
                errors.append(f"event_chain:{index}")
            previous = row["event_sha256"]
        return {
            "schema": "musitu.axiom.evidence-observatory-integrity.v1",
            "status": "FAIL" if errors else "PASS",
            "errors": sorted(set(errors)),
            "definition_count": len(self.definitions),
            "evaluation_count": len(self.evaluations),
            "event_count": len(self.events),
            "history_policy": HISTORY_POLICY,
        }

    def public_snapshot(self) -> dict[str, Any]:
        integrity = self.verify()
        body = {
            "schema": "musitu.axiom.evidence-observatory-public-snapshot.v1",
            "ledger_id": self.ledger_id,
            "publication_mode": PUBLICATION_MODE,
            "definitions": [deepcopy(self.definitions[key]) for key in sorted(self.definitions)],
            "evaluations": [deepcopy(self.evaluations[key]) for key in sorted(self.evaluations)],
            "events": deepcopy(self.events),
            "integrity": integrity,
            "failed_evaluations_visible": True,
            "retired_and_contaminated_history_visible": True,
            "external_attestations_authenticated": False,
            "global_superiority_claim_allowed": False,
        }
        return {**body, "snapshot_sha256": _sha(body)}

    def independent_review_packet(self, *, trust_documents: Mapping[str, str]) -> dict[str, Any]:
        if not isinstance(trust_documents, Mapping) or not trust_documents:
            raise EvidenceObservatoryError("trust documents required")
        document_digests = {
            _required(name, "trust document name", 120): _sha(_required(text, f"trust document {name}", 50000))
            for name, text in trust_documents.items()
        }
        snapshot = self.public_snapshot()
        body = {
            "schema": "musitu.axiom.phase13-independent-review-packet.v1",
            "ledger_id": self.ledger_id,
            "snapshot_sha256": snapshot["snapshot_sha256"],
            "ledger_event_root_sha256": self.events[-1]["event_sha256"] if self.events else None,
            "trust_document_digests": document_digests,
            "claim_policy": CLAIM_POLICY,
            "review_policy": REVIEW_POLICY,
            "review_status": "AWAITING_AUTHENTICATED_INDEPENDENT_REVIEW",
            "independent_review_complete": False,
            "phase13_earned": False,
            "global_superiority_claim_allowed": False,
        }
        return {**body, "review_packet_sha256": _sha(body)}


__all__ = [
    "ALLOWED_CLAIM_CLASSES",
    "ClaimBoundaryViolation",
    "EvidenceObservatoryError",
    "EvidenceObservatoryLedger",
    "FAILURE_POLICY",
    "HISTORY_POLICY",
    "ImmutableHistoryViolation",
    "PUBLICATION_MODE",
    "REVIEW_POLICY",
]
