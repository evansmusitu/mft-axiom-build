"""All synthetic; intercept networking, storage, and stdout."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1]/'qualification/observe_cloudflare_accounts_readonly.py'
PRODUCTION='93f395f5121954671f92fffa453d6b61'
OTHER='a'*32

class CloudflareAccountInventory(unittest.TestCase):
    def run_subject(self,mutate=lambda x:None, token='SYNTHETIC_TOKEN',error=None):
        spec=importlib.util.spec_from_file_location('test_subject_accounts',SOURCE)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        data={'success':True,'result':[{'id':PRODUCTION,'name':'PRIVATE_PRODUCT_ACCOUNT'}],
              'result_info':{'page':1,'per_page':20,'count':1,'total_count':1}}
        mutate(data)
        requests=[]
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,n):return json.dumps(data).encode()[:n]
        class Opener:
            def open(self,req,timeout):
                requests.append(req)
                if error is not None:raise error
                return Response()
        output=io.StringIO()
        with tempfile.TemporaryDirectory() as d:
            old=os.getcwd()
            try:
                os.chdir(d)
                with patch.object(module.urllib.request,'build_opener',return_value=Opener()),patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':token}),contextlib.redirect_stdout(output):
                    status=module.observe()
                result=json.loads(Path('cloudflare-visible-account-metadata-only.json').read_text())
                self.assertTrue(Path('cloudflare-visible-account-metadata-only.json.sha256').exists())
            finally:os.chdir(old)
        printed=output.getvalue()
        for secret in ('SYNTHETIC_TOKEN','PRIVATE_PRODUCT_ACCOUNT','PRIVATE_OTHER_ACCOUNT'):
            self.assertNotIn(secret,printed)
        self.assertLessEqual(len(requests),1)
        for req in requests:
            self.assertEqual(req.get_method(),'GET')
            self.assertEqual(req.full_url,module.API+module.PATH)
            self.assertIsNone(req.data)
        for key in ('capacity_verified','free_tier_verified','security_operator_separation_verified','safe_restore_target_identified','restore_target_admitted','migration_authorized','release_authorized'):
            self.assertIs(result[key],False,key)
        self.assertEqual(result['d1_queries'],0)
        self.assertEqual(result['resource_mutations'],0)
        return status,result,requests

    def test_one_account_observed_not_admitted(self):
        rc,d,r=self.run_subject()
        self.assertEqual(rc,0);self.assertEqual(d['accounts_visible'],1)
        self.assertEqual(d['other_account_id_sha256'],[])

    def test_two_accounts_only_hashes_returned(self):
        def change(d):
            d['result'].append({'id':OTHER,'name':'PRIVATE_OTHER_ACCOUNT'})
            d['result_info'].update(count=2,total_count=2)
        rc,d,r=self.run_subject(change)
        self.assertEqual(rc,0);self.assertEqual(d['accounts_visible'],2)
        self.assertEqual(len(d['other_account_id_sha256']),1)

    def test_missing_token_performs_no_network(self):
        rc,d,r=self.run_subject(token='')
        self.assertEqual(rc,1);self.assertEqual(r,[])
        self.assertEqual(d['error'],'MISSING_OPERATOR_TOKEN')

    def test_403_keeps_account_visibility_unknown(self):
        e=urllib.error.HTTPError('https://cloudflare.invalid',403,'PRIVATE_OTHER_ACCOUNT',{},None)
        rc,d,r=self.run_subject(error=e)
        self.assertEqual(rc,1);self.assertIsNone(d['accounts_visible'])
        self.assertEqual(d['http_status'],403)

    def test_absent_production_account_denied(self):
        rc,d,r=self.run_subject(lambda x:x['result'][0].update(id=OTHER))
        self.assertEqual(rc,1);self.assertFalse(d['production_account_present'])

    def test_duplicate_ids_denied(self):
        def change(d):
            d['result'].append({'id':PRODUCTION,'name':'PRIVATE_OTHER_ACCOUNT'})
            d['result_info'].update(count=2,total_count=2)
        rc,d,r=self.run_subject(change)
        self.assertEqual(rc,1)

    def test_wrong_total_count_denied(self):
        rc,d,r=self.run_subject(lambda x:x['result_info'].update(total_count=2))
        self.assertEqual(rc,1)

    def test_duplicate_pagination_bool_rejected(self):
        rc,d,r=self.run_subject(lambda x:x['result_info'].update(page=True))
        self.assertEqual(rc,1)

    def test_incomplete_result_info_denied(self):
        rc,d,r=self.run_subject(lambda x:x.pop('result_info'))
        self.assertEqual(rc,1)

    def test_missing_success_denied(self):
        rc,d,r=self.run_subject(lambda x:x.update(success=False))
        self.assertEqual(rc,1)

    def test_account_id_invalid_denied(self):
        rc,d,r=self.run_subject(lambda x:x['result'][0].update(id='WRONG'))
        self.assertEqual(rc,1)

    def test_empty_inventory_denied(self):
        def change(d):d['result']=[];d['result_info'].update(count=0,total_count=0)
        rc,d,r=self.run_subject(change)
        self.assertEqual(rc,1)

if __name__=='__main__':
    unittest.main()
