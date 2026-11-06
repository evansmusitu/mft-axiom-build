"""GET-only discovery of existing D1 metadata. Never admits or mutates a target."""
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

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
API = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT
LIST = '/d1/database?per_page=100&page=1'
BASE = '/d1/database/'
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
NAME = re.compile(r'[A-Za-z0-9_-]{1,128}')
PROTECTED = {
    '504029cc-f9a5-495e-818f-63c6144b4ea4': 'musitu-axiom-prod',
    'a7384b8a-0751-4705-ac77-0616b0885e7c': 'mft-axiom-claude-staging-20260927',
    '4a62b374-7232-4103-b201-34443c467382': 'mft-axiom-prod',
}


class AuditError(ValueError): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


def observe():
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
    out = {'schema': 'musitu.axiom.existing_d1_reuse_metadata.v1',
           'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'source_sha': os.environ.get('AXIOM_CHECKOUT_SHA'),
           'event_sha': os.environ.get('GITHUB_SHA'), 'run_id': os.environ.get('GITHUB_RUN_ID'),
           'account': ACCOUNT, 'transport': [], 'databases': [], 'database_count': None,
           'followup_candidate_ids': [], 'inventory_complete': False,
           'target_admitted': False, 'binding_inventory_complete': False,
           'customer_records_read': 0, 'sql_queries': 0, 'mutations': 0,
           'billing_changes': 0, 'backup_restore_qualified': False,
           'hosted_migration_qualified': False, 'release_authority': False,
           'http_methods': ['GET'], 'status': 'INCOMPLETE', 'error': None}
    admitted = set()
    deadline = time.monotonic() + 180
    opener = urllib.request.build_opener(NoRedirect)

    def get(path):
        if path != LIST and not (path.startswith(BASE) and path[len(BASE):] in admitted):
            raise AuditError('UNADMITTED_PATH')
        remaining = deadline - time.monotonic()
        if remaining <= 0 or len(out['transport']) >= 25: raise AuditError('REQUEST_BUDGET_EXHAUSTED')
        item = {'path': path, 'method': 'GET', 'http_status': None}
        out['transport'].append(item)
        req = urllib.request.Request(API + path, method='GET', headers={
            'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
            'User-Agent': 'MUSITU-AXIOM-Existing-D1-Reuse-Metadata/1.0'})
        try:
            with opener.open(req, timeout=min(20, remaining)) as response:
                item['http_status'] = response.status
                raw = response.read(2_000_001)
            if item['http_status'] != 200 or len(raw) > 2_000_000: raise AuditError('INVALID_TRANSPORT')
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get('success') is not True: raise AuditError('INVALID_ENVELOPE')
            return data
        except urllib.error.HTTPError as error:
            item['http_status'] = error.code
            raise AuditError('HTTP_FAILURE') from None

    try:
        if not token: raise AuditError('MISSING_TOKEN')
        data = get(LIST)
        rows, info = data.get('result'), data.get('result_info')
        if not isinstance(rows, list) or not 1 <= len(rows) <= 20 or not isinstance(info, dict):
            raise AuditError('INCOMPLETE_INVENTORY')
        expected = {'page': 1, 'count': len(rows), 'per_page': 100, 'total_count': len(rows)}
        if any(type(info.get(key)) is not int or info[key] != value for key, value in expected.items()):
            raise AuditError('INCOMPLETE_INVENTORY')
        by_id = {}
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('uuid'), str) or not UUID.fullmatch(row['uuid']) or not isinstance(row.get('name'), str) or not NAME.fullmatch(row['name']):
                raise AuditError('INVALID_DATABASE_IDENTITY')
            if row['uuid'] in by_id: raise AuditError('DUPLICATE_DATABASE_IDENTITY')
            by_id[row['uuid']] = row['name']
        admitted.update(by_id)
        observed = []
        for database, name in by_id.items():
            row = get(BASE + database).get('result')
            if not isinstance(row, dict) or row.get('uuid') != database or row.get('name') != name:
                raise AuditError('DATABASE_IDENTITY_MISMATCH')
            if any(type(row.get(key)) is not int or row[key] < 0 for key in ('file_size', 'num_tables')):
                raise AuditError('UNKNOWN_SIZE_OR_TABLE_COUNT')
            version = row.get('version') if row.get('version') in ('alpha', 'beta', 'production') else 'UNKNOWN'
            protected = database in PROTECTED or re.search(r'(^|[-_])prod(?:uction)?($|[-_])', name, re.I) is not None
            reported_empty = row['num_tables'] == 0 and row['file_size'] <= 65536
            observed.append({'id': database,
                'name': name if PROTECTED.get(database) == name else None,
                'name_sha256': hashlib.sha256(name.encode()).hexdigest(),
                'reported_tables': row['num_tables'],
                'file_size': row['file_size'], 'version': version, 'protected': protected,
                'reported_empty': reported_empty,
                'followup_metadata_candidate': reported_empty and not protected and version == 'production'})
        out.update({'databases': observed, 'database_count': len(observed), 'inventory_complete': True,
                    'followup_candidate_ids': [row['id'] for row in observed if row['followup_metadata_candidate']],
                    'status': 'EXISTING_D1_METADATA_OBSERVED'})
    except AuditError as error: out['error'] = str(error)
    except (OSError, ValueError, TypeError, UnicodeError, http.client.HTTPException, RecursionError):
        out['error'] = 'INVALID_RESPONSE'
    path = Path('existing-d1-reuse-inventory.json')
    raw = (json.dumps(out, indent=2, sort_keys=True) + '\n').encode()
    path.write_bytes(raw)
    Path(str(path) + '.sha256').write_text(hashlib.sha256(raw).hexdigest() + '  ' + str(path) + '\n')
    print(json.dumps(out, sort_keys=True))
    return 0 if out['status'] == 'EXISTING_D1_METADATA_OBSERVED' else 1


if __name__ == '__main__': raise SystemExit(observe())
