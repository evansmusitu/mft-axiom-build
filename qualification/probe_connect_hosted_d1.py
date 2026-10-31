"""Cloudflare staging D1 metadata/schema probe; manual, read-only and non-admitting.

Requires D1 Read token restricted to an independently isolated staging account.
The provider query is a hard-coded SELECT and may not authorize customers,
billing, full hosted D1 transactional qualification, or methane safety.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / 'infra/connect_customer_registry.sql'
API_ORIGIN = 'https://api.cloudflare.com/client/v4'
SQL = ("SELECT type, name, sql FROM sqlite_schema "
       "WHERE name LIKE 'connect_customer_%' ORDER BY type, name")
EMPTY_COUNTS_SQL = (
    "SELECT "
    "(SELECT COUNT(*) FROM connect_customer_tenants) AS tenants, "
    "(SELECT COUNT(*) FROM connect_customer_credentials) AS credentials, "
    "(SELECT COUNT(*) FROM connect_customer_usage_events) AS usage_events, "
    "(SELECT COUNT(*) FROM connect_customer_daily_usage) AS daily_usage, "
    "(SELECT COUNT(*) FROM connect_customer_minute_usage) AS minute_usage"
)
EMPTY_COUNT_KEYS = frozenset({
    'tenants', 'credentials', 'usage_events', 'daily_usage', 'minute_usage'
})
HEX32 = re.compile(r'[0-9a-f]{32}\Z')
STAGING_NAME = re.compile(r'musitu-connect-stage-[a-z0-9][a-z0-9-]{2,47}\Z')
MAX_RESPONSE_BYTES = 65536


class ProbeError(Exception):
    """Fixed error code only; never include a remote body or credentials."""


class _RejectRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def load_config(environment):
    account = environment.get('MUSITU_CF_STAGING_ACCOUNT_ID', '')
    production_account = environment.get('MUSITU_CF_PRODUCTION_ACCOUNT_ID', '')
    database_id = environment.get('MUSITU_CF_STAGING_DATABASE_ID', '')
    database_name = environment.get('MUSITU_CF_STAGING_DATABASE_NAME', '')
    token = environment.get('MUSITU_CF_STAGING_READ_TOKEN', '')
    if (not isinstance(account, str) or not HEX32.fullmatch(account)
            or not isinstance(production_account, str)
            or not HEX32.fullmatch(production_account)
            or account == production_account):
        raise ProbeError('STAGING_PRODUCTION_ACCOUNT_ISOLATION_UNPROVEN')
    try:
        parsed = UUID(database_id)
    except (ValueError, TypeError, AttributeError):
        raise ProbeError('INVALID_STAGING_DATABASE_ID') from None
    if parsed.version != 4 or str(parsed) != database_id:
        raise ProbeError('INVALID_STAGING_DATABASE_ID')
    if not isinstance(database_name, str) or not STAGING_NAME.fullmatch(database_name):
        raise ProbeError('INVALID_STAGING_DATABASE_NAME')
    if not isinstance(token, str) or len(token) < 20 or '\n' in token or '\r' in token:
        raise ProbeError('STAGING_READ_TOKEN_UNAVAILABLE')
    return {'account_id': account, 'database_id': database_id,
            'database_name': database_name, 'token': token}


def local_schema_objects():
    """Compare the remote schema to this checkout, not a guessed table list."""
    with sqlite3.connect(':memory:') as db:
        db.executescript(SCHEMA_PATH.read_text(encoding='utf-8'))
        objects = db.execute(
            "SELECT type,name,sql FROM sqlite_schema "
            "WHERE name LIKE 'connect_customer_%' ORDER BY type,name").fetchall()
    if len(objects) < 9 or any(t not in ('table', 'trigger') for t, _, _ in objects):
        raise ProbeError('LOCAL_SCHEMA_MISSING_REQUIRED_GUARDS')
    keys = {(kind, name) for kind, name, _ in objects}
    for required in ('connect_customer_event_no_update', 'connect_customer_event_no_delete',
                     'connect_customer_before_admission', 'connect_customer_after_admission'):
        if ('trigger', required) not in keys:
            raise ProbeError('LOCAL_SCHEMA_MISSING_REQUIRED_GUARDS')
    return {(kind, name): ddl for kind, name, ddl in objects}


def _unique_object(pairs):
    obj = {}
    for k, v in pairs:
        if k in obj:
            raise ValueError('DUPLICATE_JSON_KEY')
        obj[k] = v
    return obj


def _reject_nonfinite(_):
    raise ValueError('NONFINITE_JSON_NUMBER')


def _finite_json_float(token):
    value = float(token)
    if not math.isfinite(value):
        raise ValueError('NONFINITE_JSON_NUMBER')
    return value


def _request_json(request, *, transport):
    try:
        with transport(request, timeout=15) as response:
            if response.status != 200:
                raise ProbeError('PROVIDER_HTTP_REJECTED')
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if not isinstance(raw, bytes) or not (0 < len(raw) <= MAX_RESPONSE_BYTES):
            raise ProbeError('PROVIDER_RESPONSE_SIZE_INVALID')
        doc = json.loads(raw, object_pairs_hook=_unique_object,
                         parse_constant=_reject_nonfinite,
                         parse_float=_finite_json_float)
    except (urllib.error.URLError, OSError, ValueError, UnicodeError, RecursionError):
        raise ProbeError('PROVIDER_RESPONSE_UNTRUSTED') from None
    if not isinstance(doc, dict) or doc.get('success') is not True:
        raise ProbeError('PROVIDER_API_REJECTED')
    return doc


def _normalized_sql(value):
    if not isinstance(value, str) or len(value) > 16000:
        raise ProbeError('REMOTE_SCHEMA_DRIFT')
    return ' '.join(value.split())


def _read_only_query(endpoint, headers, statement, transport):
    """One fixed SELECT; deny any unknown write metadata and never echo rows."""
    body = json.dumps({'sql': statement, 'params': []},
                      separators=(',', ':')).encode('utf-8')
    req = urllib.request.Request(endpoint + '/query', data=body, method='POST',
                                 headers={**headers, 'Content-Type': 'application/json'})
    query = _request_json(req, transport=transport).get('result')
    if not isinstance(query, list) or len(query) != 1 or not isinstance(query[0], dict):
        raise ProbeError('REMOTE_QUERY_RESPONSE_INVALID')
    result = query[0]
    meta = result.get('meta')
    if (result.get('success') is not True or not isinstance(meta, dict)
            or type(meta.get('changes')) is not int or meta['changes'] != 0
            or type(meta.get('rows_written')) is not int or meta['rows_written'] != 0
            or meta.get('changed_db') is not False):
        raise ProbeError('REMOTE_QUERY_NOT_PROVEN_READ_ONLY')
    rows = result.get('results')
    if not isinstance(rows, list) or len(rows) > 64:
        raise ProbeError('REMOTE_QUERY_RESPONSE_INVALID')
    return rows


def run_probe(config, transport=None):
    """Never follow HTTP redirects, and execute only GET + the fixed SELECT."""
    if transport is None:
        transport = urllib.request.build_opener(_RejectRedirect()).open
    endpoint = (API_ORIGIN + '/accounts/' + config['account_id'] +
                '/d1/database/' + config['database_id'])
    headers = {'Authorization': 'Bearer ' + config['token'],
               'Accept': 'application/json',
               'User-Agent': 'MUSITU-Connect-Staging-ReadOnly/1.0'}
    req = urllib.request.Request(endpoint, method='GET', headers=headers)
    metadata = _request_json(req, transport=transport).get('result')
    if (not isinstance(metadata, dict) or metadata.get('uuid') != config['database_id']
            or metadata.get('name') != config['database_name']):
        raise ProbeError('REMOTE_STAGING_IDENTITY_MISMATCH')

    rows = _read_only_query(endpoint, headers, SQL, transport)
    remote = {}
    for row in rows:
        if (not isinstance(row, dict) or row.get('type') not in ('table', 'trigger')
                or not isinstance(row.get('name'), str)):
            raise ProbeError('REMOTE_SCHEMA_RESPONSE_INVALID')
        key = (row['type'], row['name'])
        if key in remote:
            raise ProbeError('REMOTE_SCHEMA_RESPONSE_INVALID')
        remote[key] = _normalized_sql(row.get('sql'))
    local = local_schema_objects()
    if set(remote) != set(local) or any(
            remote[k] != _normalized_sql(local[k]) for k in local):
        raise ProbeError('REMOTE_SCHEMA_DRIFT')
    # The metadata/schema observation is not an empty staging DB proof.
    # Read counts only; never retrieve a tenant, credential or usage row.
    counts_rows = _read_only_query(endpoint, headers, EMPTY_COUNTS_SQL, transport)
    if (len(counts_rows) != 1 or not isinstance(counts_rows[0], dict)
            or set(counts_rows[0]) != EMPTY_COUNT_KEYS
            or any(type(value) is not int or value != 0
                   for value in counts_rows[0].values())):
        raise ProbeError('STAGING_CUSTOMER_REGISTRY_NOT_EMPTY_OR_UNVERIFIED')
    return {
        'schema': 'musitu.connect.hosted_d1_readonly_probe.v1',
        'result': 'HOSTED_STAGING_IDENTITY_AND_SCHEMA_OBSERVED_ONLY',
        'local_schema_sha256': hashlib.sha256(SCHEMA_PATH.read_bytes()).hexdigest(),
        'staging_database_identity_verified': True,
        'staging_account_isolation_independently_verified': False,
        'staging_read_token_scope_independently_verified': False,
        'hosted_transactional_qualification': False,
        'production_customer_admission': False,
        'hosted_schema_matches_source': True,
        'staging_customer_tables_empty_at_read_time': True,
        'cross_region_customer_data_absence_verified': False,
        'schema_objects_checked': len(local),
        'hosted_concurrency_qualified': False,
        'cross_region_quota_qualified': False,
        'customer_admission_enabled': False,
        'commercial_ga_enabled': False,
        'methane_prediction_authorized': False,
    }


def write_report(path, evidence):
    with Path(path).open('x', encoding='utf-8') as output:
        output.write(json.dumps(evidence, sort_keys=True, indent=2, allow_nan=False) + '\n')


def main(argv=None):
    parser = argparse.ArgumentParser(description='Explicit manual staging-only D1 read-only check')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        cfg = load_config(os.environ)
        proof = run_probe(cfg)
        write_report(args.output, proof)
    except (ProbeError, OSError) as exc:
        code = str(exc) if isinstance(exc, ProbeError) else 'REPORT_WRITE_UNAVAILABLE'
        print('HOSTED_D1_READONLY=BLOCKED ' + code, file=sys.stderr)
        return 2
    print('HOSTED_D1_READONLY=STAGING_SCHEMA_OBSERVED_NOT_GA_QUALIFIED')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
