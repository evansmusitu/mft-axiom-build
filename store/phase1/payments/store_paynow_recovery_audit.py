"""Read-only, OFFLINE Store V2 Paynow observation snapshot qualification.

Runs on a *local SQLite file* only. No connection strings, HTTP endpoints,
Paynow access, customer identities, payment processing or migration authority.
A successful audit is integrity evidence, not a signature, settlement receipt,
real database acceptance, marketplace approval or permission to deploy.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
import sqlite3
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
STORE_SCHEMA = HERE / 'store-axiom-checkout-schema.sql'
OBS_SCHEMA = HERE / 'store-paynow-status-observations.candidate.sql'
OBS_COLUMNS = ('event_id', 'reference', 'paynow_reference', 'provider_status',
               'amount_cents', 'currency', 'poll_url', 'callback_digest',
               'poll_digest', 'observed_at')



_HEX_SHA256 = re.compile(r'[0-9a-f]{64}\Z')
_UTC_TIMESTAMP = re.compile(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z\Z')


def _valid_observation_timestamp(value):
    if not isinstance(value,str) or not _UTC_TIMESTAMP.fullmatch(value):
        return False
    try:
        datetime.fromisoformat(value.replace('Z','+00:00'))
    except ValueError:
        return False
    return True


def _schema_manifest(db):
    return {name: (kind, table, text)
            for kind, name, table, text in db.execute(
                "SELECT type,name,tbl_name,sql FROM sqlite_master "
                "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")}


def _expected_manifest():
    with sqlite3.connect(':memory:') as reference:
        reference.execute('PRAGMA foreign_keys=ON')
        reference.executescript(STORE_SCHEMA.read_text(encoding='utf-8'))
        reference.executescript(OBS_SCHEMA.read_text(encoding='utf-8'))
        return _schema_manifest(reference)


def _result(failures, observations=0, reviews=0, fingerprint=None):
    # Deliberately return no actual order IDs, secret keys, provider refs,
    # customer identities, poll URLs, database paths, or sample record bodies.
    return {'qualified': not failures, 'scope':'local_sqlite_snapshot_only',
            'deployment_authorized':False, 'money_movement_authorized':False,
            'failures': sorted(set(failures)),
            'observations': observations, 'reviews': reviews,
            'observation_fingerprint_sha256': fingerprint}


def audit_snapshot(snapshot):
    """Fail closed on a local, read-only SQLite Store observation snapshot.

    Every database operation is a SELECT or read-only PRAGMA. Schema is
    independently derived from the exact quarantined SQL files. The
    fingerprint allows comparison of two snapshots; it is NOT an authenticity
    signature and cannot prove actual Paynow settlement or provider consent.
    """
    path = Path(snapshot)
    if not path.is_file():
        return _result(['snapshot_unavailable'])
    failures = set()
    try:
        db = sqlite3.connect('file:' + quote(str(path.resolve()), safe='/') + '?mode=ro',
                             uri=True, timeout=2)
    except (OSError, sqlite3.Error, ValueError):
        return _result(['snapshot_unavailable'])
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA foreign_keys=ON')
        check = db.execute('PRAGMA quick_check').fetchall()
        if check != [('ok',)]:
            failures.add('sqlite_integrity_failed')
        if db.execute('PRAGMA foreign_key_check').fetchone() is not None:
            failures.add('foreign_key_conflict')

        expected = _expected_manifest()
        actual = _schema_manifest(db)
        if any(actual.get(name) != entry for name, entry in expected.items()):
            failures.add('schema_drift')
        # Forbid unforeseen objects in this private Store-only schema. This
        # also catches a conflicting publisher/entitlement migration.
        if set(actual) - set(expected):
            failures.add('unreviewed_schema_object')
        needed = {'store_checkout_intents','store_checkout_reviews',
                  'store_paynow_status_observations'}
        if not needed.issubset(actual):
            return _result(failures | {'schema_drift'})

        count = db.execute('SELECT COUNT(*) FROM store_paynow_status_observations').fetchone()[0]
        reviews = db.execute('SELECT COUNT(*) FROM store_checkout_reviews').fetchone()[0]
        if count > 200_000:
            return _result(failures | {'snapshot_too_large'}, count, reviews)
        mismatched_order = db.execute('''
            SELECT 1 FROM store_paynow_status_observations AS o
            LEFT JOIN store_checkout_intents AS c ON o.reference=c.reference
            WHERE c.reference IS NULL OR o.amount_cents!=c.amount_cents
               OR o.currency!=c.currency OR o.poll_url!=c.poll_url
            LIMIT 1''').fetchone()
        if mismatched_order:
            failures.add('order_observation_identity_conflict')

        inconsistent_review = db.execute('''
            SELECT 1 FROM store_checkout_reviews AS r
            LEFT JOIN store_checkout_intents AS c ON c.reference=r.reference
            WHERE c.reference IS NULL OR c.status!=r.review_status
            UNION ALL
            SELECT 1 FROM store_checkout_intents AS c
            LEFT JOIN store_checkout_reviews AS r ON r.reference=c.reference
            WHERE c.status IN ('review_required','refund_review_required')
              AND (r.reference IS NULL OR r.review_status!=c.status)
            LIMIT 1''').fetchone()
        if inconsistent_review:
            failures.add('review_intent_state_conflict')

        seen_orders, seen_providers = {}, {}
        for source in ('store_paynow_status_observations','store_checkout_reviews'):
            for ref, provider in db.execute('SELECT reference,paynow_reference FROM '+source):
                if ref in seen_orders and seen_orders[ref]!=provider:
                    failures.add('provider_reference_conflict')
                if provider in seen_providers and seen_providers[provider]!=ref:
                    failures.add('provider_reference_conflict')
                seen_orders[ref]=provider
                seen_providers[provider]=ref

        statement = ('SELECT '+','.join(OBS_COLUMNS)+
                     ' FROM store_paynow_status_observations ORDER BY event_id')
        digest = hashlib.sha256()
        digest.update(b'MUSITU_STORE_V2_OBSERVATION_SNAPSHOT_V1\n')
        for row in db.execute(statement):
            (event_id,ref,provider,status,amount,currency,poll,cb,polled,at) = row
            if (not isinstance(ref,str) or not isinstance(provider,str) or
                not isinstance(cb,str) or not isinstance(polled,str) or
                event_id != 'evt-'+hashlib.sha256(
                    '\n'.join((ref,provider,cb,polled)).encode('utf-8')).hexdigest()):
                failures.add('observation_event_identity_conflict')
            if (not isinstance(amount,int) or amount<1 or amount>100000000 or
                currency!='USD' or status not in {'Created','Sent','Cancelled',
                  'Disputed','Awaiting Delivery','Delivered'} or
                not isinstance(provider,str) or not 3 <= len(provider) <= 80 or
                not isinstance(poll,str) or not 32 <= len(poll) <= 300 or
                not isinstance(cb,str) or not _HEX_SHA256.fullmatch(cb) or
                not isinstance(polled,str) or not _HEX_SHA256.fullmatch(polled) or
                not _valid_observation_timestamp(at)):
                failures.add('observation_field_conflict')
            digest.update(json.dumps(row,ensure_ascii=True,
                separators=(',',':')).encode('utf-8'))
            digest.update(b'\n')
        return _result(failures,count,reviews,digest.hexdigest())
    except (sqlite3.Error, TypeError, ValueError, OSError):
        return _result(failures | {'snapshot_invalid'})
    finally:
        db.close()



# Recovery qualification deliberately DOES NOT apply missing events or re-poll
# Paynow. The second snapshot is an operator-supplied comparison, not an
# attested source of truth. Every discrepancy requires independent evidence.
_RECOVERY_TABLES = (
    ('store_paynow_status_observations', 'event_id'),
    ('store_checkout_reviews', 'reference'),
    ('store_checkout_intents', 'reference'),
    ('store_products', 'sku'),
    ('store_customer_tokens', 'token_hash'),
)
_CHECKOUT_IDENTITY_FIELDS = ('reference', 'customer_id', 'sku', 'amount_cents',
                             'currency', 'created_at', 'expires_at')


def _read_snapshot_tables(path):
    """Read exact table rows into locally scoped memory, never into output."""
    uri = 'file:' + quote(str(Path(path).resolve()), safe='/') + '?mode=ro'
    with closing(sqlite3.connect(uri, uri=True, timeout=2)) as db:
        db.execute('PRAGMA query_only=ON')
        db.row_factory = sqlite3.Row
        result = {}
        for table, key in _RECOVERY_TABLES:
            count = db.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0]
            if count > 200_000:
                raise ValueError('snapshot table too large')
            rows = {}
            for row in db.execute('SELECT * FROM ' + table):
                r = dict(row)
                rows[r[key]] = r
            result[table] = rows
        return result


def compare_offline_snapshots(restored, later):
    """Produce redacted, fail-closed RPO delta. NEVER restore, replay or pay.

    `later` is merely a caller-asserted comparison snapshot. The results do
    not establish independent snapshot provenance, delivery, or settlement.
    """
    old_report, new_report = audit_snapshot(restored), audit_snapshot(later)
    base = {
        'scope': 'local_sqlite_snapshot_pair_only',
        'restore_authorized': False,
        'payment_authorized': False,
        'publisher_payout_authorized': False,
        'automatic_replay_authorized': False,
        'later_snapshot_provenance_verified': False,
        'provider_reconciliation_required': True,
    }
    if not old_report['qualified'] or not new_report['qualified']:
        return {**base, 'status': 'unqualified_snapshot',
                'restored_failures': old_report['failures'],
                'later_failures': new_report['failures']}
    try:
        old, new = _read_snapshot_tables(restored), _read_snapshot_tables(later)
    except (OSError, ValueError, sqlite3.Error, TypeError):
        return {**base, 'status': 'unqualified_snapshot',
                'restored_failures': ['snapshot_reinspection_failed'],
                'later_failures': ['snapshot_reinspection_failed']}

    obs='store_paynow_status_observations'
    reviews='store_checkout_reviews'
    intents='store_checkout_intents'
    summary = {
        'missing_observations': len(new[obs].keys() - old[obs].keys()),
        'restored_only_observations': len(old[obs].keys() - new[obs].keys()),
        'changed_existing_observations': sum(
            old[obs][key] != new[obs][key] for key in old[obs].keys() & new[obs].keys()),
        'missing_reviews': len(new[reviews].keys() - old[reviews].keys()),
        'restored_only_reviews': len(old[reviews].keys() - new[reviews].keys()),
        'changed_existing_reviews': sum(
            old[reviews][key] != new[reviews][key]
            for key in old[reviews].keys() & new[reviews].keys()),
        'missing_checkout_intents': len(new[intents].keys() - old[intents].keys()),
        'restored_only_checkout_intents': len(old[intents].keys() - new[intents].keys()),
        'changed_checkout_states': sum(
            old[intents][key]['status'] != new[intents][key]['status']
            for key in old[intents].keys() & new[intents].keys()),
        'changed_checkout_identities': sum(
            any(old[intents][key][field] != new[intents][key][field]
                for field in _CHECKOUT_IDENTITY_FIELDS)
            for key in old[intents].keys() & new[intents].keys()),
    }
    other_difference = False
    for table, _ in _RECOVERY_TABLES:
        if table not in (obs,reviews,intents) and old[table] != new[table]:
            other_difference = True
    # Even an allowed transition from pending to reviewed must be reconciled
    # by a human with original provider evidence; a snapshot is not approval.
    changed_other_intent_fields = any(
        old[intents][key] != new[intents][key]
        for key in old[intents].keys() & new[intents].keys())
    conflict = any(summary[k] for k in (
        'restored_only_observations', 'changed_existing_observations',
        'restored_only_reviews', 'changed_existing_reviews',
        'restored_only_checkout_intents', 'changed_checkout_identities'))
    differing = conflict or other_difference or changed_other_intent_fields or any(
        old[table].keys() != new[table].keys() for table, _ in _RECOVERY_TABLES)
    if conflict:
        status='conflict'
    elif differing:
        status='manual_reconciliation_required'
    else:
        status='equivalent'
    return {**base, 'status': status, **summary,
            'other_store_data_differ': other_difference,
            'operator_action': ('obtain_trusted_provider_and_store_provenance;'
                                'investigate_discrepancies_without_automatic_replay'
                                if differing else
                                'no_snapshot_difference;provider_authenticity_still_unproven'),
            'restored_observation_fingerprint_sha256':
                old_report['observation_fingerprint_sha256'],
            'later_observation_fingerprint_sha256':
                new_report['observation_fingerprint_sha256']}


def main():
    parser = argparse.ArgumentParser(description='Read-only offline Store V2 observation recovery audit; NO live migration')
    parser.add_argument('--snapshot',type=Path,
                        help='One local SQLite snapshot to audit')
    parser.add_argument('--restored',type=Path,
                        help='Offline restored snapshot for read-only difference analysis')
    parser.add_argument('--later',type=Path,
                        help='Operator-supplied comparison snapshot (NOT authenticated)')
    args = parser.parse_args()
    if args.snapshot and not (args.restored or args.later):
        result = audit_snapshot(args.snapshot)
        code = 0 if result['qualified'] else 1
    elif not args.snapshot and args.restored and args.later:
        result = compare_offline_snapshots(args.restored,args.later)
        code = {'equivalent':0,'manual_reconciliation_required':2}.get(result['status'],1)
    else:
        parser.error('supply --snapshot OR BOTH --restored and --later')
    print(json.dumps(result,sort_keys=True))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
