from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Mapping, Sequence
import math
import random

from .core import FrontierSafetyError, canonical, sha256

SCHEMA = "musitu.axiom.scenario-engine.v1"


@dataclass(frozen=True)
class ShockVariable:
    name: str
    mean: float
    stddev: float
    distribution: str = "normal"
    persistence: float = 0.0
    lower_bound: float | None = None
    upper_bound: float | None = None
    degrees_of_freedom: float = 5.0

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("shock variable name required")
        for label, value in (("mean", self.mean), ("stddev", self.stddev), ("persistence", self.persistence)):
            if not math.isfinite(float(value)):
                raise ValueError(f"{label} must be finite")
        if self.stddev < 0:
            raise ValueError("stddev cannot be negative")
        if not -0.999 <= self.persistence <= 0.999:
            raise ValueError("persistence must be in [-0.999,0.999]")
        if self.distribution not in {"normal", "student_t", "lognormal"}:
            raise ValueError("unsupported shock distribution")
        if self.distribution == "student_t" and self.degrees_of_freedom <= 2:
            raise ValueError("student_t degrees_of_freedom must exceed 2")
        if self.lower_bound is not None and not math.isfinite(float(self.lower_bound)):
            raise ValueError("lower_bound must be finite")
        if self.upper_bound is not None and not math.isfinite(float(self.upper_bound)):
            raise ValueError("upper_bound must be finite")
        if self.lower_bound is not None and self.upper_bound is not None and self.lower_bound > self.upper_bound:
            raise ValueError("lower_bound cannot exceed upper_bound")


@dataclass(frozen=True)
class ShockDependency:
    target: str
    driver: str
    coefficient: float
    lag: int = 0

    def __post_init__(self) -> None:
        if not self.target or not self.driver or self.target == self.driver:
            raise ValueError("dependency requires distinct target and driver")
        if not math.isfinite(float(self.coefficient)):
            raise ValueError("dependency coefficient must be finite")
        if self.lag not in {0, 1}:
            raise ValueError("only contemporaneous or one-period lag dependencies are supported")


@dataclass(frozen=True)
class ScenarioConstraint:
    constraint_id: str
    coefficients: Mapping[str, float]
    minimum: float | None = None
    maximum: float | None = None

    def __post_init__(self) -> None:
        if not self.constraint_id or not self.coefficients:
            raise ValueError("constraint identity and coefficients required")
        if self.minimum is None and self.maximum is None:
            raise ValueError("constraint requires minimum and/or maximum")
        if self.minimum is not None and self.maximum is not None and self.minimum > self.maximum:
            raise ValueError("constraint minimum cannot exceed maximum")
        if any(not math.isfinite(float(value)) for value in self.coefficients.values()):
            raise ValueError("constraint coefficients must be finite")

    def evaluate(self, row: Mapping[str, float]) -> dict[str, Any]:
        missing = sorted(set(self.coefficients) - set(row))
        if missing:
            return {"status": "FAIL", "constraint_id": self.constraint_id, "reason": "missing_variables", "missing": missing}
        value = sum(float(weight) * float(row[name]) for name, weight in self.coefficients.items())
        ok = math.isfinite(value)
        if self.minimum is not None:
            ok = ok and value >= self.minimum
        if self.maximum is not None:
            ok = ok and value <= self.maximum
        return {"status": "PASS" if ok else "FAIL", "constraint_id": self.constraint_id, "value": value,
                "minimum": self.minimum, "maximum": self.maximum}


@dataclass(frozen=True)
class ScenarioContract:
    scenario_id: str
    version: str
    variables: tuple[ShockVariable, ...]
    correlation: tuple[tuple[float, ...], ...]
    periods: int
    seed: int
    dependencies: tuple[ShockDependency, ...] = ()
    constraints: tuple[ScenarioConstraint, ...] = ()
    scheduled_shocks: Mapping[int, Mapping[str, float]] = field(default_factory=dict)
    provenance_hashes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.scenario_id or not self.version:
            raise ValueError("scenario identity and version required")
        if self.periods <= 0 or not self.variables:
            raise ValueError("positive periods and variables required")
        names = [variable.name for variable in self.variables]
        if len(names) != len(set(names)):
            raise ValueError("scenario variable names must be unique")
        if len(self.correlation) != len(self.variables):
            raise ValueError("correlation dimensions must match variables")
        known = set(names)
        for dependency in self.dependencies:
            if dependency.target not in known or dependency.driver not in known:
                raise ValueError("dependency references unknown variable")
        for period, shocks in self.scheduled_shocks.items():
            if int(period) < 0 or int(period) >= self.periods:
                raise ValueError("scheduled shock period out of range")
            if set(shocks) - known:
                raise ValueError("scheduled shock references unknown variable")
            if any(not math.isfinite(float(value)) for value in shocks.values()):
                raise ValueError("scheduled shock values must be finite")
        for value in self.provenance_hashes:
            if len(value) != 64:
                raise ValueError("scenario provenance must use SHA-256 hashes")

    @property
    def fingerprint(self) -> str:
        return sha256({
            "schema": SCHEMA,
            "scenario_id": self.scenario_id,
            "version": self.version,
            "variables": [asdict(v) for v in self.variables],
            "correlation": [list(row) for row in self.correlation],
            "periods": self.periods,
            "seed": self.seed,
            "dependencies": [asdict(d) for d in self.dependencies],
            "constraints": [asdict(c) for c in self.constraints],
            "scheduled_shocks": {str(k): dict(v) for k, v in sorted(self.scheduled_shocks.items())},
            "provenance_hashes": list(self.provenance_hashes),
        })


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
        lower = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(i + 1):
                subtotal = sum(lower[i][k] * lower[j][k] for k in range(j))
                if i == j:
                    value = float(matrix[i][i]) - subtotal
                    if value <= 1e-12:
                        raise ValueError("correlation matrix must be positive definite")
                    lower[i][j] = math.sqrt(value)
                else:
                    lower[i][j] = (float(matrix[i][j]) - subtotal) / lower[j][j]
        return lower

    @staticmethod
    def _innovation(variable: ShockVariable, correlated_normal: float, rng: random.Random) -> float:
        if variable.distribution == "normal":
            standardized = correlated_normal
        elif variable.distribution == "student_t":
            chi2 = rng.gammavariate(variable.degrees_of_freedom / 2.0, 2.0)
            standardized = correlated_normal / math.sqrt(chi2 / variable.degrees_of_freedom)
            standardized *= math.sqrt((variable.degrees_of_freedom - 2.0) / variable.degrees_of_freedom)
        else:  # lognormal, centered to keep ``mean`` interpretable as an additive location
            standardized = math.exp(correlated_normal - 0.5) - 1.0
        value = variable.mean + variable.stddev * standardized
        if variable.lower_bound is not None:
            value = max(float(variable.lower_bound), value)
        if variable.upper_bound is not None:
            value = min(float(variable.upper_bound), value)
        return value

    @staticmethod
    def _dependency_order(variables: Sequence[ShockVariable], dependencies: Sequence[ShockDependency]) -> tuple[str, ...]:
        names = {v.name for v in variables}
        contemporaneous = {name: set() for name in names}
        for dependency in dependencies:
            if dependency.lag == 0:
                contemporaneous[dependency.target].add(dependency.driver)
        order: list[str] = []
        remaining = {name: set(parents) for name, parents in contemporaneous.items()}
        while remaining:
            ready = sorted(name for name, parents in remaining.items() if not parents)
            if not ready:
                raise ValueError("contemporaneous shock dependency cycle")
            order.extend(ready)
            for name in ready:
                remaining.pop(name)
            for parents in remaining.values():
                parents.difference_update(ready)
        return tuple(order)

    @classmethod
    def correlated_paths(
        cls,
        variables: Sequence[ShockVariable],
        correlation: Sequence[Sequence[float]],
        periods: int,
        paths: int,
        seed: int,
    ) -> list[list[dict[str, float]]]:
        contract = ScenarioContract(
            "legacy-correlated-paths", "v1", tuple(variables),
            tuple(tuple(float(x) for x in row) for row in correlation), periods, seed,
        )
        return cls.generate(contract, paths=paths)["paths"]

    @classmethod
    def generate(cls, contract: ScenarioContract, *, paths: int) -> dict[str, Any]:
        if paths <= 0:
            raise ValueError("paths must be positive")
        lower = cls._cholesky(contract.correlation)
        order = cls._dependency_order(contract.variables, contract.dependencies)
        variable_by_name = {v.name: v for v in contract.variables}
        dependency_by_target: dict[str, list[ShockDependency]] = {name: [] for name in variable_by_name}
        for dependency in contract.dependencies:
            dependency_by_target[dependency.target].append(dependency)
        rng = random.Random(contract.seed)
        all_paths: list[list[dict[str, float]]] = []
        constraint_failures: list[dict[str, Any]] = []

        for path_index in range(paths):
            path: list[dict[str, float]] = []
            previous = {name: variable.mean for name, variable in variable_by_name.items()}
            for period in range(contract.periods):
                normals = [rng.gauss(0.0, 1.0) for _ in contract.variables]
                correlated = [sum(lower[i][j] * normals[j] for j in range(len(contract.variables))) for i in range(len(contract.variables))]
                base = {
                    variable.name: cls._innovation(variable, correlated[i], rng)
                    for i, variable in enumerate(contract.variables)
                }
                row: dict[str, float] = {}
                for name in order:
                    variable = variable_by_name[name]
                    value = variable.mean + variable.persistence * (previous[name] - variable.mean) + (base[name] - variable.mean)
                    for dependency in dependency_by_target[name]:
                        driver_value = previous[dependency.driver] if dependency.lag == 1 else row[dependency.driver]
                        value += dependency.coefficient * (driver_value - variable_by_name[dependency.driver].mean)
                    if variable.lower_bound is not None:
                        value = max(float(variable.lower_bound), value)
                    if variable.upper_bound is not None:
                        value = min(float(variable.upper_bound), value)
                    row[name] = value
                for name, value in contract.scheduled_shocks.get(period, {}).items():
                    row[name] += float(value)
                for constraint in contract.constraints:
                    checked = constraint.evaluate(row)
                    if checked["status"] != "PASS":
                        constraint_failures.append({"path": path_index, "period": period, **checked})
                path.append(row)
                previous = row
            all_paths.append(path)

        flattened = [row for path in all_paths for row in path]
        tail = cls.tail_diagnostics(flattened, tuple(variable_by_name))
        return {
            "status": "PASS" if not constraint_failures else "CONSTRAINT_VIOLATION",
            "paths": all_paths,
            "contract_sha256": contract.fingerprint,
            "paths_sha256": sha256(all_paths),
            "constraint_failures": constraint_failures,
            "tail_diagnostics": tail,
            "path_count": paths,
            "periods": contract.periods,
        }

    @staticmethod
    def validate_constraints(paths: Sequence[Sequence[Mapping[str, float]]], constraints: Sequence[ScenarioConstraint]) -> dict[str, Any]:
        failures = []
        for path_index, path in enumerate(paths):
            for period, row in enumerate(path):
                for constraint in constraints:
                    result = constraint.evaluate(row)
                    if result["status"] != "PASS":
                        failures.append({"path": path_index, "period": period, **result})
        return {"status": "PASS" if not failures else "FAIL", "failures": failures, "checked_rows": sum(len(p) for p in paths)}

    @staticmethod
    def tail_diagnostics(rows: Sequence[Mapping[str, float]], variables: Sequence[str]) -> dict[str, Any]:
        if not rows:
            raise ValueError("rows required for tail diagnostics")
        output: dict[str, Any] = {}
        for name in variables:
            values = sorted(float(row[name]) for row in rows)
            n = len(values)
            def quantile(p: float) -> float:
                idx = min(n - 1, max(0, int(round((n - 1) * p))))
                return values[idx]
            output[name] = {
                "min": values[0], "p01": quantile(.01), "p05": quantile(.05),
                "median": quantile(.5), "p95": quantile(.95), "p99": quantile(.99), "max": values[-1],
            }
        return output

    @staticmethod
    def compose(
        components: Sequence[Mapping[int, Mapping[str, float]]],
        *,
        mode: str = "additive",
    ) -> dict[int, dict[str, float]]:
        if not components or mode not in {"additive", "override"}:
            raise ValueError("components and supported composition mode required")
        merged: dict[int, dict[str, float]] = {}
        for component in components:
            for raw_period, shocks in component.items():
                period = int(raw_period)
                if period < 0:
                    raise ValueError("scenario period cannot be negative")
                target = merged.setdefault(period, {})
                for name, raw_value in shocks.items():
                    value = float(raw_value)
                    if not math.isfinite(value):
                        raise ValueError("composed shock must be finite")
                    if mode == "additive":
                        target[name] = target.get(name, 0.0) + value
                    else:
                        target[name] = value
        return {period: dict(sorted(shocks.items())) for period, shocks in sorted(merged.items())}

    @staticmethod
    def reverse_stress(
        evaluate: Callable[[Mapping[str, float]], float],
        candidates: Sequence[Mapping[str, float]],
        failure_threshold: float,
    ) -> dict[str, Any]:
        failures = []
        rows = []
        for shock in candidates:
            score = float(evaluate(shock))
            if not math.isfinite(score):
                raise ValueError("non-finite reverse-stress score")
            magnitude = math.sqrt(sum(float(value) ** 2 for value in shock.values()))
            row = {"shock": dict(shock), "score": score, "magnitude": magnitude}
            rows.append(row)
            if score <= failure_threshold:
                failures.append((magnitude, canonical(shock), dict(shock), score))
        if not failures:
            return {"status": "NO_FAILURE_FOUND", "tested": len(candidates), "trace_sha256": sha256(rows)}
        failures.sort(key=lambda x: (x[0], x[1]))
        return {
            "status": "FAILURE_FOUND",
            "minimal_shock": failures[0][2],
            "score": failures[0][3],
            "magnitude": failures[0][0],
            "tested": len(candidates),
            "trace_sha256": sha256(rows),
        }

    @staticmethod
    def reverse_stress_grid(
        evaluate: Callable[[Mapping[str, float]], float],
        axes: Mapping[str, Sequence[float]],
        failure_threshold: float,
        *,
        max_candidates: int = 100_000,
    ) -> dict[str, Any]:
        if not axes or any(not values for values in axes.values()):
            raise ValueError("non-empty reverse-stress axes required")
        count = math.prod(len(values) for values in axes.values())
        if count > max_candidates:
            raise FrontierSafetyError("reverse-stress grid exceeds candidate budget")
        names = sorted(axes)
        candidates: list[dict[str, float]] = []

        def build(index: int, current: dict[str, float]) -> None:
            if index == len(names):
                candidates.append(dict(current))
                return
            name = names[index]
            for value in axes[name]:
                current[name] = float(value)
                build(index + 1, current)
            current.pop(name, None)

        build(0, {})
        result = ScenarioFactory.reverse_stress(evaluate, candidates, failure_threshold)
        result["axes_sha256"] = sha256({name: list(axes[name]) for name in names})
        return result
