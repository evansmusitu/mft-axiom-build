import copy
import unittest
from unittest.mock import patch
import staging_override as m

class Fake:
    def __init__(self):
        self.base={'id':m.RULESET,'version':'25','phase':'http_config_settings','kind':'zone','rules':[]}
        names=['first.example.com','second.example.com']+[f'other{i}.example.com' for i in range(8)]
        for i,(rid,host) in enumerate(zip(m.FULL_IDS,names)):
            self.base['rules'].append({'id':rid,'version':'1','last_updated':'2026-11-08T01:00:00Z','enabled':True,
                     'action':'set_config','expression':f'(http.host eq "{host}")',
                     'action_parameters':{'bic':False,'security_level':'essentially_off'} if i<2 else {'security_level':'essentially_off'},
                     'description':f'old_rule_{i}','ref':f'old_{i}'})
        self.historical=copy.deepcopy(self.base)
        self.current=copy.deepcopy(self.base)
        self.fail_dry=False
        self.changed_global=False
        self.live_count=0
        self.dry_count=0
        self.reads=[]
    def get(self,path):
        self.reads.append(path)
        if path==f'/zones/{m.ZONE}':return {'account':{'id':m.ACCOUNT},'name':'mftintelligence.com','status':'active','plan':{'name':'Free Website'}}
        if path==f'/zones/{m.ZONE}/settings/security_level':return {'value':'medium'} if self.changed_global else {'value':'under_attack'}
        if path==f'/accounts/{m.ACCOUNT}/workers/domains':return [{'hostname':m.HOST,'service':m.WORKER,'enabled':True}]
        if path==f'/accounts/{m.ACCOUNT}/workers/scripts/{m.WORKER}/settings':return {'bindings':[]}
        if path==m.RULEPATH:return copy.deepcopy(self.current)
        if path==m.RULEPATH+'/versions/25':return copy.deepcopy(self.historical)
        raise AssertionError('unsupported GET')
    def put(self,path,body):
        if path.endswith('?dry_run=true'):
            self.dry_count+=1
            if self.fail_dry:raise m.Stop('DRY_RUN_REJECTED')
            return None
        self.live_count+=1
        assert path==m.RULEPATH
        self.current=copy.deepcopy(self.current)
        self.current['version']='26'
        self.current['rules']=copy.deepcopy(body['rules'])
        self.current['rules'][-1]['id']='a'*32
        return copy.deepcopy(self.current)

def http(path):
    if path=='/_health':return 200,False,b'{"stage":"host_route_only","identity_live_qualified":false}'
    return 503,False,b'{}'

class TestStagingOverride(unittest.TestCase):
    def setUp(self):
        self.api=Fake()
        self.patcher=patch.object(m,'FULL_HASHES',tuple(m.h(x['expression']) for x in self.api.current['rules']))
        self.patcher.start();self.addCleanup(self.patcher.stop)
    def test_two_identical_disjoint_hosts_combined_and_8_other_identities_untouched(self):
        r=m.run(self.api,http,lambda _:None)
        self.assertEqual(r['status'],'EXACT_STAGE_HTTPS_200_AND_AUTH_503_PASS')
        self.assertEqual((self.api.dry_count,self.api.live_count),(1,1))
        self.assertEqual(len(self.api.current['rules']),10)
        self.assertIn('first.example.com',self.api.current['rules'][0]['expression'])
        self.assertIn('second.example.com',self.api.current['rules'][0]['expression'])
        self.assertEqual([x['id'] for x in self.api.current['rules'][1:9]],list(m.REST_IDS))
        self.assertEqual(self.api.current['rules'][9]['expression'],m.EXPR)
        self.assertFalse(r['customer_identity_qualified'])
    def test_reject_different_original_host_effects_without_writes(self):
        self.api.current['rules'][1]['action_parameters']={'bic':True,'security_level':'essentially_off'}
        self.api.historical=copy.deepcopy(self.api.current)
        with self.assertRaisesRegex(m.Stop,'EXISTING_RULE_ACTION_DIFFERENCE'):m.run(self.api,http,lambda _:None)
        self.assertEqual(self.api.live_count,0)
    def test_reject_changed_original_expression_without_writes(self):
        self.api.current['rules'][0]['expression']='true'
        self.api.historical=copy.deepcopy(self.api.current)
        with self.assertRaisesRegex(m.Stop,'RULE_ID_OR_EXPRESSION_DRIFT'):m.run(self.api,http,lambda _:None)
        self.assertEqual(self.api.live_count,0)
    def test_reject_conflicting_historical_snapshot_without_writes(self):
        self.api.historical['rules'][0]['description']='drift'
        with self.assertRaisesRegex(m.Stop,'HISTORICAL_ROLLBACK_SNAPSHOT_MISMATCH'):m.run(self.api,http,lambda _:None)
        self.assertEqual(self.api.live_count,0)
    def test_reject_missing_or_changed_version_before_writes(self):
        self.api.current['version']='26'
        with self.assertRaisesRegex(m.Stop,'RULESET_VERSION_OR_ID_DRIFT'):m.run(self.api,http,lambda _:None)
        self.assertEqual(self.api.live_count,0)
    def test_provider_dry_run_rejection_cannot_write(self):
        self.api.fail_dry=True
        with self.assertRaisesRegex(m.Stop,'DRY_RUN_REJECTED'):m.run(self.api,http,lambda _:None)
        self.assertEqual((self.api.dry_count,self.api.live_count),(1,0))
    def test_no_global_security_changes_while_staging_exception_added(self):
        self.api.changed_global=True
        with self.assertRaisesRegex(m.Stop,'GLOBAL_SECURITY_DRIFT'):m.run(self.api,http,lambda _:None)
        self.assertEqual(self.api.live_count,0)
    def test_do_not_accept_readback_when_a_bystander_rule_changes(self):
        old_put=self.api.put
        def malicious(path,body):
            res=old_put(path,body)
            if path==m.RULEPATH:
                self.api.current['rules'][4]['action_parameters']={'security_level':'under_attack'}
            return res
        self.api.put=malicious
        r=m.run(self.api,http,lambda _:None)
        self.assertEqual(r['status'],'PROVIDER_WRITE_READBACK_MISMATCH_REVIEW_REQUIRED')
        self.assertEqual(self.api.live_count,1)
    def test_global_api_key_and_email_use_only_cloudflare_auth_headers(self):
        client=m.Client('synthetic-not-real','example@example.com')
        self.assertEqual(client.auth_headers,{'X-Auth-Email':'example@example.com','X-Auth-Key':'synthetic-not-real'})
        self.assertNotIn('authorization',client.auth_headers)
        with self.assertRaisesRegex(m.Stop,'CREDENTIALS_UNAVAILABLE'):
            m.Client('synthetic-not-real','')

    def test_no_http_success_does_not_claim_identity(self):
        def challenged(path):return 403,False,b'challenge'
        r=m.run(self.api,challenged,lambda _:None)
        self.assertEqual(r['status'],'HOST_RULE_PUBLISHED_HTTPS_PENDING')
        self.assertFalse(r['customer_identity_qualified'])

if __name__=='__main__':unittest.main()
