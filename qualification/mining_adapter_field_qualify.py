#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from benchmarks.mining_adapter.industrial_field import IndustrialWorkloadSpec, evaluate_field_gate


def load(path: Path | None) -> dict[str,Any] | None:
    if path is None: return None
    return json.loads(path.read_text())


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    p=argparse.ArgumentParser()
    p.add_argument("--musitu-mqtt",type=Path,required=True)
    p.add_argument("--emqx-mqtt",type=Path,required=True)
    p.add_argument("--opcua",type=Path,required=True)
    p.add_argument("--highbyte",type=Path)
    p.add_argument("--azure",type=Path)
    p.add_argument("--events",type=int,default=1_000_000)
    p.add_argument("--opcua-data-points",type=int,default=1_000_000)
    p.add_argument("--soak-seconds",type=int,default=600)
    p.add_argument("--seed",type=int,default=20261006)
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()

    spec=IndustrialWorkloadSpec(
        seed=args.seed,mqtt_events=args.events,opcua_data_points=args.opcua_data_points,
        soak_seconds=args.soak_seconds,
    )
    musitu=load(args.musitu_mqtt); emqx=load(args.emqx_mqtt); opcua=load(args.opcua)
    assert musitu is not None and emqx is not None and opcua is not None
    report=evaluate_field_gate(
        spec=spec,musitu_mqtt=musitu,opcua=opcua,emqx_mqtt=emqx,
        highbyte=load(args.highbyte),azure=load(args.azure),
    )
    emqx_outcome=next(x for x in report["comparisons"] if x["baseline"]=="EMQX Enterprise")["outcome"]
    execution_passed=report["field_load_qualified"] and emqx_outcome in ("WIN","TIE","LOSS")
    report.update({
        "generated_at_utc":datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z"),
        "source_commit":os.getenv("GITHUB_SHA") or "LOCAL_WORKTREE",
        "workflow_run_id":os.getenv("GITHUB_RUN_ID"),
        "execution_passed":execution_passed,
        "input_sha256":{
            "musitu_mqtt":digest(args.musitu_mqtt),
            "emqx_mqtt":digest(args.emqx_mqtt),
            "opcua":digest(args.opcua),
        },
        "limitations":[
            "HighByte remains BLOCKED until explicit EULA acceptance and a configured same-workload runtime exist.",
            "Azure IoT Operations remains BLOCKED until a legitimate Arc-enabled Kubernetes performance deployment exists.",
            "The EMQX result isolates the MQTT-broker choice because the MUSITU adapter code and workload are held constant.",
            "This field benchmark uses deterministic mining telemetry, not a customer's mine dataset or safety certification evidence."
        ],
    })
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps(report,indent=2,sort_keys=True))
    raise SystemExit(0 if execution_passed else 1)


if __name__=="__main__": main()
