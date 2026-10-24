"""TDD security probes for the S0-only independent financial policy seam.

This module NEVER certifies real provider-account zero-spend enforcement.
"""
import copy
import unittest

from ops.iso_trust_boundary.financial_zero_boundary import FinancialHold, FinancialZeroBoundary


class FinancialZeroBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.boundary = FinancialZeroBoundary(
            pinned_policy_sha256='a'*64,
            local_tool_allowlist=('sha256.compute', 'json.parse'),
        )
        self.operation = {
            'schema': 'musitu.axiom.iso.s0.planned-operation.v1',
            'policy_sha256': 'a'*64,
            'operation_id': 'operation:1',
            'project_id': 'project:1',
            'work_id': 'work:1',
            'agent_id': 'agent:1',
            'workload_identity_id': 'workload:1',
            'request_sha256': 'b'*64,
            'risk_class': 'S0',
            'tool_id': 'sha256.compute',
            'provider_dispatch': False,
            'network_egress': False,
            'external_state_write': False,
            'privileged_credential_required': False,
        }
        self.financial = {
            'schema': 'musitu.axiom.iso.s0.financial-input.v1',
            'currency': 'USD',
            'cost_source': 'NO_EXTERNAL_PROVIDER_INVOCATION',
            'quoted_max_charge_micro_usd': 0,
            'observed_charge_micro_usd': 0,
            'external_provider_account_id': None,
            'external_provider_hard_zero_cap_verified': False,
            'billing_method_enabled': False,
            'billing_credits_available': False,
            'cost_unknown': False,
        }

    def judge(self, *, op=None, finance=None):
        return self.boundary.review(
            operation=self.operation if op is None else op,
            financial=self.financial if finance is None else finance)

    def test_local_pure_compute_only_yields_non_execution_evidence(self):
        result = self.judge()
        self.assertEqual(result['status'], 'S0_LOCAL_ZERO_SPEND_RULE_CHECKED')
        self.assertEqual(result['product_objects'], ['Project', 'Work', 'Agent', 'Artifact', 'Evidence'])
        self.assertEqual(result['account_wide_zero_hard_cap'], 'NOT_PROVEN')
        self.assertEqual(result['global_antirollback'], 'FAILED_IN_SYNTHETIC_ATTACK')
        self.assertIs(result['external_provider_allowed'], False)
        self.assertIs(result['execution_allowed'], False)
        self.assertIs(result['production_authority'], False)

    def test_any_risk_above_s0_blocks(self):
        for risk in ['S1','S2','S3','S4','S5','S99',None]:
            with self.subTest(risk=risk), self.assertRaises(FinancialHold):
                self.judge(op=dict(self.operation, risk_class=risk))

    def test_network_egress_blocks_even_with_zero_estimate(self):
        with self.assertRaisesRegex(FinancialHold, 'NETWORK_EGRESS_DENIED'):
            self.judge(op=dict(self.operation, network_egress=True))

    def test_provider_dispatch_blocks_even_with_free_label(self):
        with self.assertRaisesRegex(FinancialHold, 'PROVIDER_DISPATCH_DENIED'):
            self.judge(op=dict(self.operation, provider_dispatch=True))

    def test_nonzero_cost_blocks(self):
        for charge in (1, -1, 1000000):
            with self.subTest(charge=charge), self.assertRaises(FinancialHold):
                self.judge(finance=dict(self.financial, quoted_max_charge_micro_usd=charge))

    def test_bool_cost_does_not_pass_as_zero(self):
        with self.assertRaises(FinancialHold):
            self.judge(finance=dict(self.financial, observed_charge_micro_usd=False))

    def test_float_or_nan_cost_denied(self):
        for charge in (0.0, float('nan'), float('inf')):
            with self.subTest(charge=charge), self.assertRaises(FinancialHold):
                self.judge(finance=dict(self.financial, quoted_max_charge_micro_usd=charge))

    def test_billing_credits_are_not_zero_cost_proof(self):
        with self.assertRaisesRegex(FinancialHold, 'BILLING_ACCOUNT_PRESENT'):
            self.judge(finance=dict(self.financial, billing_credits_available=True))

    def test_soft_provider_cap_is_not_zero_guarantee(self):
        with self.assertRaisesRegex(FinancialHold, 'BILLING_ACCOUNT_PRESENT'):
            self.judge(finance=dict(self.financial, external_provider_hard_zero_cap_verified=True))

    def test_provider_account_connection_blocks_without_reading_secrets(self):
        with self.assertRaisesRegex(FinancialHold, 'BILLING_ACCOUNT_PRESENT'):
            self.judge(finance=dict(self.financial, external_provider_account_id='acct:1'))

    def test_unknown_cost_blocks(self):
        with self.assertRaisesRegex(FinancialHold, 'UNKNOWN_EXTERNAL_COST'):
            self.judge(finance=dict(self.financial, cost_unknown=True))

    def test_claiming_free_without_enforcement_blocks(self):
        with self.assertRaisesRegex(FinancialHold, 'UNTRUSTED_COST_ORIGIN'):
            self.judge(finance=dict(self.financial, cost_source='PROVIDER_SAYS_FREE'))

    def test_forged_custom_fields_block(self):
        with self.assertRaisesRegex(FinancialHold, 'EXACT_FINANCIAL_FIELDS'):
            self.judge(finance=dict(self.financial, permit_paid_s3=True))
        with self.assertRaisesRegex(FinancialHold, 'EXACT_OPERATION_FIELDS'):
            self.judge(op=dict(self.operation, approve_external_network=True))

    def test_scope_and_policy_digest_mismatch_block(self):
        with self.assertRaisesRegex(FinancialHold, 'POLICY_MISMATCH'):
            self.judge(op=dict(self.operation, policy_sha256='f'*64))
        with self.assertRaisesRegex(FinancialHold, 'TOOL_NOT_PINNED'):
            self.judge(op=dict(self.operation, tool_id='repo.mutate'))

    def test_external_state_write_and_secret_broker_block(self):
        for field in ['external_state_write','privileged_credential_required']:
            with self.subTest(field=field),self.assertRaises(FinancialHold):
                self.judge(op=dict(self.operation,**{field:True}))

    def test_bad_identifier_and_identity_provenance_rejected(self):
        for field in ['operation_id','project_id','work_id','agent_id','workload_identity_id']:
            with self.subTest(field=field),self.assertRaises(FinancialHold):
                self.judge(op=dict(self.operation, **{field:'../escape'}))

    def test_empty_allowlist_denied(self):
        with self.assertRaises(FinancialHold):
            FinancialZeroBoundary(pinned_policy_sha256='a'*64,local_tool_allowlist=())

    def test_duplicate_tool_names_denied(self):
        with self.assertRaises(FinancialHold):
            FinancialZeroBoundary(pinned_policy_sha256='a'*64,local_tool_allowlist=('json.parse','json.parse'))

    def test_financial_unknown_boolean_or_wrong_currency_denied(self):
        for kwargs in [{'cost_unknown':None},{'cost_unknown':0},{'currency':'EUR'}, {'currency':'usd'}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(FinancialHold):
                self.judge(finance=dict(self.financial,**kwargs))

    def test_output_is_not_replay_or_release_authority(self):
        first=self.judge(); second=self.judge()
        self.assertEqual(first['operation_sha256'],second['operation_sha256'])
        self.assertFalse(first['provider_dispatch_allowed'])
        self.assertEqual(first['independent_security_qualification'],'NOT_CERTIFIED')
        self.assertEqual(first['single_use_authorization'],'NOT_PROVEN')


if __name__=='__main__': unittest.main()
