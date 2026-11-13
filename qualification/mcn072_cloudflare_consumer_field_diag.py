#!/usr/bin/env python3
"""MCN-072 sanitized GET-only Cloudflare consumer field presence diagnostic.

Provider script_name is optional; this tool cannot infer a Worker from a missing
field, cannot authenticate a deployed PostgreSQL scheduler, and always fails
closed for MCN-072 fairness and commercial acceptance.

Only an existing GitHub Actions protected CLOUDFLARE_API_TOKEN may be supplied;
never put that token in arguments, logs, file output, or test artifacts.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
BASE = 'https://api.cloudflare.com'
PREFIX = f'/client/v4/accounts/{ACCOUNT}/queues'
LIST_PATH = PREFIX + '?page=1&per_page=100'
ID_RE = re.compile(r'[0-9a-f]{32}\Z')
SCRIPT_RE = re.compile(r'[A-Za-z0-9_.-]{1,128}\Z')
MAX_BODY = 131072
MAX_CONSUMERS = 8
OUT = Path('mcn072-cloudflare-consumer-field-diag.json')
SAFE_FIELDS = frozenset({'consumer_id', 'type', 'queue_name', 'script_name',
                         'script', 'worker', 'worker_name', 'service',
                         'service_name', 'environment'})


class ProbeFailure(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def sha(data: bytes | str) -> str:
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def checked_id(value):
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ProbeFailure('INVALID_IDENTIFIER')
    return value


def allowed_path(path):
    if path == LIST_PATH:
        return True
    if not isinstance(path, str):
        return False
    return bool(re.fullmatch(re.escape(PREFIX) +
              r'/[0-9a-f]{32}(?:/consumers(?:/[0-9a-f]{32})?)?', path))


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ProbeFailure('DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def fetch(path, token, opener):
    """Exact account-and-method-pinned, bounded provider GET; never redirect."""
    if not allowed_path(path):
        raise ProbeFailure('UNAPPROVED_PROVIDER_PATH')
    if (not isinstance(token, str) or not 12 <= len(token) <= 4096
            or any(ch.isspace() for ch in token)):
        raise ProbeFailure('TOKEN_UNAVAILABLE')
    request = urllib.request.Request(
        BASE + path, method='GET', headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/json',
            'User-Agent': 'MUSITU-MCN072-ConsumerFields-ReadOnly/1.0',
        })
    try:
        with opener.open(request, timeout=15) as response:
            if response.status != 200:
                raise ProbeFailure('PROVIDER_STATUS_INVALID')
            if 'application/json' not in response.headers.get('Content-Type', '').lower():
                raise ProbeFailure('PROVIDER_CONTENT_TYPE_INVALID')
            raw = response.read(MAX_BODY + 1)
    except urllib.error.HTTPError as exc:
        raise ProbeFailure('PROVIDER_HTTP_' + str(exc.code)) from None
    except (urllib.error.URLError, OSError, TimeoutError):
        raise ProbeFailure('PROVIDER_TRANSPORT_BLOCKED') from None
    if len(raw) > MAX_BODY:
        raise ProbeFailure('PROVIDER_RESPONSE_TOO_LARGE')
    try:
        result = json.loads(raw, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError):
        raise ProbeFailure('PROVIDER_JSON_INVALID') from None
    if type(result) is not dict or result.get('success') is not True:
        raise ProbeFailure('PROVIDER_ENVELOPE_INVALID')
    return result, sha(raw)


def field_presence(record):
    if type(record) is not dict:
        raise ProbeFailure('CONSUMER_RECORD_INVALID')
    return {key: key in record for key in sorted(SAFE_FIELDS)}


def script_value(record):
    value = record.get('script_name')
    if value is None or value == '':
        return None
    if not isinstance(value, str) or not SCRIPT_RE.fullmatch(value):
        raise ProbeFailure('SCRIPT_NAME_FORMAT_INVALID')
    return value


def validate_consumer(record, qname):
    if type(record) is not dict:
        raise ProbeFailure('CONSUMER_RECORD_INVALID')
    cid = checked_id(record.get('consumer_id'))
    kind = record.get('type')
    if kind not in ('worker', 'http_pull'):
        raise ProbeFailure('CONSUMER_TYPE_UNSUPPORTED')
    if record.get('queue_name') not in (None, qname):
        raise ProbeFailure('CONSUMER_QUEUE_CONFLICT')
    if kind != 'worker' and script_value(record) is not None:
        raise ProbeFailure('NONWORKER_SCRIPT_IDENTITY')
    return cid, kind


def indexed(rows, qname):
    if type(rows) is not list or len(rows) > MAX_CONSUMERS:
        raise ProbeFailure('CONSUMER_COHORT_TOO_LARGE_OR_INVALID')
    out = {}
    for record in rows:
        cid, kind = validate_consumer(record, qname)
        if cid in out:
            raise ProbeFailure('DUPLICATE_CONSUMER_ID')
        out[cid] = record
    return out


def inspect(token, opener):
    inventory, inventory_hash = fetch(LIST_PATH, token, opener)
    meta = inventory.get('result_info')
    queues = inventory.get('result')
    if (type(meta) is not dict or type(queues) is not list or len(queues) != 1
            or meta.get('page') != 1 or meta.get('total_pages') != 1
            or meta.get('total_count') != 1 or type(queues[0]) is not dict):
        raise ProbeFailure('QUEUE_INVENTORY_NOT_SINGLE_AND_COMPLETE')
    qid = checked_id(queues[0].get('queue_id'))
    qdetail, detail_hash = fetch(PREFIX + '/' + qid, token, opener)
    queue = qdetail.get('result')
    if type(queue) is not dict or queue.get('queue_id') != qid:
        raise ProbeFailure('QUEUE_IDENTITY_CONFLICT')
    qname = queue.get('queue_name')
    if not isinstance(qname, str) or not 1 <= len(qname) <= 128:
        raise ProbeFailure('QUEUE_NAME_UNKNOWN')
    count = queue.get('consumers_total_count')
    if type(count) is not int or not 0 <= count <= MAX_CONSUMERS:
        raise ProbeFailure('CONSUMER_TOTAL_COUNT_INVALID')
    by_detail = indexed(queue.get('consumers'), qname)
    if len(by_detail) != count:
        raise ProbeFailure('CONSUMER_DETAIL_INCOMPLETE')
    listed, list_hash = fetch(PREFIX + '/' + qid + '/consumers', token, opener)
    by_list = indexed(listed.get('result'), qname)
    if by_detail.keys() != by_list.keys():
        raise ProbeFailure('CONSUMER_LIST_IDENTITY_MISMATCH')
    consumers, exact_hashes = [], []
    worker_count, identified_count = 0, 0
    for cid in sorted(by_detail):
        exact, exact_hash = fetch(PREFIX + '/' + qid + '/consumers/' + cid, token, opener)
        record = exact.get('result')
        exact_id, kind = validate_consumer(record, qname)
        if exact_id != cid:
            raise ProbeFailure('EXACT_CONSUMER_IDENTITY_MISMATCH')
        if by_detail[cid].get('type') != kind or by_list[cid].get('type') != kind:
            raise ProbeFailure('CONSUMER_TYPE_CONFLICT')
        sources = {'queue_detail': by_detail[cid], 'consumer_list': by_list[cid],
                   'consumer_exact': record}
        values = {script_value(item) for item in sources.values()}
        values.discard(None)
        if len(values) > 1:
            raise ProbeFailure('SCRIPT_NAME_CONFLICT')
        found = values.pop() if values else None
        if kind == 'worker':
            worker_count += 1
            identified_count += bool(found)
        elif found is not None:
            raise ProbeFailure('NONWORKER_SCRIPT_IDENTITY')
        consumers.append({
            'consumer_id_sha256': sha(cid), 'consumer_type': kind,
            'script_name_present': {key: 'script_name' in val for key, val in sources.items()},
            'known_field_presence': {key: field_presence(val) for key, val in sources.items()},
            'script_name_sha256': sha(found) if found else None,
            'script_name_observed': found is not None,
        })
        exact_hashes.append(exact_hash)
    resolved = worker_count > 0 and identified_count == worker_count
    return {
        'schema': 'musitu.mcn072.cloudflare_consumer_field_diag.v1',
        'queue_id_sha256': sha(qid), 'queue_count': 1,
        'consumer_count': count, 'worker_consumer_count': worker_count,
        'worker_script_identity_resolved': resolved,
        'worker_consumer_script_state': ('OBSERVED' if resolved else
                  'UNVERIFIABLE' if worker_count else 'NO_WORKER_CONSUMER'),
        'consumers': consumers,
        'provider_response_sha256': {
            'queue_inventory': inventory_hash, 'queue_detail': detail_hash,
            'consumer_list': list_hash, 'exact_consumers': exact_hashes,
        },
        'cloudflare_mutations': 0,
        'postgres_scheduler_correspondence_qualified': False,
        'tenant_fairness_qualified': False,
        'independent_witness_verified': False,
        'mcn072_qualified': False,
        'commercial_ga': 'NO_GO',
    }


def main():
    result = {
        'schema': 'musitu.mcn072.cloudflare_consumer_field_diag.v1',
        'observed_utc': datetime.now(timezone.utc).isoformat(),
        'github_run_id': os.environ.get('GITHUB_RUN_ID', ''),
        'github_sha': os.environ.get('GITHUB_SHA', ''),
        'method_allowlist': ['GET'], 'cloudflare_mutations': 0,
        'postgres_scheduler_correspondence_qualified': False,
        'tenant_fairness_qualified': False,
        'independent_witness_verified': False,
        'mcn072_qualified': False, 'commercial_ga': 'NO_GO',
    }
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        result.update(inspect(os.environ.get('CLOUDFLARE_API_TOKEN', ''), opener))
        result['observation_status'] = 'FIELD_SCHEMA_OBSERVED_ONLY'
        exit_code = 0
    except ProbeFailure as exc:
        result['observation_status'] = 'BLOCKED'
        result['reason_code'] = str(exc)
        exit_code = 2
    except Exception:
        result['observation_status'] = 'BLOCKED'
        result['reason_code'] = 'UNEXPECTED_FAIL_CLOSED'
        exit_code = 2
    raw = (json.dumps(result, indent=2, sort_keys=True) + '\n').encode()
    OUT.write_bytes(raw)
    OUT.with_name(OUT.name + '.sha256').write_text(
        sha(raw) + '  ' + OUT.name + '\n')
    print(json.dumps({
        'observation_status': result['observation_status'],
        'consumer_count': result.get('consumer_count'),
        'worker_script_identity_resolved': result.get('worker_script_identity_resolved'),
        'reason_code': result.get('reason_code'),
        'mcn072_qualified': False}, sort_keys=True))
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
