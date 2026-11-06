"""Pinned staging schema metadata only. Never reads customer rows or writes SQL."""
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
DATABASE = 'a7384b8a-0751-4705-ac77-0616b0885e7c'
DATABASE_NAME = 'mft-axiom-claude-staging-20260927'
API = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT
DB_PATH = '/d1/database/' + DATABASE
SQL = ("SELECT type,name,tbl_name,sql FROM sqlite_master "
       "WHERE type IN ('table','index','trigger','view') "
       "AND name NOT GLOB 'sqlite_*' ORDER BY type,name")
IDENTIFIER = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,127}')
PARENTS = ('customers', 'api_keys', 'oauth_authorization_codes',
           'oauth_access_tokens', 'oauth_refresh_tokens')


class AuditError(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def observe():
    token = os.environ.get('CLOUDFLARE_API_TOKEN', '')
    evidence = {
        'schema': 'musitu.axiom.customer.schema_catalog_readonly.v1',
        'observed_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source_sha': os.environ.get('AXIOM_CHECKOUT_SHA'),
        'event_sha': os.environ.get('GITHUB_SHA'),
        'run_id': os.environ.get('GITHUB_RUN_ID'),
        'database_id': DATABASE, 'expected_name': DATABASE_NAME,
        'identity_verified': False, 'transport': [], 'query_count': 0,
        'query_sha256': hashlib.sha256(SQL.encode()).hexdigest(),
        'objects': [], 'catalog_sha256': None, 'oauth_parent_presence': {},
        'customer_records_read': 0, 'mutations': 0, 'inference_calls': 0,
        'query_changes': None, 'query_rows_written': None,
        'raw_ddl_disclosed': False, 'backup_restore_qualified': False,
        'hosted_migration_qualified': False, 'release_authority': False,
        'status': 'INCOMPLETE', 'error': None,
    }
    opener = urllib.request.build_opener(NoRedirect)

    def request(method, path, payload=None):
        if (method, path, payload) not in (
            ('GET', DB_PATH, None),
            ('POST', DB_PATH + '/query', {'sql': SQL, 'params': []}),
        ):
            raise AuditError('UNADMITTED_REQUEST')
        raw_body = None if payload is None else json.dumps(payload).encode()
        req = urllib.request.Request(API + path, data=raw_body, method=method,
                                     headers={'Authorization': 'Bearer ' + token,
                                              'Accept': 'application/json',
                                              'Content-Type': 'application/json',
                                              'User-Agent': 'MUSITU-AXIOM-Schema-Readonly/1.0'})
        item = {'method': method, 'path': path, 'http_status': None}
        evidence['transport'].append(item)
        if method == 'POST':
            evidence['query_count'] += 1
            evidence['mutations'] = None
        try:
            with opener.open(req, timeout=20) as response:
                item['http_status'] = response.status
                raw = response.read(2_000_001)
            if item['http_status'] != 200 or len(raw) > 2_000_000:
                raise AuditError('INVALID_TRANSPORT')
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get('success') is not True:
                raise AuditError('INVALID_ENVELOPE')
            return data
        except urllib.error.HTTPError as error:
            item['http_status'] = error.code
            raise AuditError('HTTP_FAILURE') from None
        except (OSError, http.client.HTTPException, RecursionError):
            raise AuditError('TRANSPORT_FAILURE') from None

    try:
        if not token:
            raise AuditError('MISSING_TOKEN')
        db = request('GET', DB_PATH).get('result')
        if not isinstance(db, dict) or db.get('uuid') != DATABASE or db.get('name') != DATABASE_NAME:
            raise AuditError('DATABASE_IDENTITY_MISMATCH')
        evidence['identity_verified'] = True
        data = request('POST', DB_PATH + '/query', {'sql': SQL, 'params': []}).get('result')
        if not isinstance(data, list) or len(data) != 1 or not isinstance(data[0], dict):
            raise AuditError('INVALID_QUERY_RESULT')
        result = data[0]
        meta = result.get('meta')
        if isinstance(meta, dict):
            for key in ('changes', 'rows_written'):
                if type(meta.get(key)) is int and 0 <= meta[key] <= 1_000_000:
                    evidence['query_' + key] = meta[key]
        if result.get('success') is not True or not isinstance(meta, dict) or any(
            type(meta.get(key)) is not int or meta[key] != 0 for key in ('changes', 'rows_written')
        ):
            raise AuditError('READ_ONLY_METADATA_NOT_CONFIRMED')
        evidence['mutations'] = 0
        rows = result.get('results')
        if not isinstance(rows, list) or not 1 <= len(rows) <= 2000:
            raise AuditError('INVALID_CATALOG')
        objects, names = [], set()
        for row in rows:
            if not isinstance(row, dict) or set(row) != {'type', 'name', 'tbl_name', 'sql'}:
                raise AuditError('INVALID_CATALOG_ROW')
            if row['type'] not in ('table', 'index', 'trigger', 'view') or any(
                not isinstance(row[key], str) or not IDENTIFIER.fullmatch(row[key])
                for key in ('name', 'tbl_name')
            ) or row['name'] in names:
                raise AuditError('INVALID_CATALOG_IDENTITY')
            definition = row['sql']
            if not (isinstance(definition, str) and 0 < len(definition) <= 100000) and not (
                definition is None and row['type'] == 'index'
            ):
                raise AuditError('INVALID_DEFINITION')
            names.add(row['name'])
            objects.append({'type': row['type'], 'name': row['name'], 'table': row['tbl_name'],
                            'sql_sha256': hashlib.sha256(definition.encode()).hexdigest()
                            if definition is not None else None})
        tables = {obj['name'] for obj in objects if obj['type'] == 'table'}
        evidence.update({
            'objects': objects,
            'catalog_sha256': hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'oauth_parent_presence': {name: name in tables for name in PARENTS},
            'status': 'SCHEMA_CATALOG_OBSERVED',
        })
    except AuditError as error:
        evidence['error'] = str(error)
    except (ValueError, TypeError, UnicodeError):
        # Never disclose parser details, raw DDL or provider response bytes.
        evidence['error'] = 'INVALID_RESPONSE'
    path = Path('customer-schema-readonly.json')
    raw = (json.dumps(evidence, indent=2, sort_keys=True) + '\n').encode()
    path.write_bytes(raw)
    Path(str(path) + '.sha256').write_text(hashlib.sha256(raw).hexdigest() + '  ' + str(path) + '\n')
    print(json.dumps(evidence, sort_keys=True))
    return 0 if evidence['status'] == 'SCHEMA_CATALOG_OBSERVED' else 1


if __name__ == '__main__':
    raise SystemExit(observe())
