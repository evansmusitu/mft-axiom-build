"""Credential-scoped S2 metadata probe of OpenHands Cloud.

NEVER starts a conversation, calls an LLM, or grants autonomous execution.
The repository access and user token remain provider data, not authorization.
"""
import json
import os
import sys
from urllib import error, request

_ENDPOINT = 'https://app.all-hands.dev/api/user/repositories?per_page=100'
_REPO = 'evansmusitu/mft-axiom-build'
_LIMIT = 150_000

class CloudProbeError(ValueError):
    pass

class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, url):
        return None

def _get(req, timeout):
    opener = request.build_opener(_NoRedirect)
    try:
        with opener.open(req, timeout=timeout) as response:
            return response.status, response.read(_LIMIT + 1)
    except error.HTTPError as exc:
        # Do not propagate provider body, headers, or submitted credentials.
        return exc.code, b''

def probe(credential, *, request=_get):
    """Return public-safe metadata only. Transport injection is for offline tests."""
    if not isinstance(credential, str) or len(credential) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in credential):
        raise CloudProbeError('invalid in-memory credential type')
    outcome = {
        'schema': 'musitu.axiom.openhands.cloud-repository-readonly-preflight.s2.v1',
        'provider': 'OpenHands Cloud',
        'repository': _REPO,
        'scope': 'S2_READ_ONLY_METADATA_NO_EXECUTION',
        'status': 'BLOCKED_CREDENTIAL_NOT_AVAILABLE',
        'authenticated_repository_metadata': False,
        'live_s3_mutation_qualified': False,
        'runtime_activation_authorized': False,
        'external_action_executed': False,
        'provider_dispatch_allowed': False,
        'production_authority': False,
        'provider_cost': 'NOT_VERIFIED',
        'independent_human_approver': 'NOT_VERIFIED',
        'global_antirollback': 'FAILED_IN_SYNTHETIC_ATTACK',
    }
    if not credential:
        return outcome
    req = __import__('urllib.request', fromlist=['Request']).Request(
        _ENDPOINT, headers={'X-Session-API-Key': credential, 'Accept': 'application/json'}, method='GET'
    )
    try:
        code, raw = request(req, 8)
        if type(code) is not int or code < 200 or code > 599:
            raise ValueError('invalid HTTP status')
        if code != 200:
            outcome['status'] = f'BLOCKED_PROVIDER_HTTP_{code}'
            return outcome
        if type(raw) is not bytes or len(raw) > _LIMIT:
            raise ValueError('invalid response size')
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError('invalid response shape')
        has_repo = any(type(x) is dict and x.get('full_name') == _REPO
                       and x.get('git_provider') == 'github' for x in data)
        if has_repo:
            outcome['status'] = 'PROVIDER_READONLY_REPOSITORY_ACCESS_CONFIRMED'
            outcome['authenticated_repository_metadata'] = True
        else:
            outcome['status'] = 'BLOCKED_REPOSITORY_ACCESS_NOT_PROVEN'
        return outcome
    except Exception:
        # No error text or body from provider, to prevent accidental secret leaks.
        outcome['status'] = 'BLOCKED_PROVIDER_READONLY_PROBE_FAILED'
        return outcome

if __name__ == '__main__':
    try:
        print(json.dumps(probe(os.environ.get('OPENHANDS_API_KEY', '')), sort_keys=True))
    except CloudProbeError:
        print(json.dumps({'schema':'musitu.axiom.openhands.cloud-repository-readonly-preflight.s2.v1',
                          'status':'BLOCKED_INVALID_CREDENTIAL', 'runtime_activation_authorized':False,
                          'provider_dispatch_allowed':False, 'production_authority':False}))
