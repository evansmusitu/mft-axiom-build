"""Negative/positive contracts for AXIOM hosted staging metadata-only audit."""
import json
import unittest
from unittest.mock import patch
import hosted_idp_prerequisites_readonly as m

class Response:
    status=200
    headers={}
    def __init__(self, body):
        self.raw=json.dumps(body).encode()
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,max_bytes):return self.raw[:max_bytes]

class Opener:
    def __init__(self,body):self.body=body
    def open(self,req,timeout):
        assert req.get_method()=='GET'
        return Response(self.body)

def fixture():
    data={
      'zone':{'account':{'id':m.ACCOUNT},'name':'mftintelligence.com','status':'active'},
      'zone_security':{'value':'under_attack'},
      'config_rules':{'id':m.RULESET,'version':'26','rules':[{'id':str(i)} for i in range(10)]},
      'd1_list':[{'uuid':m.PREVIOUS_DB_ID,'name':m.PREVIOUS_DB_NAME},
                 {'uuid':'ephemeral','name':'axiom-disposable-candidate'}],
      'previous_d1':{'uuid':m.PREVIOUS_DB_ID,'name':m.PREVIOUS_DB_NAME,'num_tables':28},
      'workers':[{'id':m.STAGE_WORKER},{'id':'axiom-idp-candidate'}],
      'stage_settings':{'bindings':[]},
      'domains':[{'hostname':m.STAGE_HOST,'service':m.STAGE_WORKER,'enabled':True}],
      'oidc_discovery':{'issuer':m.ISSUER,'authorization_endpoint':m.ISSUER+'/oauth/v2/authorize',
        'token_endpoint':m.ISSUER+'/oauth/v2/token','jwks_uri':m.ISSUER+'/oauth/v2/keys',
        'code_challenge_methods_supported':['S256'],'id_token_signing_alg_values_supported':['RS256']},
      'oidc_jwks':{'keys':[{'kty':'RSA','kid':'synthetic','n':'synthetic','e':'AQAB'}]},
      'stage_health':{'ok':True,'stage':'host_route_only',
        'identity_live_qualified':False,'customer_ownership_qualified':False,
        'oauth_upgrade_qualified':False,'release_qualified':False},
      'stage_auth':{'ok':False},
      'stage_customer':{'ok':False},
      'd1_info':{'page':1,'count':2,'total_count':2,'per_page':100}
    }
    meta={name:{'http':200,'cookie':False,'valid':True} for name in data}
    meta['stage_auth']['http']=503
    meta['stage_customer']['http']=503
    return data,meta

class HostedIdentityReadOnlyTests(unittest.TestCase):
    def test_d1_api_pagination_must_be_carried_not_fabricated(self):
        """Regression: prior D1 inventory scripts got pagination wrong."""
        body={'success':True,'result':[{'uuid':'one','name':'one'}],
              'result_info':{'page':1,'count':1,'per_page':100,'total_count':1}}
        with patch.object(m.urllib.request,'build_opener',return_value=Opener(body)):
            meta,rows=m.get_json(m.CFROOT+m.CLOUD_PATHS[3],'synthetic-secret')
        self.assertTrue(meta['valid'])
        self.assertEqual(len(rows),1)
        self.assertEqual(meta['result_info']['total_count'],1)

    def test_excludes_non_allowlisted_api_paths(self):
        with self.assertRaises(m.Refuse):
            m.get_json(m.CFROOT+'/accounts/'+m.ACCOUNT+'/d1/database/other/query','fake')
        with self.assertRaises(m.Refuse):
            m.get_json('https://example.invalid/','')

    def test_good_metadata_never_qualifies_real_identity(self):
        data,meta=fixture()
        result=m.summarize((data,meta))
        self.assertEqual(result['status'],'HOSTED_METADATA_OBSERVED_IDENTITY_NO_GO')
        self.assertEqual(result['previous_d1_table_count'],28)
        self.assertFalse(result['previous_d1_is_empty_proven'])
        self.assertEqual(result['possible_disposable_d1_names_count'],1)
        self.assertTrue(result['host_auth_fail_closed_503'])
        self.assertFalse(result['customer_identity_live_qualified'])
        self.assertFalse(result['customer_ownership_qualified'])
        self.assertFalse(result['hosted_migration_qualified'])

    def test_rejects_incomplete_database_pagination(self):
        data,meta=fixture()
        data['d1_info']['total_count']=3
        result=m.summarize((data,meta))
        self.assertFalse(result['d1_list_complete'])
        self.assertEqual(result['status'],'INCOMPLETE_READONLY_NO_GO')

    def test_rejects_stale_cloudflare_config_version(self):
        data,meta=fixture()
        data['config_rules']['version']='25'
        result=m.summarize((data,meta))
        self.assertFalse(result['config_rules_v26'])
        self.assertEqual(result['status'],'INCOMPLETE_READONLY_NO_GO')

    def test_rejects_unexpected_live_binding_on_host_only_worker(self):
        data,meta=fixture()
        data['stage_settings']['bindings']=[{'type':'d1','name':'CUSTOMER_DB'}]
        result=m.summarize((data,meta))
        self.assertFalse(result['stage_worker_still_host_only'])
        self.assertFalse(result['customer_identity_live_qualified'])
        self.assertEqual(result['status'],'INCOMPLETE_READONLY_NO_GO')

    def test_refuses_auth_success_as_host_only_acceptance(self):
        data,meta=fixture()
        meta['stage_auth']['http']=302
        result=m.summarize((data,meta))
        self.assertFalse(result['host_auth_fail_closed_503'])
        self.assertEqual(result['status'],'INCOMPLETE_READONLY_NO_GO')

if __name__=='__main__':
    unittest.main()
