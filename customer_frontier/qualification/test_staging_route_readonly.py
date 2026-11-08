import unittest
from staging_route_readonly import inspect, Refuse, ALLOWED_HOST

class RouteProbeTests(unittest.TestCase):
    def run_case(self, replies):
        requests=[]
        def fetch(path):
            requests.append(path)
            value = replies.get(path)
            if isinstance(value,Exception): raise value
            if value is None: raise Refuse('UNEXPECTED_ROUTE')
            return value
        return inspect(fetch),requests

    def test_missing_dns_record_never_proves_route(self):
        routes={
          '/zones?name=mftintelligence.com&per_page=50&page=1':{'result':[{'id':'a'*32,'name':'mftintelligence.com','status':'active'}]},
          '/zones/'+('a'*32)+'/dns_records?name=axiom-customer-staging.mftintelligence.com&per_page=100&page=1':{'result':[]},
          '/zones/'+('a'*32)+'/workers/routes?per_page=100&page=1':{'result':[]},
          '/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts':{'result':[]}}
        outcome,requests=self.run_case(routes)
        self.assertEqual(outcome['status'],'NO_MATCHING_STAGE_DNS_OR_ROUTE')
        self.assertFalse(outcome['identity_live_qualified'])
        self.assertEqual(len(requests),4)

    def test_script_exists_but_unbound_does_not_claim_deployed(self):
        zone='a'*32
        replies={
          '/zones?name=mftintelligence.com&per_page=50&page=1':{'result':[{'id':zone,'name':'mftintelligence.com','status':'active'}]},
          '/zones/'+zone+'/dns_records?name=axiom-customer-staging.mftintelligence.com&per_page=100&page=1':{'result':[{'name':'axiom-customer-staging.mftintelligence.com','type':'A','proxied':True}]},
          '/zones/'+zone+'/workers/routes?per_page=100&page=1':{'result':[]},
          '/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts':{'result':[{'id':'musitu-axiom-customer-staging'}]},
        }
        o,_=self.run_case(replies)
        self.assertEqual(o['status'],'STAGE_DNS_PRESENT_WORKER_ROUTE_MISSING')
        self.assertFalse(o['identity_live_qualified'])

    def test_exact_route_requires_service_binding_and_safe_worker(self):
        z='a'*32;s='musitu-axiom-customer-staging'
        replies={
          '/zones?name=mftintelligence.com&per_page=50&page=1':{'result':[{'id':z,'name':'mftintelligence.com','status':'active'}]},
          '/zones/'+z+'/dns_records?name=axiom-customer-staging.mftintelligence.com&per_page=100&page=1':{'result':[{'name':'axiom-customer-staging.mftintelligence.com','type':'A','proxied':True}]},
          '/zones/'+z+'/workers/routes?per_page=100&page=1':{'result':[{'pattern':'axiom-customer-staging.mftintelligence.com/*','script':s}]},
          '/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts':{'result':[{'id':s}]},
          '/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts/'+s+'/settings':{'result':{'bindings':[]}},
        }
        o,_=self.run_case(replies)
        self.assertEqual(o['status'],'WORKER_BINDING_NOT_QUALIFIED')
        self.assertFalse(o['identity_live_qualified'])

    def test_never_qualifies_bare_dns_or_readonly_metadata(self):
        z='a'*32;s='musitu-axiom-customer-staging'
        replies={
          '/zones?name=mftintelligence.com&per_page=50&page=1':{'result':[{'id':z,'name':'mftintelligence.com','status':'active'}]},
          '/zones/'+z+'/dns_records?name=axiom-customer-staging.mftintelligence.com&per_page=100&page=1':{'result':[{'name':'axiom-customer-staging.mftintelligence.com','type':'A','proxied':True}]},
          '/zones/'+z+'/workers/routes?per_page=100&page=1':{'result':[{'pattern':'axiom-customer-staging.mftintelligence.com/*','script':s}]},
          '/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts':{'result':[{'id':s}]},
          '/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts/'+s+'/settings':{'result':{'bindings':[{'name':'CUSTOMER_IDP_BROWSER','type':'service'}]}},
        }
        o,_=self.run_case(replies)
        self.assertEqual(o['status'],'METADATA_PRESENT_NOT_HTTP_OR_SESSION_QUALIFIED')
        self.assertFalse(o['identity_live_qualified'])

    def test_redirect_or_provider_failure_always_unknown(self):
        o,r=self.run_case({'/zones?name=mftintelligence.com&per_page=50&page=1':Refuse('REDIRECT_DENIED')})
        self.assertEqual(o['status'],'UNKNOWN_PROVIDER_READ')
        self.assertEqual(len(r),2)

    def test_no_production_cross_account_access(self):
        o,r=self.run_case({'/zones?name=mftintelligence.com&per_page=50&page=1':Refuse('PERMISSION_DENIED'),'/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts':{'result':[]}})
        self.assertTrue(all(x.startswith(('/zones?','/accounts/93f395f5121954671f92fffa453d6b61/')) for x in r))
        self.assertFalse(any('/d1/' in x for x in r))
        self.assertFalse(o['identity_live_qualified'])

if __name__=='__main__': unittest.main()
