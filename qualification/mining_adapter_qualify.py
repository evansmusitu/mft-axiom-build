#!/usr/bin/env python3
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT=Path(__file__).resolve().parents[1]
MATRIX_PATH=ROOT/"qualification"/"mining_adapter_matrix.json"
BASELINES_PATH=ROOT/"benchmarks"/"mining_adapter"/"baselines.json"


def _stage(report: dict[str,Any], name: str) -> bool:
    for item in report.get("results") or []:
        if item.get("name") == name:
            return item.get("status") == "PASS"
    return False


def _pass(identifier: str, passed: bool, evidence: str, detail: Any=None) -> dict[str,Any]:
    return {
        "id":identifier,
        "status":"PASS" if passed else "FAIL",
        "evidence":evidence,
        "detail":detail,
    }


def evaluate(
    *,
    pre: dict[str,Any],
    post: dict[str,Any],
    benchmark: dict[str,Any],
    live_guard: dict[str,Any],
    production_gate: dict[str,Any],
    baseline_catalog: dict[str,Any] | None=None,
) -> dict[str,Any]:
    matrix=json.loads(MATRIX_PATH.read_text())
    baseline_catalog=baseline_catalog or json.loads(BASELINES_PATH.read_text())
    thresholds=matrix["thresholds"]
    baseline_versions=matrix.get("baseline_versions") or {}
    tests=production_gate.get("tests") or {}
    optimization=benchmark.get("optimization") or []
    largest=max(optimization,key=lambda item:item.get("records",0),default={})
    min_records=int(thresholds["minimum_optimization_records"])
    has_scale=int(largest.get("records") or 0) >= min_records
    all_correct=bool(optimization) and all(
        item.get("correctness",{}).get("objective_matches_scipy_milp") is True
        for item in optimization
    )
    p99=(largest.get("latency_ms",{}).get("musitu_exact",{}).get("p99"))
    optimization_slo=has_scale and isinstance(p99,(int,float)) and p99 <= float(thresholds["optimization_p99_ms_max"])
    pre_runtime=pre.get("runtime_seconds")
    post_runtime=post.get("runtime_seconds")
    runtime_slo=(
        isinstance(pre_runtime,(int,float)) and isinstance(post_runtime,(int,float))
        and pre_runtime <= float(thresholds["composed_e2e_runtime_seconds_max"])
        and post_runtime <= float(thresholds["composed_e2e_runtime_seconds_max"])
    )
    resource_runtime=benchmark.get("runtime") or {}
    scipy_version=str(resource_runtime.get("scipy") or "")
    required_scipy=str(baseline_versions.get("scipy") or "")
    current_scipy=(not required_scipy) or scipy_version==required_scipy
    largest_throughput=largest.get("throughput_records_per_second",{}).get("musitu_exact")
    catalog_versions={item.get("name"):str(item.get("version") or "") for item in baseline_catalog.get("baselines") or []}
    expected_catalog={
        "HighByte Intelligence Hub":str(baseline_versions.get("highbyte") or ""),
        "DuckDB":str(baseline_versions.get("duckdb") or ""),
        "OpenTelemetry Collector":str(baseline_versions.get("opentelemetry_collector") or ""),
        "Temporal":f"server {baseline_versions.get('temporal_server')} / Python SDK {baseline_versions.get('temporal_python_sdk')}",
    }
    baseline_catalog_current=all(expected and catalog_versions.get(name)==expected for name,expected in expected_catalog.items())

    repetitions=int((benchmark.get("methodology") or {}).get("repetitions") or 0)
    def valid_samples(values: Any) -> bool:
        return (
            repetitions > 0 and isinstance(values,list) and len(values)==repetitions
            and all(isinstance(value,(int,float)) and value >= 0 for value in values)
        )
    optimization_raw=bool(optimization) and all(
        valid_samples((item.get("raw_samples_ms") or {}).get(name))
        for item in optimization for name in ("musitu_exact","scipy_milp")
    )
    pipeline=benchmark.get("canonical_pipeline") or []
    pipeline_raw=bool(pipeline) and all(
        valid_samples((item.get("raw_samples_ms") or {}).get(name))
        for item in pipeline for name in ("ingest","plan","replay","total")
    )
    raw_samples_complete=optimization_raw and pipeline_raw
    largest_pipeline=max(pipeline,key=lambda item:item.get("records",0),default={})
    pipeline_total=(largest_pipeline.get("latency_ms") or {}).get("total") or {}
    pipeline_throughput=(largest_pipeline.get("throughput_records_per_second") or {}).get("total_p50")
    pipeline_scale_evidence=(
        int(largest_pipeline.get("records") or 0) >= min_records
        and all(isinstance(pipeline_total.get(key),(int,float)) and pipeline_total.get(key)>0 for key in ("p50","p95","p99"))
        and isinstance(pipeline_throughput,(int,float)) and pipeline_throughput>0
    )
    operational=benchmark.get("operational_complexity") or {}
    topology=operational.get("qualification_topology") or {}
    operational_evidence=(
        operational.get("comparison_status")=="NOT_COMPARABLE"
        and all(isinstance(topology.get(key),(int,float)) and topology.get(key)>0 for key in (
            "compose_service_count","python_dependency_count","pinned_component_count","compose_file_bytes"
        ))
        and isinstance(topology.get("compose_services"),list)
        and len(topology.get("compose_services"))==topology.get("compose_service_count")
    )
    cost=benchmark.get("cost") or {}
    cost_evidence=(
        cost.get("monetary_cost")=="NOT_COMPARABLE"
        and all(name in (cost.get("resource_proxies") or []) for name in (
            "latency_ms","throughput_records_per_second","peak_rss_kib"
        ))
    )

    capabilities=[
        _pass("ingestion.mqtt",_stage(post,"mqtt_to_canonical_persistence"),"post-recovery composed e2e"),
        _pass("ingestion.opcua",_stage(post,"opcua_to_canonical_persistence"),"post-recovery composed e2e"),
        _pass("canonical.validation_integrity",_stage(post,"canonical_integrity_and_lineage") and _stage(post,"security_negative_validation"),"canonical signature + negative validation"),
        _pass("analytical.arrow_parquet",_stage(post,"arrow_parquet_duckdb_postgis"),"composed analytical/spatial stage"),
        _pass("analytical.duckdb",_stage(post,"arrow_parquet_duckdb_postgis"),"composed analytical/spatial stage"),
        _pass("spatial.postgis",_stage(post,"arrow_parquet_duckdb_postgis"),"composed analytical/spatial stage"),
        _pass("lineage.openlineage",_stage(post,"canonical_integrity_and_lineage"),"composed canonical/lineage stage"),
        _pass("workflow.runtime_boundary",_stage(post,"workflow_runtime_boundary"),"Mining ingress traverses a qualified durable-workflow boundary"),
        _pass("workflow.temporal_durability",_stage(post,"temporal_worker_recovery"),"workflow survives worker loss"),
        _pass("security.fail_closed",_stage(post,"security_negative_validation") and (post.get("evidence") or {}).get("credentials_published") is False,"negative record validation + secret-safe evidence"),
        _pass("persistence.restart",_stage(post,"persistence_restart_replay"),"SQLite WAL store reopened after process boundary"),
        _pass("replay.recovery",_stage(post,"persistence_restart_replay") and (post.get("evidence") or {}).get("audit_chain_verified") is True,"replay integrity after restart"),
        _pass("observability.otel_slo",_stage(post,"opentelemetry_otlp") and tests.get("observability_alerting_slo") == "PASS_SYNTHETIC_CANARY_SIGNAL","OTLP export + production canary SLO evidence"),
        _pass("baseline.catalog_freshness",baseline_catalog_current,"researched current-stable baseline catalog",{"required":expected_catalog,"observed":{name:catalog_versions.get(name) for name in expected_catalog}}),
        _pass("benchmark.raw_samples",raw_samples_complete,"machine-readable per-repetition timing samples",{"repetitions":repetitions,"optimization_scales":len(optimization),"pipeline_scales":len(pipeline)}),
        _pass("canonical_pipeline.scale_evidence",pipeline_scale_evidence,"largest canonical ingest/persist/plan/replay workload",{"records":largest_pipeline.get("records"),"total_latency_ms":pipeline_total,"total_p50_records_per_second":pipeline_throughput}),
        _pass("operational_complexity.evidence",operational_evidence,"qualification topology/dependency complexity proxies",topology),
        _pass("cost.evidence",cost_evidence,"explicit monetary non-comparability plus resource proxies",cost),
        _pass("optimization.current_scipy_baseline",current_scipy,"benchmark runtime version pin",{"required":required_scipy,"observed":scipy_version}),
        _pass("optimization.correctness",all_correct and current_scipy,"same-machine current SciPy MILP objective equivalence",{"scales":[item.get("records") for item in optimization],"scipy":scipy_version}),
        _pass("optimization.scale_slo",optimization_slo,"largest deterministic benchmark",{"records":largest.get("records"),"p99_ms":p99,"limit_ms":thresholds["optimization_p99_ms_max"]}),
        _pass("axiom.execution",_stage(post,"axiom_boundary") and tests.get("production_runtime_axiom_execution") == "PASS" and tests.get("production_runtime_usage_ledger_correlation") == "PASS","isolated current boundary + sealed production execution/ledger evidence"),
        _pass("audit.tamper_evident",_stage(post,"audit_chain") and _stage(post,"audit_tamper_detection") and (post.get("evidence") or {}).get("audit_chain_verified") is True,"hash-chained run audit + deliberate mutation detection"),
        _pass("production.api_behavior",live_guard.get("passed") is True,"current read-only live runtime guard"),
        _pass("recovery.composed_after_restart",pre.get("all_passed") is True and post.get("all_passed") is True and runtime_slo,"full composed run before and after infrastructure restart",{"pre_seconds":pre_runtime,"post_seconds":post_runtime}),
        _pass("resource_efficiency.evidence",isinstance(resource_runtime.get("peak_rss_kib"),(int,float)) and resource_runtime.get("peak_rss_kib",0)>0 and isinstance(largest_throughput,(int,float)) and largest_throughput>0,"benchmark runtime metadata and throughput",{"peak_rss_kib":resource_runtime.get("peak_rss_kib"),"records_per_second":largest_throughput}),
    ]

    tie_band=float(thresholds["baseline_tie_band_fraction"])
    baseline_outcomes=[]
    for item in optimization:
        records=item.get("records")
        musitu=item.get("latency_ms",{}).get("musitu_exact",{}).get("p50")
        scipy=item.get("latency_ms",{}).get("scipy_milp",{}).get("p50")
        correct=item.get("correctness",{}).get("objective_matches_scipy_milp") is True
        if not correct or not isinstance(musitu,(int,float)) or not isinstance(scipy,(int,float)) or scipy <= 0:
            outcome="INVALID"
        else:
            ratio=musitu/scipy
            if ratio < 1-tie_band:
                outcome="WIN"
            elif ratio > 1+tie_band:
                outcome="LOSS"
            else:
                outcome="TIE"
        baseline_outcomes.append({
            "baseline":f"SciPy {scipy_version or 'UNKNOWN'} MILP @ {records} records",
            "dimension":"optimization p50 latency with objective equivalence",
            "outcome":outcome,
            "musitu_p50_ms":musitu,
            "baseline_p50_ms":scipy,
        })
    baseline_outcomes.extend([
        {
            "baseline":"Azure IoT Operations",
            "dimension":"industrial E2E scale/latency/resource/cost",
            "outcome":"NOT_COMPARABLE",
            "reason":"No identical licensed deployment, workload and hardware were exercised in this run. Published Azure numbers are external targets only."
        },
        {
            "baseline":"HighByte Intelligence Hub",
            "dimension":"industrial connectivity/completeness/performance/cost",
            "outcome":"NOT_COMPARABLE",
            "reason":"No identical licensed deployment, workload and hardware were exercised in this run."
        },
    ])
    all_passed=all(item["status"]=="PASS" for item in capabilities)
    return {
        "schema":"musitu.connect.mining_adapter_qualification.v1",
        "generated_at_utc":datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00","Z"),
        "all_passed":all_passed,
        "gate":"MINING_ADAPTER_PRODUCTION_COMPLETE" if all_passed else "MINING_ADAPTER_QUALIFICATION_FAILED",
        "capabilities":capabilities,
        "baseline_outcomes":baseline_outcomes,
        "claim_policy":matrix["policy"],
        "limitations":[
            "Commercial monetary cost remains NOT_COMPARABLE without equivalent licensed deployments.",
            "Operational-complexity evidence is a MUSITU qualification-topology/dependency proxy, not a cross-vendor production operations/TCO comparison.",
            "Synthetic qualification does not establish mine-specific predictive accuracy or safety certification.",
            "A named commercial baseline may only be described as beaten on a dimension after a same-workload measured WIN exists for that named baseline."
        ],
    }


def _load(path: Path) -> dict[str,Any]:
    return json.loads(path.read_text())


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("--pre",type=Path,required=True)
    parser.add_argument("--post",type=Path,required=True)
    parser.add_argument("--benchmark",type=Path,required=True)
    parser.add_argument("--live-guard",type=Path,required=True)
    parser.add_argument("--production-gate",type=Path,default=ROOT/"qualification"/"musitu_connect_gate.json")
    parser.add_argument("--output",type=Path,default=ROOT/"qualification"/"mining_adapter_qualification.json")
    args=parser.parse_args()
    report=evaluate(
        pre=_load(args.pre),post=_load(args.post),benchmark=_load(args.benchmark),
        live_guard=_load(args.live_guard),production_gate=_load(args.production_gate),
    )
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps(report,indent=2,sort_keys=True))
    raise SystemExit(0 if report["all_passed"] else 1)


if __name__=="__main__": main()
