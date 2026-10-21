"""Release evidence is non-enabling; synthetic contract tests do not grant launch."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class ConnectBetaReleaseGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.record = json.loads((ROOT / 'qualification/musitu_connect_beta_release_gate.json').read_text())
        cls.contract = (ROOT / 'contracts/connect.openapi.yaml').read_text()
        cls.worker = (ROOT / 'connect/production_worker.mjs').read_text()

    def test_release_gate_explicitly_blocks_commercial_publication(self):
        record = self.record
        self.assertEqual(record['schema'], 'musitu.connect.beta_release_gate.v1')
        self.assertEqual(record['assessment_kind'], 'FEATURE_BRANCH_PREPARATORY_NON_ENABLING')
        self.assertEqual(record['state'], 'BLOCKED_PENDING_CUSTOMER_AND_OPERATIONS_EVIDENCE')
        self.assertTrue(record['existing_production_runtime_enabled'])
        self.assertTrue(record['existing_production_connect_axiom_compute_preserved'])
        for decision in (
            'new_beta_customer_admission_authorized',
            'public_customer_publication_authorized',
            'openai_plugin_submission_or_publication_authorized',
            'predictive_methane_production_authorized',
        ):
            with self.subTest(decision=decision):
                self.assertIs(record[decision], False)

    def test_separate_customer_security_and_operational_requirements_are_outstanding(self):
        checks = self.record['checks']
        for name in (
            'separate_tenant_credentials_and_rotation',
            'tenant_isolation_and_customer_usage_attribution',
            'per_customer_rate_quota_and_payload_limits',
            'real_customer_onboarding_and_offboarding',
            'external_paging_human_acknowledgment',
            'connect_customer_terms_privacy_and_dpa_approved',
            'customer_beta_acceptance_evidence',
        ):
            with self.subTest(check=name):
                self.assertEqual(checks[name], 'NOT_DEMONSTRATED')
        self.assertGreaterEqual(len(self.record['mandatory_external_signoffs']), 5)

    def test_contract_names_only_supported_routes_and_protects_internal_auth(self):
        for route in ('/health:', '/api/mining/plan:', '/api/mining/risk:'):
            self.assertIn(route, self.contract)
        for marker in ('RISK_SINGLE_ROW_REQUIRED', 'PLAN_SEARCH_LIMIT_EXCEEDED'):
            self.assertIn(marker, self.worker)
            self.assertIn(marker, self.contract)
        self.assertIn('NOT a customer', self.contract)
        self.assertIn('Existing production Worker; feature-branch changes not automatically deployed.', self.contract)


if __name__ == '__main__':
    unittest.main()
