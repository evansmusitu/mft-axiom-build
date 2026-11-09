"""Credential-free guard tests for exact isolated D1 historical target-only Time Travel."""
import os, unittest
from unittest.mock import patch
import axiom_isolated_historical_rollback_20261109 as r

class RestoreGuardTests(unittest.TestCase):
    def test_exact_disposable_target_and_historic_witness(self):
        self.assertEqual(r.TARGET,'c023a0a0-472a-4178-ad07-02f1d6b2e122')
        self.assertEqual(r.ACCOUNT,'c954f0c842a486d0388c05b19cd21e47')
        self.assertEqual(r.EMPTY_WITNESSED_AT,'2026-11-09T09:40:18Z')
        self.assertEqual(r.EMPTY_WITNESS_RUN,42595180224)

    def test_other_method_and_target_denied_before_http(self):
        with self.assertRaisesRegex(r.Halt,'OTHER_RESOURCE_OR_METHOD_FORBIDDEN'):
            r.request('DELETE','/d1/database/'+r.TARGET,'fake-token')
        with self.assertRaisesRegex(r.Halt,'OTHER_RESOURCE_OR_METHOD_FORBIDDEN'):
            r.request('POST','/d1/database/504029cc-f9a5-495e-818f-63c6144b4ea4/time_travel/restore?bookmark='+'a'*36,'fake-token',b'')

    def test_sql_delete_never_accepted(self):
        with self.assertRaisesRegex(r.Halt,'UNREVIEWED_SQL_DENIED'):
            r.request('POST','/d1/database/'+r.TARGET+'/query','fake-token',{'sql':'DELETE FROM users','params':[]})

    def test_restore_requires_empty_body(self):
        with self.assertRaisesRegex(r.Halt,'RESTORE_BODY_DENIED'):
            r.request('POST','/d1/database/'+r.TARGET+'/time_travel/restore?bookmark='+'a'*36,'fake-token',None)

    def test_historical_timestamp_must_be_exact_witness(self):
        with self.assertRaisesRegex(r.Halt,'HISTORICAL_TIMESTAMP_NOT_PINNED'):
            r.request('GET','/d1/database/'+r.TARGET+'/time_travel/bookmark?timestamp=2026-11-09T01:00:00Z','fake-token')

    def test_bookmark_input_rejects_escaping_and_url(self):
        for val in ('../x','a'*120,'https://evil.com', 'abc--def'+'0'*25):
            with self.subTest(val=val), self.assertRaises(r.Halt):
                r.valid_bookmark(val)
        self.assertEqual(r.valid_bookmark('a'*36),'a'*36)

    def test_empty_target_counts_only_managed_system_tables(self):
        system=[
          {'type':'table','name':'_cf_KV','tbl_name':'_cf_KV','sql':'CREATE TABLE _cf_KV(...)'},
          {'type':'table','name':'_cf_METADATA','tbl_name':'_cf_METADATA','sql':'CREATE TABLE _cf_METADATA(...)'}
        ]
        with patch.object(r,'read_query',return_value=system) as q:
            result=r.catalog_status('synthetic',False)
        self.assertTrue(result['app_empty'])
        self.assertEqual(result['app_schema_object_count'],0)
        self.assertEqual(result['internal_objects'],2)
        q.assert_called_once()

    def test_known_worker_binding_fails_closed(self):
        def fake(method,path,token,body=None):
            if path=='/workers/scripts':return [{'id':'service1'}]
            return {'bindings':[{'id':r.TARGET,'type':'d1'}]}
        with patch.object(r,'request',side_effect=fake):
            with self.assertRaisesRegex(r.Halt,'ACTIVE_WORKER_BINDING'):
                r.check_unbound('synthetic')

    def test_missing_secrets_never_restore(self):
        with patch.dict(os.environ,{'CLOUDFLARE_AXIOM_DR_READ_TOKEN':'','MUSITU_CLOUDFLARE_ADMIN_TOKEN':''}):
            with patch.object(r,'request') as req:
                code=r.run()
        self.assertEqual(code,2)
        req.assert_not_called()

if __name__=='__main__':
    unittest.main()
