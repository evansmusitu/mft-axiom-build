import copy
import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from recovery.ar02.isolation import (  # noqa: E402
    IsolationError,
    load_manifest,
    provision_local,
    validate_manifest,
    verify_local,
)


class AR02IsolationTests(unittest.TestCase):
    def setUp(self):
        self.manifest = load_manifest()

    def test_manifest_is_zero_cost_non_production_and_physically_distinct(self):
        normalized = validate_manifest(self.manifest)
        self.assertEqual(normalized["mode"], "LOCAL_ZERO_COST")
        self.assertEqual(normalized["estimated_external_cost_usd"], 0)
        self.assertFalse(normalized["network_required"])
        self.assertFalse(normalized["provider_api_key_required"])
        self.assertFalse(normalized["production_authority"])
        self.assertEqual(
            {row["environment_id"] for row in normalized["environments"]},
            {"development", "staging", "canary"},
        )
        for field in ("database_path", "object_root", "queue_root", "identity_audience"):
            values = [row[field] for row in normalized["environments"]]
            self.assertEqual(len(values), len(set(values)), field)
        self.assertTrue(all(row["synthetic_data_only"] for row in normalized["environments"]))

    def test_production_names_and_identifiers_fail_closed(self):
        forbidden = self.manifest["forbidden_identifiers"]
        for value in forbidden:
            tampered = copy.deepcopy(self.manifest)
            tampered["environments"][0]["database_path"] = f"development/{value}.sqlite3"
            with self.subTest(value=value):
                with self.assertRaises(IsolationError):
                    validate_manifest(tampered)

    def test_duplicate_resource_names_fail_closed(self):
        for field in ("database_path", "object_root", "queue_root", "identity_audience"):
            tampered = copy.deepcopy(self.manifest)
            tampered["environments"][1][field] = tampered["environments"][0][field]
            with self.subTest(field=field):
                with self.assertRaises(IsolationError):
                    validate_manifest(tampered)

    def test_path_escape_and_absolute_paths_fail_closed(self):
        for unsafe in ("../outside.sqlite3", "/tmp/outside.sqlite3", "staging/../../outside.sqlite3"):
            tampered = copy.deepcopy(self.manifest)
            tampered["environments"][1]["database_path"] = unsafe
            with self.subTest(path=unsafe):
                with self.assertRaises(IsolationError):
                    validate_manifest(tampered)

    def test_provisioned_databases_have_canonical_schema_and_isolated_data(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar02-") as directory:
            root = Path(directory)
            evidence = provision_local(root)
            self.assertEqual(evidence["status"], "PASS_LOCAL_NON_PRODUCTION_ISOLATION")
            self.assertEqual(evidence["environment_count"], 3)
            self.assertFalse(evidence["network_used"])
            self.assertFalse(evidence["production_authority"])

            databases = {
                row["environment_id"]: root / row["database_path"]
                for row in self.manifest["environments"]
            }
            expected_tables = {
                "ar02_environment",
                "axiom_tenants",
                "axiom_actors",
                "axiom_projects",
                "axiom_project_members",
                "axiom_work_objects",
                "axiom_work_edges",
                "axiom_tasks",
                "axiom_task_steps",
                "axiom_task_events",
                "axiom_idempotency_keys",
                "axiom_approval_grants",
                "axiom_tool_receipts",
                "axiom_artifacts",
            }
            for environment, path in databases.items():
                self.assertTrue(path.is_file(), environment)
                with sqlite3.connect(path) as database:
                    tables = {
                        row[0]
                        for row in database.execute(
                            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                        )
                    }
                    self.assertEqual(tables, expected_tables)
                    marker = database.execute(
                        "SELECT environment_id, synthetic_data_only FROM ar02_environment"
                    ).fetchone()
                    self.assertEqual(marker, (environment, 1))

            with sqlite3.connect(databases["development"]) as database:
                database.execute(
                    "INSERT INTO axiom_tenants(environment_id,tenant_id,name,created_at) VALUES(?,?,?,?)",
                    ("development", "tenant-dev", "Synthetic Development", "2026-09-17T00:00:00Z"),
                )
                database.execute(
                    "INSERT INTO axiom_projects(environment_id,tenant_id,project_id,name,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                    ("development", "tenant-dev", "project-dev", "Isolated", 1, "2026-09-17T00:00:00Z", "2026-09-17T00:00:00Z"),
                )
                database.commit()
            for environment in ("staging", "canary"):
                with sqlite3.connect(databases[environment]) as database:
                    count = database.execute(
                        "SELECT count(*) FROM axiom_projects WHERE project_id='project-dev'"
                    ).fetchone()[0]
                self.assertEqual(count, 0, environment)

            verified = verify_local(root)
            self.assertEqual(verified["status"], "PASS_LOCAL_NON_PRODUCTION_ISOLATION")
            self.assertTrue(verified["physical_database_separation_verified"])

            repeated = provision_local(root)
            self.assertEqual(repeated["schema_sha256"], verified["schema_sha256"])
            self.assertEqual(repeated["environments"], verified["environments"])

    def test_existing_database_with_wrong_environment_is_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar02-") as directory:
            root = Path(directory)
            target = root / self.manifest["environments"][0]["database_path"]
            target.parent.mkdir(parents=True)
            with sqlite3.connect(target) as database:
                database.execute("CREATE TABLE ar02_environment(environment_id TEXT PRIMARY KEY)")
                database.execute("INSERT INTO ar02_environment VALUES('production')")
                database.commit()
            with self.assertRaises(IsolationError):
                provision_local(root)
            with sqlite3.connect(target) as database:
                self.assertEqual(
                    database.execute("SELECT environment_id FROM ar02_environment").fetchone()[0],
                    "production",
                )

    def test_zero_cost_cloud_plan_stays_blocked_until_account_headroom_is_known(self):
        plan = json.loads(
            (ROOT / "docs" / "axiom_recovery" / "AR02_ZERO_COST_RESOURCE_PLAN.json").read_text()
        )
        self.assertEqual(plan["status"], "OFFICIAL_LIMITS_VERIFIED_ACCOUNT_HEADROOM_PENDING")
        self.assertFalse(plan["resources_created"])
        self.assertFalse(plan["billing_mutation_authorized"])
        self.assertFalse(plan["production_authority"])
        limits = {row["product"]: row["free_limits"] for row in plan["sources"]}
        budget = plan["conservative_test_budget"]
        self.assertLess(budget["d1_rows_read_per_day_all_ar02"], limits["Cloudflare D1"]["rows_read_per_day"])
        self.assertLess(budget["d1_rows_written_per_day_all_ar02"], limits["Cloudflare D1"]["rows_written_per_day"])
        self.assertLess(budget["r2_storage_gb_month_all_ar02"], limits["Cloudflare R2 Standard"]["storage_gb_month_per_month"])
        self.assertLess(budget["queue_operations_per_day_all_ar02"], limits["Cloudflare Queues"]["standard_operations_per_day"])
        self.assertLess(budget["workflow_steps_per_day_all_ar02"], limits["Cloudflare Workflows"]["steps_per_day"])
        rendered = json.dumps(plan).lower()
        for forbidden in self.manifest["forbidden_identifiers"]:
            self.assertNotIn(forbidden.lower(), rendered)

    def test_cli_produces_no_secret_and_no_production_authority(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar02-") as directory:
            result = subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "recovery" / "ar02" / "isolation.py"),
                    "provision-local",
                    "--root",
                    directory,
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            evidence = json.loads(result.stdout)
            self.assertFalse(evidence["production_authority"])
            self.assertFalse(evidence["network_used"])
            self.assertFalse(evidence["provider_api_key_used"])
            rendered = result.stdout.lower()
            for marker in ("bearer ", "access_token\"", "client_secret\"", "password\""):
                self.assertNotIn(marker, rendered)


if __name__ == "__main__":
    unittest.main()
