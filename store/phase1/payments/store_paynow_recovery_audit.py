"""Read-only, OFFLINE Store V2 Paynow observation snapshot qualification.

Runs on a *local SQLite file* only. No connection strings, HTTP endpoints,
Paynow access, customer identities, payment processing or migration authority.
A successful audit is integrity evidence, not a signature, settlement receipt,
real database acceptance, marketplace approval or permission to deploy.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
STORE_SCHEMA = HERE / 'store-axiom-checkout-schema.sql'
OBS_SCHEMA = HERE / 'store-paynow-status-observations.candidate.sql'
OBS_COLUMNS = ('event_id', 'reference', 'paynow_reference', 'provider_status',
               'amount_cents', 'currency', 'poll_url', 'callback_digest',
               'poll_digest', 'observed_at')


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
                not isinstance(at,str) or not at.endswith('Z')):
                failures.add('observation_field_conflict')
            digest.update(json.dumps(row,ensure_ascii=True,
                separators=(',',':')).encode('utf-8'))
            digest.update(b'\n')
        return _result(failures,count,reviews,digest.hexdigest())
    except (sqlite3.Error, TypeError, ValueError, OSError):
        return _result(failures | {'snapshot_invalid'})
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description='Read-only offline Store V2 observation recovery audit; NO live migration')
    parser.add_argument('--snapshot',type=Path,required=True,
                        help='Local SQLite snapshot path (never a Neon or D1 connection)')
    args = parser.parse_args()
    result = audit_snapshot(args.snapshot)
    print(json.dumps(result,sort_keys=True))
    return 0 if result['qualified'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
