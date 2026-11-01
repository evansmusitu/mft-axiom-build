"""Composed OAuth authorization-code + PKCE qualification for MUSITU Connect.

Why composed:
- A sealed production OAuth E2E artifact already proves the complete DCR -> consent ->
  authorization-code + S256 PKCE -> bearer -> MCP -> refresh -> revoke path.
- The current OAuth worker adds UserInfo only; this validator proves the core OAuth
  functions are byte-for-byte identical to the sealed proven version.
- A fresh live probe proves the current deployed OAuth endpoint still performs DCR,
  serves consent, authenticates a disposable account key, consumes the flow, and
  creates the correctly bound authorization-code row.

The public edge currently transforms the worker's post-consent 302 into a 200 HTML
response for this headless client. We therefore do not pretend a fresh single-run
redirect/token exchange occurred when the raw code is not observable. The composed
control remains fail-closed and explicitly records that boundary.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import http.client as http_client
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any

ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0,str(ROOT))

CF_API=os.environ.get("CF_API","https://api.cloudflare.com/client/v4")
ACCOUNT_ID=os.environ["ACCOUNT_ID"]
D1_UUID=os.environ["D1_UUID"]
MCP_BASE=os.environ.get("MCP_BASE","https://mcp.mftintelligence.com").rstrip("/")
OAUTH_ISSUER=os.environ.get("OAUTH_ISSUER","https://auth.mftintelligence.com").rstrip("/")
CF_TOKEN=os.environ["CLOUDFLARE_API_TOKEN"]
CALLBACK="https://chatgpt.com/connector/oauth/musitu-connect-qualification"

PROVEN_COMMIT="e4bb32fda174ceba1c81238bf838d5b56c783ace"
PROVEN_RUN_ID=33993096141
PROVEN_ARTIFACT_ID=9977729938
PROVEN_ARTIFACT_ZIP_DIGEST="sha256:3df15f8b9d8e92b0e60be1002ac90274701b6fa624052431f8e19e0684393768"
PROVEN_EVIDENCE_SHA256="a77e285665af5b7ca7cd6dfd63ab7f1b35ff04a8d3d2be39ef09d96cdce06d43"
EVIDENCE_PATH=ROOT/"qualification"/"evidence"/"musitu_axiom_oauth_production_e2e_2026-09-05.json"
EVIDENCE_SHA_PATH=ROOT/"qualification"/"evidence"/"musitu_axiom_oauth_production_e2e_2026-09-05.sha256"
CURRENT_SOURCE_PATH=ROOT/"auth"/"musitu_axiom_oauth_worker.mjs"
CORE_FUNCTIONS=("register","authorizeGet","authorizePost","mint","token","revoke")

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
    h={"Accept":"application/json","User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/2.0"}
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
        "User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/2.0",
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
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!="https" or not parsed.hostname:
        raise ValueError("direct_form_no_redirect requires HTTPS")
    path=parsed.path or "/"
    if parsed.query:
        path+="?"+parsed.query
    h={
        "Accept":"text/html",
        "Content-Type":"application/x-www-form-urlencoded",
        "User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/2.0",
    }
    if headers:
        h.update(headers)
    body=urllib.parse.urlencode(fields).encode("utf-8")
    conn=http_client.HTTPSConnection(parsed.hostname,parsed.port or 443,timeout=50)
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
            "User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/2.0",
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

def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()

def extract_function(source: str, name: str) -> str:
    starts=(f"async function {name}(",f"function {name}(")
    start=-1
    for token in starts:
        start=source.find(token)
        if start>=0:
            break
    if start<0:
        raise RuntimeError(f"OAuth function missing: {name}")
    opening=source.find("{",start)
    if opening<0:
        raise RuntimeError(f"OAuth function body missing: {name}")
    depth=0
    quote=None
    escaped=False
    for index in range(opening,len(source)):
        char=source[index]
        if quote:
            if escaped:
                escaped=False
            elif char=="\\":
                escaped=True
            elif char==quote:
                quote=None
            continue
        if char in ("'",'"',"`"):
            quote=char
            continue
        if char=="{":
            depth+=1
        elif char=="}":
            depth-=1
            if depth==0:
                return source[start:index+1]
    raise RuntimeError(f"OAuth function is unterminated: {name}")

def validate_sealed_baseline() -> dict[str,Any]:
    raw=EVIDENCE_PATH.read_bytes()
    digest=sha256_bytes(raw)
    expected_line=EVIDENCE_SHA_PATH.read_text(encoding="utf-8").strip()
    expected_digest=expected_line.split()[0] if expected_line else ""
    if digest!=PROVEN_EVIDENCE_SHA256 or expected_digest!=PROVEN_EVIDENCE_SHA256:
        raise RuntimeError("sealed OAuth evidence checksum mismatch")
    evidence=json.loads(raw)
    required_true=(
        "authorization_code_flow",
        "authorization_code_one_time",
        "cleanup_complete",
        "dynamic_client_registration",
        "existing_musitu_account_authenticated",
        "metering_verified",
        "oauth_access_registered_as_axiom_bearer",
        "pkce_s256",
        "refresh_token_rotation",
        "resource_parameter_preserved",
        "revocation_verified",
        "usage_event_created",
    )
    if evidence.get("gate")!="MUSITU_AXIOM_OAUTH_E2E_PASS":
        raise RuntimeError("sealed OAuth evidence gate mismatch")
    if any(evidence.get(key) is not True for key in required_true):
        raise RuntimeError("sealed OAuth evidence missing required PASS claim")
    if int(evidence.get("fixture_rows_remaining",-1))!=0:
        raise RuntimeError("sealed OAuth evidence cleanup mismatch")
    if int(evidence.get("oauth_to_mcp_authenticated_compute_http") or 0)!=200:
        raise RuntimeError("sealed OAuth evidence MCP proof mismatch")
    if evidence.get("resource")!=MCP_BASE or evidence.get("issuer")!=OAUTH_ISSUER:
        raise RuntimeError("sealed OAuth issuer/resource mismatch")
    return evidence

def validate_core_compatibility(sealed: dict[str,Any]) -> dict[str,Any]:
    old_source=subprocess.run(
        ["git","show",f"{PROVEN_COMMIT}:auth/musitu_axiom_oauth_worker.mjs"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    if sha256_bytes(old_source.encode("utf-8"))!=sealed.get("oauth_worker_source_sha256"):
        raise RuntimeError("proven OAuth source does not match sealed evidence")
    current_source=CURRENT_SOURCE_PATH.read_text(encoding="utf-8")
    compatibility={}
    for name in CORE_FUNCTIONS:
        old_fn=extract_function(old_source,name)
        current_fn=extract_function(current_source,name)
        same=old_fn==current_fn
        compatibility[name]={
            "unchanged":same,
            "proven_sha256":sha256_bytes(old_fn.encode("utf-8")),
            "current_sha256":sha256_bytes(current_fn.encode("utf-8")),
        }
        if not same:
            raise RuntimeError(f"core OAuth function changed since sealed proof: {name}")
    return {
        "proven_commit":PROVEN_COMMIT,
        "proven_source_sha256":sha256_bytes(old_source.encode("utf-8")),
        "current_source_sha256":sha256_bytes(current_source.encode("utf-8")),
        "core_functions":compatibility,
    }

def main() -> None:
    sealed=validate_sealed_baseline()
    compatibility=validate_core_compatibility(sealed)

    hs,_,health,_=http_json(OAUTH_ISSUER+"/health")
    if (
        hs!=200
        or health.get("ok") is not True
        or health.get("issuer")!=OAUTH_ISSUER
        or health.get("resource")!=MCP_BASE
        or health.get("dcr") is not True
        or health.get("pkce_s256") is not True
    ):
        raise RuntimeError("current OAuth health contract mismatch")

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
        raise RuntimeError("current OAuth discovery contract mismatch")

    bad_status,_,bad,_=http_json(
        OAUTH_ISSUER+"/oauth/register",
        "POST",
        {
            "redirect_uris":["https://example.com/not-chatgpt"],
            "client_name":"MUSITU Connect invalid redirect probe",
        },
    )
    if bad_status!=400 or bad.get("error")!="invalid_redirect_uri":
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
    challenge=b64url(hashlib.sha256(verifier.encode("utf-8")).digest())
    state="st_"+secrets.token_urlsafe(20)
    for secret in (account_key,verifier,state):
        print("::add-mask::"+secret)

    client_id=""
    flow_id=""
    customer_inserted=False
    evidence: dict[str,Any]={}
    try:
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
            raise RuntimeError(f"current DCR failed HTTP {rc}")
        client_id=str(reg["client_id"])
        print("::add-mask::"+client_id)

        query={
            "response_type":"code",
            "client_id":client_id,
            "redirect_uri":CALLBACK,
            "scope":"axiom.execute",
            "state":state,
            "code_challenge":challenge,
            "code_challenge_method":"S256",
            "resource":MCP_BASE,
        }
        ac,ah,ab=http(
            OAUTH_ISSUER+"/oauth/authorize?"+urllib.parse.urlencode(query),
            headers={"Accept":"text/html","User-Agent":"MUSITU-Connect-OAuth-PKCE-Qualification/2.0"},
        )
        if ac!=200:
            raise RuntimeError(f"current authorization page HTTP {ac}")
        page=ab.decode("utf-8","replace")
        match=re.search(r'name="flow_id" value="([^"]+)"',page)
        cookie_header=str(ah.get("Set-Cookie") or "")
        if not match or "musitu_oauth_flow=" not in cookie_header:
            raise RuntimeError("current authorization flow/cookie missing")
        flow_id=match.group(1)
        cookie=cookie_header.split(";",1)[0]
        print("::add-mask::"+flow_id)

        pc,ph,pb=direct_form_no_redirect(
            OAUTH_ISSUER+"/oauth/authorize",
            {"flow_id":flow_id,"musitu_account_key":account_key},
            {"Cookie":cookie},
        )

        flow_rows=d1(
            "SELECT client_id,redirect_uri,resource,scope,code_challenge,used_at "
            "FROM oauth_authorization_flows WHERE id=?1",
            [flow_id],
        )
        code_rows=d1(
            "SELECT code_hash,client_id,customer_id,redirect_uri,resource,scope,code_challenge,used_at "
            "FROM oauth_authorization_codes WHERE client_id=?1 AND customer_id=?2",
            [client_id,customer],
        )
        if len(flow_rows)!=1 or not flow_rows[0].get("used_at"):
            raise RuntimeError("current consent did not consume authorization flow")
        if len(code_rows)!=1:
            raise RuntimeError("current consent did not create exactly one authorization code")
        code_row=code_rows[0]
        if (
            code_row.get("client_id")!=client_id
            or code_row.get("customer_id")!=customer
            or code_row.get("redirect_uri")!=CALLBACK
            or code_row.get("resource")!=MCP_BASE
            or code_row.get("scope")!="axiom.execute"
            or code_row.get("code_challenge")!=challenge
            or code_row.get("used_at")
        ):
            raise RuntimeError("current authorization-code binding mismatch")

        redirect_mode=""
        fresh_code_observed=False
        if pc==302:
            location=str(ph.get("Location") or ph.get("location") or "")
            parsed=urllib.parse.urlparse(location)
            qp=urllib.parse.parse_qs(parsed.query)
            raw_code=(qp.get("code") or [""])[0]
            returned_state=(qp.get("state") or [""])[0]
            if not raw_code or returned_state!=state:
                raise RuntimeError("current 302 redirect code/state mismatch")
            if hashlib.sha256(raw_code.encode("utf-8")).hexdigest()!=code_row.get("code_hash"):
                raise RuntimeError("current redirect code does not match authorization ledger")
            fresh_code_observed=True
            redirect_mode="RAW_302_OBSERVED"
        elif pc==200:
            # The worker-side success is proven by D1 state above. This headless client
            # sees an intermediary HTML response instead of the raw worker 302.
            if not str(ph.get("Content-Type") or ph.get("content-type") or "").startswith("text/html"):
                raise RuntimeError("current transformed consent response is not HTML")
            redirect_mode="INTERMEDIARY_TRANSFORMED_200_AFTER_CODE_MINT"
        else:
            raise RuntimeError(f"unexpected current consent HTTP {pc}")

        evidence={
            "schema":"musitu.connect.oauth_pkce_composed_qualification.v1",
            "gate":"MUSITU_CONNECT_OAUTH_PKCE_COMPOSED_QUALIFIED",
            "source_commit":os.environ.get("GITHUB_SHA"),
            "workflow_run_id":os.environ.get("GITHUB_RUN_ID"),
            "product":"MUSITU Connect",
            "axiom_role":"downstream engine",
            "qualification_mode":"current_live_consent_plus_sealed_full_flow_plus_core_compatibility",
            "sealed_full_flow":{
                "run_id":PROVEN_RUN_ID,
                "artifact_id":PROVEN_ARTIFACT_ID,
                "artifact_zip_digest":PROVEN_ARTIFACT_ZIP_DIGEST,
                "evidence_sha256":PROVEN_EVIDENCE_SHA256,
                "gate":sealed.get("gate"),
                "authorization_code_flow":sealed.get("authorization_code_flow"),
                "dynamic_client_registration":sealed.get("dynamic_client_registration"),
                "pkce_s256":sealed.get("pkce_s256"),
                "authorization_code_one_time":sealed.get("authorization_code_one_time"),
                "refresh_token_rotation":sealed.get("refresh_token_rotation"),
                "revocation_verified":sealed.get("revocation_verified"),
                "oauth_to_mcp_authenticated_compute_http":sealed.get("oauth_to_mcp_authenticated_compute_http"),
                "metering_verified":sealed.get("metering_verified"),
                "cleanup_complete":sealed.get("cleanup_complete"),
                "fixture_rows_remaining":sealed.get("fixture_rows_remaining"),
            },
            "core_compatibility":compatibility,
            "current_live":{
                "oauth_health_verified":True,
                "oauth_discovery_verified":True,
                "invalid_redirect_rejected":True,
                "dynamic_client_registration":True,
                "authorization_page_served":True,
                "account_key_authenticated":True,
                "authorization_flow_consumed":True,
                "authorization_code_row_created":True,
                "authorization_code_bound_to_s256_challenge":True,
                "authorization_code_unused_after_consent":True,
                "consent_http_status":pc,
                "redirect_observation_mode":redirect_mode,
                "fresh_raw_authorization_code_observed":fresh_code_observed,
                "transformed_response_body_sha256":sha256_bytes(pb) if pc==200 else None,
            },
            "composed_control":{
                "authorization_code_flow_qualified":True,
                "pkce_s256_qualified":True,
                "dynamic_client_registration_qualified":True,
                "refresh_rotation_qualified":True,
                "revocation_qualified":True,
                "connect_runtime_enablement_changed":False,
            },
            "raw_account_key_published":False,
            "raw_authorization_code_published":False,
            "raw_access_token_published":False,
            "raw_refresh_token_published":False,
            "production_axiom_integration_enabled":False,
            "claims":{
                "fresh_single_run_headless_code_exchange":"NOT_DEMONSTRATED_WHEN_EDGE_TRANSFORMS_302",
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

    if evidence.get("gate")!="MUSITU_CONNECT_OAUTH_PKCE_COMPOSED_QUALIFIED":
        raise RuntimeError("Connect OAuth PKCE composed qualification did not reach PASS gate")
    if evidence.get("fixture_rows_remaining")!=0:
        raise RuntimeError("Connect OAuth PKCE fixture cleanup failed")
    evidence["cleanup_complete"]=True

    raw=(json.dumps(evidence,indent=2,sort_keys=True)+"\n").encode("utf-8")
    out=Path("musitu-connect-oauth-pkce-qualification.json")
    out.write_bytes(raw)
    digest=sha256_bytes(raw)
    Path("musitu-connect-oauth-pkce-qualification.sha256").write_text(
        digest+"  "+out.name+"\n",
        encoding="utf-8",
    )
    print("MUSITU_CONNECT_OAUTH_PKCE_EVIDENCE="+json.dumps({
        "gate":evidence["gate"],
        "qualification_mode":evidence["qualification_mode"],
        "sealed_evidence_sha256":PROVEN_EVIDENCE_SHA256,
        "current_core_functions_unchanged":True,
        "current_live_consent":True,
        "current_authorization_code_row_created":True,
        "redirect_observation_mode":evidence["current_live"]["redirect_observation_mode"],
        "oauth_authorization_code_pkce_control":True,
        "fixture_rows_remaining":0,
        "production_axiom_integration_enabled":False,
        "evidence_sha256":digest,
    },sort_keys=True))

if __name__=="__main__":
    main()
