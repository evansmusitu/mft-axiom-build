"""Provision ONLY the dedicated isolated MUSITU workspace D1 database.

Requires existing GitHub Actions Cloudflare token, an exact account/zone,
free-tier-compatible database count and an explicit workflow intent flag.
Never deploys Workers, creates Access apps/policies, enrolls tenants, inserts
user data, touches any existing database schema, or attempts paid upgrades.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ACCOUNT = "93f395f5121954671f92fffa453d6b61"
DOMAIN = "mftintelligence.com"
NAME = "musitu-cloud-workspaces-private"
BASE = "https://api.cloudflare.com/client/v4"
SCHEMA = Path(__file__).resolve().parent.parent / "schema.sql"
ARTIFACT = "musitu-cloud-workspace-d1-bootstrap-result.json"
UUID = re.compile(r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$", re.I)


class BootstrapBlocked(Exception):
    pass


def cf(method, path, token, payload=None, opener=urllib.request.urlopen):
    if not path.startswith("/") or ".." in path or method not in ("GET", "POST"):
        raise BootstrapBlocked("INVALID_API_REQUEST")
    if not path.startswith(("/zones?", f"/accounts/{ACCOUNT}/d1/database")):
        raise BootstrapBlocked("OUTSIDE_CANONICAL_SCOPE")
    if method == "POST" and path not in (
        f"/accounts/{ACCOUNT}/d1/database",
        f"/accounts/{ACCOUNT}/d1/database/" + path.rsplit("/", 2)[-2] + "/query",
    ):
        raise BootstrapBlocked("UNAPPROVED_WRITE_PATH")
    if method == "POST" and path.endswith("/query"):
        ident = path.rsplit("/", 2)[-2]
        if not UUID.fullmatch(ident):
            raise BootstrapBlocked("INVALID_DATABASE_ID")
    req = urllib.request.Request(
        BASE + path,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json",
                 "Content-Type": "application/json"},
        data=json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None,
        method=method,
    )
    try:
        with opener(req, timeout=22) as response:
            if response.status not in (200, 201):
                raise BootstrapBlocked("API_NON_200")
            raw = response.read(262145)
    except urllib.error.HTTPError as err:
        # Never log potentially sensitive response bodies or token-bearing URLs.
        raise BootstrapBlocked("API_HTTP_" + str(err.code)) from None
    except urllib.error.URLError:
        raise BootstrapBlocked("API_NETWORK_UNAVAILABLE") from None
    if len(raw) > 262144:
        raise BootstrapBlocked("RESPONSE_TOO_LARGE")
    try:
        result = json.loads(raw)
    except (ValueError, TypeError):
        raise BootstrapBlocked("API_INVALID_JSON") from None
    if not isinstance(result, dict) or result.get("success") is not True:
        raise BootstrapBlocked("API_NOT_SUCCESSFUL")
    return result


def require_zone(token, opener):
    path = "/zones?" + urllib.parse.urlencode({"name": DOMAIN, "page": 1, "per_page": 50})
    result = cf("GET", path, token, opener=opener)
    rows = result.get("result")
    if not isinstance(rows, list):
        raise BootstrapBlocked("ZONE_LIST_UNAVAILABLE")
    owned = [z for z in rows if isinstance(z, dict) and z.get("name") == DOMAIN
             and (z.get("account") or {}).get("id") == ACCOUNT and z.get("status") == "active"]
    if len(owned) != 1 or len(rows) != 1:
        raise BootstrapBlocked("CANONICAL_ZONE_NOT_PROVEN")


def list_db(token, opener):
    path = f"/accounts/{ACCOUNT}/d1/database?page=1&per_page=100"
    response = cf("GET", path, token, opener=opener)
    rows, page = response.get("result"), response.get("result_info")
    if not isinstance(rows, list) or not isinstance(page, dict):
        raise BootstrapBlocked("D1_INVENTORY_INCOMPLETE")
    total = page.get("total_count")
    if not isinstance(total, int) or total < 0 or total != len(rows) or total > 100:
        raise BootstrapBlocked("D1_INVENTORY_INCOMPLETE")
    if any(not isinstance(db, dict) or not UUID.fullmatch(str(db.get("uuid", "")))
           or not isinstance(db.get("name"), str) for db in rows):
        raise BootstrapBlocked("INVALID_D1_INVENTORY")
    return rows


def validate_schema():
    sql = SCHEMA.read_text(encoding="utf-8")
    # Never execute arbitrary repository SQL supplied through a compromised branch.
    statements = [s.strip() for s in re.sub(r"(?m)^\s*--[^\n]*", "", sql).split(";") if s.strip()]
    expected = ("PRAGMA foreign_keys = ON", "CREATE TABLE IF NOT EXISTS workspace_tenants",
                "CREATE TABLE IF NOT EXISTS workspace_memberships",
                "CREATE TABLE IF NOT EXISTS workspace_blobs",
                "CREATE INDEX IF NOT EXISTS workspace_memberships_subject_idx")
    if len(statements) != len(expected) or any(not stmt.startswith(prefix)
                                               for stmt, prefix in zip(statements, expected)):
        raise BootstrapBlocked("SCHEMA_NOT_APPROVED")
    return "\n".join(stmt + ";" for stmt in statements[1:])  # D1 enforces foreign keys.


def bootstrap(token, opener=urllib.request.urlopen):
    require_zone(token, opener)
    rows = list_db(token, opener)
    existing = [db for db in rows if db["name"] == NAME]
    if len(existing) > 1:
        raise BootstrapBlocked("DATABASE_NAME_COLLISION")
    if existing:
        # Existing database is NEVER modified or re-initialized. Only readback.
        return {"result": "EXISTS_UNCHANGED", "name": NAME, "database_id": existing[0]["uuid"],
                "schema_initialized_this_run": False, "user_data_written": False,
                "worker_deployed": False, "access_policy_modified": False}
    if len(rows) >= 10:
        raise BootstrapBlocked("NO_FREE_TIER_COMPATIBLE_DATABASE_SLOT")
    sql = validate_schema()
    response = cf("POST", f"/accounts/{ACCOUNT}/d1/database",
                  token, {"name": NAME}, opener=opener)
    newly = response.get("result")
    ident = newly.get("uuid") if isinstance(newly, dict) and newly.get("name") == NAME else ""
    if not isinstance(ident, str) or not UUID.fullmatch(ident):
        raise BootstrapBlocked("CREATION_NOT_VERIFIED")
    # Explicit independent readback. No retries if create returned uncertain outcome.
    matches = [db for db in list_db(token, opener) if db["name"] == NAME]
    if len(matches) != 1 or matches[0]["uuid"] != ident:
        raise BootstrapBlocked("CREATED_DB_READBACK_MISMATCH")
    answer = cf("POST", f"/accounts/{ACCOUNT}/d1/database/{ident}/query",
                token, {"sql": sql}, opener=opener)
    results = answer.get("result")
    if not isinstance(results, list) or not results or not all(
            isinstance(row, dict) and row.get("success") is True for row in results):
        raise BootstrapBlocked("NEW_DB_SCHEMA_APPLY_FAILED")
    return {"result": "CREATED_ISOLATED", "name": NAME, "database_id": ident,
            "schema_initialized_this_run": True, "user_data_written": False,
            "worker_deployed": False, "access_policy_modified": False}


def main():
    if os.environ.get("EXPECTED_ACCOUNT_ID") != ACCOUNT or os.environ.get("EXPECTED_DOMAIN") != DOMAIN:
        print("BLOCKED: canonical account or zone invariant not proven")
        return 2
    if os.environ.get("MUSITU_D1_BOOTSTRAP_INTENT") != "CREATE_ONLY_ISOLATED_DB":
        print("BLOCKED: explicit isolated bootstrap guard not satisfied")
        return 2
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not token:
        print("BLOCKED: GitHub Cloudflare connection unavailable")
        return 3
    try:
        result = bootstrap(token)
        payload = {"schema": "musitu.cloud_workspace.d1_bootstrap.v1",
                   "account_id": ACCOUNT, "domain": DOMAIN,
                   "authentication_qualified": False, "workspace_enabled": False,
                   **result}
        Path(ARTIFACT).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n",
                                  encoding="utf-8")
        print("MUSITU D1 isolated bootstrap:", result["result"],
              "schema_created:", result["schema_initialized_this_run"],
              "NO WORKER DEPLOYED, NO ACCESS POLICY CHANGES")
        return 0
    except BootstrapBlocked as error:
        print("MUSITU ISOLATED D1 BOOTSTRAP BLOCKED:", str(error),
              "NO AUTOMATIC RETRY, NO SERVICE DEPLOYMENT")
        return 4


if __name__ == "__main__":
    sys.exit(main())
