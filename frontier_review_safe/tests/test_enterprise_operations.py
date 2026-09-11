from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import unittest

from frontier_review_safe.core import AuthorizationDenied, FrontierSafetyError
from frontier_review_safe.enterprise import (
    BackupArtifact,
    EnterpriseGovernanceContract,
    EnterpriseStateStore,
    MigrationContract,
    SLOContract,
    SpendPolicy,
    TenantConfig,
    authorize_spend,
    evaluate_slo,
)

NOW = datetime(2026, 9, 11, 3, 45, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()
H = "a" * 64


def tenant(tenant_id: str, created_at: str = NOW_S) -> TenantConfig:
    return TenantConfig(
        tenant_id=tenant_id,
        data_region="af-south",
        jurisdictions=("ZW",),
        retention_policy_version="retention-v1",
        encryption_key_id=f"kms:{tenant_id}:v1",
        created_at=created_at,
    )


class EnterpriseOperationsTests(unittest.TestCase):
    def test_tenant_isolation_idempotency_and_tamper_evidence(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "enterprise.json"
            store = EnterpriseStateStore(path)
            store.register_tenant(tenant("tenant-a"))
            store.register_tenant(tenant("tenant-b"))
            first = store.put_object(
                "tenant-a", "tenant-a", "report-1", {"value": 42},
                created_at=NOW_S, retention_days=30, idempotency_key="req-1",
            )
            retry = store.put_object(
                "tenant-a", "tenant-a", "report-1", {"value": 42},
                created_at=NOW_S, retention_days=30, idempotency_key="req-1",
            )
            self.assertEqual(first, retry)
            with self.assertRaises(FrontierSafetyError):
                store.put_object(
                    "tenant-a", "tenant-a", "report-1", {"value": 99},
                    created_at=NOW_S, retention_days=30, idempotency_key="req-1",
                )
            with self.assertRaises(AuthorizationDenied):
                store.get_object("tenant-b", "tenant-a", "report-1")
            self.assertEqual(store.get_object("tenant-a", "tenant-a", "report-1")["payload"]["value"], 42)

            raw = path.read_text(encoding="utf-8")
            path.write_text(raw.replace('"value":42', '"value":43'), encoding="utf-8")
            with self.assertRaises(FrontierSafetyError):
                EnterpriseStateStore(path)

    def test_retention_deletes_expired_objects_but_preserves_legal_hold(self):
        with tempfile.TemporaryDirectory() as td:
            store = EnterpriseStateStore(Path(td) / "enterprise.json")
            store.register_tenant(tenant("tenant-a"))
            old = (NOW - timedelta(days=40)).isoformat()
            store.put_object("tenant-a", "tenant-a", "delete-me", {"x": 1}, created_at=old, retention_days=30)
            store.put_object("tenant-a", "tenant-a", "hold-me", {"x": 2}, created_at=old, retention_days=30)
            store.set_legal_hold(
                "tenant-a", "tenant-a", "hold-me", True,
                occurred_at=(NOW - timedelta(days=1)).isoformat(), reason="litigation",
            )
            result = store.enforce_retention("tenant-a", now=NOW_S)
            self.assertEqual(result["status"], "PASS")
            self.assertEqual(result["deleted"], ["delete-me"])
            self.assertEqual(result["legal_hold_preserved"], ["hold-me"])
            self.assertIsNone(store.get_object("tenant-a", "tenant-a", "delete-me"))
            self.assertIsNotNone(store.get_object("tenant-a", "tenant-a", "hold-me"))

    def test_backup_restore_and_drill_measure_rpo_rto_and_reject_tamper(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            store = EnterpriseStateStore(root / "enterprise.json")
            store.register_tenant(tenant("tenant-a"))
            store.put_object("tenant-a", "tenant-a", "one", {"v": 1}, created_at=NOW_S, retention_days=30)
            backup = store.create_backup(created_at=NOW_S)
            restored = EnterpriseStateStore.restore_backup(backup, root / "restore.json")
            self.assertEqual(restored.fingerprint, backup.source_fingerprint)
            self.assertEqual(restored.get_object("tenant-a", "tenant-a", "one")["payload"]["v"], 1)

            store.put_object(
                "tenant-a", "tenant-a", "after-backup", {"v": 2},
                created_at=(NOW + timedelta(seconds=1)).isoformat(), retention_days=30,
            )
            failed = store.disaster_recovery_drill(
                backup, root / "restore-rpo-fail.json", max_rpo_events=0, max_rto_ms=10_000,
            )
            self.assertEqual(failed["status"], "FAIL")
            self.assertIn("rpo_exceeded", failed["reasons"])
            passed = store.disaster_recovery_drill(
                backup, root / "restore-rpo-pass.json", max_rpo_events=1, max_rto_ms=10_000,
            )
            self.assertEqual(passed["status"], "PASS")
            self.assertEqual(passed["rpo_events"], 1)

            tampered = replace(
                backup,
                events=backup.events + ({"fake": True},),
                event_count=backup.event_count + 1,
            )
            with self.assertRaises(FrontierSafetyError):
                EnterpriseStateStore.verify_backup(tampered)

    def test_incident_state_machine_rejects_invalid_transitions(self):
        with tempfile.TemporaryDirectory() as td:
            store = EnterpriseStateStore(Path(td) / "enterprise.json")
            store.register_tenant(tenant("tenant-a"))
            with self.assertRaises(FrontierSafetyError):
                store.transition_incident(
                    "tenant-a", "inc-1", "CLOSED", occurred_at=NOW_S,
                    severity="SEV2", evidence_hash=H,
                )
            states = ["OPEN", "ACKNOWLEDGED", "CONTAINED", "RECOVERED", "CLOSED"]
            for i, state in enumerate(states):
                store.transition_incident(
                    "tenant-a", "inc-1", state,
                    occurred_at=(NOW + timedelta(seconds=i)).isoformat(),
                    severity="SEV2", evidence_hash=H,
                )
            self.assertEqual(store.incident_state("tenant-a", "inc-1"), "CLOSED")
            with self.assertRaises(FrontierSafetyError):
                store.transition_incident(
                    "tenant-a", "inc-1", "OPEN",
                    occurred_at=(NOW + timedelta(minutes=1)).isoformat(),
                    severity="SEV2", evidence_hash=H,
                )

    def test_slo_error_budget_and_spend_governance_fail_closed(self):
        slo = SLOContract("slo-v1", target_availability=.99, max_p95_latency_ms=250, minimum_requests=100)
        healthy = evaluate_slo(slo, [True] * 100, [50.0] * 100)
        self.assertEqual(healthy["status"], "PASS")
        unhealthy = evaluate_slo(slo, [False] * 5 + [True] * 95, [50.0] * 95 + [500.0] * 5)
        self.assertEqual(unhealthy["status"], "FAIL")
        self.assertIn("availability_slo_breached", unhealthy["reasons"])
        self.assertIn("latency_slo_breached", unhealthy["reasons"])
        self.assertGreater(unhealthy["error_budget_consumed_ratio"], 1)

        policy = SpendPolicy("spend-v1", monthly_unit_limit=1000, per_request_unit_limit=100, concurrency_limit=4)
        self.assertEqual(authorize_spend(policy, month_units_used=100, request_units=20, concurrent_requests=1)["status"], "ALLOW")
        denied = authorize_spend(policy, month_units_used=950, request_units=101, concurrent_requests=4)
        self.assertEqual(denied["status"], "DENY")
        self.assertEqual(
            set(denied["reasons"]),
            {"per_request_limit_exceeded", "monthly_limit_exceeded", "concurrency_limit_exceeded"},
        )

    def test_migration_contract_requires_dry_run_backup_and_rollback(self):
        good = MigrationContract("m-1", "1", "2", H, "b" * 64, "c" * 64, True).validate()
        self.assertEqual(good["status"], "PASS")
        bad = MigrationContract("m-2", "1", "2", "short", "b" * 64, "c" * 64, False).validate()
        self.assertEqual(bad["status"], "FAIL")
        self.assertIn("dry_run_evidence_hash_invalid", bad["reasons"])
        self.assertIn("rollback_not_proven", bad["reasons"])

    def test_enterprise_readiness_can_require_fresh_operational_evidence(self):
        evidence = {
            "tenant_isolation": "1" * 64,
            "retention": "2" * 64,
            "backup_restore": "3" * 64,
            "disaster_recovery": "4" * 64,
            "incident_response": "5" * 64,
            "slo": "6" * 64,
            "spend_governance": "7" * 64,
            "migration_rollback": "8" * 64,
            "secret_scanning": "9" * 64,
            "supply_chain": "a" * 64,
        }
        good = EnterpriseGovernanceContract(
            True, True, True, True, "ret-v1", "privacy-v1", "ir-v1",
            NOW_S, NOW_S, "slo-v1", "spend-v1", True, True, True,
            evidence_hashes=evidence, require_operational_evidence=True,
            max_drill_age_seconds=3600, evaluated_at=(NOW + timedelta(minutes=10)).isoformat(),
        ).readiness()
        self.assertEqual(good["status"], "PASS")

        missing = dict(evidence)
        missing.pop("disaster_recovery")
        failed = EnterpriseGovernanceContract(
            True, True, True, True, "ret-v1", "privacy-v1", "ir-v1",
            NOW_S, NOW_S, "slo-v1", "spend-v1", True, True, True,
            evidence_hashes=missing, require_operational_evidence=True,
            max_drill_age_seconds=60, evaluated_at=(NOW + timedelta(minutes=10)).isoformat(),
        ).readiness()
        self.assertEqual(failed["status"], "FAIL")
        self.assertIn("disaster_recovery", failed["invalid_evidence"])
        self.assertEqual(
            set(failed["stale_drills"]),
            {"backup_restore_tested_at", "disaster_recovery_tested_at"},
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
