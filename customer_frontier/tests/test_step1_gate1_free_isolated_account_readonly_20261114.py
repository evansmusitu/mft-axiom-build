"""Synthetic Cloudflare provider responses: never exercise real account, SQL or paid resources."""
import importlib.util,json,pathlib,unittest
from datetime import datetime,timezone
p=pathlib.Path(__file__).resolve().parents[1]/'qualification'/'step1_gate1_free_isolated_account_readonly_20261114.py'
spec=importlib.util.spec_from_file_location('free_gate1',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ACCOUNT='a'*32
NOW=datetime(2026,11,14,tzinfo=timezone.utc)

def valid_get(token,account,path):
    assert token=='synthetic-only'
    assert account==ACCOUNT
    if path.endswith('/subscriptions'):return {'success':True,'result':[]}
    if '/d1/database?' in path:return {'success':True,'result':[],'result_info':{'page':1,'per_page':100,'count':0,'total_count':0}}
    return {'success':True,'result':{'id':ACCOUNT}}

class FreeTest(unittest.TestCase):
    def run_it(self,get=valid_get):return m.inspect(ACCOUNT,'synthetic-only',get=get,now=NOW)
    def test_baseline_readonly_candidate(self):
        a=self.run_it();self.assertTrue(a['isolation_candidate_empty']);self.assertFalse(a['gate1_closed'])
    def test_paid_source_account_rejected(self):
        with self.assertRaisesRegex(m.Denied,'PRODUCTION_ACCOUNT_REUSE'):m.inspect(m.SOURCE_ACCOUNT,'synthetic-only',get=valid_get)
    def test_invalid_account_ids(self):
        for x in (None,'', 'A'*32, 'a'*31, 'g'*32, '../', '123\n'):
            with self.subTest(account=x),self.assertRaises(m.Denied):m.account_pin(x)
    def test_missing_token_is_denial_on_live_get(self):
        with self.assertRaisesRegex(m.Denied,'TOKEN'):m.cloudflare_get('',ACCOUNT,f'/accounts/{ACCOUNT}')
    def test_non_get_path_forbidden(self):
        with self.assertRaisesRegex(m.Denied,'GET_ENDPOINT_NOT_ALLOWLISTED'):m.cloudflare_get('synthetic-only',ACCOUNT,f'/accounts/{ACCOUNT}/d1/database')
    def test_source_db_in_target_catalog_denied(self):
        def g(t,a,p):
            if '/d1/database?' in p:return {'success':True,'result':[{'uuid':m.SOURCE_D1,'name':'protected'}], 'result_info':{'page':1,'per_page':100,'count':1,'total_count':1}}
            return valid_get(t,a,p)
        self.assertFalse(self.run_it(g)['d1_catalog_complete'])
    def test_nonempty_db_is_not_fresh_isolated_target(self):
        def g(t,a,p):
            if '/d1/database?' in p:return {'success':True,'result':[{'uuid':'z'*36,'name':'other'}], 'result_info':{'page':1,'per_page':100,'count':1,'total_count':1}}
            return valid_get(t,a,p)
        self.assertFalse(self.run_it(g)['isolation_candidate_empty'])
    def test_paid_subscription_fails(self):
        def g(t,a,p):
            if p.endswith('/subscriptions'):return {'success':True,'result':[{'state':'Paid','rate_plan':{'name':'Workers'}}]}
            return valid_get(t,a,p)
        self.assertFalse(self.run_it(g)['all_active_paid_subscriptions_absent'])
    def test_trial_ambiguous_fails(self):
        def g(t,a,p):
            if p.endswith('/subscriptions'):return {'success':True,'result':[{'state':'Trial'}]}
            return valid_get(t,a,p)
        self.assertFalse(self.run_it(g)['all_active_paid_subscriptions_absent'])
    def test_malformed_catalog_not_complete(self):
        def g(t,a,p):
            if '/d1/database?' in p:return {'success':True,'result':[],'result_info':{}}
            return valid_get(t,a,p)
        self.assertFalse(self.run_it(g)['d1_catalog_complete'])
    def test_incomplete_catalog_not_complete(self):
        def g(t,a,p):
            if '/d1/database?' in p:return {'success':True,'result':[],'result_info':{'page':1,'per_page':100,'count':0,'total_count':10}}
            return valid_get(t,a,p)
        self.assertFalse(self.run_it(g)['d1_catalog_complete'])
    def test_account_identity_drift(self):
        def g(t,a,p):
            if p.endswith('/subscriptions') or '/d1/database?' in p:return valid_get(t,a,p)
            return {'success':True,'result':{'id':'b'*32}}
        self.assertFalse(self.run_it(g)['account_identity_verified'])
    def test_get_failure_sanitized(self):
        def g(t,a,p):raise m.Denied('HTTP_403')
        r=self.run_it(g);self.assertEqual(r['subscriptions_http'],'HTTP_403');self.assertFalse(r['gate1_closed'])
    def test_malicious_extra_response_not_persisted(self):
        def g(t,a,p):
            item=valid_get(t,a,p);item['user_email']='PRIVATE_NOT_FOR_ARTIFACT';return item
        s=json.dumps(self.run_it(g));self.assertNotIn('PRIVATE_NOT_FOR_ARTIFACT',s)
    def test_no_account_id_logged(self):
        self.assertNotIn(ACCOUNT,json.dumps(self.run_it()))
    def test_no_release_flags_even_good_metadata(self):
        r=self.run_it()
        for k in ('gate1_closed','step1_closed','step2_authorized','release_authorized','target_creation_authorized',
                  'provider_hard_zero_additional_spend_verified','customer_export_authorized','customer_restore_authorized'):
            with self.subTest(k=k):self.assertIs(r[k],False)
    def test_blank_plan_subscription_not_free_proof(self):
        r=self.run_it();self.assertFalse(r['explicit_workers_free_provider_plan_verified'])
    def test_zero_dbs_does_not_prove_payment_method_absence(self):
        self.assertFalse(self.run_it()['account_has_no_payment_method_independently_verified'])
    def test_free_account_fits_known_source_metadata_only(self):
        r=self.run_it();self.assertEqual(r['source_size_known_20261113_only_bytes'],356352)
        self.assertTrue(r['source_file_fits_free_single_db_limit']);self.assertFalse(r['import_row_write_volume_verified'])
    def test_no_real_cloud_operation_in_unit_tests(self):
        r=self.run_it();self.assertEqual(r['provider_mutations'],0)
    def test_bad_clock(self):
        with self.assertRaisesRegex(m.Denied,'UTC_CLOCK_REQUIRED'):m.inspect(ACCOUNT,'synthetic-only',get=valid_get,now=datetime(2026,11,14))
    def test_forced_owner_state_not_inferred(self):
        r=self.run_it();self.assertFalse(r['independently_authenticated_owner_mfa_verified']);self.assertFalse(r['signer_trust_anchor_activated'])
    def test_wrong_success_envelope_denied(self):
        def g(t,a,p):return {'success':False,'result':{'id':ACCOUNT}}
        r=self.run_it(g);self.assertFalse(r['account_identity_verified']);self.assertEqual(r['account_metadata_http'],'PROVIDER_ENVELOPE_INVALID')
    def test_none_subscriptions_not_free(self):
        def g(t,a,p):
            if p.endswith('/subscriptions'):return {'success':True,'result':None}
            return valid_get(t,a,p)
        r=self.run_it(g);self.assertFalse(r['all_active_paid_subscriptions_absent'])

if __name__=='__main__':unittest.main()
