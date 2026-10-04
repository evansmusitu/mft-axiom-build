"""Read-only preflight for a non-fixture MUSITU Connect -> Axiom identity.

No identity is created here. A non-fixture production identity is qualified only when
CI has a dedicated raw credential whose SHA-256 matches an active non-fixture Axiom
api_keys row. The script reports counts and presence booleans only; it never prints
credential values, customer identifiers, emails, or key hashes.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

CF_API=os.environ.get("CF_API","https://api.cloudflare.com/client/v4")
ACCOUNT_ID=os.environ["ACCOUNT_ID"]
D1_UUID=os.environ["D1_UUID"]
CF_TOKEN=os.environ["CLOUDFLARE_API_TOKEN"]
MCP_BASE=os.environ.get("MCP_BASE","https://mcp.mftintelligence.com").rstrip("/")
ACCOUNT_KEY=os.environ.get("MUSITU_CONNECT_AXIOM_ACCOUNT_KEY","").strip()
BEARER=os.environ.get("MUSITU_CONNECT_AXIOM_BEARER_TOKEN","").strip()
CONTROL=os.environ.get("MFT_CONTROL_SECRET","").strip()

def call(url: str, method: str="GET", headers=None, body: bytes | None=None):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(req,timeout=30) as response:
            return response.status,response.read()
    except urllib.error.HTTPError as exc:
        return exc.code,exc.read()

def d1(sql: str, params=None):
    payload={"sql":sql}
    if params is not None:
        payload["params"]=params
    status,raw=call(
        f"{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{D1_UUID}/query",
        "POST",
        {
            "Authorization":"Bearer "+CF_TOKEN,
            "Accept":"application/json",
            "Content-Type":"application/json",
            "User-Agent":"MUSITU-Connect-Identity-Preflight/1.0",
        },
        json.dumps(payload,separators=(",",":")).encode("utf-8"),
    )
    if status!=200:
        raise RuntimeError("D1 read-only query HTTP "+str(status))
    obj=json.loads(raw or b"{}")
    result=obj.get("result") or []
    if not result or not all(item.get("success") is True for item in result):
        raise RuntimeError("D1 read-only query failed")
    rows=[]
    for item in result:
        rows.extend(item.get("results") or [])
    return rows

def credential_match(raw_credential: str):
    if not raw_credential:
        return None
    digest=hashlib.sha256(raw_credential.encode("utf-8")).hexdigest()
    rows=d1(
        "SELECT "
        "CASE WHEN c.id LIKE 'fixture_%' THEN 1 ELSE 0 END AS fixture_customer,"
        "CASE WHEN k.id LIKE 'fixture_%' THEN 1 ELSE 0 END AS fixture_key,"
        "k.status AS key_status,c.status AS customer_status,"
        "CASE WHEN k.revoked_at IS NULL THEN 0 ELSE 1 END AS revoked,"
        "CASE WHEN k.expires_at IS NULL OR k.expires_at>datetime('now') THEN 0 ELSE 1 END AS expired "
        "FROM api_keys k JOIN customers c ON c.id=k.customer_id "
        "WHERE k.key_hash=?1 LIMIT 2",
        [digest],
    )
    if len(rows)!=1:
        return {"matched":False}
    row=rows[0]
    active=(
        int(row.get("fixture_customer") or 0)==0
        and int(row.get("fixture_key") or 0)==0
        and row.get("key_status")=="active"
        and row.get("customer_status")=="active"
        and int(row.get("revoked") or 0)==0
        and int(row.get("expired") or 0)==0
    )
    return {
        "matched":True,
        "active_non_fixture":active,
    }

def main():
    if ACCOUNT_KEY:
        print("::add-mask::"+ACCOUNT_KEY)
    if BEARER:
        print("::add-mask::"+BEARER)
    if CONTROL:
        print("::add-mask::"+CONTROL)

    hs,raw=call(
        MCP_BASE+"/health",
        headers={"Accept":"application/json","User-Agent":"MUSITU-Connect-Identity-Preflight/1.0"},
    )
    health=json.loads(raw or b"{}")
    if hs!=200 or health.get("ok") is not True:
        raise RuntimeError("Axiom public MCP health unavailable")

    counts=d1(
        "SELECT "
        "(SELECT count(*) FROM customers WHERE status='active' AND id NOT LIKE 'fixture_%') AS customers,"
        "(SELECT count(*) FROM api_keys k JOIN customers c ON c.id=k.customer_id "
        " WHERE k.status='active' AND c.status='active' "
        " AND k.id NOT LIKE 'fixture_%' AND c.id NOT LIKE 'fixture_%' "
        " AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>datetime('now'))) AS api_keys"
    )
    if len(counts)!=1:
        raise RuntimeError("non-fixture identity inventory query failed")

    account_match=credential_match(ACCOUNT_KEY)
    bearer_match=credential_match(BEARER)
    matched=bool(
        (account_match or {}).get("active_non_fixture")
        or (bearer_match or {}).get("active_non_fixture")
    )

    evidence={
        "schema":"musitu.connect.non_fixture_identity_preflight.v1",
        "source_commit":os.environ.get("GITHUB_SHA"),
        "workflow_run_id":os.environ.get("GITHUB_RUN_ID"),
        "mcp_health_verified":True,
        "active_non_fixture_customer_count":int(counts[0].get("customers") or 0),
        "active_non_fixture_api_key_count":int(counts[0].get("api_keys") or 0),
        "dedicated_account_key_secret_present":bool(ACCOUNT_KEY),
        "dedicated_bearer_secret_present":bool(BEARER),
        "admin_control_secret_present":bool(CONTROL),
        "dedicated_account_key_matches_active_non_fixture_identity":bool((account_match or {}).get("active_non_fixture")),
        "dedicated_bearer_matches_active_non_fixture_identity":bool((bearer_match or {}).get("active_non_fixture")),
        "non_fixture_identity_control_ready":matched,
        "credential_values_published":False,
        "database_mutated":False,
        "production_axiom_integration_enabled":False,
        "gate":"MUSITU_CONNECT_NON_FIXTURE_IDENTITY_READY" if matched else "MUSITU_CONNECT_NON_FIXTURE_IDENTITY_BLOCKED",
        "blocker":None if matched else (
            "No dedicated Connect Axiom credential available in CI that matches an active "
            "non-fixture production identity. Direct production D1 identity creation is intentionally prohibited."
        ),
    }
    raw=(json.dumps(evidence,indent=2,sort_keys=True)+"\n").encode("utf-8")
    Path("musitu-connect-non-fixture-identity-preflight.json").write_bytes(raw)
    digest=hashlib.sha256(raw).hexdigest()
    Path("musitu-connect-non-fixture-identity-preflight.sha256").write_text(
        digest+"  musitu-connect-non-fixture-identity-preflight.json\n",
        encoding="utf-8",
    )
    print("MUSITU_CONNECT_IDENTITY_PREFLIGHT="+json.dumps({
        "gate":evidence["gate"],
        "mcp_health_verified":True,
        "active_non_fixture_customer_count":evidence["active_non_fixture_customer_count"],
        "active_non_fixture_api_key_count":evidence["active_non_fixture_api_key_count"],
        "dedicated_account_key_secret_present":evidence["dedicated_account_key_secret_present"],
        "dedicated_bearer_secret_present":evidence["dedicated_bearer_secret_present"],
        "admin_control_secret_present":evidence["admin_control_secret_present"],
        "non_fixture_identity_control_ready":matched,
        "database_mutated":False,
        "production_axiom_integration_enabled":False,
        "evidence_sha256":digest,
    },sort_keys=True))

if __name__=="__main__":
    main()
