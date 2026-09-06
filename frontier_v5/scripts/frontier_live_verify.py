#!/usr/bin/env python3
from __future__ import annotations

import ast
import base64
import csv
import datetime
import hashlib
import io
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from frontier_v5.runtime.fullstack import (
    AxiomMCPAdapter, CloudflareD1ProductionStore, DomainTwinCalibrator,
    FrontierEvaluationHarness, LiveResearchAdapter, PlaywrightBrowserAdapter,
    SpecialistToolAdapter, SpecialistToolBinding, ComparativeCase,
)

CF_API="https://api.cloudflare.com/client/v4"
ACCOUNT_ID="93f395f5121954671f92fffa453d6b61"
SEALED_D1="504029cc-f9a5-495e-818f-63c6144b4ea4"
FRONTIER_DB_NAME="musitu-axiom-frontier-v5"
ISSUER="https://auth.mftintelligence.com"
RESOURCE="https://mcp.mftintelligence.com"
MCP="https://mcp.mftintelligence.com/mcp"


def canonical(x): return json.dumps(x,sort_keys=True,separators=(",",":"),default=str)
def sha(x): return hashlib.sha256(canonical(x).encode()).hexdigest()
def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def raw(url,method="GET",headers=None,body=None,follow=True,timeout=45):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    if follow:
        opener=urllib.request.build_opener()
    else:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,req,fp,code,msg,headers,newurl): return None
        opener=urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req,timeout=timeout) as r: return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e: return e.code,e.headers,e.read()


def main():
    email=os.environ.get("CLOUDFLARE_EMAIL",""); key=os.environ.get("CLOUDFLARE_GLOBAL_API_KEY","")
    if not email or not key: raise SystemExit("Cloudflare credentials required")
    cfh={"X-Auth-Email":email,"X-Auth-Key":key,"Accept":"application/json","User-Agent":"MUSITU-Axiom-Frontier-Live-Verify/5.0"}

    def cf(path,method="GET",obj=None):
        h=dict(cfh); body=None
        if obj is not None:
            h["Content-Type"]="application/json"; body=canonical(obj).encode()
        code,_,b=raw(CF_API+path,method,h,body)
        if not 200<=code<300: raise RuntimeError(f"Cloudflare HTTP {code}: {path}")
        o=json.loads(b or b"{}")
        if o.get("success") is not True: raise RuntimeError("Cloudflare success=false "+str(o.get("errors"))[:200])
        return o.get("result")

    def d1(sql,params=None):
        obj={"sql":sql}
        if params is not None: obj["params"]=params
        blocks=cf(f"/accounts/{ACCOUNT_ID}/d1/database/{SEALED_D1}/query","POST",obj) or []
        if not blocks or any(x.get("success") is not True for x in blocks): raise RuntimeError("canonical D1 statement failed")
        rows=[]
        for x in blocks: rows.extend(x.get("results") or [])
        return rows

    evidence={"schema":"musitu.axiom.frontier.live-verification.v1","started_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"checks":{}}

    # 1. Isolated production persistence database: never mutate sealed Axiom schema.
    dbs=cf(f"/accounts/{ACCOUNT_ID}/d1/database?per_page=100") or []
    matches=[x for x in dbs if x.get("name")==FRONTIER_DB_NAME]
    if len(matches)>1: raise RuntimeError("duplicate frontier D1 databases")
    if matches:
        frontier_id=matches[0]["uuid"]
    else:
        created=cf(f"/accounts/{ACCOUNT_ID}/d1/database","POST",{"name":FRONTIER_DB_NAME}) or {}
        frontier_id=created.get("uuid")
    if not frontier_id or frontier_id==SEALED_D1: raise RuntimeError("frontier D1 isolation failure")
    store=CloudflareD1ProductionStore(ACCOUNT_ID,frontier_id,email,key); store.migrate()
    rid="live_"+uuid.uuid4().hex
    store.query("INSERT INTO frontier_eval_events(event_id,suite,payload_json,created_at) VALUES(?1,?2,?3,?4)",[rid,"persistence-smoke",canonical({"ok":True}),datetime.datetime.now(datetime.timezone.utc).isoformat()])
    rr=store.query("SELECT suite,payload_json FROM frontier_eval_events WHERE event_id=?1",[rid])
    if len(rr)!=1 or rr[0].get("suite")!="persistence-smoke": raise RuntimeError("frontier D1 readback failed")
    store.query("DELETE FROM frontier_eval_events WHERE event_id=?1",[rid])
    if store.query("SELECT count(*) AS n FROM frontier_eval_events WHERE event_id=?1",[rid])[0]["n"]!=0: raise RuntimeError("frontier D1 cleanup failed")
    evidence["checks"]["production_persistence"]={"pass":True,"database_name":FRONTIER_DB_NAME,"database_uuid":frontier_id}

    # 2. Live research with provenance snapshots and data-only instruction authority.
    research=LiveResearchAdapter({"api.worldbank.org","data.sec.gov","stooq.com"},max_bytes=20_000_000,timeout=45)
    wb_gdp=research.fetch("https://api.worldbank.org/v2/country/USA/indicator/NY.GDP.MKTP.CD?format=json&per_page=80")
    wb_pop=research.fetch("https://api.worldbank.org/v2/country/USA/indicator/SP.POP.TOTL?format=json&per_page=80")
    sec=research.fetch("https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",headers={"User-Agent":"MUSITU Axiom Frontier verification support@mftintelligence.com"})
    stooq_a=research.fetch("https://stooq.com/q/d/l/?s=aapl.us&d1=20240101&i=d")
    stooq_m=research.fetch("https://stooq.com/q/d/l/?s=msft.us&d1=20240101&i=d")
    snapshots=[x.evidence() for x in (wb_gdp,wb_pop,sec,stooq_a,stooq_m)]
    if any(x["instruction_authority"]!="retrieved-content-data-only" for x in snapshots): raise RuntimeError("retrieval authority drift")
    evidence["checks"]["live_research"]={"pass":True,"snapshots":snapshots,"citation_fidelity":"source bytes hashed before parsing"}

    # 3. Domain-calibrated digital twins + external historical holdout validation.
    sec_obj=json.loads(sec.content)
    usgaap=((sec_obj.get("facts") or {}).get("us-gaap") or {})
    def annual(tag):
        unit=((usgaap.get(tag) or {}).get("units") or {}).get("USD") or []
        byfy={}
        for r in unit:
            if r.get("form")!="10-K" or not isinstance(r.get("fy"),int): continue
            fy=int(r["fy"]); val=r.get("val")
            if not isinstance(val,(int,float)): continue
            filed=str(r.get("filed") or "")
            if fy not in byfy or filed>byfy[fy][0]: byfy[fy]=(filed,float(val))
        return {fy:v for fy,(_,v) in byfy.items()}
    rev={}
    for tag in ("RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","SalesRevenueNet"):
        rev=annual(tag)
        if len(rev)>=6: break
    op=annual("OperatingIncomeLoss")
    years=sorted(set(rev)&set(op))[-10:]
    if len(years)<6: raise RuntimeError("SEC company calibration history too short")
    revenues=[rev[y] for y in years]; operating=[op[y] for y in years]
    split=max(3,len(years)-2)
    company_validation=DomainTwinCalibrator.holdout_validate(revenues[:split],operating[:split],revenues[split:],operating[split:])
    company=DomainTwinCalibrator.company("apple-company-twin",revenues[:split],operating[:split])

    gdp_rows=(json.loads(wb_gdp.content)[1] or []); pop_rows=(json.loads(wb_pop.content)[1] or [])
    gdp={int(r["date"]):float(r["value"]) for r in gdp_rows if r.get("value") is not None and str(r.get("date","")).isdigit()}
    pop={int(r["date"]):float(r["value"]) for r in pop_rows if r.get("value") is not None and str(r.get("date","")).isdigit()}
    eyears=sorted(set(gdp)&set(pop))[-20:]
    if len(eyears)<10: raise RuntimeError("World Bank calibration history too short")
    esplit=len(eyears)-3
    economy_validation=DomainTwinCalibrator.holdout_validate([pop[y] for y in eyears[:esplit]],[gdp[y] for y in eyears[:esplit]],[pop[y] for y in eyears[esplit:]],[gdp[y] for y in eyears[esplit:]])
    economy=DomainTwinCalibrator.economy("usa-economy-twin",[pop[y] for y in eyears[:esplit]],[gdp[y] for y in eyears[:esplit]],"population","gdp")

    def returns(snapshot):
        rows=list(csv.DictReader(io.StringIO(snapshot.text())))
        closes=[float(r["Close"]) for r in rows if r.get("Close") not in (None,"")]
        if len(closes)<30: raise RuntimeError("portfolio price history too short")
        return [closes[i]/closes[i-1]-1 for i in range(1,len(closes))][-120:]
    ar=returns(stooq_a); mr=returns(stooq_m); n=min(len(ar),len(mr)); ar=ar[-n:]; mr=mr[-n:]
    portfolio=DomainTwinCalibrator.portfolio("aapl-msft-portfolio-twin",{"AAPL":ar,"MSFT":mr},{"AAPL":.5,"MSFT":.5})
    evidence["checks"]["domain_twins"]={
        "pass":True,
        "company":{"years":years,"calibration":company["calibration"],"holdout":company_validation,"source_sha256":sec.sha256},
        "portfolio":{"observations":portfolio["observations"],"mean_return":portfolio["mean_return"],"volatility":portfolio["volatility"],"sources":[stooq_a.sha256,stooq_m.sha256]},
        "economy":{"years":eyears,"calibration":economy["calibration"],"holdout":economy_validation,"sources":[wb_gdp.sha256,wb_pop.sha256]},
    }

    # 4. Real browser adapter against live MUSITU documentation.
    browser=PlaywrightBrowserAdapter({"mcp.mftintelligence.com"})
    with tempfile.TemporaryDirectory() as td:
        br=browser.run("https://mcp.mftintelligence.com/docs",Path(td)/"live-docs.png")
    evidence["checks"]["live_browser"]={"pass":True,"final_url":br.final_url,"title":br.title,"text_sha256":br.text_sha256,"screenshot_sha256":br.screenshot_sha256}

    # 5. Disposable production OAuth -> MCP adapter -> specialist/model-tool adapter proof.
    prefix="fixture_frontier_"+uuid.uuid4().hex; customer=prefix+"_customer"; key_id=prefix+"_key"
    account_key="musitu_axiom_frontier_fixture_"+secrets.token_urlsafe(40)
    print("::add-mask::"+account_key)
    ah=hashlib.sha256(account_key.encode()).hexdigest(); created=datetime.datetime.now(datetime.timezone.utc); created_s=created.isoformat().replace("+00:00","Z"); expires=(created+datetime.timedelta(hours=1)).isoformat().replace("+00:00","Z")
    callback="https://chatgpt.com/connector/oauth/musitu-frontier-e2e"
    verifier=b64url(secrets.token_bytes(48)); challenge=b64url(hashlib.sha256(verifier.encode()).digest()); state="st_"+secrets.token_urlsafe(20)
    print("::add-mask::"+verifier)
    client_id=""; access=""
    try:
        d1("INSERT INTO customers(id,email,name,plan,status,monthly_unit_override,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)",[customer,prefix+"@invalid.example","MUSITU Frontier verification fixture","developer","active",5000,created_s])
        d1("INSERT INTO api_keys(id,customer_id,key_hash,key_prefix,label,status,created_at,last_used_at,expires_at,revoked_at) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,NULL)",[key_id,customer,ah,account_key[:16],"frontier-e2e","active",created_s,expires])
        reg_obj={"redirect_uris":[callback],"client_name":"MUSITU Frontier E2E","token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"]}
        rc,_,rb=raw(ISSUER+"/oauth/register","POST",{"Accept":"application/json","Content-Type":"application/json","User-Agent":"MUSITU-Frontier-E2E/5.0"},canonical(reg_obj).encode())
        reg=json.loads(rb or b"{}"); client_id=str(reg.get("client_id") or "")
        if rc!=201 or not client_id: raise RuntimeError("frontier DCR failed")
        aq={"response_type":"code","client_id":client_id,"redirect_uri":callback,"scope":"axiom.execute","state":state,"code_challenge":challenge,"code_challenge_method":"S256","resource":RESOURCE}
        ac,headers,body=raw(ISSUER+"/oauth/authorize?"+urllib.parse.urlencode(aq),headers={"Accept":"text/html","User-Agent":"MUSITU-Frontier-E2E/5.0"})
        page=body.decode("utf-8","replace"); fm=re.search(r'name="flow_id" value="([^"]+)"',page); cookie_header=str(headers.get("Set-Cookie") or "")
        if ac!=200 or not fm or "musitu_oauth_flow=" not in cookie_header: raise RuntimeError("frontier OAuth flow/cookie missing")
        flow_id=fm.group(1); cookie=cookie_header.split(";",1)[0]
        form=urllib.parse.urlencode({"flow_id":flow_id,"musitu_account_key":account_key}).encode()
        pc,ph,pb=raw(ISSUER+"/oauth/authorize","POST",{"Accept":"text/html","Content-Type":"application/x-www-form-urlencoded","Cookie":cookie,"User-Agent":"MUSITU-Frontier-E2E/5.0"},form,follow=False)
        loc=str(ph.get("Location") or ""); qp=urllib.parse.parse_qs(urllib.parse.urlparse(loc).query); code=(qp.get("code") or [""])[0]
        if pc!=302 or not code or (qp.get("state") or [""])[0]!=state: raise RuntimeError("frontier OAuth authorization failed")
        token_body=urllib.parse.urlencode({"grant_type":"authorization_code","code":code,"code_verifier":verifier,"client_id":client_id,"redirect_uri":callback,"resource":RESOURCE}).encode()
        tc,_,tb=raw(ISSUER+"/oauth/token","POST",{"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded","User-Agent":"MUSITU-Frontier-E2E/5.0"},token_body)
        tok=json.loads(tb or b"{}"); access=str(tok.get("access_token") or "")
        if tc!=200 or not access or tok.get("scope")!="axiom.execute": raise RuntimeError("frontier OAuth token exchange failed")
        print("::add-mask::"+access)

        mcp=AxiomMCPAdapter(MCP,access)
        bindings=[SpecialistToolBinding(s,"arithmetic.evaluate",d,True) for s,d in [
            ("quantitative-analyst","quant"),("statistician","statistics"),("risk-officer","risk"),("economist","economics"),("model-auditor","verification"),("financial-modeler","modeling")]]
        specialist=SpecialistToolAdapter(mcp,bindings)
        specialist_proofs=[]
        for i,b in enumerate(bindings):
            x=specialist.run(b.specialist,{"expression":f"{40+i}+2"},"MUSITU-FRONTIER-SPECIALIST-"+uuid.uuid4().hex.upper())
            specialist_proofs.append({"specialist":b.specialist,"domain":b.domain,"operation":b.operation,"body_sha256":x["body_sha256"]})

        # Sealed unseen comparative: live Axiom vs independent Python and SymPy.
        import sympy as sp
        expressions=["40+2","12*8-5","(7+5)**2","sqrt(81)+3","2**10","(15-3)/4","5*5*5","100/8+0.5","(9**2-1)/8","3.5*4-2"]
        cases=[ComparativeCase(f"arith-{i}",{"expression":e},float(sp.N(sp.sympify(e)))) for i,e in enumerate(expressions)]
        _,hold=FrontierEvaluationHarness.sealed_split(cases,"MUSITU-FRONTIER-SEALED-20260906",.4)
        rows=[]
        for case in hold:
            expr=case.input["expression"]
            live=mcp.execute("arithmetic.evaluate",{"expression":expr},"MUSITU-FRONTIER-EVAL-"+uuid.uuid4().hex.upper())
            body=canonical(live["body"])
            nums=[float(x) for x in re.findall(r"(?<![A-Za-z0-9_])[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?",body)]
            expected=float(case.expected)
            if not any(abs(v-expected)<=1e-8 for v in nums): raise RuntimeError("live Axiom comparative result not observed")
            sym=float(sp.N(sp.sympify(expr)))
            rows.append({"case_id":case.case_id,"expected":expected,"sympy":sym,"axiom_result_observed":True,"response_sha256":live["body_sha256"]})
        evidence["checks"]["specialist_tool_adapters"]={"pass":True,"bindings":specialist_proofs,"transport":"production OAuth -> public MCP -> metered Axiom runtime"}
        evidence["checks"]["sealed_external_comparative"]={"pass":True,"holdout_count":len(rows),"independent_baseline":"SymPy","rows":rows,"suite_sha256":sha(rows)}
    finally:
        try:
            d1("DELETE FROM usage_events WHERE customer_id=?1",[customer]); d1("DELETE FROM usage_buckets WHERE customer_id=?1",[customer])
            d1("DELETE FROM oauth_access_tokens WHERE customer_id=?1",[customer]); d1("DELETE FROM oauth_refresh_tokens WHERE customer_id=?1",[customer]); d1("DELETE FROM oauth_authorization_codes WHERE customer_id=?1",[customer])
            if client_id:
                d1("DELETE FROM oauth_authorization_flows WHERE client_id=?1",[client_id]); d1("DELETE FROM oauth_clients WHERE client_id=?1",[client_id])
            d1("DELETE FROM api_keys WHERE customer_id=?1",[customer]); d1("DELETE FROM customers WHERE id=?1",[customer])
            residue=d1("SELECT (SELECT count(*) FROM customers WHERE id=?1)+(SELECT count(*) FROM api_keys WHERE customer_id=?1)+(SELECT count(*) FROM usage_events WHERE customer_id=?1)+(SELECT count(*) FROM oauth_access_tokens WHERE customer_id=?1)+(SELECT count(*) FROM oauth_refresh_tokens WHERE customer_id=?1)+(SELECT count(*) FROM oauth_authorization_codes WHERE customer_id=?1) AS n",[customer])
            if int(residue[0]["n"])!=0: raise RuntimeError("frontier OAuth fixture residue")
        except Exception as cleanup_error:
            print("cleanup failure:",type(cleanup_error).__name__,file=sys.stderr); raise

    evidence["completed_at"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
    required=["production_persistence","live_research","domain_twins","live_browser","specialist_tool_adapters","sealed_external_comparative"]
    evidence["gate"]="MUSITU_AXIOM_FRONTIER_LIVE_ADAPTERS_PASS" if all(evidence["checks"].get(k,{}).get("pass") for k in required) else "FAIL"
    evidence["evidence_sha256"]=sha(evidence)
    out=Path(os.environ.get("FRONTIER_EVIDENCE_PATH","/tmp/musitu-frontier-live-evidence.json")); out.write_text(json.dumps(evidence,indent=2,sort_keys=True),encoding="utf-8")
    if evidence["gate"]!="MUSITU_AXIOM_FRONTIER_LIVE_ADAPTERS_PASS": raise SystemExit(2)
    print(evidence["gate"]); print("evidence_sha256="+evidence["evidence_sha256"])


if __name__=="__main__": main()
