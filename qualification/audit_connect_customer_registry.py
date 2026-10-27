"""Read-only offline consistency audit for MUSITU Connect customer attempt quotas.

A consistent local SQLite snapshot is a research contract, NOT a hosted D1,
production identity, customer approval, billing or operating-mine claim.
This tool never connects to Cloudflare or a customer, never reads raw tokens
and never releases tenant, request or credential identifiers in its report.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sqlite3
from typing import Any

STAMP = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\Z')
SCOPE = {'mining.plan', 'mining.risk'}
# A committed attempt ID is minted exclusively by the customer admission
# runtime. Non-UUID or wrong-version identifiers are never trusted evidence.
UUID_V4 = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z')


def _valid_utc_event(day: str, when: str) -> bool:
    if (not isinstance(day, str) or not isinstance(when, str)
            or STAMP.fullmatch(when) is None or when[:10] != day):
        return False
    try:
        parsed = datetime.fromisoformat(when.replace('Z', '+00:00'))
    except ValueError:
        return False
    return (parsed.utcoffset() == timezone.utc.utcoffset(parsed)
            and parsed.isoformat(timespec='milliseconds')
            .replace('+00:00', 'Z') == when)


def audit_customer_registry(database: Path) -> dict[str, Any]:
    """Compare event-derived counts to stored quotas in ONE read-only snapshot."""
    database = Path(database)
    if not database.is_file():
        raise FileNotFoundError('customer_accounting_local_database_missing')
    # pathlib URI percent-escapes path characters before appending SQLite's
    # read-only query flag. No writable database handle is ever constructed.
    conn = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True)
    try:
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        tenant_limits = {
            tenant: (daily_limit, minute_limit)
            for tenant, daily_limit, minute_limit in conn.execute(
                'SELECT tenant_id,daily_limit,minute_limit '
                'FROM connect_customer_tenants')}
        tenants = set(tenant_limits)
        credentials = {
            row[0]: row[1] for row in conn.execute(
                'SELECT credential_id,tenant_id FROM connect_customer_credentials')}
        orphaned_credentials = sum(t not in tenants for t in credentials.values())
        expected_day: Counter[tuple[str, str]] = Counter()
        expected_minute: Counter[tuple[str, str]] = Counter()
        used = 0
        malformed = 0
        inconsistent_credential = 0
        malformed_request_ids = 0
        for tenant, credential, request, scope, day, timestamp in conn.execute(
                'SELECT tenant_id,credential_id,request_id,scope,utc_day,observed_at '
                'FROM connect_customer_usage_events'):
            used += 1
            if not isinstance(request, str) or UUID_V4.fullmatch(request) is None:
                malformed_request_ids += 1
            if tenant not in tenants or credentials.get(credential) != tenant:
                inconsistent_credential += 1
            if (not _valid_utc_event(day,timestamp)
                    or scope not in SCOPE):
                malformed += 1
            if isinstance(day,str):
                expected_day[(tenant, day)] += 1
            if isinstance(timestamp,str):
                expected_minute[(tenant, timestamp[:16])] += 1

        actual_day = {
            (tenant,day): count for tenant,day,count in conn.execute(
                'SELECT tenant_id,utc_day,used FROM connect_customer_daily_usage')}
        actual_minute = {
            (tenant,minute): count for tenant,minute,count in conn.execute(
                'SELECT tenant_id,utc_minute,used FROM connect_customer_minute_usage')}
        # Presence matters: a zero-valued orphan quota row must not
        # compare equal to an entirely absent event-derived bucket.
        day_mismatch = sum(
            key not in actual_day or key not in expected_day
            or actual_day[key] != expected_day[key]
            for key in expected_day.keys() | actual_day.keys())
        minute_mismatch = sum(
            key not in actual_minute or key not in expected_minute
            or actual_minute[key] != expected_minute[key]
            for key in expected_minute.keys() | actual_minute.keys())
        orphaned_quota_rows = (
            sum(key[0] not in tenants for key in actual_day)
            + sum(key[0] not in tenants for key in actual_minute))
        # Compare both reconstructed event counts and stored counters
        # against the tenant's limits in this same snapshot. An operator
        # may legitimately have reduced limits after past admissions; such
        # snapshots are marked policy-inconsistent, not retroactive proof
        # that a prior admission exceeded its then-effective limit.
        daily_limit_exceedances = sum(
            max(expected_day.get(key, 0), actual_day.get(key, 0)) >
            tenant_limits[key[0]][0]
            for key in expected_day.keys() | actual_day.keys()
            if key[0] in tenant_limits)
        minute_limit_exceedances = sum(
            max(expected_minute.get(key, 0), actual_minute.get(key, 0)) >
            tenant_limits[key[0]][1]
            for key in expected_minute.keys() | actual_minute.keys()
            if key[0] in tenant_limits)
        conn.commit()
    finally:
        conn.close()

    good = not any((day_mismatch, minute_mismatch,
                    malformed, inconsistent_credential, malformed_request_ids,
                    daily_limit_exceedances, minute_limit_exceedances,
                    orphaned_credentials, orphaned_quota_rows))
    return {
        'schema': 'musitu.connect.customer_accounting_audit.v1',
        'status': ('OFFLINE_ACCOUNTING_CONSISTENT_NOT_ADMITTED'
                   if good else 'OFFLINE_ACCOUNTING_INCONSISTENT_NOT_ADMITTED'),
        'snapshot_mode': 'LOCAL_SQLITE_READ_ONLY',
        'tenants_examined': len(tenants),
        'usage_events_examined': used,
        'daily_counter_rows': len(actual_day),
        'minute_counter_rows': len(actual_minute),
        'daily_counter_mismatches': day_mismatch,
        'minute_counter_mismatches': minute_mismatch,
        'malformed_event_timestamps_or_scopes': malformed,
        'malformed_request_ids': malformed_request_ids,
        'daily_quota_limit_exceedances': daily_limit_exceedances,
        'minute_quota_limit_exceedances': minute_limit_exceedances,
        'credential_tenant_mismatches': inconsistent_credential,
        'orphaned_credentials': orphaned_credentials,
        'orphaned_quota_rows': orphaned_quota_rows,
        'event_and_quota_consistency': good,
        'hosted_d1_qualified': False,
        'production_admission': False,
        'customer_beta_admission': False,
        'billing_accuracy_verified': False,
        'source_customer_records_shared': False,
        'claim_policy': ('A deidentified read-only offline consistency check '
                         'does not authenticate customers, prove distributed '
                         'quota atomicity, satisfy legal approval, or authorize '
                         'public beta/customer deployment.'),
    }


def main() -> None:
    parser=argparse.ArgumentParser(description='Offline customer D1-compatible SQLite quota audit; no admission')
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args=parser.parse_args()
    if args.output.exists() or args.output.resolve()==args.database.resolve():
        raise FileExistsError('customer_accounting_report_already_exists_or_source')
    report=audit_customer_registry(args.database)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x',encoding='utf-8') as f:
        f.write(json.dumps(report,sort_keys=True,indent=2,allow_nan=False)+'\n')
    print(json.dumps({k:report[k] for k in (
        'status','usage_events_examined','production_admission')},sort_keys=True))


if __name__=='__main__':
    main()
