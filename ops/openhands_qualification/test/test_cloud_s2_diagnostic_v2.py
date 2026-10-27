import contextlib
import io
import json
import os
import socket
import ssl
import unittest
from unittest.mock import patch
from urllib import error
from ops.openhands_qualification.cloud_s2_diagnostic_v2 import (
    diagnose, ProbeHold, _NoRedirect, main,
)

SENSITIVE='synthetic-CREDENTIAL-NOT-REAL'

class S2DiagnosticTests(unittest.TestCase):
    def assert_no_authority(self,r):
        self.assertFalse(r['production_authority'])
        self.assertFalse(r['provider_dispatch_allowed'])
        self.assertFalse(r['model_inference_executed'])
        self.assertFalse(r['external_mutation_executed'])
        self.assertFalse(r['execution_allowed'])
        self.assertEqual(r['global_antirollback'], 'FAILED_IN_SYNTHETIC_ATTACK')
        self.assertEqual(r['account_wide_hard_zero_cost'], 'NOT_PROVEN')
        self.assertNotIn(SENSITIVE,json.dumps(r))
    def test_cloud_v1_positive_bearer_is_readonly_without_repo_proof(self):
        seen=[]
        def fake(req,ttl):
            seen.append((req.full_url,req.get_method(),req.get_header('Authorization'),ttl))
            return 200,b'{"items":[],"next_page_id":null}'
        r=diagnose(SENSITIVE,'cloud_api_key',transport=fake)
        self.assertEqual(r['status'],'CLOUD_V1_READONLY_AUTH_CONFIRMED_REPO_NOT_CHECKED')
        self.assertTrue(r['authenticated_provider'])
        self.assertFalse(r['repository_access_confirmed'])
        self.assertEqual(seen[0],('https://app.all-hands.dev/api/v1/app-conversations/search?limit=1','GET','Bearer '+SENSITIVE,8))
        self.assert_no_authority(r)
    def test_session_positive_exact_repo_and_old_header(self):
        seen=[]
        def fake(req,ttl):
            seen.append(req)
            return 200,b'[{"git_provider":"github","full_name":"evansmusitu/mft-axiom-build"}]'
        r=diagnose(SENSITIVE,'agent_session_key',transport=fake)
        self.assertEqual(r['status'],'SESSION_READONLY_REPOSITORY_ACCESS_CONFIRMED')
        self.assertTrue(r['repository_access_confirmed'])
        self.assertEqual(seen[0].get_header('X-session-api-key'),SENSITIVE)
        self.assertNotIn('Authorization',dict(seen[0].header_items()))
        self.assert_no_authority(r)
    def test_schema_mismatch_v1(self):
        r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a:(200,b'[]'))
        self.assertEqual(r['status'],'BLOCKED_UNEXPECTED_V1_SCHEMA')
        self.assert_no_authority(r)
    def test_schema_mismatch_session(self):
        r=diagnose(SENSITIVE,'agent_session_key',transport=lambda *a:(200,b'{"items":[]}'))
        self.assertEqual(r['status'],'BLOCKED_UNEXPECTED_SESSION_SCHEMA')
        self.assert_no_authority(r)
    def test_wrong_repo_not_confirmed(self):
        r=diagnose(SENSITIVE,'agent_session_key',transport=lambda *a:(200,b'[{"full_name":"other/repo","git_provider":"github"}]'))
        self.assertEqual(r['status'],'SESSION_READONLY_AUTHENTICATED_REPO_UNCONFIRMED')
        self.assert_no_authority(r)
    def test_http_failures_redact(self):
        for code in (401,403,404,422,429,500,503):
            with self.subTest(code=code):
                r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a:(code,SENSITIVE.encode()))
                self.assertEqual(r['status'],'BLOCKED_PROVIDER_HTTP_'+str(code))
                self.assert_no_authority(r)
    def test_redirect_denied(self):
        for code in (301,302,307,308):
            self.assertEqual(diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a:(code,b''))['status'],'BLOCKED_REDIRECT_DENIED')
    def test_redirect_handler_never_forwards(self):
        self.assertIsNone(_NoRedirect().redirect_request(None,None,302,'x',{},'https://evil.invalid'))
    def test_tls_nested(self):
        r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a: (_ for _ in ()).throw(error.URLError(ssl.SSLError('secret ssl'))))
        self.assertEqual(r['status'],'BLOCKED_TLS_ERROR');self.assert_no_authority(r)
    def test_dns_nested(self):
        r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a: (_ for _ in ()).throw(error.URLError(socket.gaierror('secret host'))))
        self.assertEqual(r['status'],'BLOCKED_DNS_ERROR');self.assert_no_authority(r)
    def test_timeout_nested(self):
        r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a: (_ for _ in ()).throw(error.URLError(TimeoutError('secret'))))
        self.assertEqual(r['status'],'BLOCKED_NETWORK_TIMEOUT');self.assert_no_authority(r)
    def test_unclassified_exception_redacted(self):
        r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a: (_ for _ in ()).throw(RuntimeError('Password: '+SENSITIVE)))
        self.assertEqual(r['status'],'BLOCKED_UNCLASSIFIED_TRANSPORT');self.assert_no_authority(r)
    def test_transport_error_classification(self):
        r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a: (_ for _ in ()).throw(error.URLError('no route')))
        self.assertEqual(r['status'],'BLOCKED_NETWORK_TRANSPORT');self.assert_no_authority(r)
    def test_html_gateway_response_is_denied(self):
        for b in (b'<html>Secret '+SENSITIVE.encode(), b'  <!doctype html><html>'):
            self.assertEqual(diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a:(200,b))['status'],'BLOCKED_HTML_RESPONSE')
    def test_malformed_json(self):
        r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a:(200,b'{'))
        self.assertEqual(r['status'],'BLOCKED_INVALID_JSON');self.assert_no_authority(r)
    def test_big_response(self):
        r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a:(200,b' '*120001))
        self.assertEqual(r['status'],'BLOCKED_OVERSIZE_OR_NONBINARY_RESPONSE')
    def test_nonbinary_response(self):
        r=diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a:(200,'{}'))
        self.assertEqual(r['status'],'BLOCKED_OVERSIZE_OR_NONBINARY_RESPONSE')
    def test_invalid_http_status(self):
        for code in (False,0,-1,600,'200'):
            self.assertEqual(diagnose(SENSITIVE,'cloud_api_key',transport=lambda *a:(code,b'[]'))['status'],'BLOCKED_INVALID_HTTP_STATUS')
    def test_unknown_mode_never_calls_network(self):
        called=[]
        with self.assertRaises(ProbeHold): diagnose(SENSITIVE,'guess',transport=lambda *a:called.append(1))
        self.assertFalse(called)
    def test_nonstring_modes_fail_closed(self):
        for mode in (None,[],{},5,True):
            with self.subTest(mode_type=str(type(mode))):
                with self.assertRaises(ProbeHold):diagnose(SENSITIVE,mode,transport=lambda *a: self.fail('network invoked'))
    def test_credential_invalid_never_network(self):
        called=[]
        for val in ('',None,42,True,'x\nhi',' x','x'*4097):
            with self.subTest(value_type=type(val)):
                with self.assertRaises(ProbeHold):diagnose(val,'cloud_api_key',transport=lambda *a:called.append(1))
        self.assertFalse(called)
    def test_no_automatic_fallback_on_401(self):
        seen=[]
        def f(*args):seen.append(1);return 401,b''
        r=diagnose(SENSITIVE,'cloud_api_key',transport=f)
        self.assertEqual(len(seen),1)
        self.assertEqual(r['status'],'BLOCKED_PROVIDER_HTTP_401')
    def test_no_automatic_fallback_on_v1_wrong_schema(self):
        seen=[]
        def f(*args):seen.append(1);return 200,b'[]'
        diagnose(SENSITIVE,'cloud_api_key',transport=f)
        self.assertEqual(len(seen),1)
    def test_missing_opt_in_blocks_credential_use(self):
        env={'AXIOM_S2_CREDENTIAL_KIND':'cloud_api_key','OPENHANDS_API_KEY':SENSITIVE}
        with patch.dict(os.environ,env,clear=True),contextlib.redirect_stdout(io.StringIO()) as c:main()
        self.assertEqual(json.loads(c.getvalue())['status'],'BLOCKED_MANUAL_OPT_IN_REQUIRED')
    def test_missing_credential_blocks(self):
        with patch.dict(os.environ,{'AXIOM_S2_CREDENTIAL_KIND':'cloud_api_key','AXIOM_S2_OPT_IN':'READONLY_PROBE_ONLY'},clear=True),contextlib.redirect_stdout(io.StringIO()) as c:main()
        self.assertEqual(json.loads(c.getvalue())['status'],'BLOCKED_CREDENTIAL_NOT_AVAILABLE')
    def test_invalid_mode_in_main_blocks(self):
        with patch.dict(os.environ,{'AXIOM_S2_CREDENTIAL_KIND':'unexpected','OPENHANDS_API_KEY':SENSITIVE,'AXIOM_S2_OPT_IN':'READONLY_PROBE_ONLY'},clear=True),contextlib.redirect_stdout(io.StringIO()) as c:main()
        self.assertEqual(json.loads(c.getvalue())['status'],'BLOCKED_INVALID_CREDENTIAL_OR_MODE')

if __name__=='__main__':unittest.main()
