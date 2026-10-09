"""Read-only account billing audit test with synthetic Cloudflare response fixtures."""
import json
import unittest
from cloudflare_free_readonly import CloudflareBillingEvidenceError, inspect_cloudflare_billing_readonly

ACCOUNT='93f395f5121954671f92fffa453d6b61'

class FakeResponse:
    def __init__(self, body, status=200):
        self.payload = json.dumps(body).encode()
        self.status=status
    def __enter__(self):return self
    def __exit__(self,*args): return False
    def read(self,n):return self.payload[:n]

class CloudflareBillingEvidenceTests(unittest.TestCase):
    def setUp(self):self.paths=[]
    def adapter(self,req,timeout):
        self.paths.append((req.full_url,req.get_method(),dict(req.header_items())))
        url=req.full_url
        if url.endswith('/zones?name=mftintelligence.com&status=active'):
            return FakeResponse({'success':True,'result':[{'name':'mftintelligence.com','status':'active','account':{'id':ACCOUNT}}]})
        if url.endswith('/accounts/'+ACCOUNT):
            return FakeResponse({'success':True,'result':{'id':ACCOUNT}})
        if url.endswith('/accounts/'+ACCOUNT+'/subscriptions'):
            return FakeResponse({'success':True,'result':[{'price':0,'rate_plan':{'id':'free'},'state':'Provisioned'}]})
        if url.endswith('/accounts/'+ACCOUNT+'/workers/account-settings'):
            return FakeResponse({'success':True,'result':{'default_usage_model':'bundled','green_compute':False}})
        raise AssertionError('unexpected GET route')
    def call(self,**kwargs):
        d=dict(email='cloudflare@example.com',api_key='cfk_SYNTHETIC_NOT_REAL',expected_account=ACCOUNT,api_get=self.adapter)
        d.update(kwargs)
        return inspect_cloudflare_billing_readonly(**d)
    def test_reuse_established_key_and_four_fixed_read_only_paths(self):
        data=self.call()
        self.assertEqual(len(self.paths),4)
        for url,method,headers in self.paths:
            self.assertEqual(method,'GET')
            self.assertEqual(headers['X-auth-email'],'cloudflare@example.com')
            self.assertEqual(headers['X-auth-key'],'cfk_SYNTHETIC_NOT_REAL')
            self.assertNotIn('Authorization',headers)
            self.assertTrue(url.startswith('https://api.cloudflare.com/client/v4/'))
        self.assertEqual(data['subscriptions_returned'],1)
        self.assertEqual(data['workers_usage_model_observed'],'bundled')
        self.assertTrue(data['billing_read_only_endpoint_success'])
        self.assertFalse(data['workers_ai_free_plan_qualified'])
        self.assertFalse(data['billing_overage_hard_stop_verified'])
        self.assertFalse(data['write_performed'])
        self.assertNotIn(ACCOUNT,str(data))
        self.assertNotIn('cfk_',str(data))
    def test_observed_paid_subscriptions_never_certify_free(self):
        normal=self.adapter
        def fake(req,timeout):
            if req.full_url.endswith('/subscriptions'):
                return FakeResponse({'success':True,'result':[{'price':1.0,'rate_plan':{'id':'pro'},'state':'Paid'}]})
            return normal(req,timeout)
        record=self.call(api_get=fake)
        self.assertTrue(record['paid_subscription_observed'])
        self.assertFalse(record['workers_ai_free_plan_qualified'])
        self.assertFalse(record['billing_overage_hard_stop_verified'])
    def test_empty_subscriptions_is_not_free_proof(self):
        normal=self.adapter
        def fake(req,timeout):
            if req.full_url.endswith('/subscriptions'):return FakeResponse({'success':True,'result':[]})
            return normal(req,timeout)
        record=self.call(api_get=fake)
        self.assertEqual(record['subscriptions_returned'],0)
        self.assertFalse(record['workers_ai_free_plan_qualified'])
    def test_unreadable_billing_is_fail_closed_not_fake_pass(self):
        normal=self.adapter
        def fake(req,timeout):
            if req.full_url.endswith('/subscriptions'):raise RuntimeError('403 cfk_SYNTHETIC_NOT_REAL')
            return normal(req,timeout)
        with self.assertRaises(CloudflareBillingEvidenceError) as got:self.call(api_get=fake)
        self.assertNotIn('cfk_',str(got.exception))
    def test_missing_settings_fails_closed(self):
        normal=self.adapter
        def fake(req,timeout):
            if req.full_url.endswith('/workers/account-settings'):return FakeResponse({'success':True,'result':None})
            return normal(req,timeout)
        with self.assertRaises(CloudflareBillingEvidenceError):self.call(api_get=fake)
    def test_subscription_data_shape_and_negative_price_fail(self):
        normal=self.adapter
        for result in (None,{'id':'not-a-list'},[{'price':-1}],[{'price':'UNKNOWN'}]):
            def fake(req,timeout):
                if req.full_url.endswith('/subscriptions'):return FakeResponse({'success':True,'result':result})
                return normal(req,timeout)
            with self.subTest(result=result),self.assertRaises(CloudflareBillingEvidenceError):self.call(api_get=fake)
    def test_partial_subscription_page_fails_closed(self):
        normal=self.adapter
        def fake(req,timeout):
            if req.full_url.endswith('/subscriptions'):
                return FakeResponse({'success':True,'result':[], 'result_info':{'total_count':50,'count':0}})
            return normal(req,timeout)
        with self.assertRaises(CloudflareBillingEvidenceError):self.call(api_get=fake)
    def test_wrong_account_never_reaches_billing(self):
        with self.assertRaises(CloudflareBillingEvidenceError):self.call(expected_account='a'*32)
        self.assertTrue(all('/subscriptions' not in p[0] for p in self.paths))
    def test_malicious_global_key_rejected_before_any_request(self):
        with self.assertRaises(CloudflareBillingEvidenceError):self.call(api_key='Bearer bad')
        self.assertEqual(self.paths,[])

if __name__=='__main__':unittest.main()
