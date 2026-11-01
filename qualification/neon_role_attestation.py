"""Fail-closed PostgreSQL role evidence checks for isolated MUSITU Connect.

Passing attestation alone is NOT production release or host authenticity: the
caller must independently verify the Neon project and branch being connected.
The credential-bearing connection string is never printed or returned.
"""
from __future__ import annotations

import argparse
import os
import re

ATTESTATION_SQL = """
SELECT r.rolname AS role_name,
       r.rolcanlogin,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
       r.rolreplication,r.rolbypassrls,
       (SELECT count(*)::int FROM pg_auth_members a WHERE a.member=r.oid)
         AS inherited_role_count,
       has_schema_privilege(r.rolname,'connect_qualification','USAGE') AS schema_usage,
       has_function_privilege(r.rolname,
         'connect_qualification.admit(text,text,uuid)','EXECUTE') AS function_execute,
       has_table_privilege(r.rolname,'connect_qualification.tenants','SELECT') AS tenant_select,
       has_table_privilege(r.rolname,'connect_qualification.credentials','SELECT') AS credential_select,
       has_table_privilege(r.rolname,'connect_qualification.events','SELECT') AS event_select,
       has_table_privilege(r.rolname,'connect_qualification.events','INSERT') AS event_insert,
       has_table_privilege(r.rolname,'connect_qualification.daily_usage','UPDATE') AS quota_update,
       has_database_privilege(r.rolname,current_database(),'CREATE') AS database_create
FROM pg_roles r WHERE r.rolname=%s
"""
_REQUIRED_TRUE = ("rolcanlogin", "schema_usage", "function_execute")
_REQUIRED_FALSE = ("rolsuper", "rolcreatedb", "rolcreaterole",
                   "rolreplication", "rolbypassrls", "tenant_select",
                   "credential_select", "event_select", "event_insert",
                   "quota_update", "database_create")
_PRIVILEGED = ("rolsuper", "rolcreatedb", "rolcreaterole",
               "rolreplication", "rolbypassrls", "database_create")
_DIRECT = ("tenant_select", "credential_select", "event_select",
           "event_insert", "quota_update")
_ROLE = re.compile(r"^[a-z][a-z0-9_]{2,62}$")


def assess_role(row: object, *, expected_role: str) -> dict:
    """No truthy-string coercion or caller-supplied 'approved' overrides."""
    if not isinstance(row, dict) or not isinstance(expected_role, str) or not _ROLE.fullmatch(expected_role):
        return {"qualified": False, "reason_codes": ["MALFORMED_FACTS"]}
    reasons = []
    if row.get("role_name") != expected_role:
        reasons.append("ROLE_IDENTITY_MISMATCH")
    if (any(type(row.get(key)) is not bool for key in _REQUIRED_TRUE + _REQUIRED_FALSE)
            or type(row.get("inherited_role_count")) is not int
            or row["inherited_role_count"] < 0):
        reasons.append("MALFORMED_FACTS")
    if any(row.get(key) is True for key in _PRIVILEGED):
        reasons.append("PRIVILEGED_ROLE_ATTRIBUTES")
    if type(row.get("inherited_role_count")) is int and row["inherited_role_count"] != 0:
        reasons.append("INHERITED_ROLES")
    if any(row.get(key) is True for key in _DIRECT):
        reasons.append("DIRECT_TABLE_ACCESS")
    if any(row.get(key) is False for key in _REQUIRED_TRUE):
        reasons.append("MISSING_RUNTIME_FUNCTION_PERMISSION")
    return {"qualified": not reasons, "reason_codes": reasons}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Read-only isolated Neon role attestation")
    parser.add_argument("--expected-role", required=True)
    parser.add_argument("--dsn-env", default="NEON_ROLE_REVIEW_DSN")
    args = parser.parse_args(argv)
    dsn = os.environ.get(args.dsn_env, "")
    if not dsn:
        print("NEON_ROLE_ATTESTATION=BLOCKED MISSING_REVIEW_CONNECTION")
        return 1
    try:
        import psycopg
        from psycopg.rows import dict_row
        with psycopg.connect(dsn, connect_timeout=8, row_factory=dict_row) as conn:
            rows = conn.execute(ATTESTATION_SQL, (args.expected_role,)).fetchall()
        if len(rows) != 1:
            report = {"qualified": False, "reason_codes": ["ROLE_MISSING_OR_DUPLICATE"]}
        else:
            report = assess_role(rows[0], expected_role=args.expected_role)
    except Exception:
        report = {"qualified": False, "reason_codes": ["READ_FAILED"]}
    print("NEON_ROLE_ATTESTATION=" + ("PASS" if report["qualified"] else "BLOCKED"))
    print("ROLE_REASON_CODES=" + ",".join(report["reason_codes"]))
    return 0 if report["qualified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
