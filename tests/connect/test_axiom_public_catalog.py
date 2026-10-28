import json
import unittest
from qualification.diagnose_axiom_public_catalog import assess,probe,BODY,HIDDEN

def synthetic():
    rows=[]
    for i in range(108):
        meta={}
        if i<74:meta['musitu/operation']='op'+str(i)
        if i<30:meta['musitu/business_product']=True
        rows.append({'name':'tool'+str(i),'_meta':meta,'outputSchema':{'type':'object'}})
    return {'result':{'tools':rows}}

class PublicCatalogTests(unittest.TestCase):
    def test_public_counts_never_qualify_release(self):
        r=assess(200,synthetic())
        self.assertTrue(r['catalog_metadata_observed'])
        self.assertEqual(r['counts'],{'tools':108,'operations':74,'business':30,'output_schemas':108})
        self.assertFalse(r['openai_submission_approved'])
    def test_hidden_commerce_fails_closed(self):
        d=synthetic()
        d['result']['tools'][0]['name']=next(iter(HIDDEN))
        self.assertIn('PRIVATE_COMMERCE_EXPOSED',assess(200,d)['failed_checks'])
    def test_missing_schema_and_duplicate_names_refused(self):
        d=synthetic();del d['result']['tools'][0]['outputSchema']
        self.assertIn('OUTPUT_SCHEMAS_DRIFT',assess(200,d)['failed_checks'])
        d=synthetic();d['result']['tools'][0]['name']=d['result']['tools'][1]['name']
        self.assertIn('DUPLICATE_NAMES',assess(200,d)['failed_checks'])
    def test_only_anonymous_tools_list_rpc_sent(self):
        requests=[]
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*_):return False
            def read(self,n):return json.dumps(synthetic()).encode()[:n]
        def transport(req,timeout):requests.append(req);return Response()
        self.assertTrue(probe(transport)['catalog_metadata_observed'])
        self.assertEqual(len(requests),1)
        self.assertEqual(requests[0].get_method(),'POST')
        self.assertEqual(requests[0].data,BODY)
        self.assertNotIn('Authorization',requests[0].headers)
        self.assertNotIn(b'tools/call',requests[0].data)

if __name__=='__main__':unittest.main()
