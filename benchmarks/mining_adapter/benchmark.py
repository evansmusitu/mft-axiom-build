#!/usr/bin/env python3
import argparse
import json
import math
import os
import platform
import random
import re
import resource
import statistics
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

ROOT=Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

import numpy as np
import scipy
from scipy.optimize import Bounds, LinearConstraint, milp

from connect.adapters import AdapterCatalog, AdapterContract
from connect.axiom_gateway import AxiomGateway
from connect.core import IntegrationGate
from connect.fabric import ConnectFabric
from connect.mining import normalize_mining_rows, optimize_interventions
from connect.mining_adapter import MiningAdapterService
from connect.persistence import RunStore
from connect.runtime import ConnectRuntime
from connect.workflows import DurableWorkflowBoundary


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _percentile(values: Iterable[float], percentile: float) -> float:
    ordered=sorted(values)
    if not ordered:
        raise ValueError("values_required")
    position=(len(ordered)-1)*percentile
    lower=math.floor(position)
    upper=math.ceil(position)
    if lower == upper:
        return ordered[lower]
    weight=position-lower
    return ordered[lower]*(1-weight)+ordered[upper]*weight


def _latency_summary(samples_ms: list[float]) -> dict[str,float]:
    return {
        "p50": _percentile(samples_ms,0.50),
        "p95": _percentile(samples_ms,0.95),
        "p99": _percentile(samples_ms,0.99),
        "mean": statistics.fmean(samples_ms),
        "min": min(samples_ms),
        "max": max(samples_ms),
    }


def _workload(records: int, seed: int) -> list[dict[str,float|str]]:
    rng=random.Random(seed*1009+records)
    rows=[]
    for index in range(records):
        rows.append({
            "hazard": f"Synthetic hazard {index:05d}",
            "exposure": round(rng.uniform(0.05,1.0),9),
            "severity": round(rng.uniform(1.0,10.0),9),
            "likelihood": round(rng.uniform(0.02,1.0),9),
            "cost": round(rng.uniform(100.0,25000.0),6),
            "benefit": round(rng.uniform(0.02,0.95),9),
        })
    return rows


def _scipy_solution(rows: list[dict], budget: float) -> tuple[float,float]:
    costs=np.asarray([float(row["cost"]) for row in rows],dtype=float)
    reductions=np.asarray([
        float(row["exposure"])*float(row["severity"])*float(row["likelihood"])*float(row["benefit"])
        for row in rows
    ],dtype=float)
    result=milp(
        c=-reductions,
        integrality=np.ones(len(rows),dtype=int),
        bounds=Bounds(np.zeros(len(rows)),np.ones(len(rows))),
        constraints=LinearConstraint(costs,-np.inf,budget),
        options={"disp":False},
    )
    if not result.success or result.x is None:
        raise RuntimeError(f"scipy_milp_failed:{result.message}")
    selected=np.rint(result.x).astype(int)
    return float(reductions @ selected), float(costs @ selected)


def _measure(callable_, warmups: int, repetitions: int) -> tuple[list[float],object]:
    result=None
    for _ in range(warmups):
        result=callable_()
    samples=[]
    for _ in range(repetitions):
        started=time.perf_counter_ns()
        result=callable_()
        samples.append((time.perf_counter_ns()-started)/1_000_000.0)
    return samples,result




def _pipeline_service(path: Path) -> MiningAdapterService:
    catalog=AdapterCatalog()
    catalog.register(AdapterContract(
        name="Mining Adapter",domain="mining",version="1.0.0",normalize=normalize_mining_rows
    ))
    runtime=ConnectRuntime(
        catalog=catalog,
        fabric=ConnectFabric(signing_secret=b"benchmark-signing-secret"),
        axiom=AxiomGateway(IntegrationGate()),
    )
    workflow=DurableWorkflowBoundary(qualified=True,executor=lambda _workflow_id, action: action())
    return MiningAdapterService(runtime=runtime,store=RunStore(path),workflow=workflow)


def _benchmark_pipeline(rows: list[dict], budget: float, warmups: int, repetitions: int, scale: int) -> dict:
    payload=json.dumps({"rows":rows},separators=(",",":"),sort_keys=True).encode("utf-8")
    with tempfile.TemporaryDirectory() as directory:
        service=_pipeline_service(Path(directory)/"runs.sqlite3")
        sequence=0
        def once(measure: bool):
            nonlocal sequence
            sequence += 1
            run_id=f"bench-{scale}-{sequence}"
            started=time.perf_counter_ns()
            service.ingest_mqtt_payload(
                run_id=run_id,connector_name="benchmark-mqtt",payload=payload
            )
            ingest_ms=(time.perf_counter_ns()-started)/1_000_000.0
            started=time.perf_counter_ns()
            service.plan(run_id,budget=budget)
            plan_ms=(time.perf_counter_ns()-started)/1_000_000.0
            started=time.perf_counter_ns()
            service.replay(run_id)
            replay_ms=(time.perf_counter_ns()-started)/1_000_000.0
            return ingest_ms,plan_ms,replay_ms

        for _ in range(warmups):
            once(False)
        samples={"ingest":[],"plan":[],"replay":[],"total":[]}
        for _ in range(repetitions):
            ingest_ms,plan_ms,replay_ms=once(True)
            samples["ingest"].append(ingest_ms)
            samples["plan"].append(plan_ms)
            samples["replay"].append(replay_ms)
            samples["total"].append(ingest_ms+plan_ms+replay_ms)
        service.store.close()
    summaries={name:_latency_summary(values) for name,values in samples.items()}
    return {
        "records":scale,
        "latency_ms":summaries,
        "raw_samples_ms":samples,
        "throughput_records_per_second":{
            "total_p50":scale/(summaries["total"]["p50"]/1000.0),
            "ingest_p50":scale/(summaries["ingest"]["p50"]/1000.0),
        },
    }


def _qualification_topology_metrics() -> dict:
    compose_path=ROOT/"infra"/"qualification"/"docker-compose.yml"
    requirements_path=ROOT/"infra"/"qualification"/"requirements.txt"
    versions_path=ROOT/"infra"/"versions.lock"
    compose_text=compose_path.read_text()
    requirements_text=requirements_path.read_text()
    versions_text=versions_path.read_text()

    services=[]
    in_services=False
    for line in compose_text.splitlines():
        if line.strip()=="services:" and not line.startswith(" "):
            in_services=True
            continue
        if in_services and line and not line.startswith(" "):
            break
        if in_services:
            match=re.match(r"^  ([A-Za-z0-9_.-]+):\s*$",line)
            if match:
                services.append(match.group(1))

    dependencies=[
        line.strip() for line in requirements_text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    components=[]
    in_components=False
    for line in versions_text.splitlines():
        if line.strip()=="components:" and not line.startswith(" "):
            in_components=True
            continue
        if in_components and line and not line.startswith(" "):
            break
        if in_components:
            match=re.match(r"^  ([A-Za-z0-9_]+):\s*$",line)
            if match:
                components.append(match.group(1))

    return {
        "comparison_status":"NOT_COMPARABLE",
        "reason":"These are reproducible MUSITU qualification-topology proxies, not a same-deployment cross-vendor operations/TCO comparison.",
        "qualification_topology":{
            "compose_service_count":len(services),
            "compose_services":services,
            "python_dependency_count":len(dependencies),
            "pinned_component_count":len(components),
            "compose_file_bytes":compose_path.stat().st_size,
            "requirements_file_bytes":requirements_path.stat().st_size,
            "versions_lock_bytes":versions_path.stat().st_size,
        },
    }


def run_benchmark(
    *,
    scales: tuple[int,...]=(16,32,64,128,256),
    warmups: int=5,
    repetitions: int=30,
    seed: int=20261006,
) -> dict:
    if not scales or any(value <= 0 for value in scales):
        raise ValueError("positive_scales_required")
    if warmups < 0 or repetitions <= 0:
        raise ValueError("invalid_repetition_schedule")

    optimization=[]
    canonical_pipeline=[]
    for count in scales:
        rows=_workload(count,seed)
        envelope=normalize_mining_rows(rows)
        budget=sum(float(row["cost"]) for row in rows)*0.25

        musitu_samples,musitu_plan=_measure(
            lambda: optimize_interventions(envelope,budget),warmups,repetitions
        )
        scipy_samples,scipy_pair=_measure(
            lambda: _scipy_solution(rows,budget),warmups,repetitions
        )
        scipy_reduction,scipy_spend=scipy_pair
        objective_tolerance=max(1e-9,abs(scipy_reduction)*1e-9)
        musitu_summary=_latency_summary(musitu_samples)
        scipy_summary=_latency_summary(scipy_samples)
        optimization.append({
            "records": count,
            "budget": budget,
            "correctness": {
                "objective_matches_scipy_milp": abs(musitu_plan.risk_reduction-scipy_reduction) <= objective_tolerance,
                "objective_abs_delta": abs(musitu_plan.risk_reduction-scipy_reduction),
                "tolerance": objective_tolerance,
                "musitu_risk_reduction": musitu_plan.risk_reduction,
                "scipy_risk_reduction": scipy_reduction,
                "musitu_spend": musitu_plan.spend,
                "scipy_spend": scipy_spend,
            },
            "latency_ms": {
                "musitu_exact": musitu_summary,
                "scipy_milp": scipy_summary,
            },
            "raw_samples_ms": {
                "musitu_exact": musitu_samples,
                "scipy_milp": scipy_samples,
            },
            "throughput_records_per_second": {
                "musitu_exact": count/(musitu_summary["p50"]/1000.0),
                "scipy_milp": count/(scipy_summary["p50"]/1000.0),
            },
            "comparison": {
                "latency_p50_ratio_musitu_over_scipy": musitu_summary["p50"]/scipy_summary["p50"],
                "winner_p50_latency": (
                    "MUSITU Connect" if musitu_summary["p50"] < scipy_summary["p50"]
                    else "SciPy MILP" if scipy_summary["p50"] < musitu_summary["p50"]
                    else "TIE"
                ),
            },
        })
        canonical_pipeline.append(
            _benchmark_pipeline(rows,budget,warmups,repetitions,count)
        )

    usage=resource.getrusage(resource.RUSAGE_SELF)
    return {
        "schema":"musitu.connect.mining.benchmark.v1",
        "generated_at_utc":_now(),
        "source_commit":os.getenv("GITHUB_SHA") or "LOCAL_WORKTREE",
        "methodology":{
            "seed":seed,
            "warmups":warmups,
            "repetitions":repetitions,
            "statistics":"linear-interpolated p50/p95/p99 over wall-clock perf_counter_ns samples",
            "budget_fraction":0.25,
            "workload":"deterministic synthetic independent hazard interventions",
            "canonical_pipeline":"in-process JSON ingress -> normalize/sign -> SQLite WAL persist -> exact plan -> verified replay",
            "raw_samples_preserved":True,
        },
        "runtime":{
            "python":platform.python_version(),
            "scipy":scipy.__version__,
            "numpy":np.__version__,
            "platform":platform.platform(),
            "machine":platform.machine(),
            "processor":platform.processor(),
            "cpu_count":os.cpu_count(),
            "peak_rss_kib":usage.ru_maxrss,
        },
        "cost":{
            "monetary_cost":"NOT_COMPARABLE",
            "reason":"Equivalent licensed commercial deployments on identical hardware/workloads were not available in this run.",
            "resource_proxies":["latency_ms","throughput_records_per_second","peak_rss_kib"],
        },
        "operational_complexity":_qualification_topology_metrics(),
        "optimization":optimization,
        "canonical_pipeline":canonical_pipeline,
    }


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--scales",default="16,32,64,128,256")
    parser.add_argument("--warmups",type=int,default=5)
    parser.add_argument("--repetitions",type=int,default=30)
    parser.add_argument("--seed",type=int,default=20261006)
    parser.add_argument("--output",type=Path)
    args=parser.parse_args()
    report=run_benchmark(
        scales=tuple(int(value) for value in args.scales.split(",") if value),
        warmups=args.warmups,
        repetitions=args.repetitions,
        seed=args.seed,
    )
    rendered=json.dumps(report,indent=2,sort_keys=True)+"\n"
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(rendered)
    print(rendered,end="")


if __name__ == "__main__":
    main()
