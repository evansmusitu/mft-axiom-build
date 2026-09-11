from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import asdict, dataclass
from queue import Empty, Queue
from threading import Thread
from typing import Any, Callable, Mapping, Sequence
import math
import statistics

from .core import Abstained, FrontierSafetyError, parse_time, sha256


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
        for i, group in enumerate(groups):
            if not group:
                continue
            confidence = statistics.fmean(p for p, _ in group)
            accuracy = statistics.fmean(y for _, y in group)
            gap = abs(confidence - accuracy)
            ece += len(group) / len(probabilities) * gap
            rows.append({"bin": i, "n": len(group), "confidence": confidence, "accuracy": accuracy, "gap": gap})
        return {"ece": ece, "brier": UncertaintyCalibrator.brier(probabilities, outcomes), "bins": rows}

    @staticmethod
    def quantile_interval(samples: Sequence[float], alpha: float = 0.05) -> tuple[float, float]:
        if not 0 < alpha < 1 or len(samples) < 2:
            raise ValueError("valid alpha and at least two samples required")
        values = sorted(float(v) for v in samples)
        low = values[max(0, min(len(values) - 1, math.floor((alpha / 2) * (len(values) - 1))))]
        high = values[max(0, min(len(values) - 1, math.ceil((1 - alpha / 2) * (len(values) - 1))))]
        return low, high

    @staticmethod
    def population_stability_index(reference: Sequence[float], current: Sequence[float], bins: int = 10) -> float:
        if not reference or not current or bins <= 1:
            raise ValueError("reference/current data required")
        combined = sorted(float(x) for x in reference)
        cuts = [combined[min(len(combined) - 1, max(0, int(i * len(combined) / bins)))] for i in range(1, bins)]

        def counts(values: Sequence[float]) -> list[float]:
            bucket_counts = [0] * bins
            for value in values:
                idx = 0
                while idx < len(cuts) and float(value) > cuts[idx]:
                    idx += 1
                bucket_counts[idx] += 1
            total = len(values)
            return [max(1e-6, n / total) for n in bucket_counts]

        reference_counts, current_counts = counts(reference), counts(current)
        return sum((b - a) * math.log(b / a) for a, b in zip(reference_counts, current_counts))

    @staticmethod
    def selective_predict(
        probability: float,
        threshold: float,
        drift_psi: float = 0.0,
        max_drift_psi: float = 0.2,
    ) -> dict[str, Any]:
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
        if not ctx.authorized:
            reasons.append("unauthorized")
        if ctx.evidence_count < ctx.min_evidence_count:
            reasons.append("insufficient_evidence")
        if ctx.uncertainty > ctx.max_uncertainty:
            reasons.append("excess_uncertainty")
        if ctx.contradiction_status == "UNRESOLVED":
            reasons.append("unresolved_contradiction")
        if ctx.stale:
            reasons.append("stale_data")
        if ctx.causal_identified is False:
            reasons.append("unsupported_causal_inference")
        if not ctx.provider_ok:
            reasons.append("provider_failure")
        if not ctx.evaluation_in_scope:
            reasons.append("outside_evaluation_boundary")
        return {"status": "ABSTAIN" if reasons else "PROCEED", "reasons": reasons}


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

    def deliberate(
        self,
        contracts: Sequence[SpecialistContract],
        task: Mapping[str, Any],
        total_budget_units: float,
    ) -> dict[str, Any]:
        if sum(c.budget_units for c in contracts) > total_budget_units:
            raise Abstained("specialist budget exceeded")
        if len({c.independent_lane for c in contracts}) < min(2, len(contracts)):
            raise ValueError("specialist lanes must preserve declared independence")
        outputs: list[SpecialistResult] = []
        failures: list[dict[str, str]] = []

        def run_one(contract: SpecialistContract) -> SpecialistResult:
            if contract.name not in self.handlers:
                raise FrontierSafetyError("missing specialist handler")
            last: Exception | None = None
            for _attempt in range(contract.retries + 1):
                queue: Queue[tuple[str, Any]] = Queue(maxsize=1)

                def invoke() -> None:
                    try:
                        queue.put(("ok", self.handlers[contract.name](task)))
                    except BaseException as exc:
                        queue.put(("err", exc))

                worker = Thread(target=invoke, daemon=True, name=f"axiom-specialist-{contract.name}")
                worker.start()
                try:
                    kind, value = queue.get(timeout=contract.timeout_seconds)
                    if kind == "err":
                        raise value
                    result = value
                    if result.specialist != contract.name or result.lane != contract.independent_lane:
                        raise FrontierSafetyError("specialist identity/lane mismatch")
                    if not 0 <= result.confidence <= 1:
                        raise FrontierSafetyError("invalid specialist confidence")
                    return result
                except Empty:
                    last = FutureTimeout(f"specialist timeout: {contract.name}")
                except Exception as exc:
                    last = exc
            raise FrontierSafetyError(
                f"specialist failed: {contract.name}: {type(last).__name__ if last else 'unknown'}"
            )

        with ThreadPoolExecutor(max_workers=max(1, len(contracts))) as pool:
            futures = [(contract, pool.submit(run_one, contract)) for contract in contracts]
            for contract, future in futures:
                try:
                    outputs.append(future.result())
                except Exception as exc:
                    failures.append({"specialist": contract.name, "error": type(exc).__name__})
                    if contract.veto_on_failure:
                        return {"status": "VETO", "reason": "required specialist failed", "failures": failures}
        if any(output.veto for output in outputs):
            return {
                "status": "VETO",
                "reason": "specialist veto",
                "outputs": [asdict(output) for output in outputs],
                "failures": failures,
            }
        if not outputs:
            return {"status": "ABSTAIN", "reason": "no specialist result", "failures": failures}
        confidence = statistics.fmean(output.confidence for output in outputs)
        ordered = sorted(outputs, key=lambda x: x.specialist)
        return {
            "status": "OK",
            "outputs": [asdict(output) for output in ordered],
            "confidence": confidence,
            "failures": failures,
            "trace_sha256": sha256([asdict(output) for output in ordered]),
        }


# Compatibility facade: all stateful/high-consequence primitives are implemented
# exactly once in their canonical hardened modules.
from .routing import CostLatencyQualityRouter as CostLatencyQualityRouter, ProviderState as ProviderState
from .verification import IndependentVerifier as IndependentVerifier, VerificationPath as VerificationPath
from .hypothesis_market import HypothesisMarket as HypothesisMarket, HypothesisState as HypothesisState
