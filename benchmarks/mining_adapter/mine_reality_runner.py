#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import resource
import subprocess
import sys
import tempfile
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from benchmarks.mining_adapter.mine_reality import (
    MineRealitySpec,
    batch_plan,
    evaluate_reality_gate,
    negative_probe_cases,
    reality_fingerprint,
    realistic_row,
    scenario_profile,
)
from benchmarks.mining_adapter.mqtt_field_runner import FieldSession, build_service, latency_summary


def _fault_thresholds(spec: MineRealitySpec) -> tuple[int,...]:
    return tuple(
        max(1,(spec.events*(index+1))//(spec.fault_count+1))
        for index in range(spec.fault_count)
    )


def _wait_duplicates(session: FieldSession, expected: int, timeout: float) -> None:
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        with session.lock:
            observed=session.duplicates
            errors=tuple(session.errors)
        if errors:
            raise RuntimeError("mine_reality_adapter_errors:"+";".join(errors[:5]))
        if observed >= expected:
            return
        time.sleep(0.05)
    raise TimeoutError(f"mine_reality_duplicate_timeout:{session.duplicates}:{expected}")


def _negative_probes(service, spec: MineRealitySpec) -> dict[str,dict[str,Any]]:
    evidence={}
    for name,case in negative_probe_cases(spec).items():
        expected=case["expected_error"]
        error=None
        try:
            service.ingest_mqtt_payload(
                run_id=f"mine-reality-negative-{name}",
                connector_name="mine-reality-negative-probe",
                payload=json.dumps(
                    {"rows":[case["row"]]},
                    sort_keys=True,separators=(",",":"),
                ).encode("utf-8"),
            )
        except ValueError as exc:
            error=str(exc)
        evidence[name]={
            "rejected":error==expected,
            "error":error,
            "expected_error":expected,
        }
    return evidence


def run(args: argparse.Namespace) -> dict[str,Any]:
    spec=MineRealitySpec(
        seed=args.seed,
        events=args.events,
        fault_count=args.fault_count,
        duplicate_batch_every=args.duplicate_batch_every,
        stale_every=args.stale_every,
        out_of_order_every=args.out_of_order_every,
        clock_drift_every=args.clock_drift_every,
        max_recovery_seconds=args.max_recovery_seconds,
    )
    plan=batch_plan(spec)
    thresholds=_fault_thresholds(spec)

    with tempfile.TemporaryDirectory(prefix="musitu-mine-reality-") as directory:
        db_path=Path(directory)/"runs.sqlite3"
        service=build_service(db_path)
        session=FieldSession(
            host=args.host,
            port=args.port,
            label=args.label,
            service=service,
            qos=args.qos,
            timeout=args.connect_timeout,
        )
        recoveries=[]
        faults_observed=0
        try:
            session.start()
            started=time.perf_counter()
            published=0
            next_fault=0
            last_batch_start=0
            last_batch_count=0
            last_batch_index=0

            for batch_index,start_index,count in plan:
                rows=[realistic_row(start_index+offset,spec) for offset in range(count)]
                session.publish_rows("stress",batch_index,rows)
                published += count
                last_batch_start=start_index
                last_batch_count=count
                last_batch_index=batch_index

                while next_fault < len(thresholds) and published >= thresholds[next_fault]:
                    # Drain through the fault boundary so zero-loss recovery is
                    # attributable to reconnect/subscription readiness rather
                    # than an implicit broker retransmit assumption.
                    session.wait_rows("stress",published,args.drain_timeout)
                    before=(session.publisher_disconnects,session.subscriber_disconnects)
                    fault_started=time.perf_counter()
                    subprocess.run(
                        ["docker","restart",args.restart_container],
                        check=True,timeout=60,capture_output=True,text=True,
                    )
                    if not session.pub_connected.wait(spec.max_recovery_seconds):
                        raise TimeoutError("mine_reality_publisher_recovery_timeout")
                    if not session.sub_connected.wait(spec.max_recovery_seconds):
                        raise TimeoutError("mine_reality_subscriber_recovery_timeout")
                    recovery=time.perf_counter()-fault_started
                    after=(session.publisher_disconnects,session.subscriber_disconnects)
                    if not (after[0]>before[0] and after[1]>before[1]):
                        raise RuntimeError("mine_reality_disconnect_reconnect_not_observed")
                    recoveries.append(recovery)
                    faults_observed += 1
                    next_fault += 1

            session.wait_rows("stress",spec.events,args.drain_timeout)
            stress_seconds=time.perf_counter()-started

            duplicate_entries=[
                entry for entry in plan
                if entry[0] > 0 and entry[0] % spec.duplicate_batch_every == 0
            ]
            for batch_index,start_index,count in duplicate_entries:
                rows=[realistic_row(start_index+offset,spec) for offset in range(count)]
                session.publish_rows("stress",batch_index,rows)
            _wait_duplicates(session,len(duplicate_entries),args.drain_timeout)

            last_run=f"field-{args.label}-stress-{last_batch_index}"
            replay=service.replay(last_run)
            expected_rows=[
                realistic_row(last_batch_start+offset,spec)
                for offset in range(last_batch_count)
            ]
            actual_rows=[dict(item) for item in replay.envelope.records]
            replay_verified=actual_rows==expected_rows
            audit_ok=service.store.verify_audit_chain(last_run)
            probes=_negative_probes(service,spec)

            latencies=list(session.latency_ms["stress"])
            if not latencies:
                raise RuntimeError("mine_reality_latency_evidence_missing")
            if session.phase_rows["stress"] != spec.events:
                raise RuntimeError("mine_reality_receive_mismatch")
            if faults_observed != spec.fault_count:
                raise RuntimeError("mine_reality_fault_count_mismatch")

            usage=resource.getrusage(resource.RUSAGE_SELF)
            execution={
                "schema":"musitu.connect.mining.mine_reality_execution.v1",
                "workload_fingerprint":reality_fingerprint(spec),
                "events":spec.events,
                "received":session.phase_rows["stress"],
                "batch_count":len(plan),
                "batch_pattern":list(spec.batch_pattern),
                "duplicate_batches_expected":len(duplicate_entries),
                "duplicate_batches_observed":session.duplicates,
                "scenario_profile":scenario_profile(0,spec.events,spec),
                "fault_count":spec.fault_count,
                "recoveries_observed":faults_observed,
                "fault_recovery_seconds":recoveries,
                "stress_seconds":stress_seconds,
                "throughput_events_per_second":spec.events/stress_seconds,
                "latency_ms":latency_summary(latencies),
                "raw_batch_latency_ms":latencies,
                "replay_records":len(replay.envelope.records),
                "replay_verified":replay_verified,
                "audit_chain_verified":audit_ok,
                "negative_probes":probes,
                "sqlite_bytes":db_path.stat().st_size if db_path.exists() else 0,
                "peak_rss_kib":usage.ru_maxrss,
                "publisher_disconnects":session.publisher_disconnects,
                "subscriber_disconnects":session.subscriber_disconnects,
                "errors":list(session.errors),
                "credentials_used":False,
            }
            qualification=evaluate_reality_gate(spec,execution)
            return {
                "schema":"musitu.connect.mining.mine_reality_evidence.v1",
                "spec":asdict(spec),
                "execution":execution,
                "qualification":qualification,
            }
        finally:
            session.close()
            service.store.close()


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--host",default="127.0.0.1")
    parser.add_argument("--port",type=int,required=True)
    parser.add_argument("--label",default="mine-reality")
    parser.add_argument("--restart-container",required=True)
    parser.add_argument("--events",type=int,default=1_000_000)
    parser.add_argument("--fault-count",type=int,default=3)
    parser.add_argument("--duplicate-batch-every",type=int,default=29)
    parser.add_argument("--stale-every",type=int,default=211)
    parser.add_argument("--out-of-order-every",type=int,default=97)
    parser.add_argument("--clock-drift-every",type=int,default=337)
    parser.add_argument("--max-recovery-seconds",type=float,default=60.0)
    parser.add_argument("--qos",type=int,default=1)
    parser.add_argument("--seed",type=int,default=20261006)
    parser.add_argument("--connect-timeout",type=float,default=120.0)
    parser.add_argument("--drain-timeout",type=float,default=1200.0)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    report=run(args)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps(report,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
