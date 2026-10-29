"""Offline semantic reconciliation of Connect-specific Paynow TEST exports only.

The input is an *untrusted* operator-provided synthetic/sandbox snapshot.
Even a consistent export NEVER proves merchant authenticity, money movement,
invoice validity, settlement, human financial approval or commercial GA.
Only hashed references enter; results intentionally contain no row-level IDs.
"""
from __future__ import annotations
from collections import Counter
import json
import re

SCHEMA = 'musitu.connect.ga_paynow_sandbox_reconcile.v1'
MAX_ITEMS = 200
MAX_BYTES = 65_536
HASH = re.compile(r'[0-9a-f]{64}\Z')
COLLECTIONS = ('provider', 'intents', 'invoices', 'refunds', 'entitlements')
STATUSES = {
    'provider': frozenset(('paid','refunded','cancelled','failed','pending')),
    'intents': frozenset(('paid','refunded','cancelled','failed','pending')),
    'invoices': frozenset(('issued','credited')),
    'refunds': frozenset(('processed',)),
}


def _report(status, categories=(), items=0):
    return {
        'schema': 'musitu.connect.ga_paynow_sandbox_reconciliation_observation.v1',
        'status': status,
        'mismatch_categories': sorted(set(categories)),
        'items_checked': items,
        'provider_original_authenticated': False,
        'finance_independently_approved': False,
        'commercial_ga_qualified': False,
        'customer_admission': False,
        'real_money_moved': False,
        'raw_identifiers_shared': False,
    }


def _validate(bundle):
    if not isinstance(bundle, dict) or set(bundle) != set(COLLECTIONS) | {'schema','mode'}:
        return False
    if bundle.get('schema') != SCHEMA or bundle.get('mode') != 'PAYNOW_TEST_MODE':
        return False
    try:
        if len(json.dumps(bundle, allow_nan=False, ensure_ascii=True).encode()) > MAX_BYTES:
            return False
    except (TypeError, ValueError, OverflowError, RecursionError):
        return False
    if not isinstance(bundle['provider'], list) or not bundle['provider']:
        return False
    for name in COLLECTIONS:
        rows = bundle[name]
        if not isinstance(rows, list) or len(rows) > MAX_ITEMS:
            return False
        expected = ({'reference_sha256', 'active'} if name == 'entitlements'
                    else {'reference_sha256','status','amount_cents','currency'})
        for row in rows:
            if not isinstance(row, dict) or set(row) != expected:
                return False
            ref = row['reference_sha256']
            if not isinstance(ref, str) or not HASH.fullmatch(ref):
                return False
            if name == 'entitlements':
                if type(row['active']) is not bool:
                    return False
            else:
                if (row['status'] not in STATUSES[name]
                        or type(row['amount_cents']) is not int
                        or not 1 <= row['amount_cents'] <= 1_000_000_000
                        or row['currency'] != 'USD'):
                    return False
    return True


def assess(bundle):
    """Compare local test-export semantics without authenticating external data."""
    if not _validate(bundle):
        return _report('OFFLINE_INPUT_REJECTED')
    mismatches = set()
    tables = {}
    for name in COLLECTIONS:
        counts = Counter(row['reference_sha256'] for row in bundle[name])
        if any(count > 1 for count in counts.values()):
            mismatches.add('DUPLICATE_'+name.upper()+'_REFERENCE')
        tables[name] = {row['reference_sha256']: row for row in bundle[name]}

    provider, intents, invoices, refunds, grants = (tables[k] for k in COLLECTIONS)
    for ref in provider:
        pay = provider[ref]
        intent = intents.get(ref)
        invoice = invoices.get(ref)
        refund = refunds.get(ref)
        grant = grants.get(ref)
        if intent is None:
            mismatches.add('MISSING_INTENT')
            continue
        if pay['status'] != intent['status']:
            mismatches.add('STATE_CONFLICT')
        for peer in (intent, invoice, refund):
            if peer is not None and (
                    peer['amount_cents'] != pay['amount_cents']
                    or peer['currency'] != pay['currency']):
                mismatches.add('AMOUNT_OR_CURRENCY_CONFLICT')
        paid = pay['status'] == 'paid'
        refunded = pay['status'] == 'refunded'
        if paid:
            if invoice is None or invoice['status'] != 'issued':
                mismatches.add('INVOICE_CONFLICT')
            if refund is not None:
                mismatches.add('REFUND_CONFLICT')
            if grant is None or grant['active'] is not True:
                mismatches.add('ENTITLEMENT_CONFLICT')
        elif refunded:
            if invoice is None or invoice['status'] != 'credited':
                mismatches.add('INVOICE_CONFLICT')
            if refund is None or refund['status'] != 'processed':
                mismatches.add('REFUND_CONFLICT')
            if grant is not None and grant['active'] is not False:
                mismatches.add('ENTITLEMENT_CONFLICT')
        else:
            if invoice is not None:
                mismatches.add('INVOICE_CONFLICT')
            if refund is not None:
                mismatches.add('REFUND_CONFLICT')
            if grant is not None and grant['active'] is not False:
                mismatches.add('ENTITLEMENT_CONFLICT')
    for name in ('intents', 'invoices', 'refunds', 'entitlements'):
        if set(tables[name]) - set(provider):
            mismatches.add('ORPHAN_'+name.upper()+'_REFERENCE')
    return _report(
        'OFFLINE_INCONSISTENT_NOT_FINANCE_CERTIFIED'
        if mismatches else 'OFFLINE_CONSISTENT_NOT_FINANCE_CERTIFIED',
        mismatches, len(provider),
    )
