"""Fixed read-only accessible-account / D1 capacity observation. Zero admission."""
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

API = 'https://api.cloudflare.com/client/v4'
MAIN = '93f395f5121954671f92fffa453d6b61'
ACCOUNT_ID = re.compile(r'[0-9a-f]{32}\Z')
DB_ID = re.compile(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z')
BASE_ACCOUNTS = '/accounts?per_page=50&page='
OUTPUT = 'axiom-d1-accessible-accounts-readonly.json'

class AdmissionError(ValueError):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()

def observe():
    result = {
        'schema': 'musitu.axiom.other_account_d1_capacity_observation.v1',
        'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source_sha': os.getenv('AXIOM_CHECKOUT_SHA'),
        'run_id': os.getenv('GITHUB_RUN_ID'),
        'status': 'INCOMPLETE', 'accounts': [], 'other_accounts_with_under_10_d1': 0,
        'errors': [], 'transport': [], 'account_scope_complete': False,
        'account_ownership_qualified': False,
        'billing_plan_qualified': False, 'create_authorized': False,
        'restore_target_admitted': False, 'backup_restore_qualified': False,
        'production_oauth_upgrade_qualified': False, 'release_authority': False,
        'mutations': 0, 'sql_queries': 0, 'customer_rows_read': 0,
        'limitations': ['Cloudflare token access does not prove exclusive owner authority.',
                        'D1 counts are not a billing-plan or historical-client proof.',
                        'No resource creation, destructive restore, migration or release.']}
    token = os.getenv('CLOUDFLARE_API_TOKEN', '')
    deadline = time.monotonic() + 150
    opener = urllib.request.build_opener(NoRedirect)
    seen = set()
    errors = (AdmissionError, OSError, ValueError, TypeError, UnicodeError,
              http.client.HTTPException, RecursionError)

    def get(path, kind, resource):
        allowed = path in (BASE_ACCOUNTS + '1', BASE_ACCOUNTS + '2')
        for aid in seen:
            allowed |= path == '/accounts/' + aid + '/d1/database?per_page=100&page=1'
            allowed |= path == '/accounts/' + aid + '/d1/database?per_page=100&page=2'
        if not allowed:
            raise AdmissionError('UNADMITTED_PATH')
        remaining = deadline - time.monotonic()
        if remaining <= 0 or len(result['transport']) >= 38:
            raise AdmissionError('TIME_OR_REQUEST_BUDGET_EXCEEDED')
        observation = {'kind': kind, 'resource_sha256': sha(resource),
                       'http_status': None, 'provider_error_codes': []}
        result['transport'].append(observation)
        req = urllib.request.Request(API + path, method='GET',
            headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
                     'User-Agent': 'MUSITU-Axiom-Authorized-D1-Account-ReadOnly/1.0'})
        try:
            with opener.open(req, timeout=min(20, remaining)) as response:
                observation['http_status'] = response.status
                raw = response.read(1_000_001)
            if observation['http_status'] != 200 or len(raw) > 1_000_000:
                raise AdmissionError('BAD_RESPONSE')
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get('success') is not True:
                raise AdmissionError('BAD_ENVELOPE')
            return data
        except urllib.error.HTTPError as err:
            observation['http_status'] = err.code
            try:
                raw = err.read(100_001) if err.fp is not None else b''
                if len(raw) <= 100_000:
                    details = json.loads(raw)
                    codes = details.get('errors') if isinstance(details, dict) else None
                    if isinstance(codes, list):
                        observation['provider_error_codes'] = [
                            v['code'] for v in codes if isinstance(v, dict)
                            and type(v.get('code')) is int and 1000 <= v['code'] <= 2147483647][:8]
            except errors:
                pass
            raise AdmissionError('HTTP_FAILURE') from None

    def validate_page(data, page, per_page, rows):
        info = data.get('result_info')
        if info is None:
            return
        if not isinstance(info, dict):
            raise AdmissionError('BAD_PAGINATION')
        for key, expected in [('page', page), ('per_page', per_page),
                              ('count', len(rows))]:
            if key in info and (type(info[key]) is not int or info[key] != expected):
                raise AdmissionError('BAD_PAGINATION')
        for key in ('total_count', 'total_pages'):
            if key in info and (type(info[key]) is not int or info[key] < 0):
                raise AdmissionError('BAD_PAGINATION')

    if not token:
        result['errors'].append('MISSING_TOKEN')
    else:
        try:
            account_pages = []
            terminal = False
            for page in (1, 2):
                data = get(BASE_ACCOUNTS + str(page), 'account_list', str(page))
                rows = data.get('result')
                if not isinstance(rows, list) or len(rows) > 50:
                    raise AdmissionError('INVALID_ACCOUNT_LIST')
                validate_page(data, page, 50, rows)
                if not rows:
                    terminal = True
                    break
                for row in rows:
                    if not isinstance(row, dict) or not isinstance(row.get('id'), str):
                        raise AdmissionError('INVALID_ACCOUNT_IDENTITY')
                    aid = row['id']
                    if not ACCOUNT_ID.fullmatch(aid) or aid in seen:
                        raise AdmissionError('INVALID_ACCOUNT_IDENTITY')
                    seen.add(aid)
                    account_pages.append(aid)
                if len(rows) < 50:
                    terminal = True
                    break
            if not terminal or len(seen) > 50:
                raise AdmissionError('INCOMPLETE_ACCOUNT_PAGINATION')
            result['account_scope_complete'] = True
            for aid in account_pages:
                entry = {'account_sha256': sha(aid), 'same_as_main': aid == MAIN,
                         'd1_count': None, 'status': 'UNKNOWN', 'under_ten': False}
                result['accounts'].append(entry)
                try:
                    dbs = set()
                    complete = False
                    for page in (1, 2):
                        data = get('/accounts/' + aid + '/d1/database?per_page=100&page=' + str(page),
                                   'd1_list', aid + ':' + str(page))
                        rows = data.get('result')
                        if not isinstance(rows, list) or len(rows) > 100:
                            raise AdmissionError('INVALID_D1_INVENTORY')
                        validate_page(data, page, 100, rows)
                        for row in rows:
                            if not isinstance(row, dict) or not isinstance(row.get('uuid'), str):
                                raise AdmissionError('INVALID_D1_IDENTITY')
                            uid = row['uuid']
                            if not DB_ID.fullmatch(uid) or uid in dbs:
                                raise AdmissionError('INVALID_D1_IDENTITY')
                            dbs.add(uid)
                        if len(rows) < 100:
                            complete = True
                            break
                    if not complete:
                        raise AdmissionError('D1_INVENTORY_NOT_EXHAUSTIVE')
                    entry['d1_count'] = len(dbs)
                    entry['status'] = 'OBSERVED'
                    entry['under_ten'] = aid != MAIN and len(dbs) < 10
                except errors as err:
                    entry['status'] = 'UNKNOWN'
                    result['errors'].append('D1_' + (str(err) if isinstance(err, AdmissionError) else 'INVALID'))
            result['other_accounts_with_under_10_d1'] = sum(int(e['under_ten']) for e in result['accounts'])
            result['status'] = ('OBSERVED_ACCESSIBLE_ACCOUNT_CAPACITY'
                                 if all(e['status'] == 'OBSERVED' for e in result['accounts'])
                                 else 'PARTIAL_D1_CAPACITY')
        except errors as err:
            result['errors'].append(str(err) if isinstance(err, AdmissionError) else 'INVALID_RESPONSE')
    raw = (json.dumps(result, indent=2, sort_keys=True) + '\n').encode()
    path = Path(OUTPUT)
    path.write_bytes(raw)
    Path(OUTPUT + '.sha256').write_text(sha(raw.decode()) + '  ' + OUTPUT + '\n')
    print(json.dumps(result, sort_keys=True))
    return 0 if result['status'] == 'OBSERVED_ACCESSIBLE_ACCOUNT_CAPACITY' else 1

if __name__ == '__main__':
    raise SystemExit(observe())
