#!/usr/bin/env python3
"""MUSITU Studio V0.3 — authenticated Cloudflare READ-ONLY release preflight.

Absolutely no Cloudflare writes, database rows, buckets, staff identities, secrets,
customer payloads, connection strings, or Provider response bodies emitted.
This is NEVER a production cutover/approval, only a privacy-safe NO-GO receipt.
"""
from __future__ import annotations
import datetime as dt
import json
import os
import pathlib
import re
import urllib.error
import urllib.request

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
ORIGIN = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT
WORKER = 'musitu-studio-v03-do'
SAFE_PATHS = {
    f'/workers/scripts/{WORKER}/settings',
    '/hyperdrive/configs?per_page=100',
    '/cfd_tunnel?per_page=100&is_deleted=false',
}
GATES = (
    'authenticated_owner_source_export','live_sqlite_do_pitr_restore',
    'frozen_source_rows_and_hmacs','all_r2_object_integrity',
    'neon_private_least_privilege_transport','signed_staff_neon_browser_e2e',
    'hosted_neon_imported_data_restore','durable_real_route_cas_and_rollback',
    'neon_organization_hard_spend_cap','modal_provider_zero_bill_cap',
)


def safe_get(path: str, token: str) -> dict:
    """GET only; opaque error codes, never retain provider response or URLs."""
    if path not in SAFE_PATHS:
        raise ValueError('STUDIO_UNLISTED_READONLY_ENDPOINT')
    if not token:
        return {'status': 0, 'result': None}
    req = urllib.request.Request(ORIGIN + path,
        headers={'Authorization': 'Bearer ' + token,
                 'Accept': 'application/json'}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            status = response.status
            data = json.load(response)
        if not isinstance(data, dict) or data.get('success') is not True:
            return {'status': status, 'result': None}
        return {'status': status, 'result': data.get('result')}
    except urllib.error.HTTPError as error:
        return {'status': error.code, 'result': None}
    except (OSError, ValueError, TimeoutError):
        return {'status': 0, 'result': None}


def summarize_cf(provider_get) -> dict:
    """Privacy-preserving parser. Hyperdrive existence is NOT path validation."""
    settings = provider_get(f'/workers/scripts/{WORKER}/settings')
    hyperdrive = provider_get('/hyperdrive/configs?per_page=100')
    tunnels = provider_get('/cfd_tunnel?per_page=100&is_deleted=false')
    settings_value = settings.get('result')
    if not isinstance(settings_value, dict):
        settings_value = {}
    bindings = settings_value.get('bindings')
    bindings = bindings if isinstance(bindings, list) else []
    bindings = [b for b in bindings if isinstance(b, dict)]
    binding_matches = lambda name, kind: any(
        b.get('name') == name and b.get('type') == kind for b in bindings)
    vars = {b.get('name'): b.get('text') for b in bindings
            if b.get('type') == 'plain_text' and isinstance(b.get('name'), str)}
    hd = hyperdrive.get('result')
    hd = hd if isinstance(hd, list) else []
    private_hyperdrive_count = 0
    for entry in hd:
        if not isinstance(entry, dict):
            continue
        origin = entry.get('origin')
        if isinstance(origin, dict) and isinstance(origin.get('service_id'), str):
            if re.fullmatch('[a-zA-Z0-9_-]{4,128}', origin['service_id']):
                private_hyperdrive_count += 1
    tl = tunnels.get('result')
    tl = tl if isinstance(tl, list) else []
    return {
        'cloudflare_worker_settings_http_status': settings.get('status', 0),
        'cloudflare_hyperdrive_list_http_status': hyperdrive.get('status', 0),
        'cloudflare_tunnel_list_http_status': tunnels.get('status', 0),
        'live_sqlite_do_binding_observed': binding_matches('STUDIO_LEDGER', 'durable_object_namespace'),
        'existing_r2_binding_observed': binding_matches('STUDIO_ASSETS', 'r2_bucket'),
        'rendering_disabled_in_runtime': (vars.get('ENABLE_RENDER_DISPATCH') == 'false' and
            vars.get('GPU_EXECUTION_APPROVED') == 'false' and
            vars.get('BUDGET_GUARD_APPROVED') == 'false'),
        'hyperdrive_vpc_candidate_count': private_hyperdrive_count,
        'tunnel_metadata_count': len([x for x in tl if isinstance(x, dict)]),
        'private_transport_independently_verified': False,
        'provider_mutated': False,
    }


def evaluate(provider_get, source_head: str) -> dict:
    if not isinstance(source_head, str) or not re.fullmatch('[0-9a-f]{40}', source_head):
        raise ValueError('STUDIO_SOURCE_SHA_REQUIRED')
    details = summarize_cf(provider_get)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    return {
        'schema': 'musitu.studio.v03.release.no-go.readonly.v1',
        'checked_at_utc': now,
        'source_head': source_head,
        'production_cutover_allowed': False,
        'decision': 'NO_GO',
        'existing_sqlite_do_remains_production': True,
        'customer_data_exported': False,
        'customer_payloads_or_secrets_logged': False,
        'no_provider_writes': True,
        'provider': details,
        # All default FALSE in absence of real independently attested hosted receipts.
        'release_gates': {g: {'provider_proven': False} for g in GATES},
        'blocked_gate_count': len(GATES),
        'meaning': ('A settings/bindings inventory or Hyperdrive service candidate is not '
                    'proof of private Neon connectivity, complete data export, '
                    'restored real snapshots, signed staff E2E or enforced dollar cap.'),
    }


def main():
    head = os.environ.get('GITHUB_SHA', '')
    token = os.environ.get('CLOUDFLARE_API_TOKEN') or os.environ.get('CF_API_TOKEN', '')
    report = evaluate(lambda path: safe_get(path, token), head)
    out = pathlib.Path(os.environ.get('STUDIO_NO_GO_REPORT_PATH',
                                     'STUDIO_RELEASE_GATE_READONLY_20261022.json'))
    out.write_text(json.dumps(report, sort_keys=True, indent=2) + '\n')
    # Output limited to non-sensitive counts, booleans and HTTP status codes.
    print('STUDIO_READONLY_NEON_RELEASE_GATE=' + json.dumps({
        'source_head': report['source_head'],
        'decision': report['decision'],
        'blocked_gates': report['blocked_gate_count'],
        'do_binding': report['provider']['live_sqlite_do_binding_observed'],
        'r2_binding': report['provider']['existing_r2_binding_observed'],
        'rendering_off': report['provider']['rendering_disabled_in_runtime'],
        'vpc_hyperdrive_candidates': report['provider']['hyperdrive_vpc_candidate_count'],
        'no_provider_writes': True,
    }, sort_keys=True))


if __name__ == '__main__':
    main()
