# Databricks notebook source
# MUSITU Axiom × Databricks Private v0.2 | OFFLINE, synthetic only
# This is not an authenticated connection to production Axiom.
# Notebook execution may incur Databricks compute usage.

"""Small independent, offline-only verification kernel for the Databricks pilot.

Not an Axiom production module or independent security certification.
Inputs/outputs are intentionally restricted to plain finite decimal values.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from hashlib import sha256
import json
from typing import Any


@dataclass(frozen=True)
class NumericVerdict:
    passed: bool
    code: str
    actual: str | None
    expected: str | None
    absolute_error: str | None
    tolerance: str | None
    evidence_sha256: str


def _decimal(value: Any) -> Decimal:
    """Fail closed on bool, float, objects, infinity, NaN, or bad strings."""
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise ValueError("Only integer or decimal string inputs are permitted")
    if isinstance(value, str) and (len(value) > 120 or not value.strip()):
        raise ValueError("Invalid numeric string length")
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Invalid decimal input") from None
    if not parsed.is_finite():
        raise ValueError("Non-finite input is not permitted")
    if abs(parsed.adjusted()) > 60 and parsed != 0:
        raise ValueError("Numeric magnitude exceeds pilot limits")
    return parsed


def verify_numeric(actual: Any, expected: Any, *, abs_tol: str = "0", rel_tol: str = "0") -> NumericVerdict:
    """Verify expected value with Decimal arithmetic and hash a public verdict."""
    a = _decimal(actual)
    e = _decimal(expected)
    a_tol = _decimal(abs_tol)
    r_tol = _decimal(rel_tol)
    if a_tol < 0 or r_tol < 0 or r_tol > 1:
        raise ValueError("Tolerance outside pilot policy")
    error = abs(a - e)
    threshold = max(a_tol, r_tol * abs(e))
    passed = error <= threshold
    evidence = {
        "schema": "musitu.axiom.databricks.pilot.numeric-verdict.v1",
        "actual": str(a), "expected": str(e),
        "absolute_error": str(error), "tolerance": str(threshold),
        "passed": passed, "code": "PASS" if passed else "MISMATCH",
    }
    digest = sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return NumericVerdict(passed, evidence["code"], str(a), str(e), str(error), str(threshold), digest)


def evaluate_example(record: dict[str, Any]) -> dict[str, Any]:
    """Fail-closed adapter for MLflow outputs and ground truth."""
    try:
        outputs = record["outputs"]
        expectations = record["expectations"]
        if not isinstance(outputs, dict) or not isinstance(expectations, dict):
            raise ValueError("Outputs and expectations must be mappings")
        verdict = verify_numeric(
            outputs["value"], expectations["value"],
            abs_tol=expectations.get("abs_tol", "0"),
            rel_tol=expectations.get("rel_tol", "0"),
        )
        return asdict(verdict)
    except (KeyError, ValueError, TypeError) as exc:
        return {
            "passed": False, "code": "INVALID_INPUT", "error": type(exc).__name__,
            "evidence_sha256": None,
        }


# COMMAND ----------
CASES = [
    {"case_id": "math-exact-1", "outputs": {"value": "42"}, "expectations": {"value": "42"}, "should_pass": True},
    {"case_id": "rounding-1", "outputs": {"value": "1.000001"}, "expectations": {"value": "1", "rel_tol": "0.00001"}, "should_pass": True},
    {"case_id": "finance-mismatch-1", "outputs": {"value": "123.45"}, "expectations": {"value": "120.00", "abs_tol": "0.01"}, "should_pass": False},
    {"case_id": "bad-nan", "outputs": {"value": "NaN"}, "expectations": {"value": "1"}, "should_pass": False},
]
for case in CASES:
    result = evaluate_example(case)
    assert result["passed"] == case["should_pass"], (case["case_id"], result)
    print(case["case_id"], result["code"], "expected_pass=", case["should_pass"])
print("MUSITU_AXIOM_DATABRICKS_SYNTHETIC_4_OF_4_PASS")

# COMMAND ----------
RUN_MLFLOW_EVALUATION = False

if RUN_MLFLOW_EVALUATION:
    import mlflow
    from mlflow.genai.scorers import scorer

    @scorer
    def axiom_numeric_accuracy(*, outputs=None, expectations=None, inputs=None, trace=None):
        return evaluate_example({"outputs": outputs, "expectations": expectations})["passed"]

    mlflow_data = [
        {"inputs": {"case_id": case["case_id"]}, "outputs": case["outputs"], "expectations": case["expectations"]}
        for case in CASES
    ]
    mlflow.set_tracking_uri("databricks")
    evaluation = mlflow.genai.evaluate(data=mlflow_data, scorers=[axiom_numeric_accuracy])
    print("MLFLOW_RUN_ID:", evaluation.run_id)
else:
    print("MLFLOW_EVALUATION_SKIPPED: explicitly enable only after workspace/budget approval")
