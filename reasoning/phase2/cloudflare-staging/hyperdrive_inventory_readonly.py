"""One-use, credential-safe Cloudflare control-plane inspection for AXIOM Phase 2.

Only four preapproved GET paths are queried. This intentionally cannot prove
private networking, TLS handshakes, database permissions or ledger enforcement.
"""
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
STAGE_HOST = 'axiom-stage.mftintelligence.com'
STAGE_WORKER = 'mft-axiom-bootstrap'
PHASE2_WORKER = 'axiom-phase2-staging-db-preflight'
NEON_HOST = 'ep-shiny-violet-beinhrc2.c-9.us-east-2.aws.neon.tech'
API = 'https://api.cloudflare.com/client/v4'
PATHS = {
    'domains': f'/accounts/{ACCOUNT}/workers/domains',
    'stage_worker': f'/accounts/{ACCOUNT}/workers/scripts/{STAGE_WORKER}/settings',
    'phase2_worker': f'/accounts/{ACCOUNT}/workers/scripts/{PHASE2_WORKER}/settings',
    'hyperdrive': f'/accounts/{ACCOUNT}/hyperdrive/configs?page=1&per_page=100',
}
OUTPUT = 'axiom-phase2-hyperdrive-binding-readonly.json'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_fixed(path, token):
    dynamic = re.fullmatch(
        rf'/accounts/{ACCOUNT}/workers/scripts/[a-z0-9][a-z0-9_-]{{0,79}}/settings', path)
    if (path not in PATHS.values() and not dynamic) or not isinstance(token, str) or not token or any(x in token for x in '\r\n'):
        raise ValueError('INVALID_FIXED_GET')
    req = urllib.request.Request(API + path, method='GET', headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
        'User-Agent': 'AXIOM-PHASE2-CF-METADATA-GET-ONLY/20261109',
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as response:
            code = response.status
            raw = response.read(800001)
    except urllib.error.HTTPError as exc:
        code = exc.code
        raw = exc.read(800001)
    except (OSError, TimeoutError, ValueError):
        return {'http': 'NETWORK_ERROR', 'data': None, 'info': None}
    if len(raw) > 800000:
        return {'http': code, 'data': None, 'info': None}
    try:
        envelope = json.loads(raw)
    except (ValueError, UnicodeError):
        envelope = None
    if not isinstance(envelope, dict) or envelope.get('success') is not True or code != 200:
        return {'http': code, 'data': None, 'info': None}
    return {'http': code, 'data': envelope.get('result'), 'info': envelope.get('result_info')}


def safe_binding_counts(status):
    if status.get('http') != 200 or not isinstance(status.get('data'), dict):
        return None, None, []
    bindings = status['data'].get('bindings')
    if not isinstance(bindings, list) or any(not isinstance(x, dict) for x in bindings):
        return None, None, []
    refs = [x.get('id') for x in bindings if x.get('type') == 'hyperdrive' and isinstance(x.get('id'), str)]
    hyperdrive_count = sum(x.get('type') == 'hyperdrive' for x in bindings)
    return len(bindings), hyperdrive_count, refs


def exact_attached_worker_path(domains):
    if domains.get('http') != 200 or not isinstance(domains.get('data'), list):
        return None
    rows = domains['data']
    if not all(isinstance(x, dict) for x in rows):
        return None
    matches = [x for x in rows if x.get('hostname') == STAGE_HOST]
    if len(matches) != 1:
        return None
    name = matches[0].get('service')
    if not isinstance(name, str) or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,79}', name):
        return None
    return f'/accounts/{ACCOUNT}/workers/scripts/{name}/settings'


def summarize(observed):
    """Only permit exact whitelisted fields to leave the runner. No raw JSON."""
    statuses = {k: observed[k].get('http') for k in PATHS}
    out = {
        'schema': 'AXIOM_PHASE2_HYPERDRIVE_METADATA_READONLY_V1',
        'scope': 'AXIOM_PHASE2_STAGE_KNOWN_ACCOUNT_AND_TWO_KNOWN_WORKERS',
        'methods': ['GET'], 'api_requests': len(PATHS) + int(observed.get('_attached_extra_read', False)), 'cloudflare_writes': 0,
        'neon_sql_queries': 0, 'provider_paid_calls': 0, 'secrets_exposed': False,
        'staging_connection_qualified': False, 'private_network_verified': False,
        'provider_http_status': statuses,
    }
    domains = observed['domains'].get('data')
    if statuses['domains'] == 200 and isinstance(domains, list) and all(isinstance(x, dict) for x in domains):
        matches = [x for x in domains if x.get('hostname') == STAGE_HOST]
        out['exact_stage_domain_matches_on_page'] = len(matches)
        out['stage_domain_maps_to_expected_worker'] = len(matches) == 1 and matches[0].get('service') == STAGE_WORKER
    else:
        out['exact_stage_domain_matches_on_page'] = None
        out['stage_domain_maps_to_expected_worker'] = None
    for key in ('stage_worker', 'phase2_worker'):
        count, hyper, refs = safe_binding_counts(observed[key])
        out[key + '_binding_count'] = count
        out[key + '_hyperdrive_binding_count'] = hyper
        # Only non-secret IDs are compared in memory; they never enter the report.
        observed[key]['_hyperdrive_references'] = refs
    attached = observed.get('attached_worker')
    if attached is None and out['stage_domain_maps_to_expected_worker'] is True:
        attached = observed['stage_worker']
    if attached is None:
        attached = {'http': 'NOT_PROBED', 'data': None}
    count, hyper, refs = safe_binding_counts(attached)
    out['attached_worker_http'] = attached.get('http')
    out['attached_worker_binding_count'] = count
    out['attached_worker_hyperdrive_binding_count'] = hyper
    out['attached_worker_hyperdrive_references_resolved'] = None
    configs = observed['hyperdrive'].get('data')
    info = observed['hyperdrive'].get('info')
    first_page_valid = statuses['hyperdrive'] == 200 and isinstance(configs, list) and all(isinstance(x, dict) for x in configs)
    out['hyperdrive_first_page_count'] = len(configs) if first_page_valid else None
    complete = (first_page_valid
                and all(isinstance(x, dict) for x in configs)
                and isinstance(info, dict) and type(info.get('page')) is int
                and info.get('page') == 1 and
                ((info.get('total_pages') == 1) or (type(info.get('total_count')) is int and info.get('total_count') == len(configs)))
                and type(info.get('count')) is int and info.get('count') == len(configs))
    out['hyperdrive_inventory_complete'] = complete
    out['hyperdrive_config_count'] = len(configs) if complete else None
    out['configured_neon_host_match_count'] = (sum(isinstance(x.get('origin'), dict) and
        x['origin'].get('host') == NEON_HOST for x in configs) if complete else None)
    for worker in ('stage_worker', 'phase2_worker'):
        refs = observed[worker]['_hyperdrive_references']
        if complete and out[worker + '_hyperdrive_binding_count'] is not None:
            ids = {x.get('id') for x in configs if isinstance(x.get('id'), str)}
            out[worker + '_binding_refs_resolved_in_account'] = all(x in ids for x in refs)
        else:
            out[worker + '_binding_refs_resolved_in_account'] = None
    if complete and hyper is not None:
        ids = {x.get('id') for x in configs if isinstance(x.get('id'), str)}
        out['attached_worker_hyperdrive_references_resolved'] = len(refs) == hyper and all(ref in ids for ref in refs)
    if (out['exact_stage_domain_matches_on_page'] == 1
        and out['attached_worker_hyperdrive_binding_count'] == 0
        and (statuses['phase2_worker'] == 404 or out['phase2_worker_hyperdrive_binding_count'] == 0)):
        out['classification'] = 'NO_HYPERDRIVE_BINDING_ON_LIVE_DOMAIN_AND_PHASE2_WORKERS'
    elif (out['attached_worker_hyperdrive_binding_count'] or out['phase2_worker_hyperdrive_binding_count']):
        out['classification'] = 'HYPERDRIVE_BINDING_PRESENT_BUT_CONNECTIVITY_UNQUALIFIED'
    else:
        out['classification'] = 'INSUFFICIENT_METADATA_TO_CLASSIFY_BINDINGS'
    return out


def run(token, fetch=fetch_fixed):
    if not isinstance(token, str) or not token or '\r' in token or '\n' in token:
        raise RuntimeError('SCOPED_READ_TOKEN_MISSING_OR_INVALID')
    observed = {label: fetch(path, token) for label, path in PATHS.items()}
    attached_path = exact_attached_worker_path(observed['domains'])
    observed['_attached_extra_read'] = False
    if attached_path:
        if attached_path in PATHS.values():
            label = next(k for k, v in PATHS.items() if v == attached_path)
            observed['attached_worker'] = observed[label]
        else:
            observed['attached_worker'] = fetch(attached_path, token)
            observed['_attached_extra_read'] = True
    return summarize(observed)


def main():
    try:
        state = run(os.environ.get('CLOUDFLARE_API_TOKEN', ''))
    except Exception:
        # Never include raw HTTP exceptions: some contain URL or headers.
        state = {'schema': 'AXIOM_PHASE2_HYPERDRIVE_METADATA_READONLY_V1',
                 'classification': 'READONLY_CHECK_FAILED_NO_GO',
                 'staging_connection_qualified': False, 'private_network_verified': False,
                 'methods': ['GET'], 'cloudflare_writes': 0, 'neon_sql_queries': 0}
    data = (json.dumps(state, sort_keys=True, indent=2) + '\n').encode()
    path = Path(OUTPUT)
    path.write_bytes(data)
    path.with_name(OUTPUT + '.sha256').write_text(hashlib.sha256(data).hexdigest() + '  ' + OUTPUT + '\n')
    print('HYPERDRIVE_METADATA_CHECK=' + state['classification'] + ' NETWORK_CHANGES=0 SQL=0')
    return 0 if state['classification'] not in ('READONLY_CHECK_FAILED_NO_GO',) else 1


if __name__ == '__main__':
    raise SystemExit(main())
