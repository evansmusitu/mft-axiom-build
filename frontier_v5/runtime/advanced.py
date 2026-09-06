#!/usr/bin/env python3
"""Advanced MUSITU Axiom Frontier Fabric runtime primitives.

Development-only. These primitives implement deterministic, fail-closed local
contracts for durable memory, causal/digital twins, specialist societies,
uncertainty calibration, source-quality scoring, contradiction resolution,
audit replay, governed external capability adapters, and unseen/regression
evaluation. They do not claim that an external browser, GUI, deployment,
multimodal, or model provider exists unless a verified adapter is registered.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence
import hashlib
import json
import math
import os
import tempfile

from .fabric import (
    ActionPolicy,
    Authority,
    AuthorizationError,
    FrontierError,
    GovernanceEngine,
    InstructionEnvelope,
    InstructionProvenanceFirewall,
    PolicyContext,
)


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class MemoryRecord:
    namespace: str
    key: str
    value: Any
    observed_at: str
    source: str
    confidence: float = 1.0
    tombstone: bool = False
    supersedes: str | None = None

    def __post_init__(self) -> None:
        if not self.namespace or not self.key or not self.source:
            raise ValueError("namespace, key and source are required")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be in [0,1]")

    @property
    def record_id(self) -> str:
        return _sha(asdict(self))


class DurableMemoryStore:
    """Append-only memory journal with optional atomic JSONL persistence."""

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path) if path is not None else None
        self._records: list[MemoryRecord] = []
        if self.path and self.path.exists():
            self._load()

    def _load(self) -> None:
        assert self.path is not None
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            raw = json.loads(line)
            self._records.append(MemoryRecord(**raw))

    def _persist(self) -> None:
        if self.path is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = "".join(_canonical(asdict(r)) + "\n" for r in self._records)
        fd, tmp = tempfile.mkstemp(prefix=self.path.name + ".", dir=str(self.path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def append(self, record: MemoryRecord) -> str:
        if record.supersedes and all(r.record_id != record.supersedes for r in self._records):
            raise ValueError("superseded memory record does not exist")
        self._records.append(record)
        self._persist()
        return record.record_id

    def put(self, namespace: str, key: str, value: Any, source: str, confidence: float = 1.0) -> str:
        current = self.latest(namespace, key, include_tombstone=True)
        return self.append(MemoryRecord(namespace, key, value, _utcnow(), source, confidence,
                                        supersedes=current.record_id if current else None))

    def delete(self, namespace: str, key: str, source: str) -> str:
        current = self.latest(namespace, key, include_tombstone=True)
        if current is None:
            raise KeyError(f"memory key does not exist: {namespace}/{key}")
        return self.append(MemoryRecord(namespace, key, None, _utcnow(), source, 1.0,
                                        tombstone=True, supersedes=current.record_id))

    def history(self, namespace: str, key: str) -> list[MemoryRecord]:
        return [r for r in self._records if r.namespace == namespace and r.key == key]

    def latest(self, namespace: str, key: str, include_tombstone: bool = False) -> MemoryRecord | None:
        items = self.history(namespace, key)
        if not items:
            return None
        latest = items[-1]
        if latest.tombstone and not include_tombstone:
            return None
        return latest

    def search(self, namespace: str, text: str, limit: int = 20) -> list[MemoryRecord]:
        if limit <= 0:
            return []
        needle = text.casefold()
        out = []
        latest_by_key: dict[str, MemoryRecord] = {}
        for r in self._records:
            if r.namespace == namespace:
                latest_by_key[r.key] = r
        for r in latest_by_key.values():
            if r.tombstone:
                continue
            hay = f"{r.key} {_canonical(r.value)} {r.source}".casefold()
            if needle in hay:
                out.append(r)
        return sorted(out, key=lambda r: (-r.confidence, r.observed_at, r.key), reverse=False)[:limit]

    @property
    def snapshot_sha256(self) -> str:
        return _sha([asdict(r) for r in self._records])


@dataclass(frozen=True)
class LinearEquation:
    node: str
    intercept: float = 0.0
    parents: Mapping[str, float] = field(default_factory=dict)


class CausalModel:
    """Deterministic acyclic linear structural causal model."""

    def __init__(self, equations: Sequence[LinearEquation]) -> None:
        self._eq = {e.node: e for e in equations}
        if len(self._eq) != len(equations):
            raise ValueError("duplicate causal node")
        self._order = self._topological_order()

    def _topological_order(self) -> list[str]:
        nodes = set(self._eq)
        deps = {n: set(p for p in e.parents if p in nodes) for n, e in self._eq.items()}
        order: list[str] = []
        while deps:
            ready = sorted(n for n, d in deps.items() if not d)
            if not ready:
                raise ValueError("causal graph must be acyclic")
            for n in ready:
                order.append(n)
                deps.pop(n)
            for d in deps.values():
                d.difference_update(ready)
        return order

    def simulate(self, exogenous: Mapping[str, float] | None = None,
                 interventions: Mapping[str, float] | None = None) -> dict[str, float]:
        state = {k: float(v) for k, v in (exogenous or {}).items()}
        do = {k: float(v) for k, v in (interventions or {}).items()}
        unknown = set(do) - set(self._eq)
        if unknown:
            raise ValueError("unknown intervention nodes: " + ",".join(sorted(unknown)))
        for node in self._order:
            if node in do:
                state[node] = do[node]
                continue
            eq = self._eq[node]
            value = eq.intercept
            for parent, coeff in eq.parents.items():
                if parent not in state:
                    raise ValueError(f"missing parent/exogenous value: {parent}")
                value += float(coeff) * float(state[parent])
            state[node] = value
        return state


@dataclass
class DigitalTwin:
    twin_id: str
    twin_type: str
    baseline: dict[str, float]
    model: CausalModel
    metadata: dict[str, Any] = field(default_factory=dict)

    def simulate(self, interventions: Mapping[str, float] | None = None) -> dict[str, Any]:
        result = self.model.simulate(self.baseline, interventions)
        payload = {
            "twin_id": self.twin_id,
            "twin_type": self.twin_type,
            "baseline": self.baseline,
            "interventions": dict(interventions or {}),
            "result": result,
        }
        payload["scenario_sha256"] = _sha(payload)
        return payload

    def stress_grid(self, variable: str, values: Sequence[float]) -> list[dict[str, Any]]:
        return [self.simulate({variable: float(v)}) for v in values]


@dataclass(frozen=True)
class Hypothesis:
    label: str
    probability: float
    rationale: str
    specialist: str

    def __post_init__(self) -> None:
        if not 0.0 <= self.probability <= 1.0:
            raise ValueError("probability must be in [0,1]")


@dataclass
class Specialist:
    name: str
    domains: frozenset[str]
    handler: Callable[[Mapping[str, Any]], Mapping[str, Any]]
    calibration_weight: float = 1.0

    def __post_init__(self) -> None:
        if self.calibration_weight <= 0:
            raise ValueError("calibration_weight must be positive")


class SpecialistSociety:
    def __init__(self) -> None:
        self._specialists: dict[str, Specialist] = {}

    def register(self, specialist: Specialist) -> None:
        if specialist.name in self._specialists:
            raise ValueError("duplicate specialist")
        self._specialists[specialist.name] = specialist

    def deliberate(self, domain: str, task: Mapping[str, Any]) -> dict[str, Any]:
        eligible = [s for s in self._specialists.values() if domain in s.domains]
        if not eligible:
            raise FrontierError("no specialist available for domain")
        outputs = []
        for specialist in sorted(eligible, key=lambda s: s.name):
            result = dict(specialist.handler(task))
            result["specialist"] = specialist.name
            result["calibration_weight"] = specialist.calibration_weight
            outputs.append(result)
        return {"domain": domain, "task_sha256": _sha(task), "specialist_outputs": outputs}

    @staticmethod
    def hypothesis_market(hypotheses: Sequence[Hypothesis], weights: Mapping[str, float] | None = None) -> dict[str, Any]:
        if not hypotheses:
            raise ValueError("at least one hypothesis required")
        by_label: dict[str, list[tuple[float, float]]] = {}
        for h in hypotheses:
            w = float((weights or {}).get(h.specialist, 1.0))
            if w <= 0:
                raise ValueError("hypothesis weight must be positive")
            by_label.setdefault(h.label, []).append((h.probability, w))
        scores = {
            label: sum(p * w for p, w in vals) / sum(w for _, w in vals)
            for label, vals in by_label.items()
        }
        winner = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))[0]
        return {"winner": winner[0], "probability": winner[1], "scores": scores}


class IndependentVerifier:
    @staticmethod
    def verify(result: Mapping[str, Any], invariants: Sequence[Callable[[Mapping[str, Any]], bool]]) -> dict[str, Any]:
        checks = []
        for i, invariant in enumerate(invariants):
            try:
                ok = bool(invariant(result))
            except Exception as exc:
                checks.append({"index": i, "pass": False, "error": type(exc).__name__})
            else:
                checks.append({"index": i, "pass": ok})
        passed = all(c["pass"] for c in checks)
        return {"verified": passed, "checks": checks, "result_sha256": _sha(result)}


class UncertaintyCalibrator:
    @staticmethod
    def brier(probabilities: Sequence[float], outcomes: Sequence[int]) -> float:
        if len(probabilities) != len(outcomes) or not probabilities:
            raise ValueError("equal non-empty probability/outcome sequences required")
        if any(not 0.0 <= p <= 1.0 for p in probabilities) or any(y not in (0, 1) for y in outcomes):
            raise ValueError("invalid probability or outcome")
        return sum((p - y) ** 2 for p, y in zip(probabilities, outcomes)) / len(probabilities)

    @staticmethod
    def expected_calibration_error(probabilities: Sequence[float], outcomes: Sequence[int], bins: int = 10) -> float:
        if bins <= 0:
            raise ValueError("bins must be positive")
        if len(probabilities) != len(outcomes) or not probabilities:
            raise ValueError("equal non-empty probability/outcome sequences required")
        groups: list[list[tuple[float, int]]] = [[] for _ in range(bins)]
        for p, y in zip(probabilities, outcomes):
            if not 0.0 <= p <= 1.0 or y not in (0, 1):
                raise ValueError("invalid probability or outcome")
            idx = min(int(p * bins), bins - 1)
            groups[idx].append((p, y))
        n = len(probabilities)
        ece = 0.0
        for group in groups:
            if not group:
                continue
            conf = sum(p for p, _ in group) / len(group)
            acc = sum(y for _, y in group) / len(group)
            ece += len(group) / n * abs(conf - acc)
        return ece


@dataclass(frozen=True)
class SourceProfile:
    source_id: str
    primary: bool
    independently_verifiable: bool
    recency: float
    domain_authority: float
    methodological_transparency: float
    conflict_of_interest_risk: float = 0.0


class SourceQualityScorer:
    @staticmethod
    def score(p: SourceProfile) -> float:
        values = (p.recency, p.domain_authority, p.methodological_transparency, p.conflict_of_interest_risk)
        if any(not 0.0 <= x <= 1.0 for x in values):
            raise ValueError("source quality dimensions must be in [0,1]")
        score = (
            0.20 * float(p.primary)
            + 0.15 * float(p.independently_verifiable)
            + 0.15 * p.recency
            + 0.25 * p.domain_authority
            + 0.25 * p.methodological_transparency
            - 0.20 * p.conflict_of_interest_risk
        )
        return max(0.0, min(1.0, score))


@dataclass(frozen=True)
class ClaimEvidence:
    claim: str
    value: Any
    confidence: float
    source_quality: float
    observed_at: str
    source_id: str


class ContradictionResolver:
    @staticmethod
    def resolve(items: Sequence[ClaimEvidence], minimum_margin: float = 0.05) -> dict[str, Any]:
        if len(items) < 2:
            raise ValueError("at least two evidence items required")
        if len({x.claim for x in items}) != 1:
            raise ValueError("evidence items must address the same claim")
        grouped: dict[str, list[ClaimEvidence]] = {}
        for item in items:
            if not 0 <= item.confidence <= 1 or not 0 <= item.source_quality <= 1:
                raise ValueError("confidence/source_quality must be in [0,1]")
            grouped.setdefault(_canonical(item.value), []).append(item)
        ranked = []
        for canonical_value, group in grouped.items():
            weight = sum(x.confidence * x.source_quality for x in group)
            ranked.append((weight, canonical_value, group[0].value, sorted(x.source_id for x in group)))
        ranked.sort(key=lambda x: (-x[0], x[1]))
        if len(ranked) == 1:
            return {"status": "CONSISTENT", "value": ranked[0][2], "support": ranked[0][0]}
        margin = ranked[0][0] - ranked[1][0]
        if margin < minimum_margin:
            return {"status": "UNRESOLVED", "candidates": [r[2] for r in ranked], "margin": margin}
        return {"status": "RESOLVED", "value": ranked[0][2], "margin": margin, "sources": ranked[0][3]}


class AuditReplayLedger:
    def __init__(self) -> None:
        self._events: list[dict[str, Any]] = []

    def append(self, event_type: str, payload: Mapping[str, Any], actor: str) -> str:
        if not event_type or not actor:
            raise ValueError("event_type and actor required")
        previous = self._events[-1]["event_sha256"] if self._events else None
        body = {
            "sequence": len(self._events),
            "event_type": event_type,
            "payload": dict(payload),
            "actor": actor,
            "previous_sha256": previous,
        }
        event_sha = _sha(body)
        body["event_sha256"] = event_sha
        self._events.append(body)
        return event_sha

    def verify(self) -> bool:
        prev = None
        for i, event in enumerate(self._events):
            body = dict(event)
            actual = body.pop("event_sha256", None)
            if body.get("sequence") != i or body.get("previous_sha256") != prev:
                return False
            if _sha(body) != actual:
                return False
            prev = actual
        return True

    def replay(self, reducer: Callable[[Any, Mapping[str, Any]], Any], initial: Any) -> Any:
        if not self.verify():
            raise FrontierError("audit ledger integrity failure")
        state = initial
        for event in self._events:
            state = reducer(state, event)
        return state


@dataclass(frozen=True)
class ExternalCapability:
    name: str
    domain: str
    modality: str
    action: str
    required_scopes: frozenset[str]
    verified: bool
    consequential: bool = False


class GovernedCapabilityBroker:
    """Executes only explicitly registered, verified external adapters."""

    def __init__(self) -> None:
        self._caps: dict[str, tuple[ExternalCapability, Callable[[Mapping[str, Any]], Any]]] = {}

    def register(self, cap: ExternalCapability, adapter: Callable[[Mapping[str, Any]], Any]) -> None:
        if cap.name in self._caps:
            raise ValueError("duplicate external capability")
        self._caps[cap.name] = (cap, adapter)

    def execute(self, name: str, request: Mapping[str, Any], ctx: PolicyContext,
                instruction: InstructionEnvelope) -> dict[str, Any]:
        if name not in self._caps:
            raise FrontierError("external capability is not registered")
        cap, adapter = self._caps[name]
        if not cap.verified:
            raise AuthorizationError("external capability is not verified")
        firewall = InstructionProvenanceFirewall.assess(instruction)
        if not firewall["allowed"]:
            raise AuthorizationError(firewall["reason"])
        policy = ActionPolicy(cap.action, cap.required_scopes)
        GovernanceEngine.authorize(ctx, policy)
        result = adapter(request)
        return {
            "capability": cap.name,
            "domain": cap.domain,
            "modality": cap.modality,
            "request_sha256": _sha(request),
            "result": result,
            "result_sha256": _sha(result),
        }


@dataclass(frozen=True)
class BenchmarkCase:
    case_id: str
    input: Any
    expected: Any
    tags: frozenset[str] = frozenset()


class BenchmarkHarness:
    @staticmethod
    def split(cases: Sequence[BenchmarkCase], holdout_fraction: float = 0.2,
              salt: str = "musitu-frontier-v5") -> tuple[list[BenchmarkCase], list[BenchmarkCase]]:
        if not 0.0 < holdout_fraction < 1.0:
            raise ValueError("holdout_fraction must be between 0 and 1")
        train, holdout = [], []
        threshold = int(holdout_fraction * 10_000)
        for case in cases:
            bucket = int(hashlib.sha256(f"{salt}:{case.case_id}".encode()).hexdigest()[:8], 16) % 10_000
            (holdout if bucket < threshold else train).append(case)
        if cases and (not train or not holdout):
            # Deterministic fallback for tiny suites so unseen evaluation still exists.
            ordered = sorted(cases, key=lambda c: _sha({"salt": salt, "id": c.case_id}))
            cut = max(1, min(len(ordered) - 1, round(len(ordered) * (1 - holdout_fraction))))
            train, holdout = ordered[:cut], ordered[cut:]
        return train, holdout

    @staticmethod
    def evaluate(cases: Sequence[BenchmarkCase], runner: Callable[[Any], Any],
                 scorer: Callable[[Any, Any], float]) -> dict[str, Any]:
        if not cases:
            raise ValueError("benchmark cases required")
        rows = []
        for case in cases:
            actual = runner(case.input)
            score = float(scorer(actual, case.expected))
            if not math.isfinite(score):
                raise ValueError("benchmark score must be finite")
            rows.append({"case_id": case.case_id, "score": score, "actual_sha256": _sha(actual)})
        mean = sum(r["score"] for r in rows) / len(rows)
        return {"count": len(rows), "mean_score": mean, "cases": rows, "suite_sha256": _sha(rows)}

    @staticmethod
    def regression_gate(candidate: Mapping[str, float], baseline: Mapping[str, float],
                        tolerance: float = 0.0) -> dict[str, Any]:
        missing = sorted(set(baseline) - set(candidate))
        regressions = sorted(
            k for k in baseline if k in candidate and float(candidate[k]) + tolerance < float(baseline[k])
        )
        return {"status": "PASS" if not missing and not regressions else "FAIL",
                "missing": missing, "regressions": regressions}


@dataclass(frozen=True)
class CapabilityEvidence:
    target: str
    runtime_path: str
    test_gate: str
    evidence_sha256: str
    status: str


class CapabilityStatusRegistry:
    ALLOWED = frozenset({"TARGET", "PARTIAL", "IMPLEMENTED", "VERIFIED"})

    def __init__(self, known_targets: Iterable[str]) -> None:
        self.known_targets = frozenset(known_targets)
        self._entries: dict[str, CapabilityEvidence] = {}

    def record(self, evidence: CapabilityEvidence) -> None:
        if evidence.target not in self.known_targets:
            raise ValueError("unknown capability target")
        if evidence.status not in self.ALLOWED:
            raise ValueError("invalid capability status")
        if evidence.status in {"IMPLEMENTED", "VERIFIED"} and (not evidence.runtime_path or not evidence.test_gate or len(evidence.evidence_sha256) != 64):
            raise ValueError("implemented/verified capability requires runtime, test gate and SHA-256 evidence")
        self._entries[evidence.target] = evidence

    def summary(self) -> dict[str, Any]:
        counts = {s: 0 for s in sorted(self.ALLOWED)}
        for target in self.known_targets:
            counts[self._entries.get(target, CapabilityEvidence(target, "", "", "", "TARGET")).status] += 1
        return {"total": len(self.known_targets), "counts": counts}


__all__ = [
    "AuditReplayLedger", "BenchmarkCase", "BenchmarkHarness", "CapabilityEvidence",
    "CapabilityStatusRegistry", "CausalModel", "ClaimEvidence", "ContradictionResolver",
    "DigitalTwin", "DurableMemoryStore", "ExternalCapability", "GovernedCapabilityBroker",
    "Hypothesis", "IndependentVerifier", "LinearEquation", "MemoryRecord", "SourceProfile",
    "SourceQualityScorer", "Specialist", "SpecialistSociety", "UncertaintyCalibrator",
]
