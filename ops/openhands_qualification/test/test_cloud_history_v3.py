import contextlib, io, json, os, ssl, socket, unittest
from unittest.mock import patch
from urllib import error
from ops.openhands_qualification.cloud_history_v3 import Hold, probe, main, _NoRedirect
S='synthetic-secret-not-real'

def raw(items, **other): return json.dumps(dict(items=items,**other)).encode()

class HistoryS2(unittest.TestCase):
    def fake(self, val):return lambda req:(200,val)
    def test_exact_repo_is_only_historical(self):
        r=probe(S,self.fake(raw([{'selected_repository':'evansmusitu/mft-axiom-build'}],next_page_id=None)))
        self.assertEqual(r['historical_exact_repo_matches'],1)
        self.assertEqual(r['repository_access_current'],'NOT_PROVEN')
        self.assertFalse(r['production_authority'])
        self.assertFalse(r['model_inference_executed'])
        self.assertFalse(r['external_write_executed'])
    def test_empty(self):
        r=probe(S,self.fake(raw([])))
        self.assertEqual(r['status'],'NO_REPO_REFERENCE_IN_BOUNDED_HISTORY_CURRENT_ACCESS_NOT_PROVEN')
        self.assertTrue(r['authenticated_provider'])
    def test_other_repo(self):
        r=probe(S,self.fake(raw([{'selected_repository':'not/the-repo'}])))
        self.assertEqual(r['historical_exact_repo_matches'],0)
    def test_request_pin(self):
        v=[]
        def transport(req):
            v.append((req.full_url,req.get_method(),req.get_header('Authorization')))
            return 200,raw([])
        probe(S,transport)
        self.assertEqual(v,[('https://app.all-hands.dev/api/v1/app-conversations/search?limit=20','GET','Bearer '+S)])
    def test_no_secret_in_result(self):
        r=probe(S,self.fake(raw([{'title':S,'selected_repository':'evansmusitu/mft-axiom-build','id':S}])))
        self.assertNotIn(S,json.dumps(r))
    def test_redirect_handler(self):
        self.assertIsNone(_NoRedirect().redirect_request(None,None,302,'redirect',{},'https://evil.invalid'))
    def test_http_denial(self):
        for n in [301,307,401,403,404,422,429,500]:
            r=probe(S,lambda req:(n,S.encode()))
            self.assertTrue(r['status'].startswith('BLOCKED_'))
            self.assertNotIn(S,json.dumps(r))
    def test_bad_schemas(self):
        for b in [b'[]',b'{}',b'{"items":1}',b'{"items":[2]}',raw([{'selected_repository':5}]),raw([],next_page_id=True),raw([{}]*21)]:
            self.assertEqual(probe(S,self.fake(b))['status'],'BLOCKED_SCHEMA')
    def test_bad_json_and_duplicates(self):
        for b in [b'not json',b'{"items":[],"items":[]}',b'{"items":[{"x":Infinity}]}']:
            self.assertEqual(probe(S,self.fake(b))['status'],'BLOCKED_JSON')
    def test_bad_binary(self):
        for b in ['bad',b'a'*120001]:
            self.assertEqual(probe(S,self.fake(b))['status'],'BLOCKED_SIZE')
    def test_bad_http(self):
        for n in [True,600,0,'200']:
            self.assertEqual(probe(S,lambda r:(n,b'{}'))['status'],'BLOCKED_BAD_HTTP_STATUS')
    def test_secret_validation(self):
        for x in ['',None,True,22,' test','x\nY','x'*4097]:
            with self.assertRaises(Hold):probe(x,lambda _:self.fail('network called'))
    def test_dns_error(self):
        r=probe(S,lambda req:(_ for _ in ()).throw(error.URLError(socket.gaierror('sensitive'))))
        self.assertEqual(r['status'],'BLOCKED_DNS')
    def test_tls_error(self):
        r=probe(S,lambda req:(_ for _ in ()).throw(error.URLError(ssl.SSLError('sensitive'))))
        self.assertEqual(r['status'],'BLOCKED_TLS')
    def test_timeout_error(self):
        r=probe(S,lambda req:(_ for _ in ()).throw(TimeoutError('secret')))
        self.assertEqual(r['status'],'BLOCKED_TIMEOUT')
    def test_opt_in(self):
        with patch.dict(os.environ,{'OPENHANDS_API_KEY':S},clear=True),contextlib.redirect_stdout(io.StringIO()) as stream:main()
        self.assertEqual(json.loads(stream.getvalue())['status'],'BLOCKED_OPT_IN_MISSING')
    def test_zero_charge_unproven(self):
        r=probe(S,self.fake(raw([])))
        self.assertEqual(r['account_wide_zero_cost'],'NOT_PROVEN')
        self.assertEqual(r['b27_global_antirollback'],'FAILED_IN_SYNTHETIC_ATTACK')
if __name__=='__main__':unittest.main()
