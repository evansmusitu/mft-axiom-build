from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Mapping, Sequence
import math
import random

from .core import FrontierSafetyError, canonical, parse_time, sha256

@dataclass(frozen=True)
class StructuralEquation:
    node: str
    intercept: float = 0.0
    linear: Mapping[str, float] = field(default_factory=dict)
    quadratic: Mapping[str, float] = field(default_factory=dict)
    noise_scale: float = 0.0

    def evaluate(self, state: Mapping[str, float], noise: float = 0.0) -> float:
        out = float(self.intercept)
        for p, c in self.linear.items():
            out += float(c) * float(state[p])
        for p, c in self.quadratic.items():
            out += float(c) * float(state[p]) ** 2
        return out + float(self.noise_scale) * float(noise)


@dataclass(frozen=True)
class CausalAssumptions:
    model_version: str
    causal_sufficiency: bool
    latent_confounding_pairs: frozenset[tuple[str, str]] = frozenset()
    positivity: bool = True
    consistency: bool = True
    transportability_domain: str | None = None
    notes: tuple[str, ...] = ()


class CausalCounterfactualModel:
    """Acyclic SCM with explicit assumption/identifiability boundaries.

    It supports nonlinear polynomial equations and common-noise counterfactuals,
    but refuses identification claims when declared assumptions do not justify
    them. This is deliberately narrower than a general causal discovery engine.
    """

    def __init__(self, equations: Sequence[StructuralEquation], assumptions: CausalAssumptions) -> None:
        self.equations = {e.node: e for e in equations}
        if not self.equations or len(self.equations) != len(equations):
            raise ValueError("unique structural equations required")
        self.assumptions = assumptions
        self.parents = {n: set(e.linear) | set(e.quadratic) for n, e in self.equations.items()}
        self.order = self._topological_order()

    def _topological_order(self) -> tuple[str, ...]:
        nodes = set(self.equations)
        deps = {n: {p for p in ps if p in nodes} for n, ps in self.parents.items()}
        order: list[str] = []
        while deps:
            ready = sorted(n for n, ps in deps.items() if not ps)
            if not ready:
                raise ValueError("causal graph contains a cycle")
            order.extend(ready)
            for n in ready:
                deps.pop(n)
            for ps in deps.values():
                ps.difference_update(ready)
        return tuple(order)

    def identification(self, treatment: str, outcome: str) -> dict[str, Any]:
        if treatment not in self.equations and all(treatment not in ps for ps in self.parents.values()):
            return {"identified": False, "reason": "unknown treatment"}
        if outcome not in self.equations:
            return {"identified": False, "reason": "unknown outcome"}
        if not self.assumptions.positivity or not self.assumptions.consistency:
            return {"identified": False, "reason": "positivity/consistency assumption not satisfied"}
        pair = tuple(sorted((treatment, outcome)))
        confounded = {tuple(sorted(x)) for x in self.assumptions.latent_confounding_pairs}
        if pair in confounded or (not self.assumptions.causal_sufficiency and confounded):
            return {"identified": False, "reason": "declared latent confounding blocks unqualified effect claim"}
        return {"identified": True, "assumptions_sha256": sha256(asdict(self.assumptions)),
                "boundary": "identified within declared SCM; not causal discovery from observational data"}

    def simulate(self, exogenous: Mapping[str, float], interventions: Mapping[str, float] | None = None,
                 noise: Mapping[str, float] | None = None) -> dict[str, float]:
        state = {k: float(v) for k, v in exogenous.items()}
        do = {k: float(v) for k, v in (interventions or {}).items()}
        unknown = set(do) - (set(self.equations) | set(state))
        if unknown:
            raise ValueError("unknown intervention: " + ",".join(sorted(unknown)))
        # Apply interventions on exogenous/root inputs immediately. Endogenous
        # equation nodes are still replaced inside the topological loop below.
        # Without this, a validated do(shock=...) on an exogenous driver was
        # silently ignored, producing false replay/stress results.
        for node, value in do.items():
            if node not in self.equations:
                state[node] = value
        for n in self.order:
            if n in do:
                state[n] = do[n]
                continue
            eq = self.equations[n]
            missing = [p for p in self.parents[n] if p not in state]
            if missing:
                raise ValueError("missing exogenous/parent values: " + ",".join(sorted(missing)))
            state[n] = eq.evaluate(state, float((noise or {}).get(n, 0.0)))
        return state

    def counterfactual(self, factual_exogenous: Mapping[str, float], intervention: Mapping[str, float],
                       outcome: str, factual_noise: Mapping[str, float] | None = None) -> dict[str, Any]:
        if len(intervention) != 1:
            raise ValueError("counterfactual currently requires exactly one intervention variable")
        treatment = next(iter(intervention))
        ident = self.identification(treatment, outcome)
        if not ident["identified"]:
            return {"status": "ABSTAIN", "reason": ident["reason"]}
        factual = self.simulate(factual_exogenous, noise=factual_noise)
        cf = self.simulate(factual_exogenous, intervention, factual_noise)
        return {"status": "OK", "factual": factual[outcome], "counterfactual": cf[outcome],
                "effect": cf[outcome] - factual[outcome], "identification": ident}

    def sensitivity(self, exogenous: Mapping[str, float], intervention_node: str, values: Sequence[float],
                    outcome: str) -> dict[str, Any]:
        ident = self.identification(intervention_node, outcome)
        if not ident["identified"]:
            return {"status": "ABSTAIN", "reason": ident["reason"]}
        rows = [{"value": float(v), "outcome": self.simulate(exogenous, {intervention_node: float(v)})[outcome]}
                for v in values]
        return {"status": "OK", "rows": rows, "range": [min(r["outcome"] for r in rows), max(r["outcome"] for r in rows)]}


@dataclass(frozen=True)
class ShockVariable:
    name: str
    mean: float
    stddev: float


class ScenarioFactory:
    @staticmethod
    def _cholesky(matrix: Sequence[Sequence[float]]) -> list[list[float]]:
        n = len(matrix)
        if n == 0 or any(len(row) != n for row in matrix):
            raise ValueError("square correlation matrix required")
        for i in range(n):
            if not math.isclose(float(matrix[i][i]), 1.0, rel_tol=0.0, abs_tol=1e-9):
                raise ValueError("correlation diagonal must equal 1")
            for j in range(n):
                value = float(matrix[i][j])
                if not math.isfinite(value) or not -1.0 <= value <= 1.0:
                    raise ValueError("correlation values must be finite and in [-1,1]")
                if not math.isclose(value, float(matrix[j][i]), rel_tol=0.0, abs_tol=1e-9):
                    raise ValueError("correlation matrix must be symmetric")
        L = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(i + 1):
                s = sum(L[i][k] * L[j][k] for k in range(j))
                if i == j:
                    value = float(matrix[i][i]) - s
                    if value <= 1e-12:
                        raise ValueError("correlation matrix must be positive definite")
                    L[i][j] = math.sqrt(value)
                else:
                    L[i][j] = (float(matrix[i][j]) - s) / L[j][j]
        return L

    @classmethod
    def correlated_paths(cls, variables: Sequence[ShockVariable], correlation: Sequence[Sequence[float]],
                         periods: int, paths: int, seed: int) -> list[list[dict[str, float]]]:
        if periods <= 0 or paths <= 0:
            raise ValueError("periods and paths must be positive")
        L = cls._cholesky(correlation)
        rng = random.Random(seed)
        out = []
        for _ in range(paths):
            path = []
            for _t in range(periods):
                z = [rng.gauss(0.0, 1.0) for _ in variables]
                corr = [sum(L[i][j] * z[j] for j in range(len(variables))) for i in range(len(variables))]
                path.append({v.name: v.mean + v.stddev * corr[i] for i, v in enumerate(variables)})
            out.append(path)
        return out

    @staticmethod
    def reverse_stress(evaluate: Callable[[Mapping[str, float]], float], candidates: Sequence[Mapping[str, float]],
                       failure_threshold: float) -> dict[str, Any]:
        failures = []
        for shock in candidates:
            score = float(evaluate(shock))
            if not math.isfinite(score):
                raise ValueError("non-finite reverse-stress score")
            if score <= failure_threshold:
                magnitude = math.sqrt(sum(float(v) ** 2 for v in shock.values()))
                failures.append((magnitude, canonical(shock), dict(shock), score))
        if not failures:
            return {"status": "NO_FAILURE_FOUND", "tested": len(candidates)}
        failures.sort(key=lambda x: (x[0], x[1]))
        return {"status": "FAILURE_FOUND", "minimal_shock": failures[0][2], "score": failures[0][3],
                "tested": len(candidates)}


@dataclass(frozen=True)
class TwinCalibration:
    calibrated_at: str
    dataset_hash: str
    metric: str
    value: float
    sample_size: int

    def __post_init__(self) -> None:
        parse_time(self.calibrated_at)
        if self.sample_size <= 0 or not math.isfinite(self.value):
            raise ValueError("valid calibration sample and metric required")


@dataclass(frozen=True)
class TwinState:
    twin_id: str
    twin_type: str
    schema_version: str
    model_version: str
    as_of: str
    max_age_seconds: int
    baseline: Mapping[str, float]
    provenance_hashes: tuple[str, ...]
    calibration: TwinCalibration

    def __post_init__(self) -> None:
        parse_time(self.as_of)
        if self.twin_type not in {"company", "portfolio", "economic"}:
            raise ValueError("unsupported twin_type")
        if self.max_age_seconds <= 0 or not self.provenance_hashes:
            raise ValueError("freshness and provenance are required")


class DigitalTwin:
    def __init__(self, state: TwinState, model: CausalCounterfactualModel) -> None:
        self.state = state
        self.model = model

    def diagnose(self, now: str) -> dict[str, Any]:
        age = (parse_time(now) - parse_time(self.state.as_of)).total_seconds()
        reasons = []
        if age < 0:
            reasons.append("state timestamp is in the future")
        if age > self.state.max_age_seconds:
            reasons.append("state is stale")
        if self.state.calibration.sample_size < 20:
            reasons.append("calibration sample too small")
        return {"healthy": not reasons, "age_seconds": age, "reasons": reasons,
                "state_sha256": sha256(asdict(self.state))}

    def simulate_path(self, shocks: Sequence[Mapping[str, float]], now: str) -> dict[str, Any]:
        diag = self.diagnose(now)
        if not diag["healthy"]:
            return {"status": "ABSTAIN", "reasons": diag["reasons"]}
        state = dict(self.state.baseline)
        rows = []
        for i, shock in enumerate(shocks):
            state = self.model.simulate(state, interventions=shock)
            rows.append({"period": i, "shock": dict(shock), "state": dict(state)})
        return {"status": "OK", "path": rows, "twin_version": self.state.model_version,
                "scenario_sha256": sha256(rows), "diagnostics": diag}