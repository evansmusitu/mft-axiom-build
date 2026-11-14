import importlib.util
import json
import pathlib
import unittest

P = pathlib.Path(__file__).resolve().parents[1] / 'qualification' / 'mcn072_all_worker_settings_readonly.py'
spec = importlib.util.spec_from_file_location('worker_probe', P)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

class ProbeContracts(unittest.TestCase):
    def test_redacts_all_binding_contents_and_names(self):
        data={'bindings':[
            {'name':'SECRET_PG_DSN','type':'secret_text','text':'postgresql://user:password@host/db','secret':'PRIVATE'},
            {'name':'PUBLIC_VAR','type':'plain_text','text':'sensitive plain text'},
            {'name':'DB_HYPER','type':'hyperdrive','id':'private-hyperdrive-id'},
            {'name':'SERVICE','type':'service','service':'hidden-worker'}]}
        result=probe.summarize_settings('worker-name',data)
        raw=json.dumps(result)
        for secret in ('SECRET_PG_DSN','PUBLIC_VAR','DB_HYPER','SERVICE','postgresql://','private-hyperdrive-id','worker-name','hidden-worker','PRIVATE','sensitive plain text'):
            self.assertNotIn(secret,raw)
        self.assertEqual(result['types'],{'secret_text':1,'plain_text':1,'hyperdrive':1,'service':1})
        self.assertEqual(result['database_binding_name_cue_count'],2)
        self.assertTrue(result['potential_database_binding'])

    def test_non_data_binding_not_promoted_to_postgres(self):
        x=probe.summarize_settings('abc',{'bindings':[{'name':'FOO','type':'secret_text'}]})
        self.assertFalse(x['potential_database_binding'])
        self.assertFalse(x['postgres_authenticated'])

    def test_scanner_sanitizes_invalid_provider_result(self):
        def fake(path):
            if path.endswith('/workers/scripts'):return {'result':[{'id':'worker-one'}]}
            return {'result':{'bindings':'INVALID'}}
        r=probe.audit_account(fake,'a'*32)
        self.assertFalse(r['inventory_complete'])
        self.assertEqual(r['settings_read_failures'],1)
        self.assertNotIn('worker-one',json.dumps(r))

    def test_scanner_allows_only_get_metadata_and_sanitizes_scripts(self):
        calls=[]
        def fake(path):
            calls.append(path)
            if path.endswith('/workers/scripts'):
                return {'result':[{'id':'worker-one'},{'id':'worker-two'}]}
            if path.endswith('/worker-one/settings'):
                return {'result':{'bindings':[{'name':'PGHOST','type':'plain_text','text':'sensitivehost'}]}}
            if path.endswith('/worker-two/settings'):
                return {'result':{'bindings':[{'name':'FOO','type':'plain_text','text':'secret-value'}]}}
            raise AssertionError('unknown request')
        r=probe.audit_account(fake,'a'*32)
        self.assertTrue(r['inventory_complete'])
        self.assertEqual(r['worker_scripts_listed'],2)
        self.assertEqual(r['worker_settings_read'],2)
        self.assertEqual(r['potential_pg_binding_scripts'],1)
        self.assertFalse(r['postgres_authenticated'])
        self.assertNotIn('worker-one',json.dumps(r))
        self.assertNotIn('worker-two',json.dumps(r))
        self.assertNotIn('sensitivehost',json.dumps(r))
        self.assertEqual(len(calls),3)
        self.assertTrue(all(path.startswith('/accounts/'+'a'*32+'/workers/scripts') for path in calls))

    def test_deduplication_and_failure_close(self):
        def fake(path):
            if path.endswith('/workers/scripts'):
                return {'result':[{'id':'worker-one'},{'id':'worker-one'}]}
            raise AssertionError('should never query settings for duplicate listing')
        r=probe.audit_account(fake,'b'*32)
        self.assertFalse(r['inventory_complete'])
        self.assertTrue(r['duplicate_worker_name_observed'])
        self.assertFalse(r['postgres_authenticated'])

if __name__=='__main__':unittest.main()
