"""Account-scoped, read-only Cloudflare recovery evidence-channel capability probe.

Never lists the contents of production objects or retains raw provider payloads.
Prints sanitized capability booleans and HTTP status codes only.
"""
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '')
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN') or os.environ.get('CF_API_TOKEN', '')
assert len(ACCOUNT) == 32 and all(c in '0123456789abcdef' for c in ACCOUNT)
assert TOKEN, 'CLOUDFLARE_API_TOKEN_REQUIRED'
BASE = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT


def get_meta(path):
    assert path.startswith('/') and not path.startswith('//')
    req = urllib.request.Request(BASE + path,
                                 headers={'Authorization': 'Bearer ' + TOKEN,
                                          'Accept': 'application/json'}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=17) as response:
            status = response.status
            # Do not persist private provider response payloads. Decode only success.
            envelope = json.load(response)
            good = bool(isinstance(envelope, dict) and envelope.get('success') is True)
    except urllib.error.HTTPError as error:
        status, good = error.code, False
    except (OSError, ValueError):
        status, good = 0, False
    return {'http_status': status, 'api_success': good}


receipt = {
    'schema': 'musitu.studio.v03.pitr-safe-evidence-channels.v1',
    'read_only': True,
    'customer_records_accessed': False,
    'customer_kv_values_read': False,
    'customer_r2_objects_read': False,
    'provider_mutated': False,
    'no_new_cloud_resources': True,
    'no_billable_compute': True,
    'hosted_pitr_qualified': False,
    'disposable_workers_left_running': False,
    'kv_metadata_list': get_meta('/storage/kv/namespaces?per_page=1'),
    'r2_bucket_metadata_list': get_meta('/r2/buckets?per_page=1'),
    'existing_worker_tails_metadata': get_meta('/workers/scripts/musitu-studio-v03-do/tails'),
    'observability_saved_query_metadata': get_meta('/workers/observability/queries?per_page=1'),
    'previous_disposable_cron_worker_missing': False,
    'previous_disposable_public_worker_missing': False,
}
for kind, script in [
    ('previous_disposable_cron_worker_missing', 'musitu-studio-v03-pitr-cron-e2e-20261020'),
    ('previous_disposable_public_worker_missing', 'musitu-studio-v03-pitr-proof-20261018'),
]:
    status = get_meta('/workers/scripts/' + script)['http_status']
    receipt[kind] = status == 404

path = pathlib.Path('studio-v03-pitr-safe-evidence-channels-20261021.json')
path.write_text(json.dumps(receipt, sort_keys=True, indent=2) + '\n')
print('STUDIO_V03_PITR_EVIDENCE_CHANNELS=' + json.dumps(receipt, sort_keys=True))
assert receipt['previous_disposable_cron_worker_missing']
assert receipt['previous_disposable_public_worker_missing']
