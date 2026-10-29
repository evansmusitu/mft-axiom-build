"""AR-09 bounded concurrency, restart, and fault-injection qualification."""

from __future__ import annotations

import shutil
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from recovery.ar03_06.common import TenantIsolationError, TransientAdapterError
from recovery.ar03_06.fabric import AdapterBinding
from recovery.ar03_06.runtime import CandidateRuntime

from .application import UnifiedApplication


def run_reliability_qualification(directory, *, secret_key: bytes, sample_size=20):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    database = directory / "reliability.sqlite3"
    sample_size = max(4, min(100, int(sample_size)))

    bootstrap = UnifiedApplication(database, secret_key=secret_key)
    owner = bootstrap.onboard("reliability@example.test", "LongPasswordOne!2026", "Reliability")
    other = bootstrap.onboard("isolation@example.test", "LongPasswordTwo!2026", "Isolation")
    bootstrap.close()

    def submit(index):
        started = time.perf_counter()
        app = UnifiedApplication(database, secret_key=secret_key)
        try:
            session = app.login("reliability@example.test", "LongPasswordOne!2026")
            result = app.compose(
                session["session_token"],
                owner["project_id"],
                f"{index}+1",
                request_id=f"concurrent-{index:04d}",
            )
            return result, (time.perf_counter() - started) * 1000
        finally:
            app.close()

    with ThreadPoolExecutor(max_workers=min(4, sample_size)) as pool:
        concurrent = list(pool.map(submit, range(sample_size)))

    app = UnifiedApplication(database, secret_key=secret_key)
    session = app.login("reliability@example.test", "LongPasswordOne!2026")
    token = session["session_token"]
    context = app.runtime.identity.authenticate(token)
    results = [item[0] for item in concurrent]
    latencies = [item[1] for item in concurrent]
    concurrent_success = all(item["state"] == "SUCCEEDED" for item in results)

    invocation_rows = app.runtime.store.connection.execute(
        "SELECT invocation_id,COUNT(*) AS count FROM tool_receipts GROUP BY invocation_id"
    ).fetchall()
    duplicate_receipts = sum(max(0, row["count"] - 1) for row in invocation_rows)
    task_verdicts = [
        app.runtime.kernel.verify_task(context, item["task_id"]) for item in results
    ]
    reconciled = sum(verdict["status"] == "PASS" for verdict in task_verdicts)
    project_verdict = app.runtime.graph.verify_project(context, owner["project_id"])
    artifact_count = app.runtime.store.connection.execute(
        """SELECT COUNT(*) FROM graph_entities
           WHERE organization_id=? AND project_id=? AND entity_type='ARTIFACT'""",
        (owner["organization_id"], owner["project_id"]),
    ).fetchone()[0]

    attempts = {}

    def flaky(invocation):
        count = attempts.get(invocation.invocation_id, 0) + 1
        attempts[invocation.invocation_id] = count
        if count == 1:
            raise TransientAdapterError("injected transient outage")
        return {"recovered": True}

    app.runtime.fabric.bind(
        AdapterBinding.local_candidate(
            lane="quantitative",
            adapter_id="ar09-transient-fault-probe",
            operations={"algebra.expand"},
            adapter=flaky,
        )
    )
    recovered = 0
    for index in range(sample_size):
        task = app.runtime.kernel.create_task(
            context,
            owner["project_id"],
            [{"operation": "algebra.expand", "args": {"expression": f"x+{index}"}}],
            budget_max=1,
            idempotency_key=f"transient-{index:04d}",
        )
        first = app.runtime.kernel.run_until_blocked(
            context, task["task_id"], f"fault-worker-{index}", app.runtime.fabric
        )
        second = app.runtime.kernel.run_until_blocked(
            context, task["task_id"], f"fault-worker-{index}", app.runtime.fabric
        )
        recovered += first["state"] == "RETRYABLE" and second["state"] == "SUCCEEDED"

    restart_task = app.runtime.kernel.create_task(
        context,
        owner["project_id"],
        [{"operation": "arithmetic.evaluate", "args": {"expression": "100/4"}}],
        budget_max=1,
        idempotency_key="restart-probe",
    )
    restart_task_id = restart_task["task_id"]
    app.close()

    restarted = UnifiedApplication(database, secret_key=secret_key)
    restart_session = restarted.login("reliability@example.test", "LongPasswordOne!2026")
    restart_context = restarted.runtime.identity.authenticate(restart_session["session_token"])
    restart_result = restarted.runtime.kernel.run_until_blocked(
        restart_context, restart_task_id, "restart-worker", restarted.runtime.fabric
    )

    leakage = 0
    try:
        restarted.workspace(other["session_token"], owner["project_id"])
    except Exception as exc:
        if not isinstance(exc, TenantIsolationError):
            leakage += 1
    else:
        leakage += 1

    corrupt_task = restarted.compose(
        restart_session["session_token"], owner["project_id"], "3*7", request_id="corrupt-event"
    )
    restarted.runtime.store.connection.execute(
        "UPDATE task_events SET payload_json='{}' WHERE task_id=? AND sequence=(SELECT MIN(sequence) FROM task_events WHERE task_id=?)",
        (corrupt_task["task_id"], corrupt_task["task_id"]),
    )
    restarted.runtime.store.connection.commit()
    corruption_detected = (
        restarted.runtime.kernel.verify_task(restart_context, corrupt_task["task_id"])["status"] == "FAIL"
    )
    restarted.close()

    backup = directory / "reliability-backup.sqlite3"
    shutil.copy2(database, backup)
    restored = CandidateRuntime(backup, secret_key=secret_key)
    restored_session = restored.identity.login("reliability@example.test", "LongPasswordOne!2026")
    restored_context = restored.identity.authenticate(restored_session["session_token"])
    restored_ok = restored.kernel.status(restored_context, restart_task_id)["state"] == "SUCCEEDED"
    restored.close()

    p95_index = max(0, min(len(latencies) - 1, int(len(latencies) * 0.95) - 1))
    p95_ms = sorted(latencies)[p95_index]
    recovery_rate = recovered / sample_size
    reconciliation_rate = reconciled / sample_size
    provenance_rate = artifact_count / sample_size
    checks = {
        "concurrent_submission": concurrent_success,
        "transient_outage_recovery": recovery_rate >= 0.95,
        "workflow_restart": restart_result["state"] == "SUCCEEDED",
        "duplicate_receipt_prevention": duplicate_receipts == 0,
        "task_reconciliation": reconciliation_rate == 1.0,
        "material_provenance": provenance_rate == 1.0 and project_verdict["status"] == "PASS",
        "cross_tenant_isolation": leakage == 0,
        "corruption_detection": corruption_detected,
        "backup_restoration": restored_ok,
    }
    return {
        "schema": "musitu.axiom.ar09.reliability-report.v1",
        "status": "PASS" if all(checks.values()) else "FAIL",
        "evidence_class": "CONTROLLED_LOCAL_SAMPLE_ONLY",
        "sample_size": sample_size,
        "checks": checks,
        "metrics": {
            "local_request_success_rate": sum(item["state"] == "SUCCEEDED" for item in results) / sample_size,
            "transient_recovery_rate": recovery_rate,
            "duplicate_consequential_actions": 0,
            "duplicate_tool_receipts": duplicate_receipts,
            "task_reconciliation_rate": reconciliation_rate,
            "material_provenance_rate": provenance_rate,
            "cross_tenant_leakage": leakage,
            "local_latency_p50_ms": round(statistics.median(latencies), 3),
            "local_latency_p95_ms": round(p95_ms, 3),
        },
        "target_context": {
            "gateway_availability_99_9": "NOT_ASSESSED_LIVE",
            "live_slo_observation": False,
            "consequential_actions_in_sample": 0,
        },
        "phase_gate": "NOT_EARNED",
        "candidate_only": True,
    }
