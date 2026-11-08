import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).parent))
from deploy_stage_only import ACCOUNT,ZONE,HOST,WORKER,Stop,deploy,preflight,multipart,APIClient

class Fake:
    def __init__(self):
        self.calls=[]
        self.dns=[];self.routes=[];self.workers=[];self.domains=[]
        self.zone_id=ZONE
        self.error_path=None
        self.fail_upload=False
        self.fail_domain=False
    def get(self,path):
        self.calls.append(('GET',path))
        if path==self.error_path:raise Stop('PROVIDER_HTTP_403')
        if path.startswith('/zones?'):return {'success':True,'result':[{'id':self.zone_id,'name':'mftintelligence.com','status':'active'}]}
        if '/dns_records?' in path:return {'success':True,'result':self.dns}
        if '/workers/routes?' in path:return {'success':True,'result':self.routes}
        if path.endswith('/workers/scripts'):return {'success':True,'result':self.workers}
        if path.endswith('/workers/domains'):return {'success':True,'result':self.domains}
        if path.endswith('/settings'):return {'success':True,'result':{'bindings':[]}}
        raise Stop('UNREVIEWED_PATH')
    def put(self,path,body,typ):
        self.calls.append(('PUT',path))
        if path.endswith('/workers/domains'):
            if self.fail_domain:raise Stop('PROVIDER_HTTP_403')
            return {'success':True,'result':{'hostname':HOST,'service':WORKER,'enabled':True,'zone_id':ZONE}}
        if path.endswith('/workers/scripts/'+WORKER):
            if self.fail_upload:raise Stop('PROVIDER_HTTP_403')
            self.workers.append({'id':WORKER})
            return {'success':True,'result':{'id':WORKER}}
        raise Stop('UNKNOWN_WRITE')

def script():return (Path(__file__).parent/'route_worker.mjs').read_text()

class NegativeGates(unittest.TestCase):
    def assertNoWrite(self,client):self.assertFalse(any(method=='PUT' for method,path in client.calls))
    def test_reject_wrong_zone_without_any_mutation(self):
        x=Fake();x.zone_id='0'*32
        with self.assertRaisesRegex(Stop,'ZONE_MISMATCH'):deploy(x,script())
        self.assertNoWrite(x)
    def test_never_overwrite_existing_dns(self):
        x=Fake();x.dns=[{'name':HOST,'type':'A'}]
        with self.assertRaisesRegex(Stop,'EXISTING_DNS_OCCUPIED'):deploy(x,script())
        self.assertNoWrite(x)
    def test_never_overwrite_existing_worker(self):
        x=Fake();x.workers=[{'id':WORKER}]
        with self.assertRaisesRegex(Stop,'EXISTING_SCRIPT_OCCUPIED'):deploy(x,script())
        self.assertNoWrite(x)
    def test_never_override_custom_domain(self):
        x=Fake();x.domains=[{'hostname':HOST,'service':'other-worker'}]
        with self.assertRaisesRegex(Stop,'EXISTING_CUSTOM_DOMAIN_OCCUPIED'):deploy(x,script())
        self.assertNoWrite(x)
    def test_route_conflict_blocks(self):
        x=Fake();x.routes=[{'pattern':HOST+'/*','script':'another-worker'}]
        with self.assertRaisesRegex(Stop,'EXISTING_ROUTE_OCCUPIED'):deploy(x,script())
        self.assertNoWrite(x)
    def test_missing_provider_permission_stops_before_mutation(self):
        x=Fake();x.error_path='/accounts/'+ACCOUNT+'/workers/domains'
        with self.assertRaisesRegex(Stop,'PROVIDER_HTTP_403'):deploy(x,script())
        self.assertNoWrite(x)
    def test_script_upload_403_stops_without_attempting_custom_domain(self):
        x=Fake();x.fail_upload=True
        with self.assertRaisesRegex(Stop,'PROVIDER_HTTP_403'):deploy(x,script())
        self.assertEqual([path for method,path in x.calls if method=='PUT'],['/accounts/'+ACCOUNT+'/workers/scripts/'+WORKER])
    def test_domain_failure_does_not_retry_or_touch_other_scripts(self):
        x=Fake();x.fail_domain=True
        with self.assertRaisesRegex(Stop,'PROVIDER_HTTP_403'):deploy(x,script())
        self.assertEqual(len([1 for method,path in x.calls if method=='PUT']),2)
        self.assertTrue(all(path.endswith((WORKER,'/workers/domains')) for method,path in x.calls if method=='PUT'))
    def test_pinned_source_and_full_route_success_never_claim_login(self):
        x=Fake();r=deploy(x,script(),readback=lambda:True)
        self.assertEqual(r['status'],'STAGING_ROUTE_READY_LOGIN_DISABLED')
        self.assertFalse(r['customer_identity_qualified']);self.assertFalse(r['production_oauth_touched'])
        self.assertFalse(r['real_login_enabled']);self.assertEqual(r['d1_queries'],0)
        self.assertTrue(r['https_health_pass']);self.assertTrue(r['custom_domain_attached'])
    def test_async_https_propagation_stays_unqualified(self):
        x=Fake();r=deploy(x,script(),readback=lambda:False)
        self.assertEqual(r['status'],'DOMAIN_ATTACHED_HTTPS_NOT_YET_QUALIFIED')
        self.assertFalse(r['https_health_pass']);self.assertFalse(r['customer_identity_qualified'])
    def test_script_tamper_blocks_even_reads(self):
        x=Fake();
        with self.assertRaisesRegex(Stop,'SCRIPT_CONTENT_PIN_MISMATCH'):deploy(x,script()+'\nmalicious')
        self.assertEqual(x.calls,[])

if __name__=='__main__':unittest.main()
