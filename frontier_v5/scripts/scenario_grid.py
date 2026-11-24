#!/usr/bin/env python3
"""Expand a scenario variable grid into its full Cartesian product.

Spec: ``{"variables": {"name": [value, ...], ...}}``. ``variables`` must be a
non-empty object; each variable name must be a non-empty string and each axis a
non-empty list of distinct JSON scalars (string, finite number or boolean).
Specs whose grid would exceed ``--max-scenarios`` are rejected. Any invalid
spec exits non-zero without writing the output file.
"""
import argparse
import itertools
import json
import math

DEFAULT_MAX_SCENARIOS = 100_000


class SpecError(ValueError):
    pass


def _no_duplicate_keys(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise SpecError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


def _reject_constant(token):
    raise SpecError(f"non-finite number {token} is not allowed")


def _is_scalar(value):
    if isinstance(value, bool) or isinstance(value, str):
        return True
    if isinstance(value, (int, float)):
        return math.isfinite(value)
    return False


def validate_spec(spec, max_scenarios=DEFAULT_MAX_SCENARIOS):
    """Return (names, axes) for a valid spec or raise SpecError."""
    if not isinstance(spec, dict):
        raise SpecError("spec must be a JSON object")
    variables = spec.get("variables")
    if not isinstance(variables, dict) or not variables:
        raise SpecError("variables required: a non-empty object mapping names to value lists")
    names, axes = [], []
    for name, values in variables.items():
        if not name.strip():
            raise SpecError("variable names must be non-empty strings")
        if not isinstance(values, list) or not values:
            raise SpecError(f"axis {name!r} must be a non-empty list of values")
        seen = set()
        for value in values:
            if not _is_scalar(value):
                raise SpecError(f"axis {name!r} values must be strings, finite numbers or booleans")
            key = json.dumps(value, sort_keys=True)
            if key in seen:
                raise SpecError(f"axis {name!r} contains duplicate value {key}")
            seen.add(key)
        names.append(name)
        axes.append(values)
    count = math.prod(len(values) for values in axes)
    if count > max_scenarios:
        raise SpecError(f"grid has {count} scenarios, above --max-scenarios {max_scenarios}")
    return names, axes


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--spec", required=True, help='JSON object: {"variables":{"x":[1,2],"y":[3,4]}}')
    p.add_argument("--output", required=True)
    p.add_argument("--max-scenarios", type=int, default=DEFAULT_MAX_SCENARIOS)
    a = p.parse_args()
    if a.max_scenarios < 1:
        raise SystemExit("--max-scenarios must be positive")
    try:
        with open(a.spec, encoding="utf-8") as f:
            spec = json.load(f, object_pairs_hook=_no_duplicate_keys, parse_constant=_reject_constant)
        names, axes = validate_spec(spec, a.max_scenarios)
    except (OSError, ValueError) as exc:
        raise SystemExit(f"invalid scenario spec: {exc}")
    rows = [dict(zip(names, vals)) for vals in itertools.product(*axes)]
    with open(a.output, "w", encoding="utf-8") as f:
        json.dump({"scenario_count": len(rows), "scenarios": rows}, f, indent=2)


if __name__ == "__main__":
    main()
