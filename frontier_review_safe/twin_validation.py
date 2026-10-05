from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from threading import RLock
from typing import Any, Mapping, Sequence
import json
import math
import statistics

from .analysis import CausalCounterfactualModel, ScenarioFactory, ShockVariable
from .core import FrontierSafetyError, atomic_write, canonical, parse_time, sha256


def _valid_sha256(value: str | None) -> bool:
    return bool(value) and len(value) == 64 and all(c in "0123456789abcdef" for c in value.lower())


@dataclass(frozen=True)
class TwinBacktestCase:
    case_id: str
    as_of: str
    baseline: Mapping[str, float]
    shocks: tuple[Mapping[str, float], ...]
    actual_end_state: Mapping[str, float]
    provenance_hashes: tuple[str, ...]

    def __post_init__(self) -> None:
        parse_time(self.as_of)
        if not self.case_id or not self.baseline or not self.actual_end_state or not self.provenance_hashes:
            raise ValueError("complete twin backtest case required")
        if any(not _valid_sha256(x) for x in self.provenance_hashes):
            raise ValueError("backtest provenance hashes must be SHA-256")
        for mapping in (self.baseline, self.actual_end_state, *self.shocks):
            if any(not math.isfinite(float(v)) for v in mapping.values()):
                raise ValueError("twin backtest values must be finite")


class TwinBacktester:
    @staticmethod
    def evaluate(
        model: CausalCounterfactualModel,
        cases: Sequence[TwinBacktestCase],
        *,
        calibrated_at: str,
    ) -> dict[str, Any]:
        parse_time(calibrated_at)
        if not cases or len({x.case_id for x in cases}) != len(cases):
            raise ValueError("unique non-empty twin backtest cases required")
        errors: dict[str, list[float]] = {}
        failed: list[dict[str, str]] = []
        predictions: list[dict[str, Any]] = []
        for case in cases:
            try:
                state = {k: float(v) for k, v in case.baseline.items()}
                for shock in case.shocks:
                    state = model.simulate(state, interventions=shock)
                common = sorted(set(case.actual_end_state) & set(state))
                if not common:
                    raise FrontierSafetyError("no comparable actual/predicted variables")
                row_errors = {}
                for variable in common:
                    error = float(state[variable]) - float(case.actual_end_state[variable])
                    errors.setdefault(variable, []).append(error)
                    row_errors[variable] = error
                predictions.append({
                    "case_id": case.case_id,
                    "prediction_hash": sha256({k: state[k] for k in common}),
                    "actual_hash": sha256({k: case.actual_end_state[k] for k in common}),
                    "errors": row_errors,
                })
            except Exception as exc:
                failed.append({"case_id": case.case_id, "error_type": type(exc).__name__})

        metrics: dict[str, dict[str, float]] = {}
        for variable, values in sorted(errors.items()):
            abs_errors = [abs(x) for x in values]
            metrics[variable] = {
                "n": float(len(values)),
                "mae": statistics.fmean(abs_errors),
                "rmse": math.sqrt(statistics.fmean(x * x for x in values)),
                "max_abs_error": max(abs_errors),
                "mean_error": statistics.fmean(values),
            }
        report = {
            "schema": "musitu.axiom.twin-backtest-report.v1",
            "model_version": model.assumptions.model_version,
            "calibrated_at": calibrated_at,
            "dataset_hash": sha256([asdict(x) for x in cases]),
            "case_count": len(cases),
            "successful_case_count": len(predictions),
            "failed_cases": failed,
            "variable_metrics": metrics,
            "prediction_evidence_hash": sha256(predictions),
        }
        report["report_sha256"] = sha256(report)
        return report


@dataclass(frozen=True)
class TwinCalibrationPolicy:
    version: str
    minimum_cases: int
    max_failed_fraction: float
    max_mae_by_variable: Mapping[str, float]
    max_calibration_age_seconds: int

    def __post_init__(self) -> None:
        if not self.version or self.minimum_cases <= 0 or self.max_calibration_age_seconds <= 0:
            raise ValueError("valid calibration policy version/count/freshness required")
        if not 0 <= self.max_failed_fraction <= 1:
            raise ValueError("failed fraction must be in [0,1]")
        if not self.max_mae_by_variable or any(float(v) < 0 for v in self.max_mae_by_variable.values()):
            raise ValueError("non-negative per-variable MAE limits required")

    def gate(self, report: Mapping[str, Any], *, now: str) -> dict[str, Any]:
        when = parse_time(now)
        reasons: list[str] = []
        case_count = int(report.get("case_count", 0))
        successful = int(report.get("successful_case_count", 0))
        if case_count < self.minimum_cases:
            reasons.append("insufficient_backtest_cases")
        failed_fraction = (case_count - successful) / case_count if case_count else 1.0
        if failed_fraction > self.max_failed_fraction:
            reasons.append("backtest_failure_fraction_exceeded")
        try:
            age = (when - parse_time(str(report["calibrated_at"]))).total_seconds()
            if age < 0 or age > self.max_calibration_age_seconds:
                reasons.append("calibration_stale")
        except Exception:
            reasons.append("calibration_timestamp_invalid")
        metrics = report.get("variable_metrics") or {}
        for variable, limit in sorted(self.max_mae_by_variable.items()):
            row = metrics.get(variable)
            if row is None:
                reasons.append(f"missing_metric:{variable}")
            elif float(row.get("mae", math.inf)) > float(limit):
                reasons.append(f"mae_exceeded:{variable}")
        if not _valid_sha256(str(report.get("report_sha256") or "")):
            reasons.append("backtest_report_hash_missing")
        result = {
            "status": "PASS" if not reasons else "FAIL",
            "reasons": reasons,
            "policy_version": self.version,
            "backtest_report_sha256": report.get("report_sha256"),
            "failed_fraction": failed_fraction,
        }
        result["gate_sha256"] = sha256(result)
        return result


@dataclass(frozen=True)
class TwinVersionCandidate:
    twin_id: str
    version: str
    parent_version: str | None
    model_version: str
    state_hash: str
    calibration_report_hash: str
    scenario_contract_hash: str
    created_at: str

    def __post_init__(self) -> None:
        parse_time(self.created_at)
        if not self.twin_id or not self.version or not self.model_version:
            raise ValueError("twin/version/model identities required")
        for value in (self.state_hash, self.calibration_report_hash, self.scenario_contract_hash):
            if not _valid_sha256(value):
                raise ValueError("twin version evidence hashes must be SHA-256")


class TwinVersionRegistry:
    SCHEMA = "musitu.axiom.twin-version-registry.v1"

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = RLock()
        self.events: list[dict[str, Any]] = []
        if self.path.exists():
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            if raw.get("schema") != self.SCHEMA:
                raise FrontierSafetyError("unsupported twin version registry schema")
            self.events = list(raw.get("events") or [])
            self.verify()

    def _persist(self) -> None:
        atomic_write(self.path, canonical({"schema": self.SCHEMA, "events": self.events}))

    def verify(self) -> bool:
        previous = None
        registrations: dict[tuple[str, str], str] = {}
        for index, event in enumerate(self.events):
            body = dict(event)
            actual = body.pop("event_sha256", None)
            if body.get("sequence") != index or body.get("previous_sha256") != previous:
                raise FrontierSafetyError("twin registry chain integrity failure")
            parse_time(str(body.get("occurred_at") or ""))
            if sha256(body) != actual:
                raise FrontierSafetyError("twin registry content integrity failure")
            if body.get("event_type") == "register":
                data = body.get("data") or {}
                key = (str(data.get("twin_id")), str(data.get("version")))
                fingerprint = sha256(data)
                old = registrations.get(key)
                if old and old != fingerprint:
                    raise FrontierSafetyError("twin version collision")
                registrations[key] = fingerprint
            previous = actual
        return True

    def _append(self, event_type: str, data: Mapping[str, Any], occurred_at: str) -> str:
        parse_time(occurred_at)
        with self._lock:
            body = {
                "sequence": len(self.events),
                "event_type": event_type,
                "data": json.loads(canonical(dict(data))),
                "occurred_at": occurred_at,
                "previous_sha256": self.events[-1]["event_sha256"] if self.events else None,
            }
            body["event_sha256"] = sha256(body)
            self.events.append(body)
            self._persist()
            return str(body["event_sha256"])

    def candidate(self, twin_id: str, version: str) -> TwinVersionCandidate | None:
        for event in reversed(self.events):
            if event.get("event_type") != "register":
                continue
            data = event.get("data") or {}
            if data.get("twin_id") == twin_id and data.get("version") == version:
                return TwinVersionCandidate(**data)
        return None

    def register(self, candidate: TwinVersionCandidate) -> str:
        existing = self.candidate(candidate.twin_id, candidate.version)
        if existing:
            if existing != candidate:
                raise FrontierSafetyError("twin version registration collision")
            for event in self.events:
                if event.get("event_type") == "register" and event.get("data") == asdict(candidate):
                    return str(event["event_sha256"])
        return self._append("register", asdict(candidate), candidate.created_at)

    def active_version(self, twin_id: str) -> str | None:
        active = None
        for event in self.events:
            data = event.get("data") or {}
            if data.get("twin_id") != twin_id:
                continue
            if event.get("event_type") == "promote":
                active = data.get("version")
            elif event.get("event_type") == "rollback":
                active = data.get("target_version")
        return str(active) if active is not None else None

    def promote(self, twin_id: str, version: str, calibration_gate: Mapping[str, Any], *, occurred_at: str) -> str:
        candidate = self.candidate(twin_id, version)
        if not candidate:
            raise FrontierSafetyError("cannot promote unregistered twin version")
        if calibration_gate.get("status") != "PASS" or not _valid_sha256(str(calibration_gate.get("gate_sha256") or "")):
            raise FrontierSafetyError("twin promotion blocked by calibration gate")
        active = self.active_version(twin_id)
        if candidate.parent_version != active:
            raise FrontierSafetyError("twin candidate parent is not active version")
        return self._append("promote", {
            "twin_id": twin_id,
            "version": version,
            "parent_version": active,
            "calibration_gate_sha256": calibration_gate["gate_sha256"],
        }, occurred_at)

    def rollback(self, twin_id: str, target_version: str, *, occurred_at: str) -> str:
        active_version = self.active_version(twin_id)
        if active_version is None:
            raise FrontierSafetyError("no active twin version")
        active = self.candidate(twin_id, active_version)
        if not active or active.parent_version != target_version:
            raise FrontierSafetyError("rollback target must be active version's registered parent")
        if not self.candidate(twin_id, target_version):
            raise FrontierSafetyError("rollback target is not registered")
        return self._append("rollback", {
            "twin_id": twin_id,
            "from_version": active_version,
            "target_version": target_version,
        }, occurred_at)

    @property
    def fingerprint(self) -> str:
        self.verify()
        return sha256(self.events)


@dataclass(frozen=True)
class TwinStressSpec:
    variables: tuple[ShockVariable, ...]
    correlation: tuple[tuple[float, ...], ...]
    periods: int
    paths: int
    seed: int
    target_metrics: tuple[str, ...]
    quantiles: tuple[float, ...] = (0.05, 0.5, 0.95)

    def __post_init__(self) -> None:
        if not self.variables or self.periods <= 0 or self.paths <= 0 or not self.target_metrics:
            raise ValueError("complete positive twin stress specification required")
        if any(not 0 < q < 1 for q in self.quantiles):
            raise ValueError("stress quantiles must be in (0,1)")

    @property
    def fingerprint(self) -> str:
        return sha256(asdict(self))


class TwinStressEngine:
    @staticmethod
    def _quantile(values: Sequence[float], q: float) -> float:
        ordered = sorted(values)
        index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * q)))
        return float(ordered[index])

    @classmethod
    def run(
        cls,
        model: CausalCounterfactualModel,
        baseline: Mapping[str, float],
        spec: TwinStressSpec,
    ) -> dict[str, Any]:
        paths = ScenarioFactory.correlated_paths(
            spec.variables, spec.correlation, spec.periods, spec.paths, spec.seed,
        )
        terminal: dict[str, list[float]] = {metric: [] for metric in spec.target_metrics}
        failures: list[dict[str, Any]] = []
        for path_index, shocks in enumerate(paths):
            try:
                state = {k: float(v) for k, v in baseline.items()}
                for shock in shocks:
                    state = model.simulate(state, interventions=shock)
                for metric in spec.target_metrics:
                    if metric not in state or not math.isfinite(float(state[metric])):
                        raise FrontierSafetyError(f"missing/non-finite stress metric: {metric}")
                    terminal[metric].append(float(state[metric]))
            except Exception as exc:
                failures.append({"path": path_index, "error_type": type(exc).__name__})

        summaries: dict[str, Any] = {}
        for metric, values in terminal.items():
            if not values:
                continue
            summaries[metric] = {
                "n": len(values),
                "mean": statistics.fmean(values),
                "min": min(values),
                "max": max(values),
                "quantiles": {str(q): cls._quantile(values, q) for q in spec.quantiles},
            }
        result = {
            "status": "PASS" if not failures and len(summaries) == len(spec.target_metrics) else "FAIL",
            "model_version": model.assumptions.model_version,
            "spec_sha256": spec.fingerprint,
            "path_count": spec.paths,
            "periods": spec.periods,
            "failed_paths": failures,
            "terminal_summaries": summaries,
        }
        result["result_sha256"] = sha256(result)
        return result
