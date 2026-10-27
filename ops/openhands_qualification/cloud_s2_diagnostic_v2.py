"""Non-releasing OpenHands S2 credential transport diagnostics.

Only two tightly pinned read-only GET endpoints; no model or repository writes.
The GitHub secret must be supplied by a secure runner, NEVER pasted or written.
This tool never logs response bodies, tokens, headers or exception messages.
The pinned endpoints correspond to distinct OpenHands credential families.
This does not qualify any provider financial hard cap or independent security.
"""
import json
import os
import socket
import ssl
from urllib import error, request

_REPO = 'evansmusitu/mft-axiom-build'
_URLS = {
    'cloud_api_key': 'https://app.all-hands.dev/api/v1/app-conversations/search?limit=1',
    'agent_session_key': 'https://app.all-hands.dev/api/user/repositories?per_page=100',
}
_MAX = 120_000

class ProbeHold(ValueError):
    pass

class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, url):
        return None


def _fetch(req, timeout):
    opener = request.build_opener(request.ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(req, timeout=timeout) as res:
            return res.status, res.read(_MAX + 1)
    except error.HTTPError as exc:
        # Deliberately never consume or expose the response body/headers.
        return exc.code, b''


def _network_class(exc):
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return 'BLOCKED_NETWORK_TIMEOUT'
    if isinstance(exc, ssl.SSLError):
        return 'BLOCKED_TLS_ERROR'
    if isinstance(exc, socket.gaierror):
        return 'BLOCKED_DNS_ERROR'
    if isinstance(exc, error.URLError):
        reason = exc.reason
        if isinstance(reason, ssl.SSLError):
            return 'BLOCKED_TLS_ERROR'
        if isinstance(reason, socket.gaierror):
            return 'BLOCKED_DNS_ERROR'
        if isinstance(reason, (TimeoutError, socket.timeout)):
            return 'BLOCKED_NETWORK_TIMEOUT'
        return 'BLOCKED_NETWORK_TRANSPORT'
    if isinstance(exc, (OSError, ConnectionError)):
        return 'BLOCKED_NETWORK_TRANSPORT'
    return 'BLOCKED_UNCLASSIFIED_TRANSPORT'


def diagnose(credential, mode, *, transport=_fetch):
    """Produce only a non-sensitive result, with zero authority transfer."""
    if type(mode) is not str or mode not in _URLS:
        raise ProbeHold('MODE_REQUIRED_NO_AUTOMATIC_FALLBACK')
    if type(credential) is not str or not credential or len(credential) > 4096 or any(ord(c) < 33 or ord(c) == 127 for c in credential):
        raise ProbeHold('CREDENTIAL_FORMAT_INVALID')
    result = {
        'schema': 'musitu.axiom.openhands.cloud.s2.safe-diagnostic.v2',
        'mode': mode,
        'status': 'BLOCKED_NOT_EXECUTED',
        'authenticated_provider': False,
        'repository_access_confirmed': False,
        'runtime_activation_authorized': False,
        'provider_dispatch_allowed': False,
        'model_inference_executed': False,
        'external_mutation_executed': False,
        'execution_allowed': False,
        'production_authority': False,
        'independent_security_verifier': 'NOT_PROVEN',
        'account_wide_hard_zero_cost': 'NOT_PROVEN',
        'global_antirollback': 'FAILED_IN_SYNTHETIC_ATTACK',
        'product_objects': ['Project', 'Work', 'Agent', 'Artifact', 'Evidence'],
    }
    header = ('Authorization', 'Bearer ' + credential) if mode == 'cloud_api_key' else ('X-Session-API-Key', credential)
    req = request.Request(_URLS[mode], headers={header[0]:header[1], 'Accept':'application/json'}, method='GET')
    try:
        code, body = transport(req, 8)
    except Exception as exc:
        result['status'] = _network_class(exc)
        return result
    if type(code) is not int or code < 100 or code > 599:
        result['status'] = 'BLOCKED_INVALID_HTTP_STATUS'
        return result
    if code != 200:
        # A 3xx is always denied; neither redirected location nor token is used.
        result['status'] = 'BLOCKED_REDIRECT_DENIED' if 300 <= code < 400 else 'BLOCKED_PROVIDER_HTTP_' + str(code)
        return result
    if type(body) is not bytes or len(body) > _MAX:
        result['status'] = 'BLOCKED_OVERSIZE_OR_NONBINARY_RESPONSE'
        return result
    if body.lstrip()[:20].lower().startswith((b'<!doctype html', b'<html')):
        result['status'] = 'BLOCKED_HTML_RESPONSE'
        return result
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        result['status'] = 'BLOCKED_INVALID_JSON'
        return result
    if mode == 'cloud_api_key':
        if type(data) is not dict or type(data.get('items')) is not list:
            result['status'] = 'BLOCKED_UNEXPECTED_V1_SCHEMA'
            return result
        result['authenticated_provider'] = True
        # V1 conversations GET cannot establish GitHub repo binding.
        result['status'] = 'CLOUD_V1_READONLY_AUTH_CONFIRMED_REPO_NOT_CHECKED'
    else:
        if type(data) is not list:
            result['status'] = 'BLOCKED_UNEXPECTED_SESSION_SCHEMA'
            return result
        result['authenticated_provider'] = True
        if any(type(item) is dict and item.get('full_name') == _REPO and item.get('git_provider') == 'github' for item in data):
            result['repository_access_confirmed'] = True
            result['status'] = 'SESSION_READONLY_REPOSITORY_ACCESS_CONFIRMED'
        else:
            result['status'] = 'SESSION_READONLY_AUTHENTICATED_REPO_UNCONFIRMED'
    return result


def main():
    # Never run a request incidentally when imported or executed locally.
    if os.getenv('AXIOM_S2_OPT_IN') != 'READONLY_PROBE_ONLY':
        print(json.dumps({'status':'BLOCKED_MANUAL_OPT_IN_REQUIRED','production_authority':False}))
        return
    mode=os.getenv('AXIOM_S2_CREDENTIAL_KIND','')
    credential=os.getenv('OPENHANDS_API_KEY','')
    if not credential:
        print(json.dumps({'status':'BLOCKED_CREDENTIAL_NOT_AVAILABLE','production_authority':False}))
        return
    try:
        print(json.dumps(diagnose(credential,mode),sort_keys=True))
    except ProbeHold:
        print(json.dumps({'status':'BLOCKED_INVALID_CREDENTIAL_OR_MODE','production_authority':False}))

if __name__ == '__main__':
    main()
