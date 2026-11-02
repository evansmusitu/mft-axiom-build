"""Non-enabling release-gate contract: isolated Neon tests cannot admit customers."""
from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
GATE = ROOT / "qualification" / "musitu_connect_beta_release_gate.json"

class NeonBetaReleaseGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gate = json.loads(GATE.read_text(encoding="utf-8"))
        cls.evidence = cls.gate["neon_engineering_evidence_20261102"]

    def test_customer_methane_listing_and_release_stay_disabled(self):
        gate=self.gate
        self.assertEqual(gate["state"],"BLOCKED_PENDING_CUSTOMER_AND_OPERATIONS_EVIDENCE")
        self.assertEqual(gate["assessment_kind"],"FEATURE_BRANCH_PREPARATORY_NON_ENABLING")
        for key in ("new_beta_customer_admission_authorized",
                    "public_customer_publication_authorized",
                    "openai_plugin_submission_or_publication_authorized",
                    "predictive_methane_production_authorized"):
            with self.subTest(key=key):
                self.assertIs(gate[key], False)
        self.assertIs(gate["existing_production_runtime_enabled"],True)
        self.assertIs(gate["existing_production_connect_axiom_compute_preserved"],True)

    def test_neon_evidence_cannot_manufacture_signoff_or_deployment(self):
        e=self.evidence
        self.assertEqual(e["evidence_scope"],"PREPARATORY_SYNTHETIC_ONLY_NON_ENABLING")
        self.assertEqual(e["selected_research_staging_backend"],
                         "NEON_POSTGRESQL_ISOLATED_NONPRODUCTION")
        for key in ("worker_to_hosted_neon_tls_staging_acceptance_completed",
                    "customer_facing_neon_app_deployed",
                    "independent_mine_holdout_qualified",
                    "physical_event_independently_reviewed",
                    "real_pilot_customer_acceptance_signed",
                    "security_operations_legal_and_release_signoffs_completed",
                    "production_worker_changed",
                    "customer_admission_authorized"):
            with self.subTest(key=key):
                self.assertIs(e[key],False)
        self.assertIs(type(e["real_customer_credentials_issued"]),int)
        self.assertEqual(e["real_customer_credentials_issued"],0)

    def test_evidence_links_exist_and_do_not_claim_business_exactly_once(self):
        e=self.evidence
        self.assertEqual(e["ci_http_lost_ack_and_credential_rotation_run_id"],41386185680)
        self.assertEqual(e["ci_tls_certificate_validation_run_id"],41386633451)
        self.assertEqual(e["uncertain_commit_technical_acceptance"],
                         "SAME_REQUEST_ID_REPLAY_NO_DOUBLE_QUOTA_CHARGE_NOT_BUSINESS_EXACTLY_ONCE")
        for key in ("hosted_neon_database_acceptance_document","lost_ack_semantics_document"):
            with self.subTest(key=key):
                path=ROOT/e[key]
                self.assertTrue(path.is_file(),str(path))
        self.assertEqual(e["ephemeral_http_pg_acceptance"],"PASS_NOT_DEPLOYED")
        self.assertEqual(e["ephemeral_tls_client_to_test_server_acceptance"],"PASS_NOT_HOSTED")
        self.assertEqual(e["hosted_neon_sql_login_database_checks"],"PASS_SYNTHETIC_NO_APP_DEPLOYED")

if __name__=="__main__":
    unittest.main()
