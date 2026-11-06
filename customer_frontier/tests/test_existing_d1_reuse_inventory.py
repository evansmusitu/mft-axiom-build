"""Synthetic metadata transport; no socket, data access or provider mutations."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

SOURCE = Path(__file__).resolve().parents[1] / 'qualification/existing_d1_reuse_inventory.py'


class ExistingInventory(unittest.TestCase):
    def run_subject(self, mutate=lambda data: None, exception=None, token='SYNTHETIC-ONLY'):
        spec = importlib.util.spec_from_file_location('existing_inventory', SOURCE)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        spare = '77777777-7777-4777-8777-777777777777'
        rows = [{'uuid': key, 'name': name} for key,name in module.PROTECTED.items()]
        rows.append({'uuid': spare, 'name': 'axiom-disposable-test'})
        data = {module.LIST: {'success': True, 'result': rows, 'result_info': {'page': 1, 'per_page': 100, 'count': 4, 'total_count': 4}}}
        for row in rows:
            data[module.BASE+row['uuid']] = {'success': True, 'result': {**row, 'num_tables': 0, 'file_size': 16384, 'version': 'production', 'private_detail': 'PRIVATE-DETAIL'}}
        mutate(data); calls, files = [], {}

        class Response:
            status = 200
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self,*args): return False
            def read(self,size): return json.dumps(self.payload).encode()[:size]
        class Opener:
            def open(self,req,timeout):
                calls.append(req)
                if exception and len(calls)==2: raise exception
                return Response(data[req.full_url[len(module.API):]])
        class Sink:
            def __init__(self,name): self.name=name
            def __str__(self): return self.name
            def write_bytes(self,raw): files[self.name]=raw
            def write_text(self,raw): files[self.name]=raw

        output=io.StringIO()
        with patch.object(module.urllib.request,'build_opener',return_value=Opener()), \
             patch.object(module,'Path',Sink),patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':token}),contextlib.redirect_stdout(output):
            rc=module.observe()
        self.assertNotIn('SYNTHETIC-ONLY',output.getvalue());self.assertNotIn('PRIVATE-DETAIL',output.getvalue())
        for req in calls:
            self.assertEqual(req.get_method(),'GET');self.assertIsNone(req.data)
            self.assertTrue(req.full_url.startswith(module.API+'/d1/database'))
        result=json.loads(files['existing-d1-reuse-inventory.json'])
        self.assertFalse(result['target_admitted']);self.assertFalse(result['binding_inventory_complete'])
        self.assertFalse(result['release_authority']);self.assertEqual(result['mutations'],0)
        return rc,result,calls

    def assert_incomplete(self,mutate=lambda data:None,**kwargs):
        rc,result,calls=self.run_subject(mutate,**kwargs)
        self.assertEqual(rc,1);self.assertEqual(result['status'],'INCOMPLETE')
        self.assertEqual(result['databases'],[]);self.assertFalse(result['inventory_complete'])
        return result,calls

    def test_complete_inventory_projects_only_safe_metadata_and_does_not_admit(self):
        rc,result,calls=self.run_subject();self.assertEqual(rc,0);self.assertEqual(len(calls),5)
        self.assertEqual(result['followup_candidate_ids'],['77777777-7777-4777-8777-777777777777'])

    def test_missing_pagination_never_claims_complete(self):
        self.assert_incomplete(lambda d:d['/d1/database?per_page=100&page=1'].pop('result_info'))

    def test_boolean_pagination_is_not_an_integer(self):
        self.assert_incomplete(lambda d:d['/d1/database?per_page=100&page=1']['result_info'].update(page=True))

    def test_duplicate_database_identity_rejected(self):
        def change(d): d['/d1/database?per_page=100&page=1']['result'][1]=copy.deepcopy(d['/d1/database?per_page=100&page=1']['result'][0])
        _,calls=self.assert_incomplete(change);self.assertEqual(len(calls),1)

    def test_metadata_identity_mismatch_rejected_without_partial_candidates(self):
        self.assert_incomplete(lambda d:d['/d1/database/77777777-7777-4777-8777-777777777777']['result'].update(name='other'))

    def test_unknown_or_boolean_table_count_rejected(self):
        for val in [None,False,'0']:
            with self.subTest(value=val):self.assert_incomplete(lambda d:d['/d1/database/77777777-7777-4777-8777-777777777777']['result'].update(num_tables=val))

    def test_large_or_nonempty_database_is_not_an_empty_candidate(self):
        for values in [{'num_tables':1},{'file_size':65537},{'version':'alpha'}]:
            with self.subTest(values=values):
                rc,result,_=self.run_subject(lambda d:d['/d1/database/77777777-7777-4777-8777-777777777777']['result'].update(values))
                self.assertEqual(rc,0);self.assertEqual(result['followup_candidate_ids'],[])

    def test_prod_named_database_is_protected_even_if_metadata_empty(self):
        def change(d):
            d['/d1/database?per_page=100&page=1']['result'][-1]['name']='other-prod-db'
            d['/d1/database/77777777-7777-4777-8777-777777777777']['result']['name']='other-prod-db'
        _,result,_=self.run_subject(change);self.assertEqual(result['followup_candidate_ids'],[])

    def test_unrecognized_resource_label_is_not_published(self):
        def change(d):
            d['/d1/database?per_page=100&page=1']['result'][-1]['name']='PRIVATE_CUSTOMER_ALIAS'
            d['/d1/database/77777777-7777-4777-8777-777777777777']['result']['name']='PRIVATE_CUSTOMER_ALIAS'
        _,result,_=self.run_subject(change)
        self.assertNotIn('PRIVATE_CUSTOMER_ALIAS',json.dumps(result))
        self.assertIsNone(result['databases'][-1]['name']);self.assertEqual(len(result['databases'][-1]['name_sha256']),64)

    def test_redirect_stops_without_raw_body_or_credentials(self):
        err=urllib.error.HTTPError('https://foreign.example',302,'PRIVATE-DETAIL',{},None)
        result,calls=self.assert_incomplete(exception=err)
        self.assertEqual(result['transport'][-1]['http_status'],302);self.assertEqual(len(calls),2)

    def test_missing_token_makes_no_request(self):
        _,calls=self.assert_incomplete(token='');self.assertEqual(calls,[])


if __name__=='__main__':unittest.main()
