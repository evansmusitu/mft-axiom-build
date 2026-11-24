#!/usr/bin/env python3
"""Seal a proof envelope with a deterministic reproducibility fingerprint.

``reproducibility_fingerprint_sha256`` is the SHA-256 of the canonical JSON
(sorted keys, compact separators, UTF-8) of the proof content: every input field
except the metadata fields ``generated_at`` and
``reproducibility_fingerprint_sha256``. Identical content therefore always yields
the same fingerprint; ``generated_at`` is recorded as metadata only.

Required fields: ``question`` and ``method`` (non-empty strings), ``evidence``
(non-empty list of objects, each with a ``class`` of USER, RETRIEVED, COMPUTED,
ASSUMED, INFERRED or UNKNOWN), ``assumptions`` (list) and ``result`` (non-null).
Invalid input exits non-zero without writing the output file.
"""
import argparse
import datetime
import hashlib
import json

REQUIRED = ("question", "evidence", "assumptions", "method", "result")
METADATA_FIELDS = ("generated_at", "reproducibility_fingerprint_sha256")
EVIDENCE_CLASSES = ("USER", "RETRIEVED", "COMPUTED", "ASSUMED", "INFERRED", "UNKNOWN")


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def fingerprint(payload):
    body = {k: v for k, v in payload.items() if k not in METADATA_FIELDS}
    return hashlib.sha256(canonical(body).encode("utf-8")).hexdigest()


def _no_duplicate_keys(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


def _reject_constant(token):
    raise ValueError(f"non-finite number {token} is not allowed")


def load_input(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f, object_pairs_hook=_no_duplicate_keys, parse_constant=_reject_constant)


def validate(data):
    """Return a list of validation errors (empty when the envelope is valid)."""
    if not isinstance(data, dict):
        return ["proof envelope must be a JSON object"]
    missing = [k for k in REQUIRED if k not in data]
    if missing:
        return ["missing required fields: " + ",".join(missing)]
    errors = []
    for key in ("question", "method"):
        if not isinstance(data[key], str) or not data[key].strip():
            errors.append(f"{key} must be a non-empty string")
    evidence = data["evidence"]
    if not isinstance(evidence, list) or not evidence:
        errors.append("evidence must be a non-empty list")
    else:
        for i, item in enumerate(evidence):
            if not isinstance(item, dict) or item.get("class") not in EVIDENCE_CLASSES:
                errors.append(f"evidence[{i}] must be an object with class in {','.join(EVIDENCE_CLASSES)}")
    if not isinstance(data["assumptions"], list) or any(a is None for a in data["assumptions"]):
        errors.append("assumptions must be a list of non-null items")
    if data["result"] is None:
        errors.append("result must not be null")
    if "generated_at" in data and not isinstance(data["generated_at"], str):
        errors.append("generated_at must be a string when supplied")
    return errors


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--input", required=True, help="JSON file containing proof-envelope fields")
    p.add_argument("--output", required=True)
    a = p.parse_args()
    try:
        data = load_input(a.input)
    except (OSError, ValueError) as exc:
        raise SystemExit(f"invalid proof envelope input: {exc}")
    errors = validate(data)
    if errors:
        raise SystemExit("invalid proof envelope: " + "; ".join(errors))
    payload = {k: v for k, v in data.items() if k != "reproducibility_fingerprint_sha256"}
    payload.setdefault("generated_at", datetime.datetime.now(datetime.timezone.utc).isoformat())
    payload["reproducibility_fingerprint_sha256"] = fingerprint(payload)
    with open(a.output, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
