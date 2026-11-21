"""Inspect only allowlisted OIDC claims; never log/store/forward the JWT.

This diagnostic does not verify a JWT signature. AWS STS is the independent
signature/trust verifier when the subsequent identity test actually runs.
"""
import base64
import json
import os
import time
import urllib.parse
import urllib.request

from .guardrails import (ENVIRONMENT, EXECUTOR, IMMUTABLE_SUB, LEGACY_SUB,
                         OWNER_ID, REPOSITORY, REPOSITORY_ID, require)


def summarize_claims(c, now=None):
    now = now or time.time()
    expected = {'iss': 'https://token.actions.githubusercontent.com', 'aud': 'sts.amazonaws.com',
                'repository': REPOSITORY, 'repository_id': REPOSITORY_ID,
                'repository_owner_id': OWNER_ID, 'actor_id': OWNER_ID,
                'ref': 'refs/heads/main', 'environment': ENVIRONMENT,
                'job_workflow_ref': EXECUTOR, 'event_name': 'workflow_dispatch'}
    require(all(c.get(k) == v for k, v in expected.items()), 'OIDC context mismatch')
    require(c.get('sub') in (IMMUTABLE_SUB, LEGACY_SUB), 'Unrecognized subject format')
    require(type(c.get('iat')) in (int, float) and type(c.get('exp')) in (int, float)
            and now - 600 <= c['iat'] <= now + 30 and now < c['exp'] <= now + 600,
            'OIDC validity unverified')
    return {'schema': 'musitu.g1.oidc_subject_observation.v1', 'subject': c['sub'],
            'repository_id': REPOSITORY_ID, 'ref': 'refs/heads/main',
            'environment': ENVIRONMENT, 'reusable_workflow': EXECUTOR,
            'signature_verified_by_diagnostic': False, 'aws_identity_verified': False,
            'writes_performed': False, 'g1_accepted': False}


def main():
    raw_url = os.environ.get('ACTIONS_ID_TOKEN_REQUEST_URL', '')
    u = urllib.parse.urlsplit(raw_url)
    require(u.scheme == 'https' and u.hostname and u.hostname.endswith('.actions.githubusercontent.com')
            and not u.username and not u.password, 'Unexpected OIDC request origin')
    q = urllib.parse.parse_qsl(u.query, keep_blank_values=True)
    require(not any(k == 'audience' for k, _ in q), 'Ambiguous OIDC audience')
    url = urllib.parse.urlunsplit(u._replace(query=urllib.parse.urlencode(q + [('audience', 'sts.amazonaws.com')])))
    bearer = os.environ.get('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '')
    require(bool(bearer), 'GitHub OIDC unavailable')
    # Do not follow redirects with the runner's OIDC request credential.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl): return None
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + bearer})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=20) as r:
        payload = json.loads(r.read(32768))
    jwt = payload.get('value', '')
    require(isinstance(jwt, str) and len(jwt.split('.')) == 3, 'Invalid OIDC response')
    part = jwt.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))
    print(json.dumps(summarize_claims(claims), sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception:
        raise SystemExit('G1 OIDC subject discovery unavailable or rejected; token suppressed') from None
