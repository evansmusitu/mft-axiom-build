from __future__ import annotations
import json, tempfile
from pathlib import Path

from recovery.ar04.project_work_graph import ProjectWorkGraph, TenantIsolationError
from recovery.ar05.durable_kernel import DurableKernel

TARGETS={
    "gateway_availability_min_pct":99.9,
    "injected_transient_failure_recovery_min_pct":95.0,
    "duplicate_consequential_actions_max":0,
    "task_state_reconciliation_pct":100.0,
    "material_artifact_provenance_pct":100.0,
    "cross_tenant_leakage_max":0,
}

def run_local_matrix(iterations=40):
    iterations=max(10,min(200,int(iterations)))
    recovered=0
    reconciled=0
    duplicate_actions=0
    provenance_ok=0
    leakage=0

    with tempfile.TemporaryDirectory(prefix="axiom-ar09-") as td:
        root=Path(td)
        kernel_path=root/"kernel.sqlite3"
        graph=ProjectWorkGraph(root/"graph.sqlite3")

        for i in range(iterations):
            k=DurableKernel(kernel_path)
            task=k.create_task("tenant-a",f"project-{i}",[
                {"operation":"tool.timeout_once","args":{},"idempotency_key":f"timeout-{i}","cost_units":1},
                {"operation":"side_effect.increment","args":{"effect_key":f"effect-{i}","fail_after_commit_once":True},"risk_class":"S1","idempotency_key":f"write-{i}","cost_units":1},
            ],budget_max=10)
            first=k.run(task)
            k.close()

            k=DurableKernel(kernel_path)
            second=k.run(task)
            k.close()

            k=DurableKernel(kernel_path)
            final=k.run(task)
            state=k.status(task)
            effect=k.db.execute("SELECT value FROM side_effects WHERE effect_key=?",(f"effect-{i}",)).fetchone()["value"]
            if first=="RETRYABLE" and second=="RETRYABLE" and final=="SUCCEEDED": recovered+=1
            if state["task"]["state"]=="SUCCEEDED" and all(s["status"]=="SUCCEEDED" for s in state["steps"]): reconciled+=1
            if effect!=1: duplicate_actions+=abs(effect-1)
            k.close()

            project=f"project-{i}"
            artifact=graph.create("tenant-a",project,"artifact",{"iteration":i,"material":True})
            if graph.verify_provenance("tenant-a",project): provenance_ok+=1
            try:
                graph.get("tenant-b",artifact)
                leakage+=1
            except TenantIsolationError:
                pass

        graph.close()

    pct=lambda n: round(100.0*n/iterations,4)
    measured={
        "gateway_availability_pct":"NOT_MEASURED_LOCAL_FOUNDATION",
        "injected_transient_failure_recovery_pct":pct(recovered),
        "duplicate_consequential_actions":duplicate_actions,
        "task_state_reconciliation_pct":pct(reconciled),
        "material_artifact_provenance_pct":pct(provenance_ok),
        "cross_tenant_leakage":leakage,
    }
    local_pass=(
        measured["injected_transient_failure_recovery_pct"]>=TARGETS["injected_transient_failure_recovery_min_pct"]
        and measured["duplicate_consequential_actions"]<=TARGETS["duplicate_consequential_actions_max"]
        and measured["task_state_reconciliation_pct"]>=TARGETS["task_state_reconciliation_pct"]
        and measured["material_artifact_provenance_pct"]>=TARGETS["material_artifact_provenance_pct"]
        and measured["cross_tenant_leakage"]<=TARGETS["cross_tenant_leakage_max"]
    )
    return {
        "schema":"musitu.axiom.recovery.ar09-local-reliability-report.v1",
        "scope":"LOCAL_RECOVERY_FOUNDATIONS_ONLY",
        "iterations":iterations,
        "targets":TARGETS,
        "measured":measured,
        "local_measured_targets_pass":local_pass,
        "unmeasured_required_tests":[
            "gateway availability",
            "real concurrency",
            "long soak",
            "queue saturation",
            "provider outage",
            "D1/R2 latency",
            "browser disconnect",
            "workflow/provider restart",
            "partial external tool outage",
            "model timeout",
            "cloud rollback/restoration"
        ],
        "ar09_gate_earned":False,
        "production_mutated":False
    }

def main():
    print(json.dumps(run_local_matrix(),indent=2,sort_keys=True))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
