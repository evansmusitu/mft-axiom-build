"""Uncredentialed OAuth/MCP discovery must fail closed without access tokens."""
import json
import unittest
from qualification.diagnose_axiom_public_oauth import assess_discovery, assess_userinfo, probe_all, URLS


class Response:
    def __init__(self, code, obj, headers=None):
        self.status = code
        self.data = json.dumps(obj).encode()
        self.headers = headers or {'Content-Type': 'application/json'}
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self, n=-1): return self.data[:n]


def provider(req, timeout):
    assert req.get_method() == 'GET'
    assert not req.has_header('Authorization')
    if req.full_url == URLS['authorization_server']:
        return Response(200, {
            'issuer': 'https://auth.mftintelligence.com',
            'userinfo_endpoint': 'https://auth.mftintelligence.com/oauth/userinfo',
            'scopes_supported': ['axiom.execute', 'openid', 'email'],
            'code_challenge_methods_supported': ['S256']})
    if req.full_url == URLS['protected_resource']:
        return Response(200, {
            'resource': 'https://mcp.mftintelligence.com',
            'authorization_servers': ['https://auth.mftintelligence.com'],
            'scopes_supported': ['axiom.execute']})
    return Response(401, {'error': 'invalid_token'}, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer error="invalid_token"'})


class OAuthPublicReadOnlyTests(unittest.TestCase):
    def test_valid_public_only_snapshot_is_never_release_certification(self):
        evidence = probe_all(transport=provider)
        self.assertTrue(evidence['metadata_and_unauthenticated_boundary_observed'])
        self.assertFalse(evidence['oauth_e2e_qualified'])
        self.assertFalse(evidence['commercial_ga_qualified'])
        self.assertFalse(evidence['openai_submission_approved'])
        self.assertEqual(evidence['failed_checks'], [])
        self.assertNotIn('access_token', json.dumps(evidence))

    def test_scopes_issuer_and_pkce_fail_closed(self):
        good = {'issuer':'https://auth.mftintelligence.com',
                'userinfo_endpoint':'https://auth.mftintelligence.com/oauth/userinfo',
                'scopes_supported':['axiom.execute','openid','email'],
                'code_challenge_methods_supported':['S256']}
        self.assertEqual(assess_discovery('authorization_server',200,good), [])
        for field, bad in [('issuer','https://fake.invalid'),
                           ('userinfo_endpoint','https://fake.invalid/info'),
                           ('scopes_supported',['openid','email']),
                           ('code_challenge_methods_supported',['plain'])]:
            with self.subTest(field=field):
                self.assertTrue(assess_discovery('authorization_server',200,dict(good,**{field:bad})))

    def test_resource_metadata_rejects_wrong_resource_and_issuer(self):
        data = {'resource':'https://mcp.mftintelligence.com',
                'authorization_servers':['https://auth.mftintelligence.com'],
                'scopes_supported':['axiom.execute']}
        self.assertEqual(assess_discovery('protected_resource',200,data), [])
        for change in ({'resource':'https://wrong.invalid'},
                       {'authorization_servers':['https://fake.invalid']},
                       {'scopes_supported':[]}):
            self.assertTrue(assess_discovery('protected_resource',200,dict(data,**change)))

    def test_userinfo_must_be_401_invalid_token_and_bearer_challenge(self):
        self.assertEqual(assess_userinfo(401,{'error':'invalid_token'},
                        'Bearer error="invalid_token"'), [])
        for status, body, challenge in ((200,{},''),(403,{'error':'invalid_token'},''),
                                        (401,{'error':'access_denied'},'Bearer error="invalid_token"'),
                                        (401,{'error':'invalid_token'},'')):
            self.assertTrue(assess_userinfo(status,body,challenge))

    def test_provider_response_values_never_leak(self):
        def attacker(req, timeout):
            return Response(200,{'unexpected':'SECRET_SUPPLIED', 'access_token':'NEVER_PRINT'})
        evidence=probe_all(transport=attacker)
        self.assertFalse(evidence['metadata_and_unauthenticated_boundary_observed'])
        self.assertNotIn('SECRET_SUPPLIED',json.dumps(evidence))
        self.assertNotIn('NEVER_PRINT',json.dumps(evidence))


if __name__ == '__main__':
    unittest.main()
