"""Synthetic-only MFA-posture checks. Always non-authorizing."""
import importlib.util
import pathlib
import unittest
from datetime import datetime,timezone
SRC=pathlib.Path(__file__).resolve().parents[1]/'qualification'/'step1_gate1_cloudflare_mfa_posture_readonly_20261113.py'
spec=importlib.util.spec_from_file_location('gate1_mfa',SRC)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW=datetime(2026,11,13,20,0,tzinfo=timezone.utc)


def provider(path):
    if path=='/accounts/'+m.ACCOUNT:
        return {'success':True,'result':{'id':m.ACCOUNT,'settings':{'enforce_twofactor':True},'name':'PRIVATE_ACCOUNT_NAME'}}
    if path=='/accounts/'+m.ACCOUNT+'/members?page=1&per_page=100':
        return {'success':True,'result':[
            {'id':'member_private_1','status':'accepted','user':{'two_factor_authentication_enabled':True,'email':'SECRET_OWNER_EMAIL'},'roles':[{'name':'Super Administrator'}]},
            {'id':'member_private_2','status':'accepted','user':{'two_factor_authentication_enabled':True},'roles':[]}],
            'result_info':{'page':1,'per_page':100,'count':2,'total_count':2}}
    if path=='/user':
        return {'success':True,'result':{'two_factor_authentication_enabled':True,'email':'SECRET_API_PRINCIPAL'}}
    raise AssertionError('Unexpected path '+path)

class AuditTests(unittest.TestCase):
    def run_audit(self,get=None):return m.audit(get=get or (lambda _t,p:provider(p)),token='PRIVATE_TOKEN',now=NOW)
    def test_every_good_signal_does_not_authorize_gate1(self):
        r=self.run_audit()
        self.assertTrue(r['account_2fa_requirement_enabled'])
        self.assertTrue(r['accepted_member_2fa_all_enabled'])
        self.assertEqual(r['member_super_admin_count'],1)
        self.assertTrue(r['token_user_2fa_reported'])
        self.assertFalse(r['owner_identity_and_mfa_independently_qualified'])
        self.assertFalse(r['gate1_closed'])
    def test_no_personal_data_or_token_in_receipt(self):
        import json
        data=json.dumps(self.run_audit())
        for secret in ('PRIVATE_ACCOUNT_NAME','SECRET_OWNER_EMAIL','SECRET_API_PRINCIPAL','PRIVATE_TOKEN','member_private_1'):
            self.assertNotIn(secret,data)
    def test_404_or_403_denies(self):
        r=self.run_audit(lambda _t,p: (_ for _ in ()).throw(m.NoGo('HTTP_403')))
        self.assertEqual(r['account_http'],'HTTP_403')
        self.assertFalse(r['gate1_closed'])
    def test_only_exact_paths(self):
        self.assertFalse(m.valid_path('/accounts/'+m.ACCOUNT+'/d1/database'))
        self.assertFalse(m.valid_path('/accounts/another/members?page=1&per_page=100'))
        self.assertFalse(m.valid_path('/accounts/'+m.ACCOUNT+'/members?page=6&per_page=100'))
        self.assertTrue(m.valid_path('/user'))
    def test_account_mismatch_not_verified(self):
        def inject(_t,p):
            r=provider(p)
            if p=='/accounts/'+m.ACCOUNT:r['result']['id']='wrong'
            return r
        self.assertFalse(self.run_audit(inject)['account_identity_matched'])
    def test_mfa_disabled_member(self):
        def inject(_t,p):
            r=provider(p)
            if 'members?' in p:r['result'][1]['user']['two_factor_authentication_enabled']=False
            return r
        self.assertFalse(self.run_audit(inject)['accepted_member_2fa_all_enabled'])
    def test_missing_member_mfa_is_not_proof(self):
        def inject(_t,p):
            r=provider(p)
            if 'members?' in p:del r['result'][0]['user']['two_factor_authentication_enabled']
            return r
        self.assertFalse(self.run_audit(inject)['accepted_member_2fa_all_enabled'])
    def test_pending_member_not_counted_accepted(self):
        def inject(_t,p):
            r=provider(p)
            if 'members?' in p:r['result'][1]['status']='pending'
            return r
        self.assertEqual(self.run_audit(inject)['accepted_member_count'],1)
    def test_zero_members_never_all_mfa_pass(self):
        def inject(_t,p):
            r=provider(p)
            if 'members?' in p:r['result']=[];r['result_info']['count']=0;r['result_info']['total_count']=0
            return r
        self.assertFalse(self.run_audit(inject)['accepted_member_2fa_all_enabled'])
    def test_pagination_change_fails_closed(self):
        def inject(_t,p):
            r=provider(p)
            if 'members?' in p:r['result_info']['total_count']=201
            return r
        r=self.run_audit(inject)
        self.assertNotEqual(r['member_list_http'],200)
        self.assertFalse(r['member_list_complete'])
    def test_missing_user_token_identity_never_owner(self):
        def inject(_t,p):
            r=provider(p)
            if p=='/user':r['result']['two_factor_authentication_enabled']=False
            return r
        self.assertFalse(self.run_audit(inject)['token_user_2fa_reported'])
        self.assertFalse(self.run_audit(inject)['token_user_identity_is_verified_owner'])
    def test_mfa_do_not_activate_runtime_policy(self):
        r=self.run_audit()
        self.assertFalse(r['sole_owner_policy_runtime_activated'])
        self.assertTrue(r['runtime_pr216_two_human_verification_unchanged'])
        self.assertFalse(r['owner_signed_proposal_authorizes_provider_operations'])
    def test_duplicate_member_id_rejects_complete_member_listing(self):
        def inject(_t,p):
            r=provider(p)
            if 'members?' in p:r['result'][1]['id']=r['result'][0]['id']
            return r
        receipt=self.run_audit(inject)
        self.assertEqual(receipt['member_list_http'],'DUPLICATE_MEMBER_ID')
        self.assertFalse(receipt['member_list_complete'])

    def test_bad_envelope_refused(self):
        r=self.run_audit(lambda _t,p:{'success':False,'result':{}})
        self.assertNotEqual(r['account_http'],200)
        self.assertNotEqual(r['member_list_http'],200)
        self.assertNotEqual(r['token_user_http'],200)
    def test_no_mutation_http_methods(self):
        content=SRC.read_text()
        for x in ("method='POST'","method='PUT'","method='DELETE'",'openssl.exe','private\u005cowner_ed25519'):
            self.assertNotIn(x,content)
    def test_clock_tz_required(self):
        with self.assertRaises(m.NoGo):m.audit(get=lambda _t,p:provider(p),token='stub',now=datetime(2026,11,13))

if __name__=='__main__':unittest.main()
