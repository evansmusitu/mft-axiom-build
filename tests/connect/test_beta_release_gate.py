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
        self.assertEqual(record['offline_customer_identity_verifier'], 'SYNTHETIC_TESTED_DISABLED_NOT_WIRED')
        self.assertNotIn('customer_identity.mjs', self.worker)
        self.assertNotIn('customer_admission.mjs', self.worker)
        self.assertNotIn('customer_payload.mjs', self.worker)
        self.assertNotIn('customer_ingress_canary.mjs', self.worker)
        self.assertNotIn('customer_mining_semantics.mjs', self.worker)
        self.assertEqual(record['offline_customer_mining_semantics'],
                         'STRICT_SCOPED_BODY_VALIDATION_NODE_TESTED_NOT_DEPLOYED')
        semantic = record['offline_customer_mining_semantics_evidence']
        self.assertEqual(semantic['node_tests_passed'], 69)
        self.assertIs(semantic['real_hosted_d1_qualified'], False)
        self.assertEqual(semantic['actual_customer_requests_executed'], 0)
        self.assertIs(semantic['customer_admission_authorized'], False)
        self.assertEqual(semantic['policy'],
                         'PROVISIONAL_NOT_PUBLIC_CUSTOMER_CONTRACT')
        self.assertNotIn('customer_provisioning.mjs', self.worker)
        self.assertEqual(record['offline_customer_provisioning'],
                         'SYNTHETIC_ONLY_SCOPED_WEBCRYPTO_ISSUANCE_REVOCATION_SUSPENSION_TESTED_NOT_WIRED')
        self.assertIs(record['offline_customer_provisioning_evidence']['customer_admission_authorized'], False)
        self.assertIs(record['offline_customer_provisioning_evidence']['remote_hosted_d1_qualified'], False)
        self.assertEqual(record['offline_customer_tenant_deactivation'],
                         'SYNTHETIC_D1_ATOMIC_SUSPEND_REVOKE_AUDIT_RETAINED_NOT_WIRED')
        evidence = record['offline_customer_tenant_deactivation_evidence']
        self.assertIs(evidence['rollback_on_forced_failure_verified_locally'], True)
        self.assertIs(evidence['remote_hosted_d1_qualified'], False)
        self.assertIs(evidence['data_erasure_or_retention_approved'], False)
        self.assertIs(evidence['customer_admission_authorized'], False)
        self.assertEqual(evidence['real_customer_credentials_issued'], 0)
        self.assertEqual(record['offline_customer_provisioning_evidence']['real_customer_credentials_issued'], 0)
        self.assertEqual(record['offline_customer_ingress_orchestration'],
                         'SYNTHETIC_AUTH_QUOTA_BOUNDED_JSON_CANARY_PASS_NOT_WIRED')
        self.assertIs(record['offline_customer_ingress_evidence']['customer_admission_authorized'], False)
        self.assertEqual(record['offline_customer_ingress_evidence']['production_requests_executed'], 0)
        self.assertEqual(record['offline_customer_request_body_boundary'],
                         'NODE_AND_LOCAL_WORKERD_TESTED_64KIB_NOT_WIRED')
        self.assertEqual(record['offline_customer_request_body_limit_bytes'], 65536)
        self.assertEqual(record['offline_customer_duplicate_json_keys'],
                         'REJECTED_IN_NODE_AND_LOCAL_WORKERD_NONPRODUCTION_TESTS')
        self.assertIs(record['offline_customer_duplicate_json_evidence']['customer_admission_authorized'], False)
        self.assertIs(record['offline_customer_request_workerd_evidence']['customer_admission_authorized'], False)
        self.assertEqual(record['offline_customer_request_body_scope'],
                         'RAW_JSON_BYTE_AND_DUPLICATE_KEY_GUARDS_NO_AUTH_OR_SEMANTIC_VALIDATION')
        self.assertEqual(record['offline_sqlite_d1_customer_admission'],
                         'SQLITE_LOCAL_CONTRACT_TESTED_D1_NOT_DEPLOYED')
        self.assertEqual(record['offline_minute_quota_and_utc_event_integrity'],
                         'SYNTHETIC_SQLITE_VERIFIED_REAL_D1_NOT_EXECUTED')
        self.assertEqual(record['offline_cloudflare_d1_runtime'],
                         'MINIFLARE_WORKERD_LOCAL_PASS_REMOTE_D1_NOT_EXECUTED')
        self.assertIs(record['offline_cloudflare_d1_evidence']['customer_admission_authorized'], False)
        self.assertEqual(record['offline_hosted_d1_staging_preflight'],
                         'STRUCTURAL_METADATA_ONLY_REMOTE_NOT_VERIFIED')
        staging = record['offline_hosted_d1_staging_evidence']
        self.assertEqual(staging['structural_negative_and_positive_tests'], 10)
        for blocker in (
            'real_cloudflare_account_verified',
            'remote_d1_transaction_testing_completed',
            'schema_migration_authorized',
            'staged_worker_deployment_authorized',
            'customer_admission_authorized',
            'existing_production_deployment_changed',
        ):
            with self.subTest(blocker=blocker):
                self.assertIs(staging[blocker], False)
        self.assertEqual(record['offline_synthetic_pilot_acceptance'],
                         'FEATURE_BRANCH_SIMULATED_ONLY_NO_REAL_DESIGN_PARTNERS')
        pilot = record['offline_synthetic_pilot_acceptance_evidence']
        self.assertEqual(pilot['synthetic_acceptance_tests'], 5)
        self.assertTrue((ROOT / pilot['fixture']).is_file())
        self.assertTrue((ROOT / pilot['suite']).is_file())
        self.assertEqual(pilot['executed_real_customer_requests'], 0)
        self.assertEqual(pilot['real_partner_signoffs'], 0)
        self.assertIs(pilot['hosted_d1_qualified'], False)
        self.assertIs(pilot['customer_admission_authorized'], False)
        self.assertEqual(record['checks']['customer_beta_acceptance_evidence'],
                         'NOT_DEMONSTRATED')
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
                expected = ('NOT_DEMONSTRATED_ON_REAL_D1' if name in (
                    'tenant_isolation_and_customer_usage_attribution',
                    'per_customer_rate_quota_and_payload_limits') else 'NOT_DEMONSTRATED')
                self.assertEqual(checks[name], expected)
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
