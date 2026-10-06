from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Any

from benchmarks.mining_adapter.industrial_field import mining_row


@dataclass(frozen=True)
class MineRealitySpec:
    """Deterministic synthetic mine-operations stress contract.

    This workload is intentionally adversarial but is not customer mine data and
    must never be represented as mine-safety certification evidence.
    """

    schema: str="musitu.connect.mining.mine_reality_workload.v1"
    seed: int=20261006
    events: int=1_000_000
    fault_count: int=3
    duplicate_batch_every: int=29
    stale_every: int=211
    out_of_order_every: int=97
    clock_drift_every: int=337
    max_recovery_seconds: float=60.0
    batch_pattern: tuple[int,...]=(64,512,3000,128,2048,32,1500,256)

    def __post_init__(self) -> None:
        if self.events < 1:
            raise ValueError("events_must_be_positive")
        if self.fault_count < 1:
            raise ValueError("fault_count_must_be_positive")
        for name,value in (
            ("duplicate_batch_every",self.duplicate_batch_every),
            ("stale_every",self.stale_every),
            ("out_of_order_every",self.out_of_order_every),
            ("clock_drift_every",self.clock_drift_every),
        ):
            if value < 1:
                raise ValueError(f"{name}_must_be_positive")
        if self.max_recovery_seconds <= 0:
            raise ValueError("max_recovery_seconds_must_be_positive")
        if not self.batch_pattern or any(value < 1 or value > 3000 for value in self.batch_pattern):
            raise ValueError("batch_pattern_invalid")


def _event_time(row: dict[str,Any]) -> datetime:
    return datetime.fromisoformat(str(row["event_time"]).replace("Z","+00:00"))


def _format_event_time(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00","Z")


def scenario_for_index(index: int, spec: MineRealitySpec) -> str:
    if index < 0:
        raise ValueError("index_must_be_nonnegative")
    # Mutually exclusive precedence keeps aggregate evidence exact and makes
    # every generated event independently reproducible.
    if index and index % spec.stale_every == 0:
        return "stale"
    if index and index % spec.out_of_order_every == 0:
        return "out_of_order"
    if index and index % spec.clock_drift_every == 0:
        return "clock_drift"
    return "clean"


def realistic_row(index: int, spec: MineRealitySpec) -> dict[str,Any]:
    row=mining_row(index,spec.seed)
    scenario=scenario_for_index(index,spec)
    timestamp=_event_time(row)
    if scenario=="stale":
        timestamp -= timedelta(hours=24)
    elif scenario=="out_of_order":
        timestamp -= timedelta(minutes=3)
    elif scenario=="clock_drift":
        timestamp += timedelta(minutes=5)
    row["event_time"]=_format_event_time(timestamp)
    return row


def scenario_profile(start_index: int, count: int, spec: MineRealitySpec) -> dict[str,int]:
    if start_index < 0:
        raise ValueError("start_index_must_be_nonnegative")
    if count < 0:
        raise ValueError("count_must_be_nonnegative")
    profile={"clean":0,"stale":0,"out_of_order":0,"clock_drift":0}
    for index in range(start_index,start_index+count):
        profile[scenario_for_index(index,spec)] += 1
    return profile


def batch_plan(spec: MineRealitySpec) -> tuple[tuple[int,int,int],...]:
    """Return (batch_index,start_index,count) for the complete workload."""
    plan=[]
    cursor=0
    batch_index=0
    pattern_index=0
    while cursor < spec.events:
        take=min(spec.batch_pattern[pattern_index % len(spec.batch_pattern)],spec.events-cursor)
        plan.append((batch_index,cursor,take))
        cursor += take
        batch_index += 1
        pattern_index += 1
    return tuple(plan)


def reality_fingerprint(spec: MineRealitySpec) -> str:
    last=max(0,spec.events-1)
    sample_indices=sorted({0,min(last,97),min(last,211),min(last,337),last})
    payload={
        "spec":asdict(spec),
        "samples":[realistic_row(index,spec) for index in sample_indices],
        "profile":scenario_profile(0,spec.events,spec),
    }
    raw=json.dumps(payload,sort_keys=True,separators=(",",":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def negative_probe_cases(spec: MineRealitySpec) -> dict[str,dict[str,Any]]:
    base=realistic_row(min(42,spec.events-1),spec)

    missing=dict(base)
    missing.pop("severity")

    out_of_range=dict(base)
    out_of_range["likelihood"]=1.2

    invalid_timestamp=dict(base)
    invalid_timestamp["event_time"]="2026-99-99T25:61:00Z"

    unknown=dict(base)
    unknown["temperature"]=91.5

    return {
        "missing_required":{"row":missing,"expected_error":"missing_fields:severity"},
        "out_of_range":{"row":out_of_range,"expected_error":"value_out_of_range"},
        "invalid_timestamp":{"row":invalid_timestamp,"expected_error":"event_time_invalid"},
        "unknown_field":{"row":unknown,"expected_error":"unknown_fields:temperature"},
    }


def _positive(value: Any) -> bool:
    return isinstance(value,(int,float)) and value > 0


def evaluate_reality_gate(spec: MineRealitySpec, report: dict[str,Any]) -> dict[str,Any]:
    expected_profile=scenario_profile(0,spec.events,spec)
    observed_profile=report.get("scenario_profile")
    profile_ok=(
        isinstance(observed_profile,dict)
        and all(int(observed_profile.get(key,-1))==value for key,value in expected_profile.items())
    )

    expected_duplicates=int(report.get("duplicate_batches_expected") or 0)
    observed_duplicates=int(report.get("duplicate_batches_observed") or 0)
    duplicates_ok=expected_duplicates > 0 and observed_duplicates >= expected_duplicates

    recoveries=report.get("fault_recovery_seconds")
    recovery_ok=(
        int(report.get("fault_count") or 0) == spec.fault_count
        and int(report.get("recoveries_observed") or 0) == spec.fault_count
        and isinstance(recoveries,list)
        and len(recoveries)==spec.fault_count
        and all(_positive(value) and float(value) <= spec.max_recovery_seconds for value in recoveries)
    )

    probes=report.get("negative_probes")
    expected_probes=negative_probe_cases(spec)
    probes_ok=isinstance(probes,dict) and all(
        isinstance(probes.get(name),dict)
        and probes[name].get("rejected") is True
        and probes[name].get("expected_error")==case["expected_error"]
        and probes[name].get("error")==case["expected_error"]
        for name,case in expected_probes.items()
    )

    latency=report.get("latency_ms")
    execution_ok=(
        report.get("schema")=="musitu.connect.mining.mine_reality_execution.v1"
        and report.get("workload_fingerprint")==reality_fingerprint(spec)
        and int(report.get("events") or 0)==spec.events
        and int(report.get("received") or 0)==spec.events
        and profile_ok
        and duplicates_ok
        and recovery_ok
        and _positive(report.get("throughput_events_per_second"))
        and isinstance(latency,dict)
        and all(_positive(latency.get(key)) for key in ("p50","p95","p99"))
        and report.get("replay_verified") is True
        and report.get("audit_chain_verified") is True
        and probes_ok
        and report.get("credentials_used") is False
        and report.get("errors")==[]
    )

    return {
        "schema":"musitu.connect.mining.mine_reality_qualification.v1",
        "workload_fingerprint":reality_fingerprint(spec),
        "reality_qualified":execution_ok,
        "gate":"MINE_REALITY_QUALIFIED" if execution_ok else "MINE_REALITY_FAILED",
        "capabilities":[
            {"id":"telemetry.mixed_asset_anomalies","status":"PASS" if profile_ok else "FAIL"},
            {"id":"mqtt.duplicate_delivery_suppression","status":"PASS" if duplicates_ok else "FAIL"},
            {"id":"mqtt.multi_fault_recovery","status":"PASS" if recovery_ok else "FAIL"},
            {"id":"telemetry.fail_closed_negative_probes","status":"PASS" if probes_ok else "FAIL"},
            {
                "id":"durability.replay_audit",
                "status":"PASS" if report.get("replay_verified") is True and report.get("audit_chain_verified") is True else "FAIL",
            },
        ],
        "claim_policy":{
            "customer_data":"PROHIBITED: this is deterministic synthetic mine-operational telemetry, not customer mine data.",
            "safety_certification":"PROHIBITED: qualification is software evidence, not mine-safety certification.",
            "superiority":"PROHIBITED: this gate contains no identical licensed product comparator.",
        },
    }
