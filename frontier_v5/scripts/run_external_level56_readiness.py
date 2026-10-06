#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from frontier_v5.runtime.external_execution_receipts import ExternalExecutionReceiptGate


def _load_json_files(path: Path) -> list[dict]:
    if not path.exists():
        return []
    if path.is_file():
        return [json.loads(path.read_text(encoding="utf-8"))]
    return [json.loads(item.read_text(encoding="utf-8")) for item in sorted(path.glob("*.json"))]


def build(root: Path, receipt_path: Path, replay_path: Path) -> dict:
    protocol=json.loads((root/"evals"/"EXTERNAL_LEVEL56_PROTOCOL_V2.json").read_text(encoding="utf-8"))
    commitment=json.loads((root/"evals"/"EXTERNAL_LEVEL56_CASESET_COMMITMENT_20261006.json").read_text(encoding="utf-8"))
    if commitment["protocol_id"] != protocol["protocol_id"]:
        raise ValueError("case-set commitment protocol_id mismatch")
    sealed=protocol["sealed_evidence_commitment"]
    for key in ("case_set_sha256","constraints_sha256","private_evaluator_pack_sha256","provider_inputs_bundle_sha256"):
        if commitment[key] != sealed[key]:
            raise ValueError(f"protocol and case-set commitment mismatch: {key}")
    if sealed["hidden_content_published"] is not False or commitment["hidden_content_published"] is not False:
        raise ValueError("hidden evaluator content must remain unpublished")

    expected_systems=[x["system_id"] for x in protocol["required_external_systems"]]
    expected_cases=list(protocol["required_case_ids"])
    gate=ExternalExecutionReceiptGate()
    receipts=_load_json_files(receipt_path)
    replays=_load_json_files(replay_path)
    out=gate.assess_level56(
        expected_system_ids=expected_systems,
        expected_case_ids=expected_cases,
        expected_case_set_sha256=commitment["case_set_sha256"],
        expected_constraints_sha256=commitment["constraints_sha256"],
        receipts=receipts,
        independent_replays=replays,
    )
    out["protocol_id"]=protocol["protocol_id"]
    out["case_set_sha256"]=commitment["case_set_sha256"]
    out["constraints_sha256"]=commitment["constraints_sha256"]
    out["private_evaluator_pack_sha256"]=commitment["private_evaluator_pack_sha256"]
    out["provider_inputs_bundle_sha256"]=commitment["provider_inputs_bundle_sha256"]
    out["protocol_requires_paid_api_key"]=protocol["execution_policy"]["api_key_required"]
    out["required_external_system_count"]=len(expected_systems)
    out["required_case_count"]=len(expected_cases)
    out["access_blocked_is_failure"]=False
    out["access_blocked_is_completion"]=False
    out["current_level5_status"]="VERIFIED" if out["evidence_level_5_verified"] else "NOT_VERIFIED"
    out["current_level6_status"]="VERIFIED" if out["evidence_level_6_verified"] else "NOT_VERIFIED"
    out["gate"]="MUSITU_AXIOM_LEVEL56_VERIFIED" if out["evidence_level_6_verified"] else "MUSITU_AXIOM_LEVEL56_IN_PROGRESS"
    return out


def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--receipts", default="/tmp/axiom-level56-receipts")
    parser.add_argument("--replays", default="/tmp/axiom-level56-replays")
    parser.add_argument("--output", default="/tmp/musitu-axiom-level56-readiness.json")
    parser.add_argument("--require-level5", action="store_true")
    parser.add_argument("--require-level6", action="store_true")
    args=parser.parse_args(argv)
    out=build(Path(args.root),Path(args.receipts),Path(args.replays))
    Path(args.output).write_text(json.dumps(out,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps(out,indent=2,sort_keys=True))
    print(out["gate"])
    if args.require_level6 and not out["evidence_level_6_verified"]:
        return 3
    if args.require_level5 and not out["evidence_level_5_verified"]:
        return 2
    return 0


if __name__=="__main__":
    raise SystemExit(main())
