"""Adversarial, offline-only D1 candidate preflight tests. No Cloudflare network."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "qualification/connect_d1_staging_preflight.py"
SCHEMA = ROOT / "infra/connect_customer_registry.sql"


def candidate():
    return {
        "schema": "musitu.connect.d1.staging_candidate.v1",
        "environment": "staging",
        "account_id": "1" * 32,
        "database_name": "musitu-connect-stage-operator-probe",
        "database_id": "a4e76671-c955-4b4c-bc48-4bf27aee3204",
        "worker_name": "musitu-connect-stage-operator-probe",
        "schema_sha256": hashlib.sha256(SCHEMA.read_bytes()).hexdigest(),
        "production_worker_binding": False,
        "production_zone_route": False,
        "real_customer_data": False,
        "production_axiom_secret": False,
    }


class StagingPreflightTests(unittest.TestCase):
    def run_candidate(self, data, *, existing_output=False, as_text=None):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "candidate.json"
            output = root / "report.json"
            source.write_text(json.dumps(data) if as_text is None else as_text)
            if existing_output:
                output.write_text("PRESERVE_ME")
            run = subprocess.run(
                [sys.executable, str(SCRIPT), "--candidate", str(source),
                 "--output", str(output)],
                cwd=ROOT, text=True, capture_output=True, timeout=20,
            )
            return run, output.read_text() if output.exists() else None

    def test_candidate_produces_non_enabling_metadata_only(self):
        run, report = self.run_candidate(candidate())
        self.assertEqual(run.returncode, 0, run.stderr)
        record = json.loads(report)
        self.assertEqual(record["schema"], "musitu.connect.d1.staging_preflight.v1")
        self.assertEqual(record["result"], "STRUCTURAL_ONLY_REMOTE_UNVERIFIED")
        self.assertEqual(record["schema_sha256"], candidate()["schema_sha256"])
        self.assertFalse(record["hosted_d1_qualified"])
        self.assertFalse(record["can_apply_migration"])
        self.assertFalse(record["can_deploy_worker"])
        self.assertFalse(record["can_admit_customers"])
        self.assertFalse(record["public_launch_authorized"])
        self.assertFalse(record["production_methane_authorized"])
        self.assertNotIn("account_id", record)
        self.assertNotIn("database_id", record)
        self.assertNotIn("Bearer", report)
        self.assertIn("REMOTE_D1_STILL_BLOCKED", run.stdout)

    def test_wrong_schema_fingerprint_rejected_without_output(self):
        entry = candidate()
        entry["schema_sha256"] = "0" * 64
        run, report = self.run_candidate(entry)
        self.assertNotEqual(run.returncode, 0)
        self.assertIsNone(report)

    def test_environment_and_resource_names_must_be_strictly_staging(self):
        for edit in [
            {"environment": "production"},
            {"database_name": "musitu-connect-production"},
            {"worker_name": "musitu-connect-production"},
            {"database_name": "musitu-connect-stage-PROD"},
            {"worker_name": "musitu-connect-stage-example.workers.dev"},
        ]:
            with self.subTest(edit=edit):
                entry = candidate()
                entry.update(edit)
                run, report = self.run_candidate(entry)
                self.assertNotEqual(run.returncode, 0)
                self.assertIsNone(report)

    def test_any_production_or_real_customer_binding_flag_denied(self):
        for flag in (
            "production_worker_binding", "production_zone_route",
            "real_customer_data", "production_axiom_secret",
        ):
            with self.subTest(flag=flag):
                entry = candidate()
                entry[flag] = True
                run, report = self.run_candidate(entry)
                self.assertNotEqual(run.returncode, 0)
                self.assertIsNone(report)

    def test_false_must_be_boolean_not_0_or_string(self):
        for fake in (0, "false", [], None):
            with self.subTest(value=fake):
                entry = candidate()
                entry["production_zone_route"] = fake
                run, report = self.run_candidate(entry)
                self.assertNotEqual(run.returncode, 0)
                self.assertIsNone(report)

    def test_duplicate_json_keys_unknown_fields_and_embedded_secrets_denied(self):
        entry = candidate()
        text = json.dumps(entry).replace('"environment": "staging"', '"environment": "production", "environment": "staging"')
        run, report = self.run_candidate(entry, as_text=text)
        self.assertNotEqual(run.returncode, 0)
        self.assertIsNone(report)
        for field, value in (
            ("token", "mct_" + "A" * 43),
            ("cloudflare_api_token", "sensitive"),
            ("notes", "Bearer sensitive"),
            ("customer_id", "tenant_alpha"),
        ):
            with self.subTest(field=field):
                entry = candidate()
                entry[field] = value
                run, report = self.run_candidate(entry)
                self.assertNotEqual(run.returncode, 0)
                self.assertIsNone(report)

    def test_invalid_identifiers_and_bad_schema_format_denied(self):
        for edit in (
            {"account_id": "not-an-account"},
            {"database_id": "00000000-0000-0000-0000-000000000000"},
            {"schema_sha256": "g" * 64},
            {"schema": "other"},
        ):
            with self.subTest(edit=edit):
                entry = candidate()
                entry.update(edit)
                run, report = self.run_candidate(entry)
                self.assertNotEqual(run.returncode, 0)
                self.assertIsNone(report)

    def test_report_file_cannot_be_overwritten(self):
        run, report = self.run_candidate(candidate(), existing_output=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertEqual(report, "PRESERVE_ME")

    def test_large_candidate_and_nonobject_denied(self):
        for text in ('[]', '{"x":"' + "a" * 20000 + '"}'):
            run, report = self.run_candidate(candidate(), as_text=text)
            self.assertNotEqual(run.returncode, 0)
            self.assertIsNone(report)

    def test_valid_candidate_is_not_remote_cloudflare_proof(self):
        run, report = self.run_candidate(candidate())
        self.assertEqual(run.returncode, 0)
        self.assertTrue(json.loads(report)["manual_cloudflare_resource_verification_required"])
        self.assertTrue(json.loads(report)["independent_authorization_required"])


if __name__ == "__main__":
    unittest.main()
