"""Reserve one empty D1 restore target; no SQL, billing changes or deletions."""
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
API = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT
LIST = '/d1/database?per_page=100&page=1'
BASE = '/d1/database'
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
KNOWN = {'a7384b8a-0751-4705-ac77-0616b0885e7c': 'mft-axiom-claude-staging-20260927',
         '504029cc-f9a5-495e-818f-63c6144b4ea4': 'musitu-axiom-prod'}
MAX_TOTAL_BYTES = 64 * 1024 * 1024


class AuditError(ValueError): pass
class Rejected(AuditError): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None


def reserve():
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    target = 'axiom-customer-restore-20261106-' + run_id
    out = {'schema': 'musitu.axiom.customer.restore_target_reservation.v1',
           'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'source_sha': os.environ.get('AXIOM_CHECKOUT_SHA'),
           'event_sha': os.environ.get('GITHUB_SHA'), 'run_id': run_id,
           'account': ACCOUNT, 'target_name': None, 'transport': [],
           'initial_database_count': None, 'initial_total_storage_bytes': None,
           'creation_attempts': 0, 'resource_creations': 0,
           'creation_state': 'NOT_ATTEMPTED', 'created_database_id': None,
           'empty_target_verified': False, 'existing_resource_mutations': 0,
           'sql_queries': 0, 'customer_records_read': 0, 'billing_changes': 0,
           'paid_upgrade_enabled': False, 'backup_restore_qualified': False,
           'hosted_migration_qualified': False, 'release_authority': False,
           'status': 'INCOMPLETE', 'error': None}
    opener = urllib.request.build_opener(NoRedirect)
    admitted = set()

    def request(method, path, payload=None):
        get_allowed = method == 'GET' and payload is None and (
            path == LIST or (path.startswith(BASE + '/') and path[len(BASE)+1:] in admitted))
        create_allowed = method == 'POST' and path == BASE and payload == {'name': target}
        if not (get_allowed or create_allowed) or len(out['transport']) >= 25:
            raise AuditError('UNADMITTED_REQUEST')
        if method == 'POST':
            if out['creation_attempts'] != 0: raise AuditError('CREATE_RETRY_DENIED')
            out['creation_attempts'] = 1
            out['creation_state'] = 'UNKNOWN'
            out['resource_creations'] = None
        item = {'method': method, 'path': path, 'http_status': None, 'provider_error_codes': []}
        out['transport'].append(item)
        req = urllib.request.Request(API + path, method=method,
            data=None if payload is None else json.dumps(payload).encode(),
            headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
                     'Content-Type': 'application/json', 'User-Agent': 'MUSITU-AXIOM-Empty-Restore-Target/1.0'})
        try:
            try:
                with opener.open(req, timeout=20) as response:
                    item['http_status'] = response.status
                    raw = response.read(2_000_001)
            except urllib.error.HTTPError as error:
                item['http_status'] = error.code
                raw = error.read(2_000_001)
            if len(raw) > 2_000_000: raise AuditError('OVERSIZE_RESPONSE')
            data = json.loads(raw)
            if not isinstance(data, dict): raise AuditError('INVALID_ENVELOPE')
            errors = data.get('errors')
            if isinstance(errors, list):
                item['provider_error_codes'] = [row['code'] for row in errors
                    if isinstance(row, dict) and type(row.get('code')) is int and 1000 <= row['code'] <= 999999][:20]
            if not 200 <= item['http_status'] < 300 or data.get('success') is not True:
                if method == 'POST' and 400 <= item['http_status'] < 500 and item['http_status'] != 408 and data.get('success') is False:
                    out['creation_state'] = 'REJECTED'
                    out['resource_creations'] = 0
                    raise Rejected('PROVIDER_REJECTED_CREATE')
                raise AuditError('PROVIDER_REQUEST_FAILED')
            return data
        except (OSError, http.client.HTTPException, RecursionError):
            raise AuditError('TRANSPORT_FAILURE') from None

    try:
        if not token: raise AuditError('MISSING_TOKEN')
        if not re.fullmatch(r'[0-9]{5,15}', run_id): raise AuditError('INVALID_RUN_ID')
        out['target_name'] = target
        listing = request('GET', LIST)
        rows, info = listing.get('result'), listing.get('result_info')
        if not isinstance(rows, list) or not 2 <= len(rows) <= 20 or not isinstance(info, dict):
            raise AuditError('INCOMPLETE_INVENTORY')
        expected = {'page': 1, 'count': len(rows), 'per_page': 100, 'total_count': len(rows)}
        if any(type(info.get(key)) is not int or info[key] != value for key, value in expected.items()):
            raise AuditError('INCOMPLETE_INVENTORY')
        by_id = {}
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get('uuid'), str) or not UUID.fullmatch(row['uuid']) or not isinstance(row.get('name'), str):
                raise AuditError('INVALID_DATABASE_IDENTITY')
            if row['uuid'] in by_id: raise AuditError('DUPLICATE_DATABASE_IDENTITY')
            if row['name'] == target: raise AuditError('TARGET_NAME_ALREADY_EXISTS')
            by_id[row['uuid']] = row['name']
        if any(by_id.get(key) != name for key, name in KNOWN.items()):
            raise AuditError('KNOWN_DATABASE_IDENTITY_MISMATCH')
        admitted.update(by_id)
        total = 0
        for database, name in by_id.items():
            db = request('GET', BASE + '/' + database).get('result')
            if not isinstance(db, dict) or db.get('uuid') != database or db.get('name') != name:
                raise AuditError('DATABASE_IDENTITY_MISMATCH')
            size = db.get('file_size')
            if type(size) is not int or size < 0: raise AuditError('STORAGE_BUDGET_UNKNOWN')
            total += size
        out['initial_database_count'] = len(rows)
        out['initial_total_storage_bytes'] = total
        if total > MAX_TOTAL_BYTES: raise AuditError('STORAGE_BUDGET_EXCEEDED')
        # <=20 existing databases is below the Paid included100,000; Free
        # rejects capacity exhaustion instead of upgrading. <=64MiB current
        # storage leaves room for an empty DB below either plan's included5GB.
        # No SQL, data import, plan change or billing endpoint is admitted.
        created = request('POST', BASE, {'name': target}).get('result')
        if not isinstance(created, dict) or not isinstance(created.get('uuid'), str) or not UUID.fullmatch(created['uuid']) or created.get('name') != target or created['uuid'] in by_id:
            raise AuditError('AMBIGUOUS_CREATE_RESULT')
        database = created['uuid']
        out.update({'creation_state': 'CREATED', 'resource_creations': 1, 'created_database_id': database})
        admitted.add(database)
        db = request('GET', BASE + '/' + database).get('result')
        if not isinstance(db, dict) or db.get('uuid') != database or db.get('name') != target:
            raise AuditError('CREATED_IDENTITY_MISMATCH')
        if type(db.get('num_tables')) is not int or db['num_tables'] != 0 or type(db.get('file_size')) is not int or not 0 <= db['file_size'] <= 65536:
            raise AuditError('EMPTY_TARGET_NOT_CONFIRMED')
        out.update({'empty_target_verified': True, 'status': 'EMPTY_RESTORE_TARGET_RESERVED'})
    except Rejected as error:
        out['status'] = 'RESTORE_TARGET_RESERVATION_REJECTED'
        out['error'] = str(error)
    except AuditError as error: out['error'] = str(error)
    except (ValueError, TypeError, UnicodeError): out['error'] = 'INVALID_RESPONSE'
    # Never retry creation, adopt a pre-existing DB, delete resources or run SQL.
    # An ambiguous result remains UNKNOWN for explicit read-only reconciliation.
    path = Path('customer-restore-target-reservation.json')
    raw = (json.dumps(out, indent=2, sort_keys=True) + '\n').encode()
    path.write_bytes(raw)
    Path(str(path) + '.sha256').write_text(hashlib.sha256(raw).hexdigest() + '  ' + str(path) + '\n')
    print(json.dumps(out, sort_keys=True))
    return 0 if out['status'] == 'EMPTY_RESTORE_TARGET_RESERVED' else 1


if __name__ == '__main__': raise SystemExit(reserve())
