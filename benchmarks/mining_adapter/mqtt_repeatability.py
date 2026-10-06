#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import resource
import sys
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from statistics import median
from typing import Any


ROOT=Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))


@dataclass(frozen=True)
class MqttRepeatabilitySpec:
    schema: str="musitu.connect.mining.mqtt_repeatability.v1"
    events: int=1_000_000
    batch_size: int=3000
    trials: int=4
    seed: int=20261006
    qos: int=1
    tie_band_fraction: float=0.05

    def __post_init__(self) -> None:
        if self.events < 1_000_000:
            raise ValueError("repeatability_million_event_minimum")
        if self.batch_size < 1:
            raise ValueError("repeatability_batch_size_required")
        if self.trials < 4:
            raise ValueError("repeatability_trials_required")
        if self.qos not in (0,1,2):
            raise ValueError("repeatability_qos_invalid")
        if not 0 <= self.tie_band_fraction < 1:
            raise ValueError("repeatability_tie_band_invalid")


def counterbalanced_order(trials: int) -> list[tuple[str,str]]:
    if trials < 4:
        raise ValueError("repeatability_trials_required")
    return [
        ("reference","emqx") if index % 2 == 0 else ("emqx","reference")
        for index in range(trials)
    ]


def comparison_fingerprint(spec: MqttRepeatabilitySpec) -> str:
    raw=json.dumps(asdict(spec),sort_keys=True,separators=(",",":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _positive_float(value: Any, name: str) -> float:
    if not isinstance(value,(int,float)) or value <= 0:
        raise ValueError(f"repeatability_metric_invalid:{name}")
    return float(value)


def _paired_outcome(left: float, right: float, tie_band: float, *, higher_is_better: bool) -> str:
    if left <= 0 or right <= 0:
        return "INVALID"
    ratio=left/right
    if abs(ratio-1.0) <= tie_band:
        return "TIE"
    if higher_is_better:
        return "WIN" if ratio > 1 else "LOSS"
    return "WIN" if ratio < 1 else "LOSS"


def _validate_trials(spec: MqttRepeatabilitySpec, reference: list[dict[str,Any]], emqx: list[dict[str,Any]]) -> None:
    if len(reference) < spec.trials or len(emqx) < spec.trials:
        raise ValueError("repeatability_trials_required")
    if len(reference) != spec.trials or len(emqx) != spec.trials:
        raise ValueError("repeatability_trial_count_mismatch")
    expected=list(range(spec.trials))
    reference_rounds=sorted(int(item.get("round",-1)) for item in reference)
    emqx_rounds=sorted(int(item.get("round",-1)) for item in emqx)
    if reference_rounds != expected or emqx_rounds != expected:
        raise ValueError("repeatability_round_mismatch")


def _dimension_summary(
    *,
    spec: MqttRepeatabilitySpec,
    reference: list[dict[str,Any]],
    emqx: list[dict[str,Any]],
    field: str,
    higher_is_better: bool,
) -> dict[str,Any]:
    ref_by_round={int(item["round"]):item for item in reference}
    emqx_by_round={int(item["round"]):item for item in emqx}
    ref_values=[_positive_float(ref_by_round[i][field],f"reference.{field}") for i in range(spec.trials)]
    emqx_values=[_positive_float(emqx_by_round[i][field],f"emqx.{field}") for i in range(spec.trials)]
    ref_median=float(median(ref_values))
    emqx_median=float(median(emqx_values))
    median_outcome=_paired_outcome(
        ref_median,emqx_median,spec.tie_band_fraction,higher_is_better=higher_is_better
    )
    round_outcomes=[
        _paired_outcome(ref_values[i],emqx_values[i],spec.tie_band_fraction,higher_is_better=higher_is_better)
        for i in range(spec.trials)
    ]
    consistent=sum(1 for outcome in round_outcomes if outcome==median_outcome)
    minimum_consistent=max(3,math.ceil(spec.trials*0.75))
    repeatable=median_outcome in ("WIN","TIE","LOSS") and consistent >= minimum_consistent
    return {
        "reference_median":ref_median,
        "emqx_median":emqx_median,
        "reference_outcome":median_outcome if repeatable else "INCONCLUSIVE",
        "median_outcome":median_outcome,
        "consistent_rounds":consistent,
        "minimum_consistent_rounds":minimum_consistent,
        "round_outcomes":round_outcomes,
        "repeatable":repeatable,
    }


def aggregate_repeatability(
    spec: MqttRepeatabilitySpec,
    reference: list[dict[str,Any]],
    emqx: list[dict[str,Any]],
) -> dict[str,Any]:
    _validate_trials(spec,reference,emqx)
    throughput=_dimension_summary(
        spec=spec,reference=reference,emqx=emqx,
        field="throughput_events_per_second",higher_is_better=True,
    )
    latency=_dimension_summary(
        spec=spec,reference=reference,emqx=emqx,
        field="p99_ms",higher_is_better=False,
    )
    return {
        "schema":"musitu.connect.mining.mqtt_repeatability_summary.v1",
        "comparison_fingerprint":comparison_fingerprint(spec),
        "trials":spec.trials,
        "events_per_trial":spec.events,
        "batch_size":spec.batch_size,
        "counterbalanced_order":[list(item) for item in counterbalanced_order(spec.trials)],
        "throughput":throughput,
        "p99_latency":latency,
        "repeatability_passed":throughput["repeatable"] and latency["repeatable"],
        "scope":"MUSITU Mining Adapter reference MQTT path (Mosquitto) versus the same adapter/workload backed by EMQX Enterprise; not a product-wide MUSITU-vs-EMQX claim.",
        "raw_trials":{
            "reference":reference,
            "emqx":emqx,
        },
    }


def run_stress_lane(
    *,
    host: str,
    port: int,
    label: str,
    broker_version: str,
    spec: MqttRepeatabilitySpec,
    round_index: int,
    position: int,
    drain_timeout: float,
) -> dict[str,Any]:
    # Runtime-only imports keep the aggregation contract dependency-light for
    # ordinary unit/qualification suites.
    from benchmarks.mining_adapter.industrial_field import mining_row
    from benchmarks.mining_adapter.mqtt_field_runner import FieldSession, build_service, latency_summary

    stress_batches=math.ceil(spec.events/spec.batch_size)
    with tempfile.TemporaryDirectory(prefix=f"musitu-repeat-{label}-{round_index}-") as directory:
        db_path=Path(directory)/"runs.sqlite3"
        service=build_service(db_path)
        session=FieldSession(
            host=host,port=port,label=f"repeat-{label}-r{round_index}",
            service=service,qos=spec.qos,
        )
        try:
            session.start()
            started=time.perf_counter()
            cursor=0
            for batch_index in range(stress_batches):
                take=min(spec.batch_size,spec.events-cursor)
                rows=[mining_row(cursor+i,spec.seed) for i in range(take)]
                session.publish_rows("stress",batch_index,rows)
                cursor += take
            publish_seconds=time.perf_counter()-started
            session.wait_rows("stress",spec.events,drain_timeout)
            stress_seconds=time.perf_counter()-started
            latencies=list(session.latency_ms["stress"])
            if not latencies:
                raise RuntimeError("repeatability_latency_evidence_missing")
            if session.phase_rows["stress"] != spec.events:
                raise RuntimeError("repeatability_receive_mismatch")
            if session.duplicates != 0:
                raise RuntimeError("repeatability_duplicate_delivery")
            if session.errors:
                raise RuntimeError("repeatability_adapter_errors:"+";".join(session.errors[:5]))
            last_run=f"field-repeat-{label}-r{round_index}-stress-{stress_batches-1}"
            replay=service.replay(last_run)
            if not service.store.verify_audit_chain(last_run):
                raise RuntimeError("repeatability_audit_chain_invalid")
            usage=resource.getrusage(resource.RUSAGE_SELF)
            summary=latency_summary(latencies)
            return {
                "round":round_index,
                "position":position,
                "lane":label,
                "broker_version":broker_version,
                "events":spec.events,
                "received":session.phase_rows["stress"],
                "duplicates":session.duplicates,
                "batch_size":spec.batch_size,
                "batches":stress_batches,
                "publish_seconds":publish_seconds,
                "stress_seconds":stress_seconds,
                "throughput_events_per_second":spec.events/stress_seconds,
                "p99_ms":summary["p99"],
                "latency_ms":summary,
                "raw_batch_latency_ms":latencies,
                "adapter_replay_records":len(replay.envelope.records),
                "audit_chain_verified":True,
                "peak_rss_kib":usage.ru_maxrss,
                "errors":list(session.errors),
                "credentials_used":False,
            }
        finally:
            session.close()
            service.store.close()


def execute(args: argparse.Namespace) -> dict[str,Any]:
    spec=MqttRepeatabilitySpec(
        events=args.events,batch_size=args.batch_size,trials=args.trials,
        seed=args.seed,qos=args.qos,tie_band_fraction=args.tie_band_fraction,
    )
    endpoints={
        "reference":("127.0.0.1",args.reference_port,"Mosquitto 2.1.2"),
        "emqx":("127.0.0.1",args.emqx_port,"EMQX Enterprise 6.3.1"),
    }
    raw={"reference":[],"emqx":[]}
    for round_index,order in enumerate(counterbalanced_order(spec.trials)):
        for position,lane in enumerate(order):
            host,port,version=endpoints[lane]
            raw[lane].append(run_stress_lane(
                host=host,port=port,label=lane,broker_version=version,
                spec=spec,round_index=round_index,position=position,
                drain_timeout=args.drain_timeout,
            ))
    aggregate=aggregate_repeatability(spec,raw["reference"],raw["emqx"])
    return {
        "schema":"musitu.connect.mining.mqtt_repeatability_evidence.v1",
        "spec":asdict(spec),
        "comparison_fingerprint":comparison_fingerprint(spec),
        "aggregate":aggregate,
    }


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--reference-port",type=int,required=True)
    parser.add_argument("--emqx-port",type=int,required=True)
    parser.add_argument("--events",type=int,default=1_000_000)
    parser.add_argument("--batch-size",type=int,default=3000)
    parser.add_argument("--trials",type=int,default=4)
    parser.add_argument("--seed",type=int,default=20261006)
    parser.add_argument("--qos",type=int,default=1)
    parser.add_argument("--tie-band-fraction",type=float,default=0.05)
    parser.add_argument("--drain-timeout",type=float,default=900.0)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    report=execute(args)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps(report,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
