"""Read-only-unless-authorized preflight for a non-fixture Connect -> Axiom identity.

Without a dedicated credential this is strictly read-only and reports the blocker.
When CI later receives a dedicated raw credential whose SHA-256 matches an active
non-fixture Axiom api_keys row, the same workflow performs one canonical Connect ->
Axiom MCP request and requires exact usage-ledger request-ID correlation before the
identity control can be marked ready. That successful metered usage event is retained
as production evidence; no customer/key records are created or altered here.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import urllib.error
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

from connect.adapters import AdapterCatalog, AdapterContract
from connect.axiom_gateway import AxiomGateway, AxiomMcpExecutor
from connect.core import IntegrationGate
from connect.fabric import ConnectFabric
from connect.mining import normalize_mining_rows
from connect.runtime import ConnectRuntime
from connect.security import canonical_bytes

CF_API=os.environ.get("CF_API","https://api.cloudflare.com/client/v4")
ACCOUNT_ID=os.environ["ACCOUNT_ID"]
D1_UUID=os.environ["D1_UUID"]
CF_TOKEN=os.environ["CLOUDFLARE_API_TOKEN"]
MCP_BASE=os.environ.get("MCP_BASE","https://mcp.mftintelligence.com").rstrip("/")
AXIOM_ADMIN_BASE=os.environ.get("AXIOM_ADMIN_BASE","https://axiom.mftintelligence.com").rstrip("/")
ACCOUNT_KEY=os.environ.get("MUSITU_CONNECT_AXIOM_ACCOUNT_KEY","").strip()
BEARER=os.environ.get("MUSITU_CONNECT_AXIOM_BEARER_TOKEN","").strip()
MUSITU_CONTROL=os.environ.get("MUSITU_CONTROL_SECRET","").strip()
LEGACY_CONTROL=os.environ.get("MFT_CONTROL_SECRET","").strip()

def call(url: str, method: str="GET", headers=None, body: bytes | None=None):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(req,timeout=40) as response:
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
            "User-Agent":"MUSITU-Connect-Identity-Preflight/2.0",
        },
        json.dumps(payload,separators=(",",":")).encode("utf-8"),
    )
    if status!=200:
        raise RuntimeError("D1 query HTTP "+str(status))
    obj=json.loads(raw or b"{}")
    result=obj.get("result") or []
    if not result or not all(item.get("success") is True for item in result):
        raise RuntimeError("D1 query failed")
    rows=[]
    for item in result:
        rows.extend(item.get("results") or [])
    return rows

def probe_admin_control(secret: str, header_name: str):
    if not secret:
        return None
    status,raw=call(
        AXIOM_ADMIN_BASE+"/v1/admin/customers",
        "POST",
        {
            header_name:secret,
            "x-musitu-axiom-version":"3.0.0",
            "Accept":"application/json",
            "Content-Type":"application/json",
            "User-Agent":"MUSITU-Connect-Identity-Preflight/3.0",
        },
        b"{}",
    )
    try:
        body=json.loads(raw or b"{}")
    except Exception:
        body={}
    authenticated_validation=status in (400,422)
    return {
        "header":header_name,
        "http_status":status,
        "authenticated_validation_reached":authenticated_validation,
        "response_json":isinstance(body,dict),
        "mutation_performed":False,
    }

def credential_match(raw_credential: str):
    if not raw_credential:
        return None
    digest=hashlib.sha256(raw_credential.encode("utf-8")).hexdigest()
    rows=d1(
        "SELECT k.id AS key_id,k.customer_id,"
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
        "key_id":row.get("key_id"),
        "customer_id":row.get("customer_id"),
    }

def qualify_live_identity(raw_credential: str, match: dict):
    scenario=[{
        "hazard":"Ground collapse",
        "exposure":0.54,
        "severity":10,
        "likelihood":0.62,
        "cost":18000,
        "benefit":0.34,
    }]
    catalog=AdapterCatalog()
    catalog.register(AdapterContract(
        name="Mining Adapter",
        domain="mining",
        version="1.0.0",
        normalize=normalize_mining_rows,
    ))
    fabric=ConnectFabric(signing_secret=secrets.token_bytes(32))
    runtime=ConnectRuntime(
        catalog=catalog,
        fabric=fabric,
        axiom=AxiomGateway(
            IntegrationGate(allowed=True,reason="non-fixture production identity qualification"),
            executor=AxiomMcpExecutor(MCP_BASE+"/mcp",raw_credential,timeout=50),
        ),
    )
    run_id="identity-live-"+uuid.uuid4().hex[:12]
    run=runtime.ingest(
        run_id=run_id,
        connector_name="non-fixture-identity-qualification",
        domain="mining",
        adapter_name="Mining Adapter",
        records=scenario,
    )
    payload={
        "contract":run.canonical.contract,
        "domain":run.canonical.domain,
        "records":[dict(item) for item in run.canonical.records],
        "run_id":run.fabric.run_id,
    }
    canonical_sha256=hashlib.sha256(canonical_bytes(payload)).hexdigest()
    request_id=f"MUSITU-CONNECT-{run_id}-{canonical_sha256[:16]}"
    before=d1(
        "SELECT count(*) AS n FROM usage_events WHERE customer_id=?1 AND request_id=?2",
        [match["customer_id"],request_id],
    )
    if int(before[0].get("n") or 0)!=0:
        raise RuntimeError("unexpected preexisting production identity request id")

    structured=runtime.execute_mining_risk(run)
    if "3.348" not in json.dumps(structured,separators=(",",":"),sort_keys=True):
        raise RuntimeError("non-fixture identity Connect result mismatch")

    events=d1(
        "SELECT request_id,operation,compute_units,http_status,result_sha256,key_id "
        "FROM usage_events WHERE customer_id=?1 AND request_id=?2",
        [match["customer_id"],request_id],
    )
    if len(events)!=1:
        raise RuntimeError("non-fixture identity usage event exact delta mismatch")
    event=events[0]
    if (
        event.get("request_id")!=request_id
        or event.get("operation")!="arithmetic.evaluate"
        or int(event.get("http_status") or 0)!=200
        or int(event.get("compute_units") or 0)<=0
        or len(str(event.get("result_sha256") or ""))<32
        or event.get("key_id")!=match["key_id"]
    ):
        raise RuntimeError("non-fixture identity usage-ledger correlation mismatch")

    return {
        "authenticated_connect_mcp_call":True,
        "canonical_sha256":canonical_sha256,
        "connect_request_id":request_id,
        "exact_usage_ledger_request_id_correlation":True,
        "usage_event_persisted_as_evidence":True,
        "result_3_348_observed":True,
    }

def main():
    if ACCOUNT_KEY:
        print("::add-mask::"+ACCOUNT_KEY)
    if BEARER:
        print("::add-mask::"+BEARER)
    if MUSITU_CONTROL:
        print("::add-mask::"+MUSITU_CONTROL)
    if LEGACY_CONTROL:
        print("::add-mask::"+LEGACY_CONTROL)

    hs,raw=call(
        MCP_BASE+"/health",
        headers={"Accept":"application/json","User-Agent":"MUSITU-Connect-Identity-Preflight/2.0"},
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

    successor_admin_probe=probe_admin_control(MUSITU_CONTROL,"x-musitu-control")
    legacy_admin_probe=probe_admin_control(LEGACY_CONTROL,"x-mft-control")
    supported_admin_probe=None
    if (successor_admin_probe or {}).get("authenticated_validation_reached"):
        supported_admin_probe=successor_admin_probe
    elif (legacy_admin_probe or {}).get("authenticated_validation_reached"):
        supported_admin_probe=legacy_admin_probe

    account_match=credential_match(ACCOUNT_KEY)
    bearer_match=credential_match(BEARER)
    selected=None
    selected_match=None
    selected_kind=None
    if (BEARER and (bearer_match or {}).get("active_non_fixture")):
        selected=BEARER
        selected_match=bearer_match
        selected_kind="dedicated_bearer"
    elif (ACCOUNT_KEY and (account_match or {}).get("active_non_fixture")):
        selected=ACCOUNT_KEY
        selected_match=account_match
        selected_kind="dedicated_account_key"

    live_proof=None
    if selected is not None:
        live_proof=qualify_live_identity(selected,selected_match)

    ready=live_proof is not None
    evidence={
        "schema":"musitu.connect.non_fixture_identity_preflight.v2",
        "source_commit":os.environ.get("GITHUB_SHA"),
        "workflow_run_id":os.environ.get("GITHUB_RUN_ID"),
        "mcp_health_verified":True,
        "active_non_fixture_customer_count":int(counts[0].get("customers") or 0),
        "active_non_fixture_api_key_count":int(counts[0].get("api_keys") or 0),
        "dedicated_account_key_secret_present":bool(ACCOUNT_KEY),
        "dedicated_bearer_secret_present":bool(BEARER),
        "successor_admin_control_secret_present":bool(MUSITU_CONTROL),
        "legacy_admin_control_secret_present":bool(LEGACY_CONTROL),
        "admin_control_secret_present":bool(MUSITU_CONTROL or LEGACY_CONTROL),
        "successor_admin_control_probe":successor_admin_probe,
        "legacy_admin_control_probe":legacy_admin_probe,
        "supported_admin_provisioning_validation_reached":supported_admin_probe is not None,
        "supported_admin_control_header":supported_admin_probe.get("header") if supported_admin_probe else None,
        "dedicated_account_key_matches_active_non_fixture_identity":bool((account_match or {}).get("active_non_fixture")),
        "dedicated_bearer_matches_active_non_fixture_identity":bool((bearer_match or {}).get("active_non_fixture")),
        "selected_credential_kind":selected_kind,
        "live_identity_proof":live_proof,
        "non_fixture_identity_control_ready":ready,
        "credential_values_published":False,
        "customer_identifiers_published":False,
        "key_identifiers_published":False,
        "identity_records_created_or_modified":False,
        "production_axiom_integration_enabled":False,
        "gate":"MUSITU_CONNECT_NON_FIXTURE_IDENTITY_QUALIFIED" if ready else "MUSITU_CONNECT_NON_FIXTURE_IDENTITY_BLOCKED",
        "blocker":None if ready else (
            "No dedicated Connect Axiom credential is available in CI that matches an active "
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
        "successor_admin_control_secret_present":evidence["successor_admin_control_secret_present"],
        "legacy_admin_control_secret_present":evidence["legacy_admin_control_secret_present"],
        "admin_control_secret_present":evidence["admin_control_secret_present"],
        "supported_admin_provisioning_validation_reached":evidence["supported_admin_provisioning_validation_reached"],
        "supported_admin_control_header":evidence["supported_admin_control_header"],
        "live_identity_proof_executed":live_proof is not None,
        "non_fixture_identity_control_ready":ready,
        "identity_records_created_or_modified":False,
        "production_axiom_integration_enabled":False,
        "evidence_sha256":digest,
    },sort_keys=True))

if __name__=="__main__":
    main()
