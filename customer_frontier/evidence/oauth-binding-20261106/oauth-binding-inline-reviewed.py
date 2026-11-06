import datetime, hashlib, http.client, json, os, urllib.error, urllib.request
from pathlib import Path
account = '93f395f5121954671f92fffa453d6b61'
database = '504029cc-f9a5-495e-818f-63c6144b4ea4'
database_name = 'musitu-axiom-prod'
worker = 'musitu-axiom-oauth'
settings_path = '/workers/scripts/musitu-axiom-oauth/settings'
db_path = '/d1/database/504029cc-f9a5-495e-818f-63c6144b4ea4'
api = 'https://api.cloudflare.com/client/v4/accounts/' + account
out = {'schema': 'musitu.axiom.oauth.binding_identity_readonly.v1',
       'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
       'run_id': os.environ.get('GITHUB_RUN_ID'), 'event_sha': os.environ.get('GITHUB_SHA'),
       'fixed_checkout': '29bfb5a81996226ae10b4d8dadbf106d2aab27df',
       'account': account, 'worker': worker, 'binding_name': 'AXIOM_DB',
       'expected_database': database, 'expected_database_name': database_name,
       'binding_identity_observed': False, 'database_identity_observed': False,
       'transport': [], 'status': 'INCOMPLETE', 'error': None,
       'http_methods': ['GET'], 'sql_queries': 0, 'customer_records_read': 0,
       'mutations': 0, 'inference_calls': 0, 'raw_settings_disclosed': False,
       'hosted_migration_qualified': False, 'release_authority': False}
class AuditError(ValueError): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None
opener = urllib.request.build_opener(NoRedirect)
token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
def get(path):
    if path not in (settings_path, db_path): raise AuditError('UNADMITTED_PATH')
    item = {'path': path, 'method': 'GET', 'http_status': None}
    out['transport'].append(item)
    req = urllib.request.Request(api + path, method='GET', headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
        'User-Agent': 'MUSITU-AXIOM-OAuth-Binding-Readonly/1.0'})
    try:
        with opener.open(req, timeout=20) as response:
            item['http_status'] = response.status
            raw = response.read(2_000_001)
        if item['http_status'] != 200 or len(raw) > 2_000_000: raise AuditError('INVALID_TRANSPORT')
        data = json.loads(raw)
        if not isinstance(data, dict) or data.get('success') is not True: raise AuditError('INVALID_ENVELOPE')
        return data.get('result')
    except urllib.error.HTTPError as error:
        item['http_status'] = error.code
        raise AuditError('HTTP_FAILURE') from None
try:
    if not token: raise AuditError('MISSING_TOKEN')
    settings = get(settings_path)
    if not isinstance(settings, dict) or not isinstance(settings.get('bindings'), list): raise AuditError('INVALID_BINDINGS')
    bindings = settings['bindings']
    if not all(isinstance(row, dict) for row in bindings): raise AuditError('INVALID_BINDINGS')
    selected = [row for row in bindings if row.get('name') == 'AXIOM_DB']
    if len(selected) != 1 or selected[0].get('type') != 'd1' or selected[0].get('id') != database: raise AuditError('OAUTH_BINDING_MISMATCH')
    out['binding_identity_observed'] = True
    db = get(db_path)
    if not isinstance(db, dict) or db.get('uuid') != database or db.get('name') != database_name: raise AuditError('DATABASE_IDENTITY_MISMATCH')
    out['database_identity_observed'] = True
    out['status'] = 'OAUTH_BINDING_IDENTITY_OBSERVED'
except AuditError as error: out['error'] = str(error)
except (OSError, ValueError, TypeError, UnicodeError, http.client.HTTPException, RecursionError): out['error'] = 'INVALID_RESPONSE'
path = Path('oauth-binding-readonly.json')
raw = (json.dumps(out, indent=2, sort_keys=True) + '\n').encode()
path.write_bytes(raw)
Path(str(path) + '.sha256').write_text(hashlib.sha256(raw).hexdigest() + '  ' + str(path) + '\n')
print(json.dumps(out, sort_keys=True))
raise SystemExit(0 if out['status'] == 'OAUTH_BINDING_IDENTITY_OBSERVED' else 1)
