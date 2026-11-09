"""One-use, credential-safe Cloudflare control-plane inspection for AXIOM Phase 2.

Only four preapproved GET paths are queried. This intentionally cannot prove
private networking, TLS handshakes, database permissions or ledger enforcement.
"""
import hashlib
import json
import os
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
    if path not in PATHS.values() or not isinstance(token, str) or not token or any(x in token for x in '\r\n'):
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


def summarize(observed):
    """Only permit exact whitelisted fields to leave the runner. No raw JSON."""
    statuses = {k: observed[k].get('http') for k in PATHS}
    out = {
        'schema': 'AXIOM_PHASE2_HYPERDRIVE_METADATA_READONLY_V1',
        'scope': 'AXIOM_PHASE2_STAGE_KNOWN_ACCOUNT_AND_TWO_KNOWN_WORKERS',
        'methods': ['GET'], 'api_requests': len(PATHS), 'cloudflare_writes': 0,
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
    configs = observed['hyperdrive'].get('data')
    info = observed['hyperdrive'].get('info')
    complete = (statuses['hyperdrive'] == 200 and isinstance(configs, list)
                and all(isinstance(x, dict) for x in configs)
                and isinstance(info, dict) and type(info.get('page')) is int
                and info.get('page') == 1 and info.get('total_pages') == 1
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
    if (out['stage_domain_maps_to_expected_worker'] is True
        and out['stage_worker_hyperdrive_binding_count'] == 0
        and (statuses['phase2_worker'] == 404 or out['phase2_worker_hyperdrive_binding_count'] == 0)):
        out['classification'] = 'NO_HYPERDRIVE_BINDING_ON_OBSERVED_STAGE_AND_PHASE2_WORKERS'
    elif (out['stage_worker_hyperdrive_binding_count'] or out['phase2_worker_hyperdrive_binding_count']):
        out['classification'] = 'HYPERDRIVE_BINDING_PRESENT_BUT_CONNECTIVITY_UNQUALIFIED'
    else:
        out['classification'] = 'INSUFFICIENT_METADATA_TO_CLASSIFY_BINDINGS'
    return out


def run(token, fetch=fetch_fixed):
    if not isinstance(token, str) or not token or '\r' in token or '\n' in token:
        raise RuntimeError('SCOPED_READ_TOKEN_MISSING_OR_INVALID')
    observed = {label: fetch(path, token) for label, path in PATHS.items()}
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
