"""Synthetic no-network tests for fixed GET-only Cloudflare account/D1 capability."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

SOURCE=Path(__file__).resolve().parents[1]/'qualification/other_cf_account_d1_capacity.py'
OTHER='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

class TestCFAccountCapacity(unittest.TestCase):
    def run_probe(self, mutator=None, token='SYNTHETIC_SECRET', fault_path=None, fault=None):
        spec=importlib.util.spec_from_file_location('account_probe', SOURCE)
        mod=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        def payload(rows, page, per_page, total):
            return {'success':True, 'result':rows,
                    'result_info':{'page':page,'per_page':per_page,
                                   'count':len(rows),'total_count':total}}
        data={
            '/accounts?per_page=50&page=1':payload([
                {'id':mod.MAIN,'name':'PRIVATE_MAIN_ACCOUNT_NAME'},
                {'id':OTHER,'name':'PRIVATE_SECOND_ACCOUNT_NAME'}],1,50,2),
            '/accounts/{}{}'.format(mod.MAIN,'/d1/database?per_page=100&page=1'):
                payload([{'uuid':format(i,'08x')+'-1111-2222-3333-444444444444',
                          'name':'PRIVATE_DATABASE_LABEL'} for i in range(11)],1,100,11),
            '/accounts/{}{}'.format(OTHER,'/d1/database?per_page=100&page=1'):
                payload([],1,100,0)
        }
        if mutator:
            mutator(data)
        requests=[]
        class Response:
            status=200
            def __init__(self, value):self.value=value
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,size):return json.dumps(self.value).encode()[:size]
        class Opener:
            def open(self, req, timeout):
                requests.append(req)
                path=req.full_url[len(mod.API):]
                if path==fault_path and fault:
                    raise fault
                return Response(data[path])
        class Sink:
            blobs={}
            def __init__(self,name):self.name=name
            def write_bytes(self,v):self.blobs[self.name]=v
            def write_text(self,v):self.blobs[self.name]=v
        output=io.StringIO()
        with patch.object(mod.urllib.request,'build_opener',return_value=Opener()),\
             patch.object(mod,'Path',Sink),\
             patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':token}),\
             contextlib.redirect_stdout(output):
            rc=mod.observe()
        for secret in ['SYNTHETIC_SECRET','PRIVATE_MAIN_ACCOUNT_NAME',
                       'PRIVATE_SECOND_ACCOUNT_NAME','PRIVATE_DATABASE_LABEL']:
            self.assertNotIn(secret,output.getvalue())
            self.assertNotIn(secret,str(Sink.blobs))
        for req in requests:
            self.assertEqual(req.get_method(),'GET')
            self.assertIsNone(req.data)
            self.assertTrue(req.full_url.startswith(mod.API+'/accounts'))
        report=json.loads(Sink.blobs[mod.OUTPUT])
        self.assertFalse(report['restore_target_admitted'])
        self.assertFalse(report['account_ownership_qualified'])
        self.assertFalse(report['billing_plan_qualified'])
        self.assertFalse(report['release_authority'])
        self.assertFalse(report['create_authorized'])
        self.assertEqual(report['mutations'],0)
        self.assertEqual(report['sql_queries'],0)
        return rc,report,requests

    def test_two_accounts_one_preliminary_capacity_signal_no_admission(self):
        rc,r,reqs=self.run_probe()
        self.assertEqual(rc,0)
        self.assertEqual(len(r['accounts']),2)
        self.assertEqual(r['other_accounts_with_under_10_d1'],1)
        self.assertEqual([a['d1_count'] for a in r['accounts']],[11,0])
        self.assertTrue(r['account_scope_complete'])
        self.assertEqual(len(reqs),3)

    def test_no_secret_means_no_requests(self):
        rc,r,reqs=self.run_probe(token='')
        self.assertEqual(rc,1)
        self.assertEqual(reqs,[])
        self.assertIn('MISSING_TOKEN',r['errors'])

    def test_provider_denial_cannot_become_zero_accounts(self):
        p='/accounts?per_page=50&page=1'
        e=urllib.error.HTTPError('https://private.example',403,'PRIVATE_ERROR',{},None)
        rc,r,_=self.run_probe(fault_path=p,fault=e)
        self.assertEqual(rc,1)
        self.assertFalse(r['account_scope_complete'])
        self.assertEqual(r['accounts'],[])

    def test_rediscovered_account_is_rejected(self):
        def modify(d):
            d['/accounts?per_page=50&page=1']['result'].append(
                {'id':OTHER,'name':'PRIVATE_SECOND_ACCOUNT_NAME'})
            d['/accounts?per_page=50&page=1']['result_info']['count']=3
        rc,r,_=self.run_probe(modify)
        self.assertEqual(rc,1)
        self.assertIn('INVALID_ACCOUNT_IDENTITY',r['errors'])

    def test_invalid_extra_account_identity_is_rejected(self):
        def modify(d):
            d['/accounts?per_page=50&page=1']['result'][1]['id']='INVALID'
        rc,r,_=self.run_probe(modify)
        self.assertEqual(rc,1)
        self.assertFalse(r['account_scope_complete'])

    def test_database_duplicate_cannot_claim_headroom(self):
        p='/accounts/'+OTHER+'/d1/database?per_page=100&page=1'
        def modify(d):
            d[p]['result']=[{'uuid':'11111111-1111-1111-1111-111111111111'},
                            {'uuid':'11111111-1111-1111-1111-111111111111'}]
            d[p]['result_info']['count']=2
        rc,r,_=self.run_probe(modify)
        self.assertEqual(rc,1)
        self.assertEqual(r['other_accounts_with_under_10_d1'],0)
        self.assertTrue(any('D1_INVALID_D1_IDENTITY'==x for x in r['errors']))

    def test_mismatched_pagination_refuses(self):
        def modify(d):d['/accounts?per_page=50&page=1']['result_info']['page']=2
        rc,r,_=self.run_probe(modify)
        self.assertEqual(rc,1)
        self.assertFalse(r['account_scope_complete'])

    def test_full_unterminated_page_refuses(self):
        def modify(d):
            d['/accounts?per_page=50&page=1']={
                'success':True,'result':[{'id':format(i,'032x')} for i in range(50)]}
            d['/accounts?per_page=50&page=2']={
                'success':True,'result':[{'id':format(i+50,'032x')} for i in range(50)]}
        rc,r,_=self.run_probe(modify)
        self.assertEqual(rc,1)
        self.assertFalse(r['account_scope_complete'])

    def test_redirection_not_retried(self):
        p='/accounts?per_page=50&page=1'
        e=urllib.error.HTTPError('https://foreign.example',307,'PRIVATE_ERROR',{},None)
        rc,r,reqs=self.run_probe(fault_path=p,fault=e)
        self.assertEqual(rc,1)
        self.assertEqual(len(reqs),1)
        self.assertEqual(r['transport'][0]['http_status'],307)


    def test_account_total_greater_than_returned_refuses_incomplete(self):
        def modify(d):
            d['/accounts?per_page=50&page=1']['result_info']['total_count']=3
        rc,r,_=self.run_probe(modify)
        self.assertEqual(rc,1)
        self.assertFalse(r['account_scope_complete'])
        self.assertIn('INCOMPLETE_ACCOUNT_PAGINATION',r['errors'])

    def test_d1_total_greater_than_returned_does_not_claim_capacity(self):
        p='/accounts/'+OTHER+'/d1/database?per_page=100&page=1'
        def modify(d):
            d[p]['result_info']['total_count']=4
        rc,r,_=self.run_probe(modify)
        self.assertEqual(rc,1)
        self.assertEqual(r['other_accounts_with_under_10_d1'],0)
        self.assertIn('D1_D1_INVENTORY_NOT_EXHAUSTIVE',r['errors'])

    def test_zero_accounts_not_proven_if_total_reports_nonzero(self):
        def modify(d):
            d['/accounts?per_page=50&page=1']['result']=[]
            d['/accounts?per_page=50&page=1']['result_info']={
                'page':1,'per_page':50,'count':0,'total_count':1}
        rc,r,_=self.run_probe(modify)
        self.assertEqual(rc,1)
        self.assertFalse(r['account_scope_complete'])

    def test_current_account_only_is_not_an_alternative(self):
        def modify(d):
            d['/accounts?per_page=50&page=1']['result']=[
                {'id':'93f395f5121954671f92fffa453d6b61'}]
            d['/accounts?per_page=50&page=1']['result_info']['count']=1
            d['/accounts?per_page=50&page=1']['result_info']['total_count']=1
        rc,r,_=self.run_probe(modify)
        self.assertEqual(rc,0)
        self.assertEqual(r['other_accounts_with_under_10_d1'],0)
        self.assertEqual(len(r['accounts']),1)

if __name__=='__main__':
    unittest.main()
