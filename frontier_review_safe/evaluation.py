from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from threading import RLock
from typing import Any, Mapping, Sequence
import hashlib
import hmac
import json
import math
import random
import statistics

from .core import FrontierSafetyError, atomic_write, canonical, parse_time, sha256, utcnow


def _valid_sha256(value: str) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(c in "0123456789abcdef" for c in value.lower())
    )


@dataclass(frozen=True)
class SealedCaseResult:
    case_fingerprint: str
    score: float
    latency_ms: float | None = None
    cost_units: float | None = None

    def __post_init__(self) -> None:
        if not _valid_sha256(self.case_fingerprint):
            raise ValueError("sealed case fingerprint must be SHA-256")
        if not math.isfinite(float(self.score)):
            raise ValueError("sealed case score must be finite")
        for name, value in (("latency_ms", self.latency_ms), ("cost_units", self.cost_units)):
            if value is not None and (not math.isfinite(float(value)) or float(value) < 0.0):
                raise ValueError(f"sealed case {name} must be finite and non-negative")


class SealedEvaluation:
    """Evaluator-side integrity helpers. The secret must never be committed with cases."""

    @staticmethod
    def case_fingerprint(case_payload: Any, evaluator_secret: bytes) -> str:
        if len(evaluator_secret) < 16:
            raise ValueError("evaluator secret too short")
        return hmac.new(evaluator_secret, canonical(case_payload).encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def suite_hash(case_fingerprints: Sequence[str], constraint_hash: str) -> str:
        if not case_fingerprints or not _valid_sha256(constraint_hash):
            raise ValueError("sealed fingerprints and constraint hash required")
        if any(not _valid_sha256(value) for value in case_fingerprints):
            raise ValueError("sealed case fingerprints must be SHA-256")
        if len(case_fingerprints) != len(set(case_fingerprints)):
            raise ValueError("duplicate sealed case fingerprints are forbidden")
        return sha256({"cases": list(case_fingerprints), "constraint_hash": constraint_hash})

    @staticmethod
    def paired_comparison(candidate: Sequence[SealedCaseResult], baseline: Sequence[SealedCaseResult],
                          confidence: float = 0.95, bootstrap_samples: int = 4000) -> dict[str, Any]:
        if not 0.0 < float(confidence) < 1.0:
            raise ValueError("comparison confidence must be between zero and one")
        if not isinstance(bootstrap_samples, int) or isinstance(bootstrap_samples, bool) or bootstrap_samples <= 0:
            raise ValueError("bootstrap_samples must be a positive integer")
        candidate_ids = [x.case_fingerprint for x in candidate]
        baseline_ids = [x.case_fingerprint for x in baseline]
        if len(candidate_ids) != len(set(candidate_ids)) or len(baseline_ids) != len(set(baseline_ids)):
            raise ValueError("duplicate paired sealed cases are forbidden")
        b = {x.case_fingerprint: x for x in baseline}
        pairs = [(x.score, b[x.case_fingerprint].score) for x in candidate if x.case_fingerprint in b]
        if len(pairs) < 5:
            raise ValueError("at least five matched sealed cases required")
        deltas = [a - z for a, z in pairs]
        if any(not math.isfinite(float(delta)) for delta in deltas):
            raise ValueError("paired comparison deltas must be finite")
        mean = statistics.fmean(deltas)
        seed = int(hashlib.sha256(canonical(sorted(deltas)).encode()).hexdigest()[:16], 16)
        rng = random.Random(seed)
        boots = []
        for _ in range(bootstrap_samples):
            boots.append(statistics.fmean(deltas[rng.randrange(len(deltas))] for _ in deltas))
        boots.sort()
        alpha = 1 - confidence
        lo = boots[max(0, min(len(boots) - 1, int((alpha / 2) * len(boots))))]
        hi = boots[max(0, min(len(boots) - 1, int((1 - alpha / 2) * len(boots)) - 1))]
        wins = sum(1 for d in deltas if d > 0)
        return {"matched_cases": len(pairs), "mean_delta": mean, "bootstrap_ci": [lo, hi],
                "candidate_wins": wins, "baseline_wins": sum(1 for d in deltas if d < 0),
                "ties": sum(1 for d in deltas if d == 0), "statistically_positive": lo > 0}


@dataclass(frozen=True)
class FailureRecord:
    failure_id: str
    case_hash: str
    category: str
    observed_at: str
    candidate_version: str
    remediation_version: str | None = None
    resolved: bool = False

    def __post_init__(self) -> None:
        if any(not isinstance(value, str) or not value.strip()
               for value in (self.failure_id, self.category, self.candidate_version)):
            raise ValueError("complete failure identity required")
        if not _valid_sha256(self.case_hash):
            raise ValueError("failure case hash must be SHA-256")
        parse_time(self.observed_at)
        if self.remediation_version is not None and not self.remediation_version.strip():
            raise ValueError("remediation version must be non-empty when supplied")
        if self.resolved and self.remediation_version is None:
            raise ValueError("resolved failure requires remediation version")


class FailureCorpus:
    SCHEMA = "musitu.axiom.failure-corpus.v2"

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = RLock()
        self.records: dict[str, FailureRecord] = {}
        if self.path.exists():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if raw.get("schema") != self.SCHEMA:
                raise FrontierSafetyError("unsupported failure corpus schema")
            self.records = {x["failure_id"]: FailureRecord(**x) for x in raw.get("records", [])}

    def _persist(self) -> None:
        atomic_write(self.path, canonical({"schema": self.SCHEMA,
                                          "records": [asdict(x) for x in sorted(self.records.values(), key=lambda r: r.failure_id)]}))

    def add(self, record: FailureRecord) -> None:
        with self._lock:
            if record.failure_id in self.records and self.records[record.failure_id] != record:
                raise FrontierSafetyError("failure record collision")
            self.records[record.failure_id] = record
            self._persist()

    def resolve(self, failure_id: str, remediation_version: str) -> None:
        with self._lock:
            old = self.records[failure_id]
            self.records[failure_id] = FailureRecord(old.failure_id, old.case_hash, old.category, old.observed_at,
                                                     old.candidate_version, remediation_version, True)
            self._persist()

    def unresolved(self) -> list[FailureRecord]:
        return sorted((x for x in self.records.values() if not x.resolved), key=lambda x: x.failure_id)


@dataclass(frozen=True)
class AdaptationRelease:
    version: str
    parent_version: str | None
    failure_corpus_hash: str
    calibration_hash: str
    routing_policy_hash: str
    eval_hash: str
    rollback_to: str | None

    def __post_init__(self) -> None:
        if not isinstance(self.version, str) or not self.version.strip():
            raise ValueError("adaptation version required")
        for value in (self.failure_corpus_hash, self.calibration_hash, self.routing_policy_hash, self.eval_hash):
            if not _valid_sha256(value):
                raise ValueError("adaptation evidence hashes must be SHA-256")
        for name, value in (("parent_version", self.parent_version), ("rollback_to", self.rollback_to)):
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ValueError(f"{name} must be non-empty when supplied")
        if self.parent_version == self.version or self.rollback_to == self.version:
            raise ValueError("adaptation cannot parent or roll back to itself")


class ContinualAdaptationRegistry:
    """Versioned non-weight adaptation ledger; does not claim model-weight learning."""

    def __init__(self) -> None:
        self.releases: dict[str, AdaptationRelease] = {}
        self.active_version: str | None = None

    def promote(self, release: AdaptationRelease, regression_pass: bool) -> None:
        if not regression_pass:
            raise FrontierSafetyError("adaptation promotion blocked by regression gate")
        if release.version in self.releases:
            raise FrontierSafetyError("adaptation version collision")
        if release.parent_version != self.active_version:
            raise FrontierSafetyError("adaptation parent is not active version")
        self.releases[release.version] = release
        self.active_version = release.version

    def rollback(self) -> str:
        if self.active_version is None:
            raise FrontierSafetyError("no active adaptation")
        current = self.releases[self.active_version]
        target = current.rollback_to or current.parent_version
        if target is None or target not in self.releases:
            raise FrontierSafetyError("no valid rollback target")
        self.active_version = target
        return target


class RegressionProtection:
    @staticmethod
    def gate(candidate: Mapping[str, float], baseline: Mapping[str, float],
             tolerances: Mapping[str, float] | None = None) -> dict[str, Any]:
        missing = sorted(set(baseline) - set(candidate))
        regressed: list[str] = []
        invalid: list[str] = []
        for k, base in baseline.items():
            if k not in candidate:
                continue
            try:
                base_value = float(base)
                candidate_value = float(candidate[k])
                tol = float((tolerances or {}).get(k, 0.0))
            except (TypeError, ValueError):
                invalid.append(k)
                continue
            if not all(math.isfinite(value) for value in (base_value, candidate_value, tol)) or tol < 0.0:
                invalid.append(k)
                continue
            if candidate_value + tol < base_value:
                regressed.append(k)
        return {"status": "PASS" if not missing and not regressed and not invalid else "FAIL", "missing": missing,
                "regressions": sorted(regressed), "invalid_metrics": sorted(set(invalid))}


# ---------------------------------------------------------------------------
# Durable proof/decision ledger and end-to-end gate contract
# ---------------------------------------------------------------------------

class DecisionProvenanceLedger:
    SCHEMA = "musitu.axiom.decision-ledger.v2"

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path else None
        self._lock = RLock()
        self.events: list[dict[str, Any]] = []
        if self.path and self.path.exists():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if raw.get("schema") != self.SCHEMA:
                raise FrontierSafetyError("unsupported ledger schema")
            self.events = list(raw.get("events", []))
            self.verify()

    def _persist(self) -> None:
        if self.path:
            atomic_write(self.path, canonical({"schema": self.SCHEMA, "events": self.events}))

    def append(self, event_type: str, actor: str, payload: Mapping[str, Any], *,
               request_id: str, policy_version: str, code_version: str,
               input_hashes: Sequence[str], model_version: str | None = None,
               tool_versions: Mapping[str, str] | None = None) -> str:
        if any(not isinstance(value, str) or not value.strip()
               for value in (event_type, actor, request_id, policy_version, code_version)):
            raise ValueError("complete decision provenance required")
        if any(not _valid_sha256(value) for value in input_hashes):
            raise ValueError("decision input hashes must be SHA-256")
        with self._lock:
            idempotency_body = {"event_type": event_type, "actor": actor, "request_id": request_id,
                                "policy_version": policy_version, "code_version": code_version,
                                "model_version": model_version, "tool_versions": dict(tool_versions or {}),
                                "input_hashes": list(input_hashes), "payload": dict(payload)}
            idem_hash = sha256(idempotency_body)
            for event in self.events:
                if event.get("request_id") == request_id and event.get("event_type") == event_type:
                    if event.get("idempotency_sha256") == idem_hash:
                        return event["event_sha256"]
                    raise FrontierSafetyError("replay/idempotency conflict for request_id")
            body = {"sequence": len(self.events), **idempotency_body, "idempotency_sha256": idem_hash,
                    "executed_at": utcnow(),
                    "previous_sha256": self.events[-1]["event_sha256"] if self.events else None}
            body["event_sha256"] = sha256(body)
            self.events.append(body)
            self._persist()
            return body["event_sha256"]

    def verify(self) -> bool:
        prev = None
        for i, event in enumerate(self.events):
            body = dict(event)
            actual = body.pop("event_sha256", None)
            if body.get("sequence") != i or body.get("previous_sha256") != prev or sha256(body) != actual:
                raise FrontierSafetyError("decision ledger integrity failure")
            prev = actual
        return True

    @property
    def fingerprint(self) -> str:
        self.verify()
        return sha256(self.events)


@dataclass(frozen=True)
class ProofEnvelope:
    request_hash: str
    evidence_hashes: tuple[str, ...]
    assumptions: tuple[str, ...]
    method: str
    result_hash: str
    uncertainty: Mapping[str, Any]
    verification: Mapping[str, Any]
    authorization: Mapping[str, Any]
    lineage_hash: str
    decision_event_hash: str
    code_version: str
    policy_version: str
    created_at: str

    def __post_init__(self) -> None:
        parse_time(self.created_at)
        for value in (self.request_hash, self.result_hash, self.lineage_hash, self.decision_event_hash):
            if not _valid_sha256(value):
                raise ValueError("proof hashes must be SHA-256 hex")
        if any(not _valid_sha256(value) for value in self.evidence_hashes):
            raise ValueError("proof evidence hashes must be SHA-256 hex")
        if not self.evidence_hashes or not self.method or not self.assumptions:
            raise ValueError("proof evidence, method and assumptions required")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))
