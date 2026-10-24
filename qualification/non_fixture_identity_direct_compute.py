"""Live non-fixture identity qualification for the MUSITU Connect backend lane.

This proof uses the dedicated permanent Connect account key only against Axiom's
backend customer compute API. Public /mcp remains OAuth-only.
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
from connect.axiom_gateway import AxiomComputeExecutor, AxiomGateway
from connect.core import IntegrationGate
from connect.fabric import ConnectFabric
from connect.mining import normalize_mining_rows
from connect.runtime import ConnectRuntime
from connect.security import canonical_bytes

CF_API=os.environ.get("CF_API","https://api.cloudflare.com/client/v4").rstrip("/")
ACCOUNT_ID=os.environ["ACCOUNT_ID"]
D1_UUID=os.environ["D1_UUID"]
CF_TOKEN=os.environ["CLOUDFLARE_API_TOKEN"].strip()
AXIOM_BASE=os.environ.get("AXIOM_BASE","https://axiom.mftintelligence.com").rstrip("/")
ACCOUNT_KEY=os.environ["MUSITU_CONNECT_AXIOM_ACCOUNT_KEY"].strip()

def call(url: str, method: str="GET", headers=None, body: bytes|None=None):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(req,timeout=50) as response:
            return response.status,response.read()
    except urllib.error.HTTPError as exc:
        return exc.code,exc.read()

def d1(sql: str, params=None):
    payload={"sql":sql}
    if params is not None:
        payload["params"]=params
    code,raw=call(
        f"{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{D1_UUID}/query",
        "POST",
        {
            "Authorization":"Bearer "+CF_TOKEN,
            "Accept":"application/json",
            "Content-Type":"application/json",
            "User-Agent":"MUSITU-Connect-Direct-Identity-Qualification/1.0",
        },
        json.dumps(payload,separators=(",",":")).encode(),
    )
    if code!=200:
        raise RuntimeError("D1_QUERY_HTTP_"+str(code))
    obj=json.loads(raw or b"{}")
    batches=obj.get("result") or []
    if not batches or not all(x.get("success") is True for x in batches):
        raise RuntimeError("D1_QUERY_FAILED")
    rows=[]
    for batch in batches:
        rows.extend(batch.get("results") or [])
    return rows

def main():
    if not ACCOUNT_KEY:
        raise RuntimeError("DEDICATED_ACCOUNT_KEY_MISSING")
    print("::add-mask::"+ACCOUNT_KEY)

    hc,hraw=call(
        AXIOM_BASE+"/health",
        headers={"Accept":"application/json","User-Agent":"MUSITU-Connect-Direct-Identity-Qualification/1.0"},
    )
    health=json.loads(hraw or b"{}")
    if hc!=200 or health.get("ok") is not True:
        raise RuntimeError("AXIOM_DIRECT_COMPUTE_HEALTH_FAILED")

    digest=hashlib.sha256(ACCOUNT_KEY.encode()).hexdigest()
    matches=d1(
        "SELECT k.id AS key_id,k.customer_id,k.status AS key_status,c.status AS customer_status,"
        "CASE WHEN k.id LIKE 'fixture_%' OR c.id LIKE 'fixture_%' THEN 1 ELSE 0 END AS fixture,"
        "CASE WHEN k.revoked_at IS NULL THEN 0 ELSE 1 END AS revoked,"
        "CASE WHEN k.expires_at IS NULL OR k.expires_at>datetime('now') THEN 0 ELSE 1 END AS expired "
        "FROM api_keys k JOIN customers c ON c.id=k.customer_id WHERE k.key_hash=?1",
        [digest],
    )
    if len(matches)!=1:
        raise RuntimeError("DEDICATED_ACCOUNT_KEY_MATCH_COUNT")
    match=matches[0]
    if (
        int(match.get("fixture") or 0)!=0
        or match.get("key_status")!="active"
        or match.get("customer_status")!="active"
        or int(match.get("revoked") or 0)!=0
        or int(match.get("expired") or 0)!=0
    ):
        raise RuntimeError("DEDICATED_ACCOUNT_KEY_NOT_ACTIVE_NON_FIXTURE")

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
    runtime=ConnectRuntime(
        catalog=catalog,
        fabric=ConnectFabric(signing_secret=secrets.token_bytes(32)),
        axiom=AxiomGateway(
            IntegrationGate(allowed=True,reason="non-fixture direct compute qualification"),
            executor=AxiomComputeExecutor(AXIOM_BASE+"/v1/compute",ACCOUNT_KEY,timeout=50),
        ),
    )
    run_id="identity-direct-"+uuid.uuid4().hex[:12]
    run=runtime.ingest(
        run_id=run_id,
        connector_name="non-fixture-direct-compute-qualification",
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
        raise RuntimeError("PREEXISTING_REQUEST_ID")

    result=runtime.execute_mining_risk(run)
    if "3.348" not in json.dumps(result,separators=(",",":"),sort_keys=True):
        raise RuntimeError("DIRECT_COMPUTE_RESULT_MISMATCH")

    events=d1(
        "SELECT request_id,operation,compute_units,http_status,result_sha256,key_id "
        "FROM usage_events WHERE customer_id=?1 AND request_id=?2",
        [match["customer_id"],request_id],
    )
    if len(events)!=1:
        raise RuntimeError("USAGE_EVENT_EXACT_DELTA_MISMATCH")
    event=events[0]
    if (
        event.get("request_id")!=request_id
        or event.get("operation")!="arithmetic.evaluate"
        or int(event.get("http_status") or 0)!=200
        or int(event.get("compute_units") or 0)<=0
        or len(str(event.get("result_sha256") or ""))<32
        or event.get("key_id")!=match["key_id"]
    ):
        raise RuntimeError("USAGE_LEDGER_CORRELATION_MISMATCH")

    evidence={
        "schema":"musitu.connect.non_fixture_identity_direct_compute.v1",
        "gate":"MUSITU_CONNECT_NON_FIXTURE_IDENTITY_QUALIFIED",
        "backend_lane":"axiom_direct_compute",
        "direct_compute_health_verified":True,
        "dedicated_account_key_matches_active_non_fixture_identity":True,
        "authenticated_connect_compute_call":True,
        "exact_usage_ledger_request_id_correlation":True,
        "usage_event_persisted_as_evidence":True,
        "result_3_348_observed":True,
        "credential_values_published":False,
        "customer_identifiers_published":False,
        "key_identifiers_published":False,
        "production_axiom_integration_enabled":False,
        "source_commit":os.environ.get("GITHUB_SHA"),
        "workflow_run_id":os.environ.get("GITHUB_RUN_ID"),
    }
    raw=(json.dumps(evidence,indent=2,sort_keys=True)+"\n").encode()
    Path("musitu-connect-non-fixture-direct-compute.json").write_bytes(raw)
    dg=hashlib.sha256(raw).hexdigest()
    Path("musitu-connect-non-fixture-direct-compute.sha256").write_text(
        dg+"  musitu-connect-non-fixture-direct-compute.json\n",encoding="utf-8"
    )
    print("MUSITU_CONNECT_DIRECT_IDENTITY_QUALIFICATION="+json.dumps({
        "gate":evidence["gate"],
        "backend_lane":evidence["backend_lane"],
        "exact_usage_ledger_request_id_correlation":True,
        "result_3_348_observed":True,
        "production_axiom_integration_enabled":False,
        "evidence_sha256":dg,
    },sort_keys=True))

if __name__=="__main__":
    main()
