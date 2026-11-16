#!/usr/bin/env python3
"""MUSITU AXIOM Gate1: read-only Cloudflare billing/owner-authority preflight.

No SQL, D1 writes, private keys, account settings, rate-limit changes, invoices,
provider mutations or release authority. All provider responses are sanitized
before writing a receipt. Testable without a provider token via injected getter.
"""
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ACCOUNT = '93f395f5121954671f92fffa453d6b61'
SOURCE = 'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
POLICIES = '/billing/spend-policies'
CYCLE = '/billable-usage/info'
USAGE = '/billable-usage'
SUBSCRIPTIONS = '/subscriptions'
ALLOWED = frozenset((POLICIES, CYCLE, USAGE, SUBSCRIPTIONS))
OUTPUT = 'axiom_step1_gate1_billing_authority_readonly_20261113.json'
SCHEMA = 'musitu.axiom.step1.gate1-billing-authority-readonly.v1'
MAX_JSON = 400_000
UTC = timezone.utc


class NoGo(Exception):
    pass


def demand(ok, reason):
    if not ok:
        raise NoGo(reason)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def cloudflare_get(token, path):
    demand(path in ALLOWED, 'UNAPPROVED_HTTP_PATH')
    demand(isinstance(token, str) and len(token) > 0 and not any(x in token for x in '\r\n'), 'TOKEN_NOT_AVAILABLE')
    request = urllib.request.Request(
        'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + path,
        method='GET', headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=18) as response:
            demand(response.status == 200, 'PROVIDER_NON_200')
            data = response.read(MAX_JSON + 1)
            demand(len(data) <= MAX_JSON, 'PROVIDER_RESPONSE_TOO_LARGE')
            body = json.loads(data)
            demand(isinstance(body, dict) and body.get('success') is True, 'PROVIDER_ENVELOPE_INVALID')
            return body
    except urllib.error.HTTPError as exc:
        # Only the HTTP status is recorded; never include provider error bodies.
        raise NoGo('HTTP_' + str(exc.code)) from None
    except (urllib.error.URLError, ValueError, UnicodeError, TimeoutError, OSError):
        raise NoGo('PROVIDER_UNAVAILABLE') from None


def _base_receipt(now):
    return dict(
        schema=SCHEMA,
        captured_at_utc=now.astimezone(UTC).isoformat(),
        cloudflare_account=ACCOUNT,
        original_d1_uuid=SOURCE,
        operation='GET_ONLY_NO_MUTATION_NO_SQL_NO_CUSTOMER_ROWS',
        spend_policies_http='UNREAD',
        spend_policies_catalog_qualified=False,
        spend_policies_count=None,
        workers_usage_block_policy_present=False,
        durable_objects_usage_block_policy_present=False,
        d1_usage_block_policy_present=False,
        workers_usage_block_effectively_proven=False,
        d1_hard_zero_spend_provider_guarantee_qualified=False,
        # Workers and Durable Object spend-policy API cannot prove D1-specific zero overage.
        d1_absent_from_documented_spend_policy_product_scope=True,
        documented_minimum_spend_policy_threshold_us_cents=1,
        billing_cycle_http='UNREAD',
        billing_cycle_anchor_seen=False,
        billing_cycle_coverage_reported=False,
        rated_usage_http='UNREAD',
        rated_usage_records=None,
        rated_usage_zero_billed_cost_snapshot_qualified=False,
        subscriptions_http='UNREAD',
        workers_paid_active=False,
        source_database_authentication_previous_readonly_evidence_only=True,
        actual_owner_mfa_independently_qualified=False,
        owner_public_trust_pins_independently_activated=False,
        owner_signed_proposal_authorizes_d1_mutation=False,
        provider_d1_target_creation_authorized=False,
        customer_data_export_authorized=False,
        customer_data_restore_authorized=False,
        no_additional_spend_contract_verified=False,
        original_pr216_two_signer_runtime_unchanged=True,
        historical_independent_custody_result='UNMET_POLICY_SUPERSEDED_NOT_PASS',
        b27_synthetic_cas_result='FAIL', pr83_fullstack_result='FAIL',
        gate1_closed=False, step1_closed=False, step2_authorized=False,
        release_authorized=False, release_status='NOT_RELEASE',
        status='GATE1_PROVIDER_ZERO_SPEND_AND_OWNER_AUTHORITY_NO_GO',
    )


def _safe_get(get, token, path, receipt, label):
    try:
        doc = get(token, path)
        demand(isinstance(doc, dict) and doc.get('success') is True, 'PROVIDER_ENVELOPE_INVALID')
        receipt[label + '_http'] = 200
        return doc
    except NoGo as exc:
        # Error identifiers only; exceptions never include provider bodies/secrets.
        receipt[label + '_http'] = str(exc)
        return None
    except (ValueError, TypeError, KeyError):
        receipt[label + '_http'] = 'PROVIDER_RESPONSE_INVALID'
        return None


def _summarize_policies(doc, receipt):
    if doc is None:
        return
    entries = doc.get('result')
    if not isinstance(entries, list) or len(entries) > 1000:
        receipt['spend_policies_http'] = 'PROVIDER_POLICY_SHAPE_INVALID'
        return
    product_set = {'workers', 'durable_objects'}
    worker_block = False
    do_block = False
    for item in entries:
        if not isinstance(item, dict):
            receipt['spend_policies_http'] = 'PROVIDER_POLICY_SHAPE_INVALID'
            return
        action = item.get('action')
        product = item.get('product_id')
        threshold = item.get('threshold_cents')
        enabled = item.get('enabled')
        if action not in ('usage_block', 'notification') or product not in product_set or type(threshold) is not int or threshold < 1 or type(enabled) is not bool:
            receipt['spend_policies_http'] = 'UNRECOGNIZED_POLICY_SCOPE_OR_SHAPE'
            return
        if enabled and action == 'usage_block':
            if product == 'workers':
                worker_block = True
            if product == 'durable_objects':
                do_block = True
    receipt['spend_policies_count'] = len(entries)
    receipt['workers_usage_block_policy_present'] = worker_block
    receipt['durable_objects_usage_block_policy_present'] = do_block
    receipt['spend_policies_catalog_qualified'] = True
    # We intentionally never claim a usage_block has reached the edge or that
    # it would protect D1, even when the API returns an enforcement object.


def _summarize_cycle(doc, receipt):
    if doc is None:
        return
    result = doc.get('result')
    if not isinstance(result, dict):
        receipt['billing_cycle_http'] = 'BILLING_INFO_RESPONSE_INVALID'
        return
    covered = result.get('covered')
    subs = result.get('subscriptions')
    if type(covered) is not bool or not isinstance(subs, list):
        receipt['billing_cycle_http'] = 'BILLING_INFO_RESPONSE_INVALID'
        return
    receipt['billing_cycle_coverage_reported'] = covered
    receipt['billing_cycle_anchor_seen'] = any(
        isinstance(x, dict) and isinstance(x.get('billing_cycle_anchor_timestamp'), str)
        and re.fullmatch(r'20\d\d-\d\d-\d\dT[^ ]+', x['billing_cycle_anchor_timestamp'])
        for x in subs)


def _summarize_usage(doc, receipt):
    if doc is None:
        return
    rows = doc.get('result')
    if not isinstance(rows, list) or len(rows) > 5000:
        receipt['rated_usage_http'] = 'BILLING_USAGE_RESPONSE_INVALID'
        return
    # Billing numbers, descriptions and customer/account identifiers NEVER
    # leave process memory into logs or artifacts.
    receipt['rated_usage_records'] = len(rows)
    if rows and all(isinstance(x, dict) and type(x.get('BilledCost')) in (int, float)
                    and x['BilledCost'] == 0 for x in rows):
        receipt['rated_usage_zero_billed_cost_snapshot_qualified'] = True
    # This is not a hard future $0 guarantee and includes no invoice review.


def _summarize_subscriptions(doc, receipt):
    if doc is None:
        return
    rows = doc.get('result')
    if not isinstance(rows, list):
        receipt['subscriptions_http'] = 'SUBSCRIPTION_RESPONSE_INVALID'
        return
    for sub in rows:
        if not isinstance(sub, dict):
            continue
        rate = sub.get('rate_plan') or {}
        if isinstance(rate, dict) and any('worker' in str(rate.get(k, '')).lower() for k in ('id', 'name')):
            receipt['workers_paid_active'] = receipt['workers_paid_active'] or sub.get('state') == 'Paid'


def audit(get=cloudflare_get, token=None, now=None):
    if now is None:
        now = datetime.now(UTC)
    demand(isinstance(now, datetime) and now.tzinfo is not None, 'CLOCK_WITHOUT_TIMEZONE')
    if token is None:
        token = os.getenv('CLOUDFLARE_API_TOKEN', '')
    receipt = _base_receipt(now)
    _summarize_policies(_safe_get(get, token, POLICIES, receipt, 'spend_policies'), receipt)
    _summarize_cycle(_safe_get(get, token, CYCLE, receipt, 'billing_cycle'), receipt)
    _summarize_usage(_safe_get(get, token, USAGE, receipt, 'rated_usage'), receipt)
    _summarize_subscriptions(_safe_get(get, token, SUBSCRIPTIONS, receipt, 'subscriptions'), receipt)
    # Non-authorizing invariant: obtaining 200 responses, paid plan, $0 usage
    # snapshot or an enabled Worker cap NEVER establishes a D1 hard $0 cap.
    demand(receipt['gate1_closed'] is False and receipt['provider_d1_target_creation_authorized'] is False and
           receipt['d1_hard_zero_spend_provider_guarantee_qualified'] is False and
           receipt['release_status'] == 'NOT_RELEASE', 'RELEASE_GATE_TAMPERED')
    return receipt


def main():
    result = audit()
    payload = (json.dumps(result, indent=2, sort_keys=True) + '\n').encode('utf-8')
    path = Path(OUTPUT)
    path.write_bytes(payload)
    path.with_suffix('.json.sha256').write_text(hashlib.sha256(payload).hexdigest() + '  ' + OUTPUT + '\n', encoding='utf-8')
    print('AXIOM_STEP1_GATE1_READONLY_BILLING_AUTHORITY_NO_GO_NOT_RELEASE')
    for k in ('spend_policies_http','spend_policies_catalog_qualified','spend_policies_count',
              'workers_usage_block_policy_present','durable_objects_usage_block_policy_present',
              'billing_cycle_http','billing_cycle_anchor_seen','rated_usage_http','rated_usage_records',
              'rated_usage_zero_billed_cost_snapshot_qualified','subscriptions_http','workers_paid_active'):
        print(k + '=' + str(result[k]))


if __name__ == '__main__':
    main()
