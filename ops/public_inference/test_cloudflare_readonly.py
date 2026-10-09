import json
import unittest
from cloudflare_readonly import CloudflareAuditError, audit_cloudflare_readonly

ACCOUNT='93f395f5121954671f92fffa453d6b61'

class FakeResponse:
    def __init__(self,data,status=200):
        self.data=json.dumps(data).encode()
        self.status=status
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def read(self,limit=None):return self.data[:limit]

class Audits(unittest.TestCase):
    def setUp(self):self.paths=[]
    def fetcher(self,req,timeout):
        self.paths.append((req.full_url,req.get_method(),dict(req.header_items())))
        if req.full_url.endswith('/zones?name=mftintelligence.com&status=active'):
            return FakeResponse({'success':True,'result':[{'name':'mftintelligence.com','status':'active','account':{'id':ACCOUNT}}]})
        if req.full_url.endswith('/accounts/'+ACCOUNT):
            return FakeResponse({'success':True,'result':{'id':ACCOUNT,'name':'Private AXIOM account'}})
        raise AssertionError('out-of-scope path')
    def audit(self,**kwargs):
        args=dict(email='cloudflare@example.com',api_key='cfk_TEST_NOT_REAL',expected_account=ACCOUNT,
                  api_get=self.fetcher)
        args.update(kwargs)
        return audit_cloudflare_readonly(**args)
    def test_read_only_auth_mode_matches_established_record(self):
        receipt=self.audit()
        self.assertEqual(len(self.paths),2)
        for url,method,headers in self.paths:
            self.assertEqual(method,'GET')
            self.assertEqual(headers['X-auth-email'],'cloudflare@example.com')
            self.assertEqual(headers['X-auth-key'],'cfk_TEST_NOT_REAL')
            self.assertNotIn('Authorization',headers)
            self.assertTrue(url.startswith('https://api.cloudflare.com/client/v4/'))
        self.assertEqual(receipt['zone_name'],'mftintelligence.com')
        self.assertTrue(receipt['cloudflare_account_read_only_verified'])
        self.assertFalse(receipt['free_plan_eligibility_verified'])
        self.assertFalse(receipt['write_performed'])
        self.assertNotIn('cfk_',repr(receipt))
    def test_missing_credential_or_unsafe_email_denied_before_network(self):
        for change in ({'api_key':''},{'api_key':'Bearer something'},
                       {'api_key':'malicious\nheader'},{'email':'bad\r\nInjected: yes'},
                       {'expected_account':'../oops'}):
            with self.subTest(change=change),self.assertRaises(CloudflareAuditError):
                self.audit(**change)
        self.assertEqual(self.paths,[])
    def test_account_mismatch_rejected_no_plan_claim(self):
        with self.assertRaises(CloudflareAuditError):
            self.audit(expected_account='a'*32)
    def test_zone_missing_or_inactive_denied(self):
        def bad(req,timeout): return FakeResponse({'success':True,'result':[]})
        with self.assertRaises(CloudflareAuditError): self.audit(api_get=bad)
    def test_transport_failure_redacted(self):
        def bad(req,timeout):raise RuntimeError('cfk_SECRET_CREDENTIAL')
        with self.assertRaises(CloudflareAuditError) as caught: self.audit(api_get=bad)
        self.assertNotIn('SECRET_CREDENTIAL',str(caught.exception))
    def test_non_http_200_rejected(self):
        def bad(req,timeout):return FakeResponse({'success':True,'result':[]},status=202)
        with self.assertRaises(CloudflareAuditError): self.audit(api_get=bad)
    def test_cf_api_success_false_fails_closed(self):
        def bad(req,timeout):return FakeResponse({'success':False,'errors':[{'message':'failure'}]})
        with self.assertRaises(CloudflareAuditError): self.audit(api_get=bad)

if __name__=='__main__':unittest.main()
