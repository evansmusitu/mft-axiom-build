"""Synthetic-only Gate1 Cloudflare billing authority denies. No provider access."""
import importlib.util
import pathlib
import unittest
from datetime import datetime,timezone

SRC = pathlib.Path(__file__).resolve().parents[1] / 'qualification' / 'step1_gate1_billing_authority_readonly_20261113.py'
spec = importlib.util.spec_from_file_location('gate1_readonly', SRC)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW = datetime(2026,11,13,19,0,tzinfo=timezone.utc)


def good(path):
    if path == m.POLICIES:
        return {'success':True,'result':[{'action':'usage_block','enabled':True,'product_id':'workers','threshold_cents':1,
                                          'current_state':{'status':'limit_reached','enforcement':{'delivery_status':'succeeded'}}},
                                         {'action':'usage_block','enabled':True,'product_id':'durable_objects','threshold_cents':1}]}
    if path == m.CYCLE:
        return {'success':True,'result':{'covered':True,'subscriptions':[{'billing_cycle_anchor_timestamp':'2026-11-02T00:00:00Z'}]}}
    if path == m.USAGE:
        return {'success':True,'result':[{'BilledCost':0,'BillingAccountName':'PRIVATE NAME','secret':'SHOULD NOT LEAK'}, {'BilledCost':0}]}
    if path == m.SUBSCRIPTIONS:
        return {'success':True,'result':[{'rate_plan':{'name':'Workers Paid'},'state':'Paid'}]}
    raise AssertionError('Unexpected endpoint')


class Gate1(unittest.TestCase):
    def audit(self, get=None):
        return m.audit(get=get or (lambda _t,p:good(p)), token='not-a-real-token', now=NOW)

    def test_four_endpoints_only(self):
        self.assertEqual(m.ALLOWED,{m.POLICIES,m.CYCLE,m.USAGE,m.SUBSCRIPTIONS})
    def test_zero_cost_and_two_active_caps_do_not_close_gate(self):
        receipt=self.audit()
        self.assertTrue(receipt['workers_paid_active'])
        self.assertTrue(receipt['workers_usage_block_policy_present'])
        self.assertTrue(receipt['durable_objects_usage_block_policy_present'])
        self.assertTrue(receipt['rated_usage_zero_billed_cost_snapshot_qualified'])
        self.assertFalse(receipt['d1_hard_zero_spend_provider_guarantee_qualified'])
        self.assertFalse(receipt['gate1_closed'])
    def test_no_secrets_billing_descriptions_or_personal_data_in_receipt(self):
        import json
        receipt=json.dumps(self.audit())
        self.assertNotIn('PRIVATE NAME',receipt)
        self.assertNotIn('SHOULD NOT LEAK',receipt)
        self.assertNotIn('not-a-real-token',receipt)
    def test_http_403_fails_closed(self):
        receipt=self.audit(lambda _t,p: (_ for _ in ()).throw(m.NoGo('HTTP_403')))
        self.assertEqual(receipt['spend_policies_http'],'HTTP_403')
        self.assertFalse(receipt['gate1_closed'])
    def test_http_unknown_error_sanitized(self):
        receipt=self.audit(lambda _t,p: (_ for _ in ()).throw(m.NoGo('PROVIDER_UNAVAILABLE')))
        self.assertEqual(receipt['billing_cycle_http'],'PROVIDER_UNAVAILABLE')
        self.assertFalse(receipt['gate1_closed'])
    def test_unsupported_d1_policy_never_proves_cap(self):
        def inject(_t,p):
            d=good(p)
            if p==m.POLICIES:
                d['result'].append({'action':'usage_block','product_id':'d1','enabled':True,'threshold_cents':0})
            return d
        receipt=self.audit(inject)
        self.assertFalse(receipt['spend_policies_catalog_qualified'])
        self.assertFalse(receipt['d1_hard_zero_spend_provider_guarantee_qualified'])
    def test_malformed_trailing_policy_cannot_leave_partial_true(self):
        def inject(_t,p):
            d=good(p)
            if p==m.POLICIES:
                d['result'].append({'action':'unknown','product_id':'d1','enabled':True,'threshold_cents':0})
            return d
        receipt=self.audit(inject)
        self.assertFalse(receipt['spend_policies_catalog_qualified'])
        self.assertFalse(receipt['workers_usage_block_policy_present'])
        self.assertFalse(receipt['durable_objects_usage_block_policy_present'])

    def test_spend_threshold_zero_invalid(self):
        def inject(_t,p):
            d=good(p)
            if p==m.POLICIES:
                d['result'][0]['threshold_cents']=0
            return d
        receipt=self.audit(inject)
        self.assertFalse(receipt['spend_policies_catalog_qualified'])
    def test_policy_missing_current_state_not_edge_proof(self):
        def inject(_t,p):
            d=good(p)
            if p==m.POLICIES:
                del d['result'][0]['current_state']
            return d
        receipt=self.audit(inject)
        self.assertFalse(receipt['workers_usage_block_effectively_proven'])
    def test_notification_only_does_not_count_as_block(self):
        def inject(_t,p):
            d=good(p)
            if p==m.POLICIES:
                d['result']=[{'action':'notification','product_id':'workers','enabled':True,'threshold_cents':100}]
            return d
        receipt=self.audit(inject)
        self.assertFalse(receipt['workers_usage_block_policy_present'])
    def test_disabled_block_does_not_count(self):
        def inject(_t,p):
            d=good(p)
            if p==m.POLICIES:
                d['result'][0]['enabled']=False
            return d
        receipt=self.audit(inject)
        self.assertFalse(receipt['workers_usage_block_policy_present'])
    def test_nonzero_usage_not_zero_snapshot(self):
        def inject(_t,p):
            d=good(p)
            if p==m.USAGE:
                d['result'][0]['BilledCost']=0.99
            return d
        receipt=self.audit(inject)
        self.assertFalse(receipt['rated_usage_zero_billed_cost_snapshot_qualified'])
    def test_empty_usage_not_proof_of_zero(self):
        def inject(_t,p):
            d=good(p)
            if p==m.USAGE:
                d['result']=[]
            return d
        self.assertFalse(self.audit(inject)['rated_usage_zero_billed_cost_snapshot_qualified'])
    def test_incomplete_billing_data_not_proof_of_zero(self):
        def inject(_t,p):
            d=good(p)
            if p==m.USAGE:
                del d['result'][0]['BilledCost']
            return d
        self.assertFalse(self.audit(inject)['rated_usage_zero_billed_cost_snapshot_qualified'])
    def test_bad_cycle_coverage_not_proof(self):
        def inject(_t,p):
            d=good(p)
            if p==m.CYCLE:
                d['result']={'covered':'yes','subscriptions':[]}
            return d
        self.assertFalse(self.audit(inject)['billing_cycle_coverage_reported'])
    def test_no_mfa_attestation_even_if_all_provider_gets_pass(self):
        receipt=self.audit()
        self.assertFalse(receipt['actual_owner_mfa_independently_qualified'])
        self.assertFalse(receipt['owner_public_trust_pins_independently_activated'])
    def test_no_d1_or_customer_data_permission(self):
        receipt=self.audit()
        for k in ('provider_d1_target_creation_authorized','customer_data_export_authorized',
                  'customer_data_restore_authorized','step1_closed','step2_authorized','release_authorized'):
            self.assertFalse(receipt[k])
    def test_nonce_and_private_material_never_in_provider_module(self):
        content=SRC.read_text()
        for s in ("method='POST'", "method='PUT'", "method='DELETE'", 'wrangler d1', 'OWNER_SIGNATURE.bin', 'pkcs8_encrypted.pem'):
            self.assertNotIn(s, content)
    def test_untrusted_nonredirect_http_scheme_cannot_be_added(self):
        self.assertNotIn('/d1/database', m.ALLOWED)
    def test_clock_requires_timezone(self):
        with self.assertRaises(m.NoGo):
            m.audit(get=lambda _t,p:good(p),token='stub',now=datetime(2026,11,13))

if __name__ == '__main__':
    unittest.main()
