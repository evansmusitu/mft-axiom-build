#!/usr/bin/env python3
"""Disposable PostgreSQL-17 DB transport TLS acceptance, not hosted Neon."""
from __future__ import annotations
import hashlib
import os
import re
from pathlib import Path

DSN = os.environ.get("NEON_TEST_PG_DSN", "")
CERT = Path(os.environ.get("NEON_PG_TLS_CERT_FILE", ""))
BAD_CA = Path(os.environ.get("NEON_PG_TLS_BAD_CA_FILE", ""))
TOKEN = "mct_" + "W" * 43
DIGEST = hashlib.sha256(TOKEN.encode("ascii")).hexdigest()
ID = "daf01234-1111-4111-8111-123456789abc"
ID2 = "daf01235-1111-4111-8111-123456789abc"

def ensure(ok, code):
    if not ok:
        raise AssertionError(code)

def connect(*, owner=False, **overrides):
    import psycopg  # Only the isolated Neon CI step installs the driver.
    params = dict(
        autocommit=True, connect_timeout=8, sslmode="verify-full",
        sslrootcert=str(CERT), channel_binding="require",
    )
    if not owner:
        params.update(user="musitu_ci_app", password="ci-synthetic-disposable-only")
    params.update(overrides)
    return psycopg.connect(DSN, **params)

def verify_tls_session(conn):
    row = conn.execute(
        "SELECT ssl,version,cipher FROM pg_stat_ssl WHERE pid=pg_backend_pid()"
    ).fetchone()
    ensure(row is not None and row[0] is True, "DATABASE_TLS_SESSION_NOT_ENCRYPTED")
    ensure(isinstance(row[1], str) and row[1].startswith("TLSv1."),
           "DATABASE_TLS_PROTOCOL_MISSING")
    ensure(isinstance(row[2], str) and len(row[2]) > 0,
           "DATABASE_TLS_CIPHER_MISSING")

def must_reject(code, expected_cause, **overrides):
    import psycopg
    try:
        with connect(**overrides):
            pass
    except psycopg.OperationalError as exc:
        # Unexpected failures (network, expired credentials) cannot qualify TLS.
        ensure(re.search(expected_cause, str(exc), re.IGNORECASE) is not None,
               code + "_REJECTED_FOR_UNRELATED_REASON")
        return
    raise AssertionError(code)

def main():
    import psycopg
    ensure(DSN == "postgresql://postgres:isolated-ci-only@127.0.0.1:5432/postgres",
           "ONLY_DISPOSABLE_CI_POSTGRES_ALLOWED")
    ensure(CERT.is_file() and BAD_CA.is_file() and CERT != BAD_CA,
           "DISPOSABLE_TLS_TRUST_FIXTURES_MISSING")
    # hostaddr resolves transport to loopback while host enforces cert identity.
    must_reject("UNTRUSTED_CA_ACCEPTED", r"certificate.*(?:verify|trust|signed)|SSL error.*certificate",
                sslrootcert=str(BAD_CA))
    must_reject("WRONG_HOSTNAME_ACCEPTED", r"certificate.*(?:does not match|hostname|host name)|host name.*(?:match|mismatch)",
                host="wrong.musitu.invalid", hostaddr="127.0.0.1")
    must_reject("PLAINTEXT_POSTGRES_ACCEPTED", r"pg_hba\.conf.*reject|no encryption",
                sslmode="disable", channel_binding="disable")
    with connect(owner=True) as owner:
        verify_tls_session(owner)
        owner.execute(
            """INSERT INTO connect_qualification.tenants
                 (tenant_id,status,daily_limit,minute_limit)
               VALUES ('tenant_pg_tls','active',1,1)"""
        )
        owner.execute(
            """INSERT INTO connect_qualification.credentials
               (credential_id,tenant_id,token_sha256,status,expires_at,can_plan,can_risk)
               VALUES ('cred_pg_tls','tenant_pg_tls',%s,'active',
                       clock_timestamp()+INTERVAL '1 day',true,false)""",
            (DIGEST,),
        )
        with connect() as app:
            verify_tls_session(app)
            ensure(app.execute("SELECT current_user").fetchone()[0] == "musitu_ci_app",
                   "WRONG_POSTGRES_LOGIN")
            try:
                app.execute("SELECT token_sha256 FROM connect_qualification.credentials")
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError("TLS_LOGIN_READS_PRIVATE_TOKENS")
            sql = ("SELECT accepted,code,authorized_tenant,daily_used "
                   "FROM connect_qualification.admit(%s,%s,%s::uuid)")
            admitted = app.execute(sql, (DIGEST, "mining.plan", ID)).fetchone()
            ensure(admitted[:3] == (True, "ADMITTED", "tenant_pg_tls"),
                   "TLS_RESTRICTED_LOGIN_NOT_ADMITTED")
            duplicate = app.execute(sql, (DIGEST, "mining.plan", ID)).fetchone()
            ensure(duplicate[:2] == (False, "REQUEST_ID_CONFLICT"),
                   "TLS_DUPLICATE_CHANGED_QUOTA")
            exhausted = app.execute(sql, (DIGEST, "mining.plan", ID2)).fetchone()
            ensure(exhausted[:2] == (False, "CUSTOMER_QUOTA_EXCEEDED"),
                   "TLS_QUOTA_LIMIT_NOT_ENFORCED")
        counts = owner.execute(
            """SELECT
                 (SELECT count(*)::int FROM connect_qualification.events
                  WHERE tenant_id='tenant_pg_tls'),
                 (SELECT used FROM connect_qualification.daily_usage
                  WHERE tenant_id='tenant_pg_tls'),
                 (SELECT used FROM connect_qualification.minute_usage
                  WHERE tenant_id='tenant_pg_tls')"""
        ).fetchone()
        ensure(counts == (1, 1, 1), "TLS_AUDIT_COUNTERS_DIVERGED")
    print("NEON_EPHEMERAL_POSTGRES_TLS_VERIFY_FULL=PASS")
    print("NEON_EPHEMERAL_POSTGRES_SCRAM_CHANNEL_BINDING=PASS")
    print("NEON_EPHEMERAL_POSTGRES_REJECTS_WRONG_CA_HOST_AND_PLAINTEXT=PASS")
    print("NEON_EPHEMERAL_POSTGRES_TLS_RESTRICTED_ADMISSION=PASS")
    print("HOSTED_NEON_DIRECT_CLIENT_TLS_VERIFIED=false")
    print("CUSTOMER_RELEASE_AUTHORIZED=false")

if __name__ == "__main__":
    main()
