import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from studio_v03_disposable_safety_20261021 import cleanup_exact_disposables, CleanupGuardError

NAME='musitu-studio-v03-pitr-kv-v2-e2e-20261021'
KV='0123456789abcdef0123456789abcdef'
SCRIPT='/workers/scripts/'+NAME
KV_PATH='/storage/kv/namespaces/'+KV

class Provider:
    def __init__(self, *, worker=True, foreign_binding=False, worker_delete_sticks=False,
                 script_get_status=None, domain_hijack=False):
        self.worker=worker
        self.namespace=True
        self.foreign_binding=foreign_binding
        self.worker_delete_sticks=worker_delete_sticks
        self.script_get_status=script_get_status
        self.domain_hijack=domain_hijack
        self.requests=[]
    def __call__(self, method, path, data=None, raw=False):
        self.requests.append((method,path))
        if path=='/workers/domains':
            domains=[{'hostname':'studio-v03.mftintelligence.com','service':'musitu-studio-v03-do'},
                     {'hostname':'studio.mftintelligence.com','service':'musitu-studio-v02'}]
            if self.domain_hijack: domains.append({'hostname':'test.mftintelligence.com','service':NAME})
            return 200,{'success':True,'result':domains}
        if path==SCRIPT:
            if method=='GET':
                return (self.script_get_status,None) if self.script_get_status is not None else (200 if self.worker else 404,None)
            if method=='DELETE':
                if not self.worker_delete_sticks:self.worker=False
                return 200,{'success':True}
        if path==SCRIPT+'/settings':
            x=[{'name':'STUDIO_CRON_PITR','type':'durable_object_namespace'},
               {'name':'STUDIO_PITR_RECEIPTS','type':'kv_namespace','namespace_id':KV}]
            if self.foreign_binding:x.append({'name':'PRODUCTION_DO','type':'durable_object_namespace'})
            return 200,{'success':True,'result':{'bindings':x}}
        if path==KV_PATH:
            if method=='GET':return 200 if self.namespace else 404,None
            if method=='DELETE':self.namespace=False;return 200,{'success':True}
        raise AssertionError((method,path))

class Cleanup(unittest.TestCase):
    def run_safe(self,provider,namespace=KV):
        return cleanup_exact_disposables(provider, NAME, namespace, pause=lambda _:None)
    def test_exact_safely_bound_worker_removed_before_receipt_namespace(self):
        f=Provider()
        r=self.run_safe(f)
        self.assertTrue(r['worker_absent'])
        self.assertTrue(r['namespace_absent'])
        self.assertLess(f.requests.index(('DELETE',SCRIPT)),f.requests.index(('DELETE',KV_PATH)))
    def test_deploy_partially_failed_but_exact_script_exists_is_cleaned(self):
        f=Provider()
        r=self.run_safe(f)
        self.assertTrue(r['worker_absent'])
    def test_abnormal_worker_binding_prevents_any_destructive_cleanup(self):
        f=Provider(foreign_binding=True)
        with self.assertRaises(CleanupGuardError):self.run_safe(f)
        self.assertEqual([x for x in f.requests if x[0]=='DELETE'],[])
        self.assertTrue(f.namespace)
    def test_worker_not_deleted_retains_kv_namespace(self):
        f=Provider(worker_delete_sticks=True)
        r=self.run_safe(f)
        self.assertFalse(r['worker_absent'])
        self.assertTrue(r['namespace_retained_for_safety'])
        self.assertNotIn(('DELETE',KV_PATH),f.requests)
    def test_unexpected_script_status_does_not_delete_anything(self):
        f=Provider(script_get_status=503)
        with self.assertRaises(CleanupGuardError):self.run_safe(f)
        self.assertEqual([x for x in f.requests if x[0]=='DELETE'],[])
    def test_script_absent_but_known_exact_kv_namespace_is_removed(self):
        f=Provider(worker=False)
        r=self.run_safe(f)
        self.assertTrue(r['worker_absent'] and r['namespace_absent'])
        self.assertEqual([x for x in f.requests if x[0]=='DELETE'],[('DELETE',KV_PATH)])
    def test_domain_mapping_hijack_aborts_all_cleanup(self):
        f=Provider(domain_hijack=True)
        with self.assertRaises(CleanupGuardError):self.run_safe(f)
        self.assertEqual([x for x in f.requests if x[0]=='DELETE'],[])
    def test_reject_script_name_not_scoped_to_disposable(self):
        f=Provider()
        with self.assertRaises(CleanupGuardError):cleanup_exact_disposables(f,'musitu-studio-v03-do',KV,pause=lambda _:None)
        self.assertEqual(f.requests,[])
    def test_reject_ambiguous_namespace_id_before_provider_calls(self):
        f=Provider()
        with self.assertRaises(CleanupGuardError):self.run_safe(f,namespace='garbage')
        self.assertEqual(f.requests,[])

if __name__=='__main__':unittest.main()

class DeployDiagnostic(unittest.TestCase):
    def test_fixed_error_category_does_not_echo_secrets(self):
        from studio_v03_disposable_safety_20261021 import categorize_deploy_failure
        input_text='wrangler: invalid durable object migration, Bearer SECRET_PRIVATE_XYZ; token abcdef'
        code=categorize_deploy_failure(input_text)
        self.assertEqual(code,'DURABLE_OBJECT_MIGRATION')
        self.assertNotIn('SECRET',code)
    def test_unfamiliar_failure_is_classified_without_payload(self):
        from studio_v03_disposable_safety_20261021 import categorize_deploy_failure
        self.assertEqual(categorize_deploy_failure('secret=not_safe; unrelated failure'),'UNCLASSIFIED')
    def test_permission_failure_has_fixed_category(self):
        from studio_v03_disposable_safety_20261021 import categorize_deploy_failure
        self.assertEqual(categorize_deploy_failure('API error: 10000 authentication failed'),'AUTH_SCOPE')
