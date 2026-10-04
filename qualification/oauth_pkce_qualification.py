"""Live OAuth authorization-code + PKCE qualification for MUSITU Connect.

This qualification uses a disposable source account identity in the production OAuth
ledger, exercises the public OAuth and MCP endpoints, verifies fail-closed negative
cases, and deletes every fixture row it creates. It never enables production runtime
integration.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

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
MCP_BASE=os.environ.get("MCP_BASE","https://mcp.mftintelligence.com").rstrip("/")
OAUTH_ISSUER=os.environ.get("OAUTH_ISSUER","https://auth.mftintelligence.com").rstrip("/")
CF_TOKEN=os.environ["CLOUDFLARE_API_TOKEN"]
CALLBACK="https://chatgpt.com/connector/oauth/musitu-connect-qualification"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def http(
    url: str,
    method: str="GET",
    headers: dict[str,str] | None=None,
    body: bytes | None=None,
    *,
    timeout: int=50,
    follow: bool=True,
):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    opener=urllib.request.build_opener() if follow else urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req,timeout=timeout) as response:
            return response.status,response.headers,response.read()
    except urllib.error.HTTPError as exc:
        return exc.code,exc.headers,exc.read()

def http_json(
    url: str,
    method: str="GET",
    obj: Any | None=None,
    headers: dict[str,str] | None=None,
    *,
    follow: bool=True,
):
    h={"Accept":"application/json","User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/1.0"}
    if headers:
        h.update(headers)
    body=None
    if obj is not None:
        h["Content-Type"]="application/json"
        body=json.dumps(obj,separators=(",",":")).encode("utf-8")
    status,resp_headers,raw=http(url,method,h,body,follow=follow)
    try:
        parsed=json.loads(raw or b"{}")
    except Exception:
        parsed={}
    return status,resp_headers,parsed,raw

def form(
    url: str,
    fields: dict[str,str],
    headers: dict[str,str] | None=None,
    *,
    follow: bool=True,
):
    h={
        "Accept":"application/json",
        "Content-Type":"application/x-www-form-urlencoded",
        "User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/1.0",
    }
    if headers:
        h.update(headers)
    body=urllib.parse.urlencode(fields).encode("utf-8")
    return http(url,"POST",h,body,follow=follow)

def direct_form_no_redirect(
    url: str,
    fields: dict[str,str],
    headers: dict[str,str] | None=None,
):
    """POST a form over HTTPS without any redirect-capable client layer."""
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!="https" or not parsed.hostname:
        raise ValueError("direct_form_no_redirect requires HTTPS")
    path=parsed.path or "/"
    if parsed.query:
        path+="?"+parsed.query
    h={
        "Accept":"text/html",
        "Content-Type":"application/x-www-form-urlencoded",
        "User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/1.0",
    }
    if headers:
        h.update(headers)
    body=urllib.parse.urlencode(fields).encode("utf-8")
    conn=http.client.HTTPSConnection(parsed.hostname,parsed.port or 443,timeout=50)
    try:
        conn.request("POST",path,body=body,headers=h)
        response=conn.getresponse()
        raw=response.read()
        return response.status,dict(response.getheaders()),raw
    finally:
        conn.close()

def d1(sql: str, params: list[Any] | None=None) -> list[dict[str,Any]]:
    payload={"sql":sql}
    if params is not None:
        payload["params"]=params
    status,_,body=http(
        f"{CF_API}/accounts/{ACCOUNT_ID}/d1/database/{D1_UUID}/query",
        "POST",
        {
            "Authorization":"Bearer "+CF_TOKEN,
            "Accept":"application/json",
            "Content-Type":"application/json",
            "User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/1.0",
        },
        json.dumps(payload,separators=(",",":")).encode("utf-8"),
    )
    if not 200 <= status < 300:
        raise RuntimeError(f"D1 HTTP {status}")
    decoded=json.loads(body or b"{}")
    result=decoded.get("result") or []
    if not result or not all(item.get("success") is True for item in result):
        raise RuntimeError("D1 statement failed")
    rows=[]
    for item in result:
        rows.extend(item.get("results") or [])
    return rows

def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

def iso(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat().replace("+00:00","Z")

def assert_mcp_rejected(token: str, request_id: str) -> dict[str,Any]:
    payload={
        "jsonrpc":"2.0",
        "id":request_id,
        "method":"tools/call",
        "params":{
            "name":"musitu_axiom_execute",
            "arguments":{"operation":"arithmetic.evaluate","args":{"expression":"1+1"}},
        },
    }
    status,_,obj,_=http_json(
        MCP_BASE+"/mcp",
        "POST",
        payload,
        {
            "Authorization":"Bearer "+token,
            "x-musitu-request-id":request_id,
        },
    )
    result=obj.get("result") or {}
    structured=result.get("structuredContent") or {}
    rejected=(
        400 <= status < 500
        or bool(obj.get("error"))
        or result.get("isError") is True
        or structured.get("authenticated") is False
    )
    if not rejected:
        raise RuntimeError("revoked OAuth token was accepted by MCP")
    return {
        "pass":True,
        "http_status":status,
        "is_error":result.get("isError"),
        "authenticated":structured.get("authenticated"),
    }

def make_runtime(token: str, catalog: AdapterCatalog, fabric: ConnectFabric):
    return ConnectRuntime(
        catalog=catalog,
        fabric=fabric,
        axiom=AxiomGateway(
            IntegrationGate(allowed=True,reason="controlled OAuth PKCE qualification only"),
            executor=AxiomMcpExecutor(MCP_BASE+"/mcp",token,timeout=50),
        ),
    )

def main() -> None:
    if not CF_TOKEN:
        raise RuntimeError("CLOUDFLARE_API_TOKEN is required")

    # Public metadata must advertise the exact OAuth security contract.
    hs,_,health,_=http_json(OAUTH_ISSUER+"/health")
    if (
        hs!=200
        or health.get("ok") is not True
        or health.get("issuer")!=OAUTH_ISSUER
        or health.get("resource")!=MCP_BASE
        or health.get("dcr") is not True
        or health.get("pkce_s256") is not True
    ):
        raise RuntimeError("OAuth health contract mismatch")

    ds,_,discovery,_=http_json(OAUTH_ISSUER+"/.well-known/oauth-authorization-server")
    expected={
        "issuer":OAUTH_ISSUER,
        "authorization_endpoint":OAUTH_ISSUER+"/oauth/authorize",
        "token_endpoint":OAUTH_ISSUER+"/oauth/token",
        "registration_endpoint":OAUTH_ISSUER+"/oauth/register",
        "revocation_endpoint":OAUTH_ISSUER+"/oauth/revoke",
    }
    if (
        ds!=200
        or any(discovery.get(k)!=v for k,v in expected.items())
        or "S256" not in (discovery.get("code_challenge_methods_supported") or [])
        or "none" not in (discovery.get("token_endpoint_auth_methods_supported") or [])
    ):
        raise RuntimeError("OAuth discovery contract mismatch")

    # Invalid DCR redirect must fail closed before the positive client is created.
    bad_reg_status,_,bad_reg,_=http_json(
        OAUTH_ISSUER+"/oauth/register",
        "POST",
        {
            "redirect_uris":["https://example.com/not-chatgpt"],
            "client_name":"MUSITU Connect invalid redirect probe",
        },
    )
    if bad_reg_status!=400 or bad_reg.get("error")!="invalid_redirect_uri":
        raise RuntimeError("invalid OAuth redirect was not rejected")

    prefix="fixture_connect_pkce_"+uuid.uuid4().hex
    customer=prefix+"_customer"
    source_key_id=prefix+"_sourcekey"
    email=prefix+"@invalid.example"
    now=dt.datetime.now(dt.timezone.utc)
    created=iso(now)
    source_expires=iso(now+dt.timedelta(hours=1))
    account_key="musitu_axiom_connect_pkce_fixture_"+secrets.token_urlsafe(40)
    account_hash=hashlib.sha256(account_key.encode("utf-8")).hexdigest()
    account_prefix=account_key[:16]
    verifier=b64url(secrets.token_bytes(48))
    wrong_verifier=b64url(secrets.token_bytes(48))
    challenge=b64url(hashlib.sha256(verifier.encode("utf-8")).digest())
    state="st_"+secrets.token_urlsafe(20)

    for secret in (account_key,verifier,wrong_verifier,state):
        print("::add-mask::"+secret)

    client_id=""
    access=""
    refresh=""
    access2=""
    refresh2=""
    evidence: dict[str,Any]={}
    customer_inserted=False

    try:
        # Disposable source account: this proves the OAuth protocol, not non-fixture identity.
        d1(
            "INSERT INTO customers(id,email,name,plan,status,monthly_unit_override,created_at,updated_at) "
            "VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",
            [customer,email,"MUSITU Connect OAuth PKCE fixture","developer","active",100,created],
        )
        d1(
            "INSERT INTO api_keys(id,customer_id,key_hash,key_prefix,label,status,created_at,last_used_at,expires_at,revoked_at) "
            "VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,NULL)",
            [source_key_id,customer,account_hash,account_prefix,"connect-oauth-pkce-source-key","active",created,source_expires],
        )
        customer_inserted=True

        rc,_,reg,_=http_json(
            OAUTH_ISSUER+"/oauth/register",
            "POST",
            {
                "redirect_uris":[CALLBACK],
                "client_name":"MUSITU Connect OAuth PKCE Qualification",
                "token_endpoint_auth_method":"none",
                "grant_types":["authorization_code","refresh_token"],
                "response_types":["code"],
            },
        )
        if rc!=201 or not reg.get("client_id"):
            raise RuntimeError(f"DCR failed HTTP {rc}")
        client_id=str(reg["client_id"])
        print("::add-mask::"+client_id)

        query={
            "response_type":"code",
            "client_id":client_id,
            "redirect_uri":CALLBACK,
            "scope":"axiom.execute openid email",
            "state":state,
            "code_challenge":challenge,
            "code_challenge_method":"S256",
            "resource":MCP_BASE,
        }
        ac,ah,ab=http(
            OAUTH_ISSUER+"/oauth/authorize?"+urllib.parse.urlencode(query),
            headers={"Accept":"text/html","User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/1.0"},
        )
        if ac!=200:
            raise RuntimeError(f"authorization page HTTP {ac}")
        page=ab.decode("utf-8","replace")
        match=re.search(r'name="flow_id" value="([^"]+)"',page)
        cookie_header=str(ah.get("Set-Cookie") or "")
        if not match or "musitu_oauth_flow=" not in cookie_header:
            raise RuntimeError("authorization flow/cookie missing")
        flow_id=match.group(1)
        cookie=cookie_header.split(";",1)[0]
        print("::add-mask::"+flow_id)

        pc,ph,pb=direct_form_no_redirect(
            OAUTH_ISSUER+"/oauth/authorize",
            {"flow_id":flow_id,"musitu_account_key":account_key},
            {"Cookie":cookie},
        )
        if pc!=302:
            flow_state=d1(
                "SELECT used_at FROM oauth_authorization_flows WHERE id=?1",
                [flow_id],
            )
            code_count=d1(
                "SELECT count(*) AS n FROM oauth_authorization_codes WHERE client_id=?1 AND customer_id=?2",
                [client_id,customer],
            )
            meta={
                "http_status":pc,
                "content_type":str(ph.get("Content-Type") or ph.get("content-type") or ""),
                "body_sha256":hashlib.sha256(pb).hexdigest(),
                "body_length":len(pb),
                "flow_used":bool(flow_state and flow_state[0].get("used_at")),
                "authorization_code_rows":int(code_count[0]["n"]) if code_count else -1,
            }
            raise RuntimeError("authorization consent redirect contract mismatch "+json.dumps(meta,sort_keys=True))
        location=str(ph.get("Location") or "")
        parsed=urllib.parse.urlparse(location)
        params=urllib.parse.parse_qs(parsed.query)
        code=(params.get("code") or [""])[0]
        returned_state=(params.get("state") or [""])[0]
        if not code or returned_state!=state:
            raise RuntimeError("authorization redirect code/state mismatch")
        print("::add-mask::"+code)

        # A wrong S256 verifier must not consume the code.
        bad_pkce_status,_,bad_pkce_body=form(
            OAUTH_ISSUER+"/oauth/token",
            {
                "grant_type":"authorization_code",
                "code":code,
                "code_verifier":wrong_verifier,
                "client_id":client_id,
                "redirect_uri":CALLBACK,
                "resource":MCP_BASE,
            },
        )
        bad_pkce=json.loads(bad_pkce_body or b"{}")
        if bad_pkce_status!=400 or bad_pkce.get("error")!="invalid_grant":
            raise RuntimeError("wrong PKCE verifier was not rejected")

        tc,_,token_body=form(
            OAUTH_ISSUER+"/oauth/token",
            {
                "grant_type":"authorization_code",
                "code":code,
                "code_verifier":verifier,
                "client_id":client_id,
                "redirect_uri":CALLBACK,
                "resource":MCP_BASE,
            },
        )
        if tc!=200:
            raise RuntimeError(f"authorization-code exchange HTTP {tc}")
        token=json.loads(token_body or b"{}")
        access=str(token.get("access_token") or "")
        refresh=str(token.get("refresh_token") or "")
        if (
            not access
            or not refresh
            or token.get("token_type")!="Bearer"
            or int(token.get("expires_in") or 0)!=3600
            or token.get("resource")!=MCP_BASE
            or "axiom.execute" not in str(token.get("scope") or "").split()
        ):
            raise RuntimeError("OAuth token response contract mismatch")
        print("::add-mask::"+access)
        print("::add-mask::"+refresh)

        # Authorization codes are one-time.
        replay_status,_,replay_body=form(
            OAUTH_ISSUER+"/oauth/token",
            {
                "grant_type":"authorization_code",
                "code":code,
                "code_verifier":verifier,
                "client_id":client_id,
                "redirect_uri":CALLBACK,
                "resource":MCP_BASE,
            },
        )
        replay=json.loads(replay_body or b"{}")
        if replay_status!=400 or replay.get("error")!="invalid_grant":
            raise RuntimeError("authorization code replay was not rejected")

        access_hash=hashlib.sha256(access.encode("utf-8")).hexdigest()
        ledger=d1(
            "SELECT a.api_key_id,a.customer_id,a.issuer,a.resource,a.scope,a.expires_at,a.revoked_at,k.status "
            "FROM oauth_access_tokens a JOIN api_keys k ON k.id=a.api_key_id WHERE a.token_hash=?1",
            [access_hash],
        )
        if (
            len(ledger)!=1
            or ledger[0].get("customer_id")!=customer
            or ledger[0].get("issuer")!=OAUTH_ISSUER
            or ledger[0].get("resource")!=MCP_BASE
            or ledger[0].get("status")!="active"
            or ledger[0].get("revoked_at")
        ):
            raise RuntimeError("OAuth access-token ledger mismatch")

        us,_,userinfo,_=http_json(
            OAUTH_ISSUER+"/oauth/userinfo",
            headers={"Authorization":"Bearer "+access},
        )
        if us!=200 or userinfo.get("email")!=email or not userinfo.get("sub"):
            raise RuntimeError("OAuth userinfo contract mismatch")

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

        run_id="mining-oauth-pkce-"+uuid.uuid4().hex[:12]
        ingest=ConnectRuntime(
            catalog=catalog,
            fabric=fabric,
            axiom=AxiomGateway(IntegrationGate()),
        )
        run=ingest.ingest(
            run_id=run_id,
            connector_name="oauth-pkce-live-qualification",
            domain="mining",
            adapter_name="Mining Adapter",
            records=scenario,
        )
        canonical_input={
            "contract":run.canonical.contract,
            "domain":run.canonical.domain,
            "records":[dict(item) for item in run.canonical.records],
            "run_id":run.fabric.run_id,
        }
        canonical_sha256=hashlib.sha256(canonical_bytes(canonical_input)).hexdigest()
        request_id=f"MUSITU-CONNECT-{run_id}-{canonical_sha256[:16]}"
        before_events=int(d1(
            "SELECT count(*) AS n FROM usage_events WHERE customer_id=?1",
            [customer],
        )[0]["n"])

        structured=make_runtime(access,catalog,fabric).execute_mining_risk(run)
        if structured.get("request_id") is not None:
            raise RuntimeError("public MCP leaked sanitized internal request ID")
        if "3.348" not in json.dumps(structured,separators=(",",":"),sort_keys=True):
            raise RuntimeError("expected OAuth-backed Connect arithmetic result absent")

        events=d1(
            "SELECT request_id,operation,compute_units,http_status,result_sha256 "
            "FROM usage_events WHERE customer_id=?1 ORDER BY created_at DESC",
            [customer],
        )
        if len(events)!=before_events+1:
            raise RuntimeError("OAuth-backed Connect usage event delta mismatch")
        match_events=[
            row for row in events
            if row.get("request_id")==request_id
            and row.get("operation")=="arithmetic.evaluate"
            and int(row.get("http_status") or 0)==200
        ]
        if len(match_events)!=1:
            raise RuntimeError("OAuth-backed Connect request-ID correlation mismatch")
        usage_event=match_events[0]
        if int(usage_event.get("compute_units") or 0)<=0 or len(str(usage_event.get("result_sha256") or ""))<32:
            raise RuntimeError("OAuth-backed usage ledger evidence incomplete")

        # Refresh token rotation must revoke the first OAuth access identity.
        fc,_,refresh_body=form(
            OAUTH_ISSUER+"/oauth/token",
            {
                "grant_type":"refresh_token",
                "refresh_token":refresh,
                "client_id":client_id,
                "resource":MCP_BASE,
            },
        )
        if fc!=200:
            raise RuntimeError(f"refresh grant HTTP {fc}")
        rotated=json.loads(refresh_body or b"{}")
        access2=str(rotated.get("access_token") or "")
        refresh2=str(rotated.get("refresh_token") or "")
        if not access2 or not refresh2 or access2==access or refresh2==refresh:
            raise RuntimeError("OAuth refresh rotation contract mismatch")
        print("::add-mask::"+access2)
        print("::add-mask::"+refresh2)

        old=d1(
            "SELECT a.revoked_at,k.status FROM oauth_access_tokens a "
            "JOIN api_keys k ON k.id=a.api_key_id WHERE a.token_hash=?1",
            [access_hash],
        )
        if len(old)!=1 or not old[0].get("revoked_at") or old[0].get("status")!="revoked":
            raise RuntimeError("old OAuth access identity not revoked during refresh")

        refresh_run_id=run_id+"-refresh"
        refresh_run=ingest.ingest(
            run_id=refresh_run_id,
            connector_name="oauth-pkce-refresh-qualification",
            domain="mining",
            adapter_name="Mining Adapter",
            records=scenario,
        )
        refresh_payload={
            "contract":refresh_run.canonical.contract,
            "domain":refresh_run.canonical.domain,
            "records":[dict(item) for item in refresh_run.canonical.records],
            "run_id":refresh_run.fabric.run_id,
        }
        refresh_sha=hashlib.sha256(canonical_bytes(refresh_payload)).hexdigest()
        refresh_request_id=f"MUSITU-CONNECT-{refresh_run_id}-{refresh_sha[:16]}"
        refreshed=make_runtime(access2,catalog,fabric).execute_mining_risk(refresh_run)
        if "3.348" not in json.dumps(refreshed,separators=(",",":"),sort_keys=True):
            raise RuntimeError("refreshed OAuth access failed Connect MCP execution")

        refreshed_events=d1(
            "SELECT request_id,http_status FROM usage_events WHERE customer_id=?1 ORDER BY created_at DESC",
            [customer],
        )
        if not any(
            row.get("request_id")==refresh_request_id and int(row.get("http_status") or 0)==200
            for row in refreshed_events
        ):
            raise RuntimeError("refreshed OAuth Connect request-ID missing from usage ledger")

        vc,_,_=form(
            OAUTH_ISSUER+"/oauth/revoke",
            {"token":access2,"client_id":client_id},
        )
        if vc!=200:
            raise RuntimeError(f"OAuth revocation HTTP {vc}")
        access2_hash=hashlib.sha256(access2.encode("utf-8")).hexdigest()
        refresh2_hash=hashlib.sha256(refresh2.encode("utf-8")).hexdigest()
        revoked=d1(
            "SELECT a.revoked_at,k.status,"
            "(SELECT revoked_at FROM oauth_refresh_tokens WHERE token_hash=?2) AS refresh_revoked "
            "FROM oauth_access_tokens a JOIN api_keys k ON k.id=a.api_key_id "
            "WHERE a.token_hash=?1",
            [access2_hash,refresh2_hash],
        )
        if (
            len(revoked)!=1
            or not revoked[0].get("revoked_at")
            or revoked[0].get("status")!="revoked"
            or not revoked[0].get("refresh_revoked")
        ):
            raise RuntimeError("OAuth revocation ledger mismatch")

        revoked_rejection=assert_mcp_rejected(
            access2,
            "MUSITU-CONNECT-OAUTH-REVOKED-"+uuid.uuid4().hex[:16],
        )

        evidence={
            "schema":"musitu.connect.oauth_pkce_qualification.v1",
            "gate":"MUSITU_CONNECT_OAUTH_PKCE_QUALIFIED",
            "source_commit":os.environ.get("GITHUB_SHA"),
            "workflow_run_id":os.environ.get("GITHUB_RUN_ID"),
            "product":"MUSITU Connect",
            "axiom_role":"downstream engine",
            "oauth_issuer":OAUTH_ISSUER,
            "oauth_resource":MCP_BASE,
            "oauth_health_verified":True,
            "oauth_discovery_verified":True,
            "dynamic_client_registration":True,
            "invalid_redirect_rejected":True,
            "authorization_consent_flow":True,
            "pkce_s256":True,
            "wrong_pkce_verifier_rejected":True,
            "authorization_code_one_time":True,
            "userinfo_verified":True,
            "oauth_scope":"axiom.execute openid email",
            "disposable_source_identity":True,
            "non_fixture_production_identity":False,
            "connect_canonical_sha256":canonical_sha256,
            "connect_request_id":request_id,
            "axiom_usage_ledger_request_id":usage_event.get("request_id"),
            "exact_request_id_correlation":usage_event.get("request_id")==request_id,
            "jsonrpc_response_id_exact_match_enforced":True,
            "public_structured_request_id_sanitized":True,
            "authenticated_connect_mcp_call":True,
            "result_3_348_observed":True,
            "refresh_token_rotation":True,
            "refreshed_access_connect_mcp_call":True,
            "refresh_request_id":refresh_request_id,
            "revocation_verified":True,
            "revoked_access_rejected_by_mcp":revoked_rejection,
            "raw_account_key_published":False,
            "raw_authorization_code_published":False,
            "raw_access_token_published":False,
            "raw_refresh_token_published":False,
            "production_axiom_integration_enabled":False,
            "claims":{
                "production_non_fixture_identity":"NOT_DEMONSTRATED",
                "production_credential_rotation_recovery":"NOT_DEMONSTRATED",
                "production_rollback":"NOT_DEMONSTRATED",
                "production_observability_slo":"NOT_DEMONSTRATED",
                "production_canary":"NOT_DEMONSTRATED",
                "mine_specific_predictive_accuracy":"NOT_CERTIFIED",
                "mine_safety_certification":"NOT_CERTIFIED",
                "global_superiority":"NOT_CERTIFIED",
            },
        }
    finally:
        # Delete only exact fixture/customer/client state from this run.
        if customer_inserted or client_id:
            try:
                if customer_inserted:
                    d1("DELETE FROM usage_events WHERE customer_id=?1",[customer])
                    d1("DELETE FROM usage_buckets WHERE customer_id=?1",[customer])
                    d1("DELETE FROM oauth_access_tokens WHERE customer_id=?1",[customer])
                    d1("DELETE FROM oauth_refresh_tokens WHERE customer_id=?1",[customer])
                    d1("DELETE FROM oauth_authorization_codes WHERE customer_id=?1",[customer])
                    d1("DELETE FROM api_keys WHERE customer_id=?1",[customer])
                if client_id:
                    d1("DELETE FROM oauth_authorization_flows WHERE client_id=?1",[client_id])
                    d1("DELETE FROM oauth_clients WHERE client_id=?1",[client_id])
                if customer_inserted:
                    d1("DELETE FROM customers WHERE id=?1",[customer])
            finally:
                remaining=d1(
                    "SELECT "
                    "(SELECT count(*) FROM customers WHERE id=?1)+"
                    "(SELECT count(*) FROM api_keys WHERE customer_id=?1)+"
                    "(SELECT count(*) FROM usage_events WHERE customer_id=?1)+"
                    "(SELECT count(*) FROM usage_buckets WHERE customer_id=?1)+"
                    "(SELECT count(*) FROM oauth_access_tokens WHERE customer_id=?1)+"
                    "(SELECT count(*) FROM oauth_refresh_tokens WHERE customer_id=?1)+"
                    "(SELECT count(*) FROM oauth_authorization_codes WHERE customer_id=?1)+"
                    "(SELECT count(*) FROM oauth_authorization_flows WHERE client_id=?2)+"
                    "(SELECT count(*) FROM oauth_clients WHERE client_id=?2) AS n",
                    [customer,client_id],
                )
                evidence["fixture_rows_remaining"]=int(remaining[0]["n"]) if remaining else -1

    if evidence.get("gate")!="MUSITU_CONNECT_OAUTH_PKCE_QUALIFIED":
        raise RuntimeError("OAuth PKCE qualification did not reach PASS gate")
    if evidence.get("fixture_rows_remaining")!=0:
        raise RuntimeError("OAuth PKCE fixture cleanup failed")
    evidence["cleanup_complete"]=True

    raw=(json.dumps(evidence,indent=2,sort_keys=True)+"\n").encode("utf-8")
    out=Path("musitu-connect-oauth-pkce-qualification.json")
    out.write_bytes(raw)
    digest=hashlib.sha256(raw).hexdigest()
    Path("musitu-connect-oauth-pkce-qualification.sha256").write_text(
        digest+"  "+out.name+"\n",
        encoding="utf-8",
    )
    print("MUSITU_CONNECT_OAUTH_PKCE_EVIDENCE="+json.dumps({
        "gate":evidence["gate"],
        "authorization_consent_flow":True,
        "dynamic_client_registration":True,
        "pkce_s256":True,
        "wrong_pkce_verifier_rejected":True,
        "authorization_code_one_time":True,
        "exact_request_id_correlation":evidence["exact_request_id_correlation"],
        "refresh_token_rotation":True,
        "revocation_verified":True,
        "fixture_rows_remaining":0,
        "production_axiom_integration_enabled":False,
        "evidence_sha256":digest,
    },sort_keys=True))

if __name__=="__main__":
    main()
