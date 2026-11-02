"""Strict independent known-answer oracles; rubric cases remain unscored."""
from __future__ import annotations

import json
import math
from typing import Any, Mapping


def _equal(actual: Any, expected: Any, absolute: float, relative: float) -> bool:
    if isinstance(expected, bool) or expected is None:
        return type(actual) is type(expected) and actual == expected
    if isinstance(expected, (int, float)):
        return (type(actual) in (int, float)
                and math.isfinite(actual) and math.isfinite(expected)
                and math.isclose(actual, expected, abs_tol=absolute, rel_tol=relative))
    if isinstance(expected, str):
        return isinstance(actual, str) and actual == expected
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(
            _equal(a, e, absolute, relative) for a, e in zip(actual, expected))
    if isinstance(expected, dict):
        return isinstance(actual, dict) and actual.keys() == expected.keys() and all(
            _equal(actual[k], v, absolute, relative) for k, v in expected.items())
    raise ValueError("expected answers must be finite JSON values")


def known_answer_score(case: Mapping[str, Any], output_text: str, _: Any = None) -> float | None:
    if case.get("mode") != "known_answer":
        return None
    if "expected" not in case:
        raise ValueError("known-answer case requires an expected answer")
    absolute, relative = case.get("absolute_tolerance", 1e-12), case.get("relative_tolerance", 1e-9)
    for tolerance in (absolute, relative):
        if type(tolerance) not in (float, int) or not math.isfinite(tolerance) or tolerance < 0:
            raise ValueError("finite nonnegative oracle tolerances required")
    text = output_text.strip()
    if text.startswith("```json\n") and text.endswith("\n```"):
        text = text[8:-4]
    try:
        actual = json.loads(text, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")))
    except (ValueError, TypeError):
        actual = text if isinstance(case["expected"], str) else object()
    return float(_equal(actual, case["expected"], absolute, relative))
