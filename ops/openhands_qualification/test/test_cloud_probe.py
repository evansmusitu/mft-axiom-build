import json
import os
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cloud_readonly_probe import probe, CloudProbeError

class ProbeTests(unittest.TestCase):
    def test_missing_credential_never_sends_request(self):
        called=[]
        report=probe('',request=lambda *_: called.append(1))
        self.assertEqual(called,[])
        self.assertEqual(report['status'],'BLOCKED_CREDENTIAL_NOT_AVAILABLE')
        self.assertFalse(report['runtime_activation_authorized'])
        self.assertFalse(report['external_action_executed'])
    def test_valid_readonly_repo_access_is_not_s3_authorization(self):
        seen=[]
        def stub(req,timeout):
            seen.append(req)
            return (200,b'[{' + b'"full_name":"evansmusitu/mft-axiom-build","git_provider":"github"' + b'}]')
        r=probe('synthetic-token-not-real',request=stub)
        self.assertEqual(r['status'],'PROVIDER_READONLY_REPOSITORY_ACCESS_CONFIRMED')
        self.assertEqual(len(seen),1)
        self.assertEqual(seen[0].get_method(),'GET')
        self.assertEqual(seen[0].full_url,'https://app.all-hands.dev/api/user/repositories?per_page=100')
        self.assertFalse(r['runtime_activation_authorized'])
        self.assertFalse(r['external_action_executed'])
        self.assertFalse(r['production_authority'])
        self.assertNotIn('synthetic-token',json.dumps(r))
    def test_wrong_repo_or_provider_does_not_pass(self):
        def wrap(obj):return lambda *args:(200,json.dumps(obj).encode())
        for value in ([],[{'full_name':'other/other','git_provider':'github'}],[{'full_name':'evansmusitu/mft-axiom-build','git_provider':'gitlab'}]):
            with self.subTest(value=value):
                self.assertEqual(probe('dummy-token',request=wrap(value))['status'],'BLOCKED_REPOSITORY_ACCESS_NOT_PROVEN')
    def test_http_failures_are_fail_closed_and_do_not_leak_response(self):
        for code in (302,401,403,404,429,500):
            with self.subTest(code=code):
                outcome=probe('dummy-token',request=lambda *args:(code,b'secret-value'))
                self.assertEqual(outcome['status'],f'BLOCKED_PROVIDER_HTTP_{code}')
                self.assertNotIn('secret-value',str(outcome))
    def test_malformed_oversize_and_network_errors_fail_closed(self):
        for f in (lambda *_:(200,b'no-json'),lambda *_:(200,b'x'*200000),lambda *_:(_ for _ in ()).throw(TimeoutError('password=private'))):
            r=probe('dummy-token',request=f)
            self.assertEqual(r['status'],'BLOCKED_PROVIDER_READONLY_PROBE_FAILED')
            self.assertNotIn('password',str(r))
    def test_invalid_caller_must_fail_closed(self):
        for x in (123,True,None,{},[], '\u0001bad'):
            with self.subTest(x=x):
                with self.assertRaises(CloudProbeError):probe(x,request=lambda *args:(200,b'[]'))
    def test_no_extra_certs_ever_from_supplied_provider_result(self):
        raw=[{'full_name':'evansmusitu/mft-axiom-build','git_provider':'github','production_authority':True,'credentials':'do-not-echo'}]
        r=probe('dummy',request=lambda *args:(200,json.dumps(raw).encode()))
        self.assertFalse(r['production_authority']);self.assertFalse(r['runtime_activation_authorized'])
        self.assertEqual(r['provider_cost'],'NOT_VERIFIED')
        self.assertNotIn('do-not-echo',json.dumps(r))

if __name__=='__main__':unittest.main()
