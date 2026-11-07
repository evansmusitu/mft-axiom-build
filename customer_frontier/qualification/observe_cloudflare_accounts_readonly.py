"""Read-only Cloudflare account visibility check, not an account/capacity admission.

Exactly one fixed GET-only account inventory. No D1, tokens, account names, or
provider response payloads are logged. Observed account membership does not
prove Free plan, available D1 slots, isolation, or authorized restore use.
"""
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

PRODUCTION_ACCOUNT = '93f395f5121954671f92fffa453d6b61'
API = 'https://api.cloudflare.com/client/v4'
PATH = '/accounts?page=1&per_page=20'
HEX32 = re.compile(r'[0-9a-f]{32}')
class ObservationError(ValueError): pass
class RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

def observe():
    out = {
        'schema': 'musitu.axiom.cloudflare_account_visibility.v1',
        'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source_sha': os.environ.get('AXIOM_CHECKOUT_SHA'),
        'run_id': os.environ.get('GITHUB_RUN_ID'),
        'status': 'UNKNOWN',
        'http_status': None,
        'provider_error_codes': [],
        'accounts_visible': None,
        'other_account_id_sha256': [],
        'production_account_present': False,
        'request_count': 0,
        'http_methods': ['GET'],
        'd1_queries': 0,
        'resource_mutations': 0,
        'customer_records_read': 0,
        'capacity_verified': False,
        'free_tier_verified': False,
        'security_operator_separation_verified': False,
        'safe_restore_target_identified': False,
        'restore_target_admitted': False,
        'migration_authorized': False,
        'release_authorized': False,
        'error': None,
    }
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
    try:
        if not token: raise ObservationError('MISSING_OPERATOR_TOKEN')
        request = urllib.request.Request(API + PATH, method='GET', headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/json',
            'User-Agent': 'MUSITU-AXIOM-Account-Visibility-Readonly/1.0',
        })
        out['request_count'] = 1
        opener = urllib.request.build_opener(RejectRedirect)
        try:
            with opener.open(request, timeout=20) as response:
                out['http_status'] = response.status
                raw = response.read(250001)
        except urllib.error.HTTPError as e:
            out['http_status'] = e.code
            raise ObservationError('CLOUDFLARE_GET_REJECTED') from None
        if out['http_status'] != 200 or len(raw) > 250000:
            raise ObservationError('INVALID_ACCOUNT_TRANSPORT')
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get('success') is not True:
            raise ObservationError('INVALID_ACCOUNT_RESPONSE')
        rows = data.get('result')
        if not isinstance(rows, list) or len(rows) > 20:
            raise ObservationError('INVALID_ACCOUNT_LIST')
        info = data.get('result_info')
        if not isinstance(info, dict):
            raise ObservationError('MISSING_ACCOUNT_PAGINATION')
        for name, expected in [('page',1),('per_page',20),('count',len(rows)),('total_count',len(rows))]:
            if type(info.get(name)) is not int or info[name] != expected:
                raise ObservationError('INCOMPLETE_OR_CHANGED_ACCOUNT_INVENTORY')
        if not 1 <= len(rows) <= 20:
            raise ObservationError('NO_ACCOUNTS_OBSERVED')
        seen = set()
        for item in rows:
            if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not HEX32.fullmatch(item['id']):
                raise ObservationError('INVALID_ACCOUNT_IDENTITY')
            account = item['id']
            if account in seen: raise ObservationError('DUPLICATE_ACCOUNT_IDENTITY')
            seen.add(account)
        if PRODUCTION_ACCOUNT not in seen:
            raise ObservationError('EXPECTED_PRODUCTION_ACCOUNT_NOT_VISIBLE')
        out.update({
            'accounts_visible':len(seen),
            'production_account_present': True,
            'other_account_id_sha256': sorted(hashlib.sha256(account.encode()).hexdigest() for account in seen if account != PRODUCTION_ACCOUNT),
            'status':'VISIBLE_ACCOUNTS_METADATA_ONLY_NOT_ADMITTED',
        })
    except ObservationError as e:
        out['error'] = str(e)
    except (OSError,ValueError,TypeError,UnicodeError,http.client.HTTPException,RecursionError):
        out['error'] = 'INVALID_PROVIDER_RESULT_OR_TRANSPORT'
    path = Path('cloudflare-visible-account-metadata-only.json')
    blob = (json.dumps(out,sort_keys=True,indent=2)+'\n').encode()
    path.write_bytes(blob)
    Path(str(path)+'.sha256').write_text(hashlib.sha256(blob).hexdigest()+'  '+str(path)+'\n')
    print(json.dumps(out,sort_keys=True))
    return 0 if out['status']=='VISIBLE_ACCOUNTS_METADATA_ONLY_NOT_ADMITTED' else 1

if __name__ == '__main__':
    raise SystemExit(observe())
