#!/usr/bin/env python3
"""Advanced MUSITU Axiom Frontier Fabric primitives.

Development-only. These deterministic components implement durable memory,
causal/digital-twin simulation, specialist-agent coordination, verification,
source quality, contradiction resolution, uncertainty calibration, governed
capability execution, benchmark splitting and longitudinal regression gates.
They do not grant external tools, credentials, or production authority.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
import hashlib
import json
import math
import statistics
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from .fabric import AuthorizationError, FrontierError, InstructionEnvelope, InstructionProvenanceFirewall


def _sha(value: Any) -> str:
    body = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(body.encode()).hexdigest()


@dataclass(frozen=True)
class MemoryRecord:
    namespace: str
    key: str
    value: Any
    observed_at: str
    source: str
    confidence: float = 1.0
    supersedes: str | None = None
    tombstone: bool = False

    def __post_init__(self) -> None:
        if not self.namespace or not self.key or not self.source:
            raise ValueError("namespace, key and source are required")
        if not (0.0 <= self.confidence <= 1.0):
            raise ValueError("confidence must be in [0,1]")

    @property
    def record_id(self) -> str:
        return _sha(asdict(self))


class DurableMemoryStore:
    """Append-only, provenance-aware in-process memory with deterministic snapshots."""

    def __init__(self) -> None:
        self._records: list[MemoryRecord] = []
        self._ids: set[str] = set()

    def put(self, record: MemoryRecord) -> str:
        rid = record.record_id
        if rid in self._ids:
            return rid
        if record.supersedes and record.supersedes not in self._ids:
            raise ValueError("superseded memory record does not exist")
        self._records.append(record)
        self._ids.add(rid)
        return rid

    def latest(self, namespace: str, key: str) -> MemoryRecord | None:
        rows = [r for r in self._records if r.namespace == namespace and r.key == key]
        if not rows:
            return None
        row = sorted(rows, key=lambda r: (r.observed_at, r.record_id))[-1]
        return None if row.tombstone else row

    def search(self, namespace: str, text: str, limit: int = 10) -> list[MemoryRecord]:
        q = text.casefold().strip()
        rows = [r for r in self._records if r.namespace == namespace and not r.tombstone]
        if q:
            rows = [r for r in rows if q in r.key.casefold() or q in str(r.value).casefold()]
        rows = sorted(rows, key=lambda r: (r.observed_at, r.record_id), reverse=True)
        return rows[: max(0, int(limit))]

    @property
    def snapshot_sha256(self) -> str:
        return _sha([asdict(r) for r in self._records])


@dataclass(frozen=True)
class LinearEquation:
    node: str
    intercept: float = 0.0
    parents: Mapping[str, float] = field(default_factory=dict)


class CausalModel:
    """Deterministic acyclic linear structural causal model.

    Interventions may target endogenous equation nodes or declared exogenous
    drivers (parents/baseline inputs). Unknown variables remain fail-closed.
    """

    def __init__(self, equations: Sequence[LinearEquation]) -> None:
        self._eq = {e.node: e for e in equations}
        if len(self._eq) != len(equations):
            raise ValueError("duplicate causal node")
        self._parents = frozenset(p for e in equations for p in e.parents)
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
        known = set(self._eq) | set(self._parents) | set(state)
        unknown = set(do) - known
        if unknown:
            raise ValueError("unknown intervention nodes: " + ",".join(sorted(unknown)))
        # Exogenous interventions override baseline/exogenous state before the
        # structural equations are evaluated. Endogenous interventions are
        # applied as standard do()-style replacements in topological order.
        for node, value in do.items():
            if node not in self._eq:
                state[node] = value
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

    def __post_init__(self) -> None:
        if not (0 <= self.probability <= 1):
            raise ValueError("hypothesis probability must be in [0,1]")


@dataclass(frozen=True)
class SpecialistResult:
    specialist: str
    answer: Any
    confidence: float
    evidence: tuple[str, ...] = ()
    veto: str | None = None

    def __post_init__(self) -> None:
        if not self.specialist:
            raise ValueError("specialist required")
        if not (0 <= self.confidence <= 1):
            raise ValueError("confidence must be in [0,1]")


class SpecialistSociety:
    """Coordinates heterogeneous specialists and preserves dissent."""

    def __init__(self, specialists: Mapping[str, Callable[[Mapping[str, Any]], SpecialistResult]]) -> None:
        if not specialists:
            raise ValueError("at least one specialist required")
        self.specialists = dict(specialists)

    def deliberate(self, task: Mapping[str, Any], selected: Sequence[str] | None = None) -> dict[str, Any]:
        names = list(selected or sorted(self.specialists))
        unknown = [n for n in names if n not in self.specialists]
        if unknown:
            raise FrontierError("unknown specialists: " + ",".join(unknown))
        results = [self.specialists[n](task) for n in names]
        vetoes = [r for r in results if r.veto]
        confidences = [r.confidence for r in results]
        payload = {
            "results": [asdict(r) for r in results],
            "vetoes": [asdict(r) for r in vetoes],
            "mean_confidence": statistics.fmean(confidences) if confidences else 0.0,
            "unresolved_dissent": len({json.dumps(r.answer, sort_keys=True, default=str) for r in results}) > 1,
        }
        payload["deliberation_sha256"] = _sha(payload)
        return payload


class IndependentVerifier:
    @staticmethod
    def verify(primary: Any, independent: Any, tolerance: float = 0.0) -> dict[str, Any]:
        if isinstance(primary, (int, float)) and isinstance(independent, (int, float)):
            delta = abs(float(primary) - float(independent))
            passed = delta <= float(tolerance)
            return {"pass": passed, "delta": delta, "tolerance": float(tolerance)}
        passed = json.dumps(primary, sort_keys=True, default=str) == json.dumps(independent, sort_keys=True, default=str)
        return {"pass": passed, "delta": None, "tolerance": None}


@dataclass(frozen=True)
class SourceScore:
    source: str
    authority: float
    recency: float
    provenance: float
    corroboration: float

    @property
    def total(self) -> float:
        vals = (self.authority, self.recency, self.provenance, self.corroboration)
        if any(v < 0 or v > 1 for v in vals):
            raise ValueError("source quality dimensions must be in [0,1]")
        return sum(vals) / len(vals)


class SourceQualityScorer:
    @staticmethod
    def score(source: str, authority: float, recency: float, provenance: float, corroboration: float) -> SourceScore:
        out = SourceScore(source, authority, recency, provenance, corroboration)
        _ = out.total
        return out


class ContradictionResolver:
    @staticmethod
    def resolve(claims: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
        if not claims:
            raise ValueError("claims required")
        normalized: dict[str, list[Mapping[str, Any]]] = {}
        for c in claims:
            if "value" not in c or "source_score" not in c:
                raise ValueError("claim value and source_score required")
            key = json.dumps(c["value"], sort_keys=True, default=str)
            normalized.setdefault(key, []).append(c)
        if len(normalized) == 1:
            winner = max(claims, key=lambda c: float(c["source_score"]))
            return {"status": "consistent", "winner": winner, "alternatives": []}
        ranked = sorted(claims, key=lambda c: float(c["source_score"]), reverse=True)
        top = ranked[0]
        runner = ranked[1]
        if float(top["source_score"]) == float(runner["source_score"]):
            return {"status": "unresolved", "winner": None, "alternatives": ranked}
        return {"status": "resolved-by-evidence-quality", "winner": top, "alternatives": ranked[1:]}


class UncertaintyCalibrator:
    """Empirical confidence calibration and fail-closed abstention."""

    @staticmethod
    def expected_calibration_error(probabilities: Sequence[float], outcomes: Sequence[int], bins: int = 10) -> float:
        if len(probabilities) != len(outcomes) or not probabilities:
            raise ValueError("aligned probabilities/outcomes required")
        if bins <= 0:
            raise ValueError("bins must be positive")
        n = len(probabilities)
        ece = 0.0
        for i in range(bins):
            lo, hi = i / bins, (i + 1) / bins
            idx = [j for j, p in enumerate(probabilities) if lo <= p <= hi if (i == bins - 1 or p < hi)]
            if not idx:
                continue
            conf = statistics.fmean(float(probabilities[j]) for j in idx)
            acc = statistics.fmean(int(outcomes[j]) for j in idx)
            ece += len(idx) / n * abs(acc - conf)
        return ece

    @staticmethod
    def decision(confidence: float, threshold: float, blockers: Sequence[str] = ()) -> dict[str, Any]:
        if not (0 <= confidence <= 1 and 0 <= threshold <= 1):
            raise ValueError("confidence/threshold must be in [0,1]")
        if blockers:
            return {"action": "ABSTAIN", "confidence": confidence, "blockers": list(blockers)}
        return {"action": "PROCEED" if confidence >= threshold else "ABSTAIN", "confidence": confidence, "blockers": []}


@dataclass(frozen=True)
class BrokerRequest:
    capability: str
    instruction: InstructionEnvelope
    authorized: bool
    verified: bool
    destructive: bool = False


class GovernedCapabilityBroker:
    """Fail-closed boundary for external model/tool/browser/artifact adapters."""

    def __init__(self, adapters: Mapping[str, Callable[[Any], Any]]) -> None:
        self.adapters = dict(adapters)

    def execute(self, req: BrokerRequest, payload: Any) -> dict[str, Any]:
        firewall = InstructionProvenanceFirewall.assess(req.instruction)
        if not firewall["allowed"]:
            raise AuthorizationError(firewall["reason"])
        if not req.authorized:
            raise AuthorizationError("capability execution not authorized")
        if not req.verified:
            raise AuthorizationError("capability adapter is not verified")
        if req.destructive and not req.instruction.consequential:
            raise AuthorizationError("destructive capability requires consequential-action envelope")
        adapter = self.adapters.get(req.capability)
        if adapter is None:
            raise FrontierError("capability adapter unavailable")
        result = adapter(payload)
        return {"capability": req.capability, "result": result, "result_sha256": _sha(result)}


@dataclass(frozen=True)
class BenchmarkCase:
    case_id: str
    input: Any
    expected: Any
    tags: tuple[str, ...] = ()


class BenchmarkHarness:
    """Deterministic sealed split and comparative scorer."""

    @staticmethod
    def sealed_split(cases: Sequence[BenchmarkCase], salt: str, holdout_fraction: float = 0.2) -> tuple[list[BenchmarkCase], list[BenchmarkCase]]:
        if not cases:
            raise ValueError("benchmark cases required")
        if not 0 < holdout_fraction < 1:
            raise ValueError("holdout_fraction must be in (0,1)")
        ranked = sorted(cases, key=lambda c: hashlib.sha256(f"{salt}:{c.case_id}".encode()).hexdigest())
        n_hold = max(1, min(len(ranked) - 1, round(len(ranked) * holdout_fraction)))
        return ranked[n_hold:], ranked[:n_hold]

    @staticmethod
    def compare(cases: Sequence[BenchmarkCase], candidate: Callable[[Any], Any], baseline: Callable[[Any], Any], scorer: Callable[[Any, Any], float]) -> dict[str, Any]:
        if not cases:
            raise ValueError("evaluation cases required")
        rows = []
        for case in cases:
            cand = candidate(case.input)
            base = baseline(case.input)
            cs = float(scorer(cand, case.expected))
            bs = float(scorer(base, case.expected))
            if not (math.isfinite(cs) and math.isfinite(bs)):
                raise ValueError("non-finite benchmark score")
            rows.append({"case_id": case.case_id, "candidate": cs, "baseline": bs})
        cmean = statistics.fmean(r["candidate"] for r in rows)
        bmean = statistics.fmean(r["baseline"] for r in rows)
        return {"candidate_mean": cmean, "baseline_mean": bmean, "delta": cmean - bmean, "rows": rows, "evaluation_sha256": _sha(rows)}


class RegressionGate:
    @staticmethod
    def compare(current: Mapping[str, float], baseline: Mapping[str, float], tolerances: Mapping[str, float] | None = None) -> dict[str, Any]:
        tolerances = dict(tolerances or {})
        missing = sorted(set(baseline) - set(current))
        regressions = {}
        for key, b in baseline.items():
            if key not in current:
                continue
            tol = float(tolerances.get(key, 0.0))
            if float(current[key]) + tol < float(b):
                regressions[key] = {"current": float(current[key]), "baseline": float(b), "tolerance": tol}
        return {"status": "PASS" if not missing and not regressions else "FAIL", "missing": missing, "regressions": regressions}


class AuditReplayLedger:
    """Hash-chained append-only audit log."""

    def __init__(self) -> None:
        self._events: list[dict[str, Any]] = []

    def append(self, event: Mapping[str, Any]) -> dict[str, Any]:
        prev = self._events[-1]["event_sha256"] if self._events else "0" * 64
        payload = {"index": len(self._events), "previous_sha256": prev, "event": dict(event)}
        payload["event_sha256"] = _sha(payload)
        self._events.append(payload)
        return dict(payload)

    def verify(self) -> bool:
        prev = "0" * 64
        for i, event in enumerate(self._events):
            if event.get("index") != i or event.get("previous_sha256") != prev:
                return False
            check = dict(event)
            digest = check.pop("event_sha256", None)
            if digest != _sha(check):
                return False
            prev = digest
        return True

    def snapshot(self) -> list[dict[str, Any]]:
        return [dict(e) for e in self._events]


__all__ = [
    "AuditReplayLedger", "BenchmarkCase", "BenchmarkHarness", "BrokerRequest", "CausalModel",
    "ContradictionResolver", "DigitalTwin", "DurableMemoryStore", "GovernedCapabilityBroker",
    "Hypothesis", "IndependentVerifier", "LinearEquation", "MemoryRecord", "RegressionGate",
    "SourceQualityScorer", "SourceScore", "SpecialistResult", "SpecialistSociety", "UncertaintyCalibrator",
]
