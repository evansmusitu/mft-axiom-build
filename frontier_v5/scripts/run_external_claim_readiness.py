#!/usr/bin/env python3
"""Emit a fail-closed external-comparative claim-readiness record.

A green execution of this script means the boundary is working, not that
MUSITU has attained external comparative verification. Use --require-level5 to
turn the current NOT_VERIFIED state into a non-zero promotion gate.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def build(root: Path) -> dict:
    registry_path = root / "evals" / "EXTERNAL_BASELINE_REGISTRY.json"
    contract_path = root / "EVAL_CONTRACT.json"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    contract = json.loads(contract_path.read_text(encoding="utf-8"))

    levels = contract.get("comparative_evidence") or {}
    references = registry.get("references") or []
    blockers = []
    completed = []
    for ref in references:
        if ref.get("evidence_status") in {"PASS", "VERIFIED", "CERTIFIED"}:
            completed.append(ref)
    if registry.get("current_level5_status") != "VERIFIED":
        blockers.append("LEVEL5_EXTERNAL_COMPARATIVE_NOT_VERIFIED")
    if registry.get("current_level6_status") != "VERIFIED":
        blockers.append("LEVEL6_INDEPENDENT_VALIDATION_NOT_VERIFIED")
    if registry.get("current_global_superiority_status") != "CERTIFIED":
        blockers.append("GLOBAL_SUPERIORITY_NOT_CERTIFIED")
    if levels.get("current_level_5") != "VERIFIED":
        blockers.append("EVAL_CONTRACT_LEVEL5_NOT_VERIFIED")
    if levels.get("current_level_6") != "VERIFIED":
        blockers.append("EVAL_CONTRACT_LEVEL6_NOT_VERIFIED")
    if levels.get("current_level_7") != "VERIFIED":
        blockers.append("EVAL_CONTRACT_LEVEL7_NOT_VERIFIED")

    out = {
        "schema": "musitu.axiom.frontier.external-claim-readiness.v1",
        "registry_sha256": sha256(registry),
        "eval_contract_sha256": sha256(contract),
        "reference_system_count": len(references),
        "completed_external_reference_count": len(completed),
        "required_distinct_external_providers_for_broad_claim": registry.get(
            "minimum_distinct_external_providers_for_broad_claim"
        ),
        "required_comparison_domains": registry.get("required_comparison_domains") or [],
        "level5_external_comparative_verified": False,
        "level6_independent_validation_verified": False,
        "level7_longitudinal_defensibility_verified": False,
        "global_superiority_certified": False,
        "blockers": blockers,
        "status": "BLOCKED" if blockers else "READY"
    }
    body = dict(out)
    out["evidence_sha256"] = sha256(body)
    out["gate"] = (
        "MUSITU_AXIOM_EXTERNAL_COMPARATIVE_CLAIM_BLOCKED"
        if blockers else
        "MUSITU_AXIOM_EXTERNAL_COMPARATIVE_CLAIM_READY"
    )
    return out


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--output", default="/tmp/musitu-frontier-external-claim-readiness.json")
    parser.add_argument("--require-level5", action="store_true")
    args = parser.parse_args(argv)
    out = build(Path(args.root))
    Path(args.output).write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))
    print(out["gate"])
    if args.require_level5 and not out["level5_external_comparative_verified"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
