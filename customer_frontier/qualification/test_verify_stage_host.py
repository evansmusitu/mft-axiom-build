import unittest
from verify_stage_host import A,Z,H,S,verify
class LiveReadbackTests(unittest.TestCase):
 def fake(self,status=200,script=True,route=True,bindings=True,dns=True,auth=503):
  def cloud(path):
   if path.endswith('/workers/domains'):return [{'hostname':H,'service':S,'zone_id':Z,'enabled':True}] if route else []
   if path.endswith('/workers/scripts'):return [{'id':S}] if script else []
   if path.endswith('/settings'):return {'bindings':[]} if bindings else {'bindings':[{'name':'CUSTOMER_DB','type':'d1'}]}
   if '/dns_records?' in path:return [{'name':H,'proxied':True}] if dns else []
   raise Exception('unexpected')
  def http(path):
   if path=='/_health':return status,None,b'{"ok":true,"stage":"host_route_only","identity_live_qualified":false,"release_qualified":false}'
   return auth,None,b'{"error":"identity_service_not_qualified"}'
  return verify(cloud,http)
 def test_verified_but_never_identity_authority(self):
  r=self.fake();self.assertEqual(r['status'],'EXACT_STAGING_HTTPS_FAIL_CLOSED_PASS');self.assertFalse(r['customer_identity_qualified'])
 def test_refuse_missing_worker(self):self.assertEqual(self.fake(script=False)['status'],'METADATA_MISMATCH')
 def test_refuse_custom_domain_missing(self):self.assertEqual(self.fake(route=False)['status'],'METADATA_MISMATCH')
 def test_refuse_customer_d1_binding(self):self.assertEqual(self.fake(bindings=False)['status'],'METADATA_MISMATCH')
 def test_refuse_health_not_200(self):
  # avoid real 8-second wait in tests
  import verify_stage_host
  old=verify_stage_host.time.sleep;verify_stage_host.time.sleep=lambda _:None
  try:self.assertEqual(self.fake(status=403)['status'],'HTTP_PENDING_OR_FILTERED')
  finally:verify_stage_host.time.sleep=old
 def test_refuse_real_auth_redirect(self):self.assertEqual(self.fake(auth=302)['status'],'HTTP_IDENTITY_GATE_UNQUALIFIED')
 def test_refuse_missing_dns(self):self.assertEqual(self.fake(dns=False)['status'],'HTTP_IDENTITY_GATE_UNQUALIFIED')
if __name__=='__main__':unittest.main()
