#!/usr/bin/env python3
"""Isolated PostgreSQL-17 verification: synthetic-only; never run on a customer DB.

Set NEON_TEST_PG_DSN to a *disposable* Postgres database. Does not accept a
production endpoint; the CI service starts an empty ephemeral database.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import os
import psycopg

ROOT = Path(__file__).resolve().parents[1]
DSN = os.environ.get("NEON_TEST_PG_DSN", "")
ROLE = "musitu_connect_qual_runtime"
ALPHA = "d" * 64
BETA = "e" * 64


def require(ok: bool, label: str) -> None:
    if not ok:
        raise AssertionError(label)


def query(statement: str, args=(), *, role=False):
    with psycopg.connect(DSN, autocommit=True, connect_timeout=8) as connection:
        if role:
            connection.execute("SET ROLE musitu_connect_qual_runtime")
        return connection.execute(statement, args).fetchall()


def admit(digest: str, scope: str, identifier: str):
    return query(
        "SELECT accepted,code,authorized_tenant,daily_used "
        "FROM connect_qualification.admit(%s,%s,%s::uuid)",
        (digest, scope, identifier), role=True,
    )[0]


def main():
    require(bool(DSN) and "127.0.0.1" in DSN, "ephemeral_loopback_postgres_only")
    require("postgres" in DSN, "ephemeral_postgres_database_required")
    sql = (ROOT / "infra/connect_customer_neon_qualification.sql").read_text()
    with psycopg.connect(DSN, autocommit=True) as connection:
        connection.execute(sql)
        connection.execute("CREATE ROLE musitu_connect_qual_runtime NOLOGIN NOINHERIT")
        connection.execute("GRANT USAGE ON SCHEMA connect_qualification TO musitu_connect_qual_runtime")
        connection.execute("GRANT EXECUTE ON FUNCTION connect_qualification.admit(text,text,uuid) TO musitu_connect_qual_runtime")
        checks = connection.execute("""
          SELECT rolcanlogin,
          has_function_privilege(%s,'connect_qualification.admit(text,text,uuid)','EXECUTE'),
          has_table_privilege(%s,'connect_qualification.credentials','SELECT'),
          has_table_privilege(%s,'connect_qualification.events','INSERT'),
          has_table_privilege(%s,'connect_qualification.daily_usage','UPDATE')
          FROM pg_roles WHERE rolname=%s
        """, (ROLE, ROLE, ROLE, ROLE, ROLE)).fetchone()
        require(checks == (False, True, False, False, False), "role_is_not_least_privilege")
        connection.execute("""
          INSERT INTO connect_qualification.tenants(tenant_id,status,daily_limit,minute_limit)
          VALUES('tenant_alpha','active',3,3),('tenant_beta','active',4,2)
        """)
        connection.execute("""
          INSERT INTO connect_qualification.credentials
            (credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk)
          VALUES('cred_alpha','tenant_alpha',%s,'active',clock_timestamp()+INTERVAL '1 day',true,false),
                ('cred_beta','tenant_beta',%s,'active',clock_timestamp()+INTERVAL '1 day',false,true)
        """, (ALPHA, BETA))

    try:
        query("SELECT * FROM connect_qualification.credentials", role=True)
        raise AssertionError("runtime_role_can_read_credential_hashes")
    except psycopg.errors.InsufficientPrivilege:
        pass
    try:
        query("SELECT * FROM connect_qualification.events", role=True)
        raise AssertionError("runtime_role_can_read_events_directly")
    except psycopg.errors.InsufficientPrivilege:
        pass

    invalid = admit(ALPHA, "mining.plan", "11111111-1111-1111-8111-111111111111")
    wrong_variant = admit(ALPHA, "mining.plan", "22222222-2222-4222-0222-222222222222")
    require(invalid[:2] == (False, "UNAUTHORIZED") and
            wrong_variant[:2] == (False, "UNAUTHORIZED"), "invalid_request_id_admitted")
    require(query("SELECT count(*) FROM connect_qualification.events")[0][0] == 0,
            "invalid_uuid_consumed_quota")

    requests = [f"{i:08x}-aaaa-4aaa-8aaa-{i:012x}" for i in range(1, 17)]
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(lambda uid: admit(ALPHA, "mining.plan", uid), requests))
    require(sum(1 for a in results if a[0] is True) == 3, "concurrent_quota_over_admitted")
    require(sum(1 for a in results if a[1] == "CUSTOMER_QUOTA_EXCEEDED") == 13,
            "concurrent_quota_rejections_missing")

    admitted_id = requests[next(i for i, r in enumerate(results) if r[0] is True)]
    require(admit(ALPHA, "mining.plan", admitted_id)[1] == "REQUEST_ID_CONFLICT",
            "duplicate_request_id_charged_again")
    require(admit(BETA, "mining.plan", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")[1] == "UNAUTHORIZED",
            "cross_scope_admitted")
    for i in range(5):
        admit(BETA, "mining.risk", f"{i+90:08x}-bbbb-4bbb-8bbb-{i+90:012x}")
    minute_used = query("SELECT used FROM connect_qualification.minute_usage WHERE tenant_id='tenant_beta'")
    require(minute_used and minute_used[0][0] == 2, "minute_quota_not_atomic")
    for tenant, expected in [("tenant_alpha", 3), ("tenant_beta", 2)]:
        counts = query("""SELECT
          (SELECT count(*) FROM connect_qualification.events WHERE tenant_id=%s),
          (SELECT used FROM connect_qualification.daily_usage WHERE tenant_id=%s),
          (SELECT used FROM connect_qualification.minute_usage WHERE tenant_id=%s)
        """, (tenant, tenant, tenant))[0]
        require(counts == (expected, expected, expected), "quota_and_audit_disagree_" + tenant)

    with psycopg.connect(DSN, autocommit=True) as connection:
        connection.execute("UPDATE connect_qualification.credentials SET status='revoked' WHERE credential_id='cred_alpha'")
    require(admit(ALPHA, "mining.plan", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")[1] == "UNAUTHORIZED",
            "revoked_credential_can_admit")
    try:
        query("UPDATE connect_qualification.events SET scope='mining.risk' WHERE tenant_id='tenant_alpha'")
        raise AssertionError("append_only_events_modified")
    except psycopg.errors.CheckViolation:
        pass
    require(query("SELECT count(*) FROM connect_qualification.events WHERE tenant_id='tenant_alpha'")[0][0] == 3,
            "revocation_or_rejected_update_changed_audit")
    print("NEON_POSTGRESQL_EPHEMERAL_CONTRACT=PASS")
    print("NEON_LEAST_PRIVILEGE=PASS")
    print("NEON_UUID_V4_DATABASE_GUARD=PASS")
    print("NEON_CONCURRENT_QUOTA=PASS")
    print("NEON_REVOCATION_AND_AUDIT=PASS")
    print("CUSTOMER_RELEASE_AUTHORIZED=false")


if __name__ == "__main__":
    main()
