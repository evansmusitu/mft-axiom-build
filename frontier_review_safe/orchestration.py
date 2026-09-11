from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import asdict, dataclass
from queue import Empty, Queue
from threading import Thread
from typing import Any, Callable, Mapping, Sequence
import math
import statistics
import time

from .core import Abstained, Evidence, FrontierSafetyError, canonical, parse_time, sha256, utcnow


class UncertaintyCalibrator:
    @staticmethod
    def brier(probabilities: Sequence[float], outcomes: Sequence[int]) -> float:
        if len(probabilities) != len(outcomes) or not probabilities:
            raise ValueError("equal non-empty sequences required")
        if any(not 0 <= p <= 1 for p in probabilities) or any(y not in (0, 1) for y in outcomes):
            raise ValueError("invalid probability/outcome")
        return statistics.fmean((p - y) ** 2 for p, y in zip(probabilities, outcomes))

    @staticmethod
    def reliability(probabilities: Sequence[float], outcomes: Sequence[int], bins: int = 10) -> dict[str, Any]:
        if bins <= 1:
            raise ValueError("bins must exceed one")
        if len(probabilities) != len(outcomes) or not probabilities:
            raise ValueError("equal non-empty sequences required")
        groups = [[] for _ in range(bins)]
        for p, y in zip(probabilities, outcomes):
            if not 0 <= p <= 1 or y not in (0, 1):
                raise ValueError("invalid probability/outcome")
            groups[min(bins - 1, int(p * bins))].append((float(p), int(y)))
        rows, ece = [], 0.0
        for i, g in enumerate(groups):
            if not g:
                continue
            conf = statistics.fmean(p for p, _ in g)
            acc = statistics.fmean(y for _, y in g)
            gap = abs(conf - acc)
            ece += len(g) / len(probabilities) * gap
            rows.append({"bin": i, "n": len(g), "confidence": conf, "accuracy": acc, "gap": gap})
        return {"ece": ece, "brier": UncertaintyCalibrator.brier(probabilities, outcomes), "bins": rows}

    @staticmethod
    def quantile_interval(samples: Sequence[float], alpha: float = 0.05) -> tuple[float, float]:
        if not 0 < alpha < 1 or len(samples) < 2:
            raise ValueError("valid alpha and at least two samples required")
        x = sorted(float(v) for v in samples)
        lo = x[max(0, min(len(x) - 1, math.floor((alpha / 2) * (len(x) - 1))))]
        hi = x[max(0, min(len(x) - 1, math.ceil((1 - alpha / 2) * (len(x) - 1))))]
        return lo, hi

    @staticmethod
    def population_stability_index(reference: Sequence[float], current: Sequence[float], bins: int = 10) -> float:
        if not reference or not current or bins <= 1:
            raise ValueError("reference/current data required")
        combined = sorted(float(x) for x in reference)
        cuts = [combined[min(len(combined) - 1, max(0, int(i * len(combined) / bins)))] for i in range(1, bins)]
        def counts(values: Sequence[float]) -> list[float]:
            c = [0] * bins
            for v in values:
                idx = 0
                while idx < len(cuts) and float(v) > cuts[idx]:
                    idx += 1
                c[idx] += 1
            total = len(values)
            return [max(1e-6, n / total) for n in c]
        a, b = counts(reference), counts(current)
        return sum((bi - ai) * math.log(bi / ai) for ai, bi in zip(a, b))

    @staticmethod
    def selective_predict(probability: float, threshold: float, drift_psi: float = 0.0,
                           max_drift_psi: float = 0.2) -> dict[str, Any]:
        if not 0 <= probability <= 1 or not 0.5 <= threshold <= 1:
            raise ValueError("invalid probability/threshold")
        confidence = max(probability, 1 - probability)
        if drift_psi > max_drift_psi:
            return {"status": "ABSTAIN", "reason": "calibration drift exceeds limit"}
        if confidence < threshold:
            return {"status": "ABSTAIN", "reason": "confidence below selective-prediction threshold"}
        return {"status": "PREDICT", "label": int(probability >= 0.5), "confidence": confidence}


@dataclass(frozen=True)
class AbstentionContext:
    authorized: bool
    evidence_count: int
    min_evidence_count: int
    uncertainty: float
    max_uncertainty: float
    contradiction_status: str
    stale: bool
    causal_identified: bool | None
    provider_ok: bool
    evaluation_in_scope: bool


class FailClosedAbstentionPolicy:
    @staticmethod
    def decide(ctx: AbstentionContext) -> dict[str, Any]:
        reasons = []
        if not ctx.authorized: reasons.append("unauthorized")
        if ctx.evidence_count < ctx.min_evidence_count: reasons.append("insufficient_evidence")
        if ctx.uncertainty > ctx.max_uncertainty: reasons.append("excess_uncertainty")
        if ctx.contradiction_status == "UNRESOLVED": reasons.append("unresolved_contradiction")
        if ctx.stale: reasons.append("stale_data")
        if ctx.causal_identified is False: reasons.append("unsupported_causal_inference")
        if not ctx.provider_ok: reasons.append("provider_failure")
        if not ctx.evaluation_in_scope: reasons.append("outside_evaluation_boundary")
        return {"status": "ABSTAIN" if reasons else "PROCEED", "reasons": reasons}


@dataclass(frozen=True)
class ProviderState:
    name: str
    quality: float
    calibration: float
    reliability: float
    latency_ms: float
    cost_units: float
    healthy: bool
    consecutive_failures: int = 0
    circuit_open_until: str | None = None
    policy_allowed: bool = True

    def __post_init__(self) -> None:
        for x in (self.quality, self.calibration, self.reliability):
            if not 0 <= x <= 1:
                raise ValueError("quality/calibration/reliability must be in [0,1]")
        if self.latency_ms < 0 or self.cost_units < 0:
            raise ValueError("latency/cost cannot be negative")


class CostLatencyQualityRouter:
    def __init__(self, providers: Sequence[ProviderState]) -> None:
        self.providers = tuple(providers)

    def route(self, now: str, min_quality: float, max_latency_ms: float | None = None,
              max_cost_units: float | None = None) -> dict[str, Any]:
        when = parse_time(now)
        candidates = []
        for p in self.providers:
            if not p.healthy or not p.policy_allowed or p.quality < min_quality:
                continue
            if p.circuit_open_until and when < parse_time(p.circuit_open_until):
                continue
            if max_latency_ms is not None and p.latency_ms > max_latency_ms:
                continue
            if max_cost_units is not None and p.cost_units > max_cost_units:
                continue
            score = 0.45 * p.quality + 0.25 * p.calibration + 0.30 * p.reliability
            penalty = 0.00005 * p.latency_ms + 0.02 * p.cost_units + 0.03 * p.consecutive_failures
            candidates.append((score - penalty, p.name, p))
        if not candidates:
            raise Abstained("no healthy policy-allowed provider satisfies constraints")
        candidates.sort(key=lambda x: (-x[0], x[1]))
        return {"provider": candidates[0][2], "selection_score": candidates[0][0],
                "candidate_scores": [(name, score) for score, name, _ in candidates]}


@dataclass(frozen=True)
class SpecialistContract:
    name: str
    domain: str
    independent_lane: str
    timeout_seconds: float
    retries: int
    budget_units: float
    veto_on_failure: bool = False


@dataclass(frozen=True)
class SpecialistResult:
    specialist: str
    lane: str
    answer: Any
    confidence: float
    evidence_ids: tuple[str, ...]
    veto: bool = False
    dissent: str | None = None


class SpecialistSociety:
    """Bounded concurrent specialist execution with fail-closed veto semantics."""

    def __init__(self, handlers: Mapping[str, Callable[[Mapping[str, Any]], SpecialistResult]]) -> None:
        self.handlers = dict(handlers)

    def deliberate(self, contracts: Sequence[SpecialistContract], task: Mapping[str, Any],
                   total_budget_units: float) -> dict[str, Any]:
        if sum(c.budget_units for c in contracts) > total_budget_units:
            raise Abstained("specialist budget exceeded")
        if len({c.independent_lane for c in contracts}) < min(2, len(contracts)):
            raise ValueError("specialist lanes must preserve declared independence")
        outputs, failures = [], []

        def run_one(c: SpecialistContract) -> SpecialistResult:
            if c.name not in self.handlers:
                raise FrontierSafetyError("missing specialist handler")
            last: Exception | None = None
            for _attempt in range(c.retries + 1):
                q: Queue[tuple[str, Any]] = Queue(maxsize=1)
                def invoke() -> None:
                    try:
                        q.put(("ok", self.handlers[c.name](task)))
                    except BaseException as exc:
                        q.put(("err", exc))
                worker = Thread(target=invoke, daemon=True, name=f"axiom-specialist-{c.name}")
                worker.start()
                try:
                    kind, value = q.get(timeout=c.timeout_seconds)
                    if kind == "err":
                        raise value
                    result = value
                    if result.specialist != c.name or result.lane != c.independent_lane:
                        raise FrontierSafetyError("specialist identity/lane mismatch")
                    if not 0 <= result.confidence <= 1:
                        raise FrontierSafetyError("invalid specialist confidence")
                    return result
                except Empty:
                    last = FutureTimeout(f"specialist timeout: {c.name}")
                except Exception as exc:
                    last = exc
            raise FrontierSafetyError(f"specialist failed: {c.name}: {type(last).__name__ if last else 'unknown'}")

        with ThreadPoolExecutor(max_workers=max(1, len(contracts))) as pool:
            futures = [(c, pool.submit(run_one, c)) for c in contracts]
            for c, fut in futures:
                try:
                    outputs.append(fut.result())
                except Exception as exc:
                    failures.append({"specialist": c.name, "error": type(exc).__name__})
                    if c.veto_on_failure:
                        return {"status": "VETO", "reason": "required specialist failed", "failures": failures}
        if any(o.veto for o in outputs):
            return {"status": "VETO", "reason": "specialist veto", "outputs": [asdict(o) for o in outputs], "failures": failures}
        if not outputs:
            return {"status": "ABSTAIN", "reason": "no specialist result", "failures": failures}
        confidence = statistics.fmean(o.confidence for o in outputs)
        return {"status": "OK", "outputs": [asdict(o) for o in sorted(outputs, key=lambda x: x.specialist)],
                "confidence": confidence, "failures": failures, "trace_sha256": sha256([asdict(o) for o in outputs])}


@dataclass(frozen=True)
class VerificationPath:
    verifier_id: str
    method: str
    independent_provider: str | None
    check: Callable[[Mapping[str, Any]], bool]


class IndependentVerifier:
    @staticmethod
    def verify(result: Mapping[str, Any], paths: Sequence[VerificationPath], minimum_independent_paths: int = 2) -> dict[str, Any]:
        rows = []
        providers = set()
        for path in paths:
            try:
                ok = bool(path.check(result))
                err = None
            except Exception as exc:
                ok, err = False, type(exc).__name__
            rows.append({"verifier_id": path.verifier_id, "method": path.method,
                         "provider": path.independent_provider, "pass": ok, "error": err})
            if ok and path.independent_provider:
                providers.add(path.independent_provider)
        passed = all(r["pass"] for r in rows) and len(rows) >= minimum_independent_paths
        if any(p.independent_provider for p in paths):
            passed = passed and len(providers) >= 1
        return {"verified": passed, "checks": rows, "independent_providers": sorted(providers),
                "result_sha256": sha256(result), "status": "PASS" if passed else "ESCALATE"}


# ---------------------------------------------------------------------------
# Hypothesis lifecycle, benchmarks, regression, continual adaptation
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class HypothesisState:
    hypothesis_id: str
    statement: str
    probability: float
    status: str
    evidence_ids: tuple[str, ...]
    updated_at: str
    resolution_criteria: str

    def __post_init__(self) -> None:
        if not 0 <= self.probability <= 1:
            raise ValueError("probability must be in [0,1]")
        if self.status not in {"OPEN", "RESOLVED_TRUE", "RESOLVED_FALSE", "REJECTED", "UNRESOLVED"}:
            raise ValueError("invalid hypothesis status")
        parse_time(self.updated_at)


class HypothesisMarket:
    @staticmethod
    def bayes_update(prior: float, likelihood_if_true: float, likelihood_if_false: float) -> float:
        for x in (prior, likelihood_if_true, likelihood_if_false):
            if not 0 <= x <= 1:
                raise ValueError("probabilities must be in [0,1]")
        num = prior * likelihood_if_true
        den = num + (1 - prior) * likelihood_if_false
        if den == 0:
            raise ValueError("undefined Bayesian update")
        return num / den

    @staticmethod
    def update(state: HypothesisState, evidence: Evidence, likelihood_if_true: float,
               likelihood_if_false: float) -> HypothesisState:
        if state.status != "OPEN":
            raise FrontierSafetyError("resolved hypothesis cannot be silently reopened")
        p = HypothesisMarket.bayes_update(state.probability, likelihood_if_true, likelihood_if_false)
        return HypothesisState(state.hypothesis_id, state.statement, p, state.status,
                               tuple(dict.fromkeys((*state.evidence_ids, evidence.evidence_id))), utcnow(),
                               state.resolution_criteria)


# Canonical verifier export. These assignments deliberately override the legacy
# inline definitions above so every supported import path resolves to the
# provenance-backed fail-closed implementation in frontier_review_safe.verification.
from .verification import IndependentVerifier as IndependentVerifier, VerificationPath as VerificationPath
