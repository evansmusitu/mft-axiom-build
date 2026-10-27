"""OpenHands Cloud V1 S2: one read-only conversation metadata request.

No agent, sandbox, repo write, model inference, secret, personal data or raw
provider body is emitted. A historical selected_repository value never proves
current GitHub installation or permission. NOT RELEASE.
"""
import json
import os
import socket
import ssl
from urllib import error, request

_REPO = 'evansmusitu/mft-axiom-build'
_URL = 'https://app.all-hands.dev/api/v1/app-conversations/search?limit=20'
_MAX = 120_000

class Hold(ValueError):
    pass

class _NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, url):
        return None

def _fetch(req):
    opener = request.build_opener(request.ProxyHandler({}), _NoRedirect())
    try:
        with opener.open(req, timeout=8) as res:
            return res.status, res.read(_MAX + 1)
    except error.HTTPError as exc:
        return exc.code, b''

def probe(secret, transport=_fetch):
    if type(secret) is not str or not secret or len(secret) > 4096 or any(ord(c) < 33 or ord(c) == 127 for c in secret):
        raise Hold('INVALID_SECRET_FORMAT')
    out = dict(schema='axiom.openhands.cloud-v1.history-readonly.s2.v3',
               status='BLOCKED_NOT_EXECUTED', authenticated_provider=False,
               historical_exact_repo_matches=0, reviewed_conversations=0,
               repository_access_current='NOT_PROVEN',
               model_inference_executed=False, external_write_executed=False,
               production_authority=False, account_wide_zero_cost='NOT_PROVEN',
               b27_global_antirollback='FAILED_IN_SYNTHETIC_ATTACK')
    req = request.Request(_URL, headers={'Authorization': 'Bearer '+secret, 'Accept': 'application/json'}, method='GET')
    try:
        code, raw = transport(req)
    except (TimeoutError, socket.timeout):
        out['status']='BLOCKED_TIMEOUT';return out
    except ssl.SSLError:
        out['status']='BLOCKED_TLS';return out
    except error.URLError as exc:
        reason=exc.reason
        out['status']=('BLOCKED_TLS' if isinstance(reason,ssl.SSLError) else
                       'BLOCKED_DNS' if isinstance(reason,socket.gaierror) else
                       'BLOCKED_TIMEOUT' if isinstance(reason,(TimeoutError,socket.timeout)) else
                       'BLOCKED_TRANSPORT')
        return out
    except Exception:
        out['status']='BLOCKED_TRANSPORT';return out
    if type(code) is not int or code < 100 or code > 599:
        out['status']='BLOCKED_BAD_HTTP_STATUS';return out
    if code != 200:
        out['status']='BLOCKED_REDIRECT' if 300<=code<400 else 'BLOCKED_HTTP_'+str(code)
        return out
    if type(raw) is not bytes or len(raw)>_MAX:
        out['status']='BLOCKED_SIZE';return out
    try:
        # Reject duplicate JSON keys and nonstandard JSON numbers.
        def pairs(v):
            d={}
            for key,value in v:
                if key in d: raise ValueError('duplicate key')
                d[key]=value
            return d
        def reject_constant(_):raise ValueError('nonfinite number')
        payload=json.loads(raw, object_pairs_hook=pairs,parse_constant=reject_constant)
    except (ValueError,UnicodeError):
        out['status']='BLOCKED_JSON';return out
    if type(payload) is not dict or type(payload.get('items')) is not list:
        out['status']='BLOCKED_SCHEMA';return out
    items=payload['items']
    if len(items)>20 or any(type(x) is not dict for x in items):
        out['status']='BLOCKED_SCHEMA';return out
    if 'next_page_id' in payload and payload['next_page_id'] is not None and type(payload['next_page_id']) is not str:
        out['status']='BLOCKED_SCHEMA';return out
    if any('selected_repository' in x and x['selected_repository'] is not None and type(x['selected_repository']) is not str for x in items):
        out['status']='BLOCKED_SCHEMA';return out
    out['authenticated_provider']=True
    out['reviewed_conversations']=len(items)
    out['historical_exact_repo_matches']=sum(x.get('selected_repository')==_REPO for x in items)
    out['status']='HISTORICAL_REPO_REFERENCE_OBSERVED_CURRENT_ACCESS_NOT_PROVEN' if out['historical_exact_repo_matches'] else 'NO_REPO_REFERENCE_IN_BOUNDED_HISTORY_CURRENT_ACCESS_NOT_PROVEN'
    return out

def main():
    if os.environ.get('AXIOM_S2_OPT_IN')!='READONLY_PROBE_ONLY':
        print(json.dumps({'status':'BLOCKED_OPT_IN_MISSING'}));return
    secret=os.environ.get('OPENHANDS_API_KEY','')
    try:out=probe(secret)
    except Hold:out={'status':'BLOCKED_SECRET_MISSING_OR_INVALID'}
    print(json.dumps(out,sort_keys=True))

if __name__=='__main__':main()
