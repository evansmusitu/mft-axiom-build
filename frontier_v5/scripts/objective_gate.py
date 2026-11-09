#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import argparse
import json
import sys


def evaluate(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    workstreams = data.get("workstreams")
    if not isinstance(workstreams, list) or not workstreams:
        raise ValueError("workstreams must be a non-empty list")
    failures = []
    seen = set()
    for item in workstreams:
        if not isinstance(item, dict):
            raise ValueError("each workstream must be an object")
        wid = item.get("id")
        if not wid or wid in seen:
            raise ValueError("workstream ids must be unique and non-empty")
        seen.add(wid)
        required = bool(item.get("required"))
        status = item.get("status")
        if status not in {"TARGET", "PARTIAL", "IMPLEMENTED_CORE", "VERIFIED"}:
            raise ValueError(f"invalid status for {wid}: {status}")
        runtime = item.get("runtime", [])
        remaining = item.get("remaining", [])
        if not isinstance(runtime, list) or not isinstance(remaining, list):
            raise ValueError(f"runtime/remaining must be arrays for {wid}")
        if required and status != "VERIFIED":
            failures.append({"id": wid, "status": status, "remaining": remaining})
        if status == "VERIFIED" and (not runtime or remaining):
            failures.append({"id": wid, "status": status, "reason": "VERIFIED requires runtime anchors and no remaining items"})
    status = "PASS" if not failures else "FAIL"
    return {
        "gate": "MUSITU_AXIOM_FIVE_YEAR_FRONTIER_OBJECTIVE",
        "status": status,
        "required_workstreams": sum(1 for w in workstreams if w.get("required")),
        "verified_workstreams": sum(1 for w in workstreams if w.get("required") and w.get("status") == "VERIFIED"),
        "failures": failures,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--objective", default="frontier_v5/FIVE_YEAR_FRONTIER_OBJECTIVE.json")
    ap.add_argument("--allow-fail", action="store_true")
    args = ap.parse_args()
    result = evaluate(Path(args.objective))
    print(json.dumps(result, indent=2, sort_keys=True))
    if result["status"] != "PASS" and not args.allow_fail:
        sys.exit(2)


if __name__ == "__main__":
    main()
