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
from email import policy
from email.parser import BytesParser
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
WORKERS_PATH = f'/client/v4/accounts/{ACCOUNT}/workers/scripts'
WORKERS_PREFIX = WORKERS_PATH + '/'
VERSION_ID_RE = re.compile(r'[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\Z')
ID_RE = re.compile(r'[0-9a-f]{32}\Z')
SCRIPT_RE = re.compile(r'[A-Za-z0-9_.-]{1,128}\Z')
MAX_BODY = 131072
MAX_SCRIPT_CONTENT = 2 * 1024 * 1024
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
    if path in (LIST_PATH, WORKERS_PATH):
        return True
    if not isinstance(path, str):
        return False
    if re.fullmatch(re.escape(WORKERS_PREFIX) +
                    r'[A-Za-z0-9_.-]{1,128}/deployments', path):
        return True
    if re.fullmatch(re.escape(WORKERS_PREFIX) +
                    r'[A-Za-z0-9_.-]{1,128}/versions/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', path):
        return True
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



def script_alias_kind(record):
    if 'script' not in record:
        return 'absent'
    value = record['script']
    if type(value) is str:
        return 'string'
    if type(value) is dict:
        return 'object'
    if type(value) is list:
        return 'array'
    if value is None:
        return 'null'
    return 'other'


def script_alias_value(record):
    value = record.get('script')
    if type(value) is str and SCRIPT_RE.fullmatch(value):
        return value
    return None


def worker_listing(token, opener):
    payload, digest = fetch(WORKERS_PATH, token, opener)
    rows = payload.get('result')
    if type(rows) is not list or len(rows) > 100:
        raise ProbeFailure('WORKER_INVENTORY_SHAPE_INVALID')
    identifiers = set()
    for row in rows:
        if type(row) is not dict or type(row.get('id')) is not str or not SCRIPT_RE.fullmatch(row['id']):
            raise ProbeFailure('WORKER_ENTRY_INVALID')
        if row['id'] in identifiers:
            raise ProbeFailure('WORKER_INVENTORY_DUPLICATE')
        identifiers.add(row['id'])
    info = payload.get('result_info')
    complete = (type(info) is dict and info.get('page') == 1
                and info.get('total_pages') == 1 and info.get('total_count') == len(rows))
    return identifiers, digest, complete



def summarize_worker_content(raw, content_type="application/javascript"):
    """Summarize current Worker content without preserving a single original byte.

    Literal presence is not an execution trace, code-to-version attestation, or
    proof of a PostgreSQL connection, eligibility history, or tenant fairness.
    """
    if type(raw) is not bytes or not 0 < len(raw) <= MAX_SCRIPT_CONTENT:
        raise ProbeFailure('WORKER_CONTENT_BOUNDS_INVALID')
    markers = (b'axiom_tenant_fair_cursor', b'axiom_tenant_fair_served',
               b'axiom_distributed_execution_jobs')
    mime=content_type.split(';',1)[0].strip().lower() if type(content_type) is str else ''
    javascript_mimes={'application/javascript','text/javascript','application/x-javascript',
                      'application/ecmascript','text/ecmascript'}
    modules=[]
    if mime=='multipart/form-data':
        match=re.search(r'(?:^|;)\s*boundary=(?:"([A-Za-z0-9_-]{1,70})"|([A-Za-z0-9_-]{1,70}))(?:\s*;|\s*$)',content_type)
        if not match:
            raise ProbeFailure('WORKER_MULTIPART_BOUNDARY_INVALID')
        message=BytesParser(policy=policy.default).parsebytes(
            b'Content-Type: '+content_type.encode('ascii')+b'\r\nMIME-Version: 1.0\r\n\r\n'+raw)
        if not message.is_multipart():
            raise ProbeFailure('WORKER_MULTIPART_INVALID')
        parts=list(message.iter_parts())
        if len(parts)>64:
            raise ProbeFailure('WORKER_MULTIPART_TOO_MANY_PARTS')
        for part in parts:
            if part.get_content_type().lower() in javascript_mimes:
                body=part.get_payload(decode=True)
                if type(body) is not bytes or not body or len(body)>MAX_SCRIPT_CONTENT:
                    raise ProbeFailure('WORKER_MULTIPART_MODULE_INVALID')
                modules.append(sha(body))
    elif mime in javascript_mimes or mime in ('application/octet-stream','text/plain'):
        modules=[sha(raw)]
    # Canonical module-payload fingerprints exclude MIME boundary strings, headers,
    # and unpublished module filenames. No source bytes are persisted.
    canonical=sha(json.dumps(sorted(modules),separators=(',',':')).encode()) if modules else None
    return {
        'worker_content_mime_class': mime,
        'javascript_module_part_count': len(modules),
        'canonical_module_content_sha256': canonical,
        'content_provenance_status': 'CURRENT_SCRIPT_CONTENT_ONLY',
        'worker_script_content_sha256': sha(raw),
        'worker_script_content_bytes': len(raw),
        'pg_scheduler_table_literal_count': sum(marker in raw for marker in markers),
        'content_matches_active_version_qualified': False,
        'postgres_correspondence_qualified': False,
        'tenant_fairness_qualified': False,
        'mcn072_qualified': False,
    }


def fetch_worker_content(script, token, opener):
    """One account-pinned GET, no redirects, bounded raw content, no raw export."""
    if type(script) is not str or not SCRIPT_RE.fullmatch(script):
        raise ProbeFailure('WORKER_CONTENT_SCRIPT_INVALID')
    if (type(token) is not str or not 12 <= len(token) <= 4096 or
            any(ch.isspace() for ch in token)):
        raise ProbeFailure('WORKER_CONTENT_TOKEN_UNAVAILABLE')
    path = WORKERS_PREFIX + script + '/content/v2'
    req = urllib.request.Request(BASE + path, method='GET', headers={
        'Authorization': 'Bearer ' + token, 'Accept': '*/*',
        'User-Agent': 'MUSITU-MCN072-ContentFingerprint-ReadOnly/1.0'})
    try:
        with opener.open(req, timeout=15) as response:
            if response.status != 200:
                raise ProbeFailure('WORKER_CONTENT_HTTP_NON_200')
            kind = response.headers.get('Content-Type', '').split(';', 1)[0].lower().strip()
            allowed = ('application/javascript', 'text/javascript', 'application/x-javascript',
                       'text/plain', 'application/octet-stream', 'multipart/form-data')
            if kind not in allowed:
                raise ProbeFailure('WORKER_CONTENT_MIME_INVALID')
            response_content_type=response.headers.get('Content-Type','')
            raw = response.read(MAX_SCRIPT_CONTENT + 1)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403, 404):
            raise ProbeFailure('WORKER_CONTENT_ACCESS_UNAVAILABLE') from None
        raise ProbeFailure('WORKER_CONTENT_HTTP_NON_200') from None
    except (urllib.error.URLError, OSError, TimeoutError):
        raise ProbeFailure('WORKER_CONTENT_TRANSPORT_UNAVAILABLE') from None
    return summarize_worker_content(raw, response_content_type)


def observe_active_deployment(token, opener, script):
    """Use Cloudflare metadata only, never script source or secret bindings."""
    if type(script) is not str or not SCRIPT_RE.fullmatch(script):
        raise ProbeFailure('WORKER_SCRIPT_CANDIDATE_INVALID')
    deployment, deployment_hash = fetch(WORKERS_PREFIX + script + '/deployments', token, opener)
    body = deployment.get('result')
    rows = body.get('deployments') if type(body) is dict else None
    if type(rows) is not list or not 1 <= len(rows) <= 10 or type(rows[0]) is not dict:
        raise ProbeFailure('WORKER_DEPLOYMENT_INVENTORY_INCOMPLETE')
    active = rows[0]  # Cloudflare documents first entry as latest active deployment.
    versions = active.get('versions')
    if type(versions) is not list or len(versions) != 1 or type(versions[0]) is not dict:
        raise ProbeFailure('MIXED_OR_UNKNOWN_ACTIVE_DEPLOYMENT')
    version = versions[0]
    vid = version.get('version_id')
    if type(vid) is not str or not VERSION_ID_RE.fullmatch(vid):
        raise ProbeFailure('ACTIVE_VERSION_IDENTIFIER_INVALID')
    pct = version.get('percentage')
    if type(pct) not in (int, float) or pct != 100:
        raise ProbeFailure('ACTIVE_VERSION_PERCENTAGE_UNKNOWN')
    envelope, version_hash = fetch(WORKERS_PREFIX + script + '/versions/' + vid, token, opener)
    result = envelope.get('result')
    if type(result) is not dict or result.get('id') != vid:
        raise ProbeFailure('ACTIVE_VERSION_IDENTITY_MISMATCH')
    resources = result.get('resources')
    script_info = resources.get('script') if type(resources) is dict else None
    handlers = script_info.get('handlers') if type(script_info) is dict else None
    if type(handlers) is not list or len(handlers) > 50 or any(type(x) is not str for x in handlers):
        raise ProbeFailure('ACTIVE_VERSION_HANDLERS_UNVERIFIABLE')
    bindings = resources.get('bindings')
    if bindings is not None and (type(bindings) is not list or len(bindings) > 128):
        raise ProbeFailure('ACTIVE_VERSION_BINDINGS_UNVERIFIABLE')
    for item in bindings or []:
        if type(item) is not dict or type(item.get('type')) is not str:
            raise ProbeFailure('ACTIVE_VERSION_BINDING_INVALID')
    handler = 'queue' in handlers
    return {
        'deployment_observation_status': ('QUEUE_HANDLER_OBSERVED_ONLY' if handler
                                          else 'NO_QUEUE_HANDLER_IN_OBSERVED_VERSION'),
        'active_deployed_queue_handler_observed': handler,
        'active_version_sha256': sha(vid),
        # Keep raw version hash in memory only; do not export it or the source.
        '_private_version_script_etag': script_info.get('etag') if
            type(script_info.get('etag')) is str and
            re.fullmatch(r'[0-9a-f]{64}', script_info['etag']) else None,
        'deployment_response_sha256': deployment_hash,
        'version_response_sha256': version_hash,
        'active_version_hyperdrive_binding_count': sum(1 for b in bindings or [] if b.get('type') == 'hyperdrive'),
        'active_version_service_binding_count': sum(1 for b in bindings or [] if b.get('type') == 'service'),
        'active_version_binding_count': len(bindings or []),
    }


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
    worker_ids, workers_hash, worker_inventory_complete = worker_listing(token, opener)
    consumers, exact_hashes = [], []
    worker_count, identified_count, alias_matches = 0, 0, 0
    active_candidate_names = []
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
        aliases = {script_alias_value(item) for item in sources.values()}
        aliases.discard(None)
        if len(aliases) > 1:
            raise ProbeFailure('CONSUMER_SCRIPT_ALIAS_CONFLICT')
        alias = aliases.pop() if aliases else None
        alias_complete = (alias is not None and all(script_alias_value(item) == alias
                                                for item in sources.values()))
        alias_match = (kind == 'worker' and alias_complete and alias in worker_ids)
        if kind == 'worker':
            worker_count += 1
            identified_count += bool(found)
            alias_matches += bool(alias_match)
            if alias_match:
                active_candidate_names.append(alias)
        elif found is not None:
            raise ProbeFailure('NONWORKER_SCRIPT_IDENTITY')
        consumers.append({
            'consumer_id_sha256': sha(cid), 'consumer_type': kind,
            'script_name_present': {key: 'script_name' in val for key, val in sources.items()},
            'known_field_presence': {key: field_presence(val) for key, val in sources.items()},
            'script_name_sha256': sha(found) if found else None,
            'script_name_observed': found is not None,
            'script_alias_field_types': {key: script_alias_kind(val) for key, val in sources.items()},
            'script_alias_sha256': sha(alias) if alias_match else None,
            'script_alias_matches_listed_worker': bool(alias_match),
            'script_alias_present_across_three': alias_complete,
        })
        exact_hashes.append(exact_hash)
    resolved = worker_count > 0 and identified_count == worker_count
    if len(active_candidate_names) == 1 and worker_count == 1:
        try:
            deployment = observe_active_deployment(token, opener, active_candidate_names[0])
        except ProbeFailure as exc:
            deployment = {'deployment_observation_status': 'BLOCKED',
                          'deployment_reason_code': str(exc),
                          'active_deployed_queue_handler_observed': False}
    else:
        deployment = {'deployment_observation_status': 'NO_MATCHING_WORKER_CANDIDATE',
                      'active_deployed_queue_handler_observed': False}
    content_observation = {'content_provenance_status': 'NOT_READ',
                           'content_matches_active_version_qualified': False,
                           'postgres_correspondence_qualified': False}
    if (len(active_candidate_names) == 1 and worker_count == 1 and
            deployment.get('active_deployed_queue_handler_observed') is True):
        try:
            content_observation = fetch_worker_content(active_candidate_names[0], token, opener)
            try:
                second = fetch_worker_content(active_candidate_names[0], token, opener)
                first_raw=content_observation.get('worker_script_content_sha256')
                second_raw=second.get('worker_script_content_sha256')
                first_module=content_observation.get('canonical_module_content_sha256')
                second_module=second.get('canonical_module_content_sha256')
                content_observation['current_content_replay_raw_sha256_equal'] = bool(
                    first_raw and first_raw==second_raw)
                content_observation['current_content_replay_canonical_modules_equal'] = bool(
                    first_module and first_module==second_module)
                content_observation['current_content_replay_status']='TWO_GETS_OBSERVED_ONLY'
            except ProbeFailure as exc:
                content_observation['current_content_replay_status']='BLOCKED'
                content_observation['current_content_replay_reason_code']=str(exc)
                content_observation['current_content_replay_raw_sha256_equal']=False
                content_observation['current_content_replay_canonical_modules_equal']=False
        except ProbeFailure as exc:
            content_observation = {**content_observation,
                                   'content_provenance_status': 'BLOCKED',
                                   'content_reason_code': str(exc)}
        except Exception:
            content_observation = {**content_observation,
                                   'content_provenance_status': 'BLOCKED',
                                   'content_reason_code': 'WORKER_CONTENT_UNEXPECTED_FAIL_CLOSED'}
    version_etag = deployment.pop('_private_version_script_etag', None)
    current_sha = content_observation.get('worker_script_content_sha256')
    content_observation['active_version_etag_sha256'] = sha(version_etag) if version_etag else None
    # Exact byte hash equality is only a provider-level content observation;
    # it cannot establish queue->Postgres execution or tenant fairness.
    content_observation['active_version_content_sha256_equality_observed'] = bool(
        version_etag and type(current_sha) is str and
        re.fullmatch(r'[0-9a-f]{64}', current_sha) and version_etag == current_sha)
    return {**deployment, **content_observation,
        'schema': 'musitu.mcn072.cloudflare_consumer_field_diag.v1',
        'queue_id_sha256': sha(qid), 'queue_count': 1,
        'consumer_count': count, 'worker_consumer_count': worker_count,
        'worker_script_identity_resolved': resolved,
        'worker_script_alias_correspondence_observed': worker_count > 0 and alias_matches == worker_count,
        'worker_inventory_count_scanned': len(worker_ids),
        'worker_inventory_complete': worker_inventory_complete,
        'worker_consumer_script_state': ('OBSERVED' if resolved else
                  'UNVERIFIABLE' if worker_count else 'NO_WORKER_CONSUMER'),
        'consumers': consumers,
        'provider_response_sha256': {
            'queue_inventory': inventory_hash, 'queue_detail': detail_hash,
            'consumer_list': list_hash, 'exact_consumers': exact_hashes,
            'worker_inventory': workers_hash,
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
