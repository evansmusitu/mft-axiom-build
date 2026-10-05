"""Canary-first MUSITU Connect production runtime enablement.

This rollout is deliberately fail-closed:
- validates technical + promotion + runtime authorization evidence,
- requires PR #9 to remain open/unmerged and main to remain sealed,
- refuses to overwrite any pre-existing Connect production Worker/domain/DNS/route,
- deploys and verifies an isolated Workers.dev canary first,
- verifies exact Axiom usage-ledger request-ID correlation,
- creates the production Worker/domain only after canary success,
- removes every production resource created by this rollout on verification failure.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/"connect"/"production_worker.mjs"
GATE=ROOT/"qualification"/"musitu_connect_gate.json"
AUTH=ROOT/"qualification"/"evidence"/"musitu_connect_production_runtime_authorization_2026-10-05.json"

CF_API=os.environ.get("CF_API","https://api.cloudflare.com/client/v4").rstrip("/")
ACCOUNT_ID=os.environ["CLOUDFLARE_ACCOUNT_ID"]
D1_UUID=os.environ["D1_UUID"]
ZONE_NAME=os.environ.get("ZONE_NAME","musitu.com")
PROD_HOST=os.environ.get("PROD_HOST","connect.musitu.com")
PROD_WORKER=os.environ.get("PROD_WORKER","musitu-connect-production")
AXIOM_BASE=os.environ.get("AXIOM_BASE","https://axiom.mftintelligence.com").rstrip("/")
WRANGLER=os.environ.get("WRANGLER_BIN","wrangler")
TOKEN=os.environ.get("CLOUDFLARE_API_TOKEN","").strip()
EMAIL=os.environ.get("CLOUDFLARE_EMAIL","").strip()
GLOBAL_KEY=os.environ.get("CLOUDFLARE_GLOBAL_API_KEY","").strip()
ACCOUNT_KEY=os.environ["MUSITU_CONNECT_AXIOM_ACCOUNT_KEY"].strip()
GITHUB_TOKEN=os.environ["GITHUB_TOKEN"].strip()
REPOSITORY=os.environ["GITHUB_REPOSITORY"]
GITHUB_SHA=os.environ["GITHUB_SHA"]
BRANCH=os.environ.get("GITHUB_REF_NAME","")
RUN_ID=os.environ.get("GITHUB_RUN_ID") or uuid.uuid4().hex[:12]
SEALED_MAIN_SHA=os.environ["SEALED_MAIN_SHA"]
PROMOTION_AUTH_ID="MUSITU-CONNECT-PROMOTION-AUTH-2026-10-04-001"
RUNTIME_AUTH_ID="MUSITU-CONNECT-RUNTIME-AUTH-2026-10-05-001"
RULE_REF="musitu_connect_prod_machine_transport"
INTERNAL_LABEL=b"MUSITU-CONNECT-RUNTIME-INTERNAL-V1"

SCENARIO=[
    {"hazard":"Ground collapse","exposure":0.54,"severity":10,"likelihood":0.62,"cost":18000,"benefit":0.34},
    {"hazard":"Explosives / gases","exposure":0.25,"severity":8,"likelihood":0.48,"cost":12000,"benefit":0.28},
    {"hazard":"Shaft falls","exposure":0.15,"severity":9,"likelihood":0.40,"cost":14000,"benefit":0.24},
    {"hazard":"Electrocution / equipment","exposure":0.06,"severity":7,"likelihood":0.36,"cost":9000,"benefit":0.18},
]

def mask(value: str) -> None:
    if value:
        print("::add-mask::"+value)

def fail(message: str) -> None:
    raise RuntimeError(message)

def json_bytes(obj) -> bytes:
    return json.dumps(obj,separators=(",",":"),sort_keys=True).encode("utf-8")

def internal_token() -> str:
    return hmac.new(ACCOUNT_KEY.encode("utf-8"),INTERNAL_LABEL,hashlib.sha256).hexdigest()

def cf_header_candidates() -> list[dict[str,str]]:
    common={
        "Accept":"application/json",
        "Content-Type":"application/json",
        "User-Agent":"MUSITU-Connect-Production-Rollout/1.0",
    }
    candidates=[]
    if TOKEN:
        candidates.append({**common,"Authorization":"Bearer "+TOKEN})
    if EMAIL and GLOBAL_KEY:
        candidates.append({
            **common,
            "X-Auth-Email":EMAIL,
            "X-Auth-Key":GLOBAL_KEY,
        })
    if not candidates:
        fail("no Cloudflare API credential available")
    return candidates

def cf_call(path: str, method: str="GET", body=None, *, allow_404: bool=False):
    data=None if body is None else json_bytes(body)
    last_code=0
    last_raw=b""
    for index,headers in enumerate(cf_header_candidates()):
        req=urllib.request.Request(CF_API+path,headers=headers,data=data,method=method)
        try:
            with urllib.request.urlopen(req,timeout=45) as response:
                raw=response.read()
                code=response.status
        except urllib.error.HTTPError as exc:
            raw=exc.read()
            code=exc.code
        last_code,last_raw=code,raw
        if code in (401,403) and index+1<len(cf_header_candidates()):
            continue
        break
    code,raw=last_code,last_raw
    if code==404 and allow_404:
        return code,None
    try:
        obj=json.loads(raw or b"{}")
    except Exception:
        obj={}
    if not 200<=code<300 or (isinstance(obj,dict) and obj.get("success") is False):
        fail(f"Cloudflare call failed HTTP {code}: {method} {path}")
    return code,(obj.get("result") if isinstance(obj,dict) else None)

def gh_json(path: str):
    req=urllib.request.Request(
        "https://api.github.com"+path,
        headers={
            "Authorization":"Bearer "+GITHUB_TOKEN,
            "Accept":"application/vnd.github+json",
            "User-Agent":"MUSITU-Connect-Production-Rollout/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req,timeout=30) as response:
            raw=response.read()
            code=response.status
    except urllib.error.HTTPError as exc:
        raw=exc.read()
        code=exc.code
    if code!=200:
        fail("GitHub precondition read failed HTTP "+str(code)+" path="+path)
    return json.loads(raw or b"{}")

def d1(sql: str, params=None):
    payload={"sql":sql}
    if params is not None:
        payload["params"]=params
    _,result=cf_call(
        f"/accounts/{ACCOUNT_ID}/d1/database/{D1_UUID}/query",
        "POST",
        payload,
    )
    batches=result or []
    if not isinstance(batches,list) or not batches or not all(x.get("success") is True for x in batches):
        fail("D1 query failed")
    rows=[]
    for batch in batches:
        rows.extend(batch.get("results") or [])
    return rows

def http_json(url: str, method: str="GET", *, headers=None, body=None, timeout: int=30):
    h={"Accept":"application/json","User-Agent":"MUSITU-Connect-Production-Verifier/1.0"}
    if headers:
        h.update(headers)
    data=None
    if body is not None:
        h["Content-Type"]="application/json"
        data=json_bytes(body)
    req=urllib.request.Request(url,headers=h,data=data,method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as response:
            raw=response.read()
            code=response.status
    except urllib.error.HTTPError as exc:
        raw=exc.read()
        code=exc.code
    except urllib.error.URLError:
        return 0,{}
    try:
        obj=json.loads(raw or b"{}")
    except Exception:
        obj={}
    return code,obj

def run(command: list[str], *, cwd: Path, stdin: str|None=None) -> str:
    env=dict(os.environ)
    if TOKEN:
        env["CLOUDFLARE_API_TOKEN"]=TOKEN
    completed=subprocess.run(
        command,
        cwd=cwd,
        env=env,
        input=stdin,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if completed.returncode!=0:
        tail="\n".join(completed.stdout.splitlines()[-80:])
        fail("command failed: "+" ".join(command)+"\n"+tail)
    return completed.stdout

def worker_exists(name: str) -> bool:
    code,_=cf_call(
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(name,safe='')}/settings",
        allow_404=True,
    )
    return code!=404

def delete_worker(name: str) -> bool:
    code,_=cf_call(
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(name,safe='')}",
        "DELETE",
        allow_404=True,
    )
    return code in (200,204,404)

def worker_domains():
    _,rows=cf_call(f"/accounts/{ACCOUNT_ID}/workers/domains")
    return rows or []

def deploy_worker(name: str, *, production: bool, workers_dev: bool) -> Path:
    workdir=Path(tempfile.mkdtemp(prefix="musitu-connect-runtime-"))
    shutil.copy2(SOURCE,workdir/"worker.mjs")
    config={
        "$schema":"node_modules/wrangler/config-schema.json",
        "name":name,
        "main":"worker.mjs",
        "compatibility_date":"2026-10-05",
        "workers_dev":workers_dev,
        "observability":{"enabled":True},
        "vars":{
            "PRODUCTION":"true" if production else "false",
            "RELEASE":GITHUB_SHA,
        },
    }
    (workdir/"wrangler.json").write_text(json.dumps(config,indent=2)+"\n",encoding="utf-8")
    run([WRANGLER,"deploy","--config","wrangler.json"],cwd=workdir)
    run(
        [WRANGLER,"secret","put","AXIOM_ACCOUNT_KEY","--config","wrangler.json"],
        cwd=workdir,
        stdin=ACCOUNT_KEY+"\n",
    )
    return workdir

def workers_dev_url(name: str) -> str:
    _,payload=cf_call(f"/accounts/{ACCOUNT_ID}/workers/subdomain")
    subdomain=(payload or {}).get("subdomain") if isinstance(payload,dict) else None
    if not subdomain:
        fail("Cloudflare workers.dev subdomain unavailable")
    return f"https://{name}.{subdomain}.workers.dev"

def wait_health(base: str, *, production: bool, attempts: int=60):
    last=None
    for _ in range(attempts):
        code,obj=http_json(base+"/health")
        last=(code,obj)
        if (
            code==200
            and obj.get("ok") is True
            and obj.get("service")=="MUSITU Connect"
            and obj.get("release")==GITHUB_SHA
            and obj.get("production") is production
            and obj.get("axiomIntegrationAllowed") is True
        ):
            return obj
        time.sleep(2)
    fail("health contract did not converge: "+repr(last))

def resolve_identity():
    digest=hashlib.sha256(ACCOUNT_KEY.encode("utf-8")).hexdigest()
    rows=d1(
        "SELECT k.id AS key_id,k.customer_id,k.label,k.status AS key_status,k.revoked_at,"
        "k.expires_at,c.status AS customer_status,c.name,c.plan,c.monthly_unit_override "
        "FROM api_keys k JOIN customers c ON c.id=k.customer_id WHERE k.key_hash=?1",
        [digest],
    )
    if len(rows)!=1:
        fail("dedicated Connect account key identity cardinality mismatch")
    row=rows[0]
    if (
        row.get("label")!="musitu-connect-production"
        or row.get("key_status")!="active"
        or row.get("customer_status")!="active"
        or row.get("revoked_at") is not None
        or row.get("name")!="MUSITU Connect Production Service"
        or row.get("plan")!="developer"
        or int(row.get("monthly_unit_override") or 0)!=100
    ):
        fail("dedicated Connect identity contract mismatch")
    return row

def verify_surface(base: str, identity: dict, *, stage: str):
    token=internal_token()
    auth={"Authorization":"Bearer "+token}

    uc,_=http_json(
        base+"/api/mining/plan",
        "POST",
        body={"rows":SCENARIO,"budget":50000},
    )
    if uc!=401:
        fail(stage+" unauthenticated plan expected 401 got "+str(uc))

    pc,plan=http_json(
        base+"/api/mining/plan",
        "POST",
        headers=auth,
        body={"rows":SCENARIO,"budget":50000},
    )
    if (
        pc!=200
        or int(plan.get("spend") or -1)!=44000
        or plan.get("selected")!=["Ground collapse","Explosives / gases","Shaft falls"]
        or plan.get("gate")!="LOCKED"
        or len(str(plan.get("trace") or ""))<8
    ):
        fail(stage+" authenticated deterministic plan mismatch")

    run_id=("canary-" if stage=="canary" else "production-enable-")+str(RUN_ID)
    rc,risk=http_json(
        base+"/api/mining/risk",
        "POST",
        headers=auth,
        body={"run_id":run_id,"rows":[SCENARIO[0]]},
    )
    if rc!=200 or risk.get("ok") is not True or risk.get("gate")!="OPEN":
        fail(stage+" authenticated Axiom risk call failed HTTP "+str(rc))
    if "3.348" not in json.dumps(risk,separators=(",",":"),sort_keys=True):
        fail(stage+" expected Axiom result 3.348 was not observed")
    request_id=str(risk.get("request_id") or "")
    canonical_sha=str(risk.get("canonical_sha256") or "")
    if not request_id.startswith("MUSITU-CONNECT-"+run_id+"-") or len(canonical_sha)!=64:
        fail(stage+" provenance response contract mismatch")

    events=d1(
        "SELECT request_id,operation,compute_units,http_status,result_sha256,key_id "
        "FROM usage_events WHERE customer_id=?1 AND request_id=?2",
        [identity["customer_id"],request_id],
    )
    if len(events)!=1:
        fail(stage+" exact usage-ledger request-ID delta mismatch")
    event=events[0]
    if (
        event.get("request_id")!=request_id
        or event.get("operation")!="arithmetic.evaluate"
        or int(event.get("compute_units") or 0)<=0
        or int(event.get("http_status") or 0)!=200
        or len(str(event.get("result_sha256") or ""))<32
        or event.get("key_id")!=identity["key_id"]
    ):
        fail(stage+" Axiom usage-ledger correlation mismatch")
    return {
        "unauthenticated_plan_http":uc,
        "authenticated_plan_http":pc,
        "risk_http":rc,
        "result_3_348_observed":True,
        "exact_usage_ledger_request_id_correlation":True,
        "request_id_sha256":hashlib.sha256(request_id.encode("utf-8")).hexdigest(),
        "canonical_sha256":canonical_sha,
    }

def main() -> None:
    global ZONE_NAME, PROD_HOST
    if BRANCH!="feat/musitu-connect-frontier":
        fail("runtime enablement may run only from feat/musitu-connect-frontier")
    if not ACCOUNT_KEY or not TOKEN or not GITHUB_TOKEN:
        fail("required rollout credentials missing")
    mask(ACCOUNT_KEY)
    derived=internal_token()
    mask(derived)

    gate=json.loads(GATE.read_text(encoding="utf-8"))
    admission=gate.get("production_admission") or {}
    promotion=admission.get("promotion") or {}
    if (
        admission.get("technical_ready") is not True
        or list(admission.get("missing_controls") or [])
        or promotion.get("authorized") is not True
        or promotion.get("authorization_id")!=PROMOTION_AUTH_ID
        or admission.get("state")!="PRODUCTION_ADMISSION_QUALIFIED__PROMOTION_AUTHORIZED__ENABLEMENT_REMAINS_SEPARATELY_BLOCKED"
        or admission.get("enablement_permitted") is not False
        or (gate.get("axiom") or {}).get("production_integration_allowed") is not False
    ):
        fail("pre-runtime admission gate is not the exact authorized blocked state")

    auth=json.loads(AUTH.read_text(encoding="utf-8"))
    constraints=auth.get("constraints") or {}
    if (
        auth.get("authorization_id")!=RUNTIME_AUTH_ID
        or constraints.get("merge_pr_9_authorized") is not False
        or constraints.get("fail_closed_controls_required") is not True
        or constraints.get("canary_before_full_activation_required") is not True
        or constraints.get("automatic_rollback_on_failed_production_verification_required") is not True
    ):
        fail("runtime authorization evidence contract mismatch")

    repo_path="/repos/"+REPOSITORY
    pr=gh_json(repo_path+"/pulls/9")
    if pr.get("state")!="open" or pr.get("merged_at") is not None:
        fail("PR #9 must remain open and unmerged")
    main_branch=gh_json(repo_path+"/branches/main")
    if (main_branch.get("commit") or {}).get("sha")!=SEALED_MAIN_SHA:
        fail("main moved from sealed SHA")
    feature_branch=gh_json(
        repo_path+"/branches/"+urllib.parse.quote("feat/musitu-connect-frontier",safe="")
    )
    if (feature_branch.get("commit") or {}).get("sha")!=GITHUB_SHA:
        fail("workflow source is not current feature head")

    requested_zone=ZONE_NAME
    requested_host=PROD_HOST

    # The live musitu.com zone is not available to this Cloudflare account and
    # the mftintelligence.com zone denies creation of the scoped configuration
    # rule required for machine transport. Do not weaken zone security or
    # silently overwrite an existing hostname. Production therefore uses the
    # stable Workers.dev hostname for this Worker; the custom hostname remains
    # a later, independently authorized DNS/security cutover.
    if worker_exists(PROD_WORKER):
        fail("production Connect Worker already exists; refusing unknown-state overwrite")
    domains=worker_domains()
    protected_hosts={requested_host,"connect.mftintelligence.com"}
    if any(x.get("hostname") in protected_hosts for x in domains):
        fail("a reserved Connect custom hostname already exists; refusing overlap")

    hostname_fallback_used=True
    custom_domain_deferred_reason="CLOUDFLARE_SCOPED_MACHINE_TRANSPORT_RULE_PERMISSION_DENIED"

    identity=resolve_identity()
    source_sha=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    evidence={
        "schema":"musitu.connect.production_runtime_enablement.v1",
        "gate":"PENDING",
        "authorization_id":RUNTIME_AUTH_ID,
        "promotion_authorization_id":PROMOTION_AUTH_ID,
        "source_commit":GITHUB_SHA,
        "workflow_run_id":os.environ.get("GITHUB_RUN_ID"),
        "worker_source_sha256":source_sha,
        "requested_hostname":requested_host,
        "requested_zone":requested_zone,
        "canonical_hostname":None,
        "zone_name":None,
        "hostname_fallback_used":hostname_fallback_used,
        "production_worker":PROD_WORKER,
        "sealed_main_sha":SEALED_MAIN_SHA,
        "pr_9_unmerged":True,
        "canary_before_production":True,
        "raw_axiom_account_key_published":False,
        "derived_runtime_token_published":False,
        "rollback_required":False,
        "rollback":{},
    }

    canary=("musitu-connect-runtime-canary-"+str(RUN_ID).lower())[:63]
    canary_dir=None
    canary_created=False
    try:
        canary_dir=deploy_worker(canary,production=False,workers_dev=True)
        canary_created=True
        canary_base=workers_dev_url(canary)
        wait_health(canary_base,production=False)
        evidence["canary"]=verify_surface(canary_base,identity,stage="canary")
        evidence["canary"]["worker_deleted_after_verification"]=False
    finally:
        if canary_created:
            deleted=delete_worker(canary)
            evidence.setdefault("canary",{})["worker_deleted_after_verification"]=deleted
            if not deleted:
                fail("canary cleanup failed")
        if canary_dir:
            shutil.rmtree(canary_dir,ignore_errors=True)

    prod_dir=None
    production_worker_created=False
    domain_created=False
    rule_created=False
    created_rule_id=None
    created_domain_id=None
    try:
        prod_dir=deploy_worker(PROD_WORKER,production=True,workers_dev=True)
        production_worker_created=True

        prod_base=workers_dev_url(PROD_WORKER)
        wait_health(prod_base,production=True)
        evidence["canonical_hostname"]=urllib.parse.urlparse(prod_base).hostname
        evidence["zone_name"]=None
        evidence["hostname_fallback_used"]=True
        evidence["custom_domain_deferred"]={
            "preferred_hostname":requested_host,
            "preferred_zone":requested_zone,
            "status":"DEFERRED",
            "reason":custom_domain_deferred_reason,
            "zone_security_weakened":False,
            "custom_domain_mutated":False,
        }
        evidence["machine_transport_rule"]={
            "requested":False,
            "created":False,
            "status":"NOT_MUTATED",
        }
        evidence["production"]=verify_surface(prod_base,identity,stage="production")
        evidence["production"].update({
            "health_http":200,
            "custom_domain_attached":False,
            "workers_dev_enabled":True,
            "scoped_machine_transport_rule":False,
            "production_axiom_integration_enabled":True,
        })

        # Recheck repository invariants after the production mutation.
        pr_after=gh_json(repo_path+"/pulls/9")
        main_after=gh_json(repo_path+"/branches/main")
        if pr_after.get("state")!="open" or pr_after.get("merged_at") is not None:
            fail("PR #9 changed during production rollout")
        if (main_after.get("commit") or {}).get("sha")!=SEALED_MAIN_SHA:
            fail("main changed during production rollout")

        evidence["gate"]="MUSITU_CONNECT_PRODUCTION_RUNTIME_ENABLED"
    except Exception as exc:
        rollback={
            "domain_deleted":not domain_created,
            "rule_deleted":not rule_created,
            "worker_deleted":not production_worker_created,
            "errors":[],
        }
        if domain_created:
            try:
                rows=[x for x in worker_domains() if x.get("hostname")==PROD_HOST]
                if len(rows)==1 and rows[0].get("service")==PROD_WORKER and rows[0].get("id"):
                    cf_call(
                        f"/accounts/{ACCOUNT_ID}/workers/domains/{rows[0]['id']}",
                        "DELETE",
                    )
                rollback["domain_deleted"]=not any(
                    x.get("hostname")==PROD_HOST for x in worker_domains()
                )
            except Exception as rb_exc:
                rollback["errors"].append("domain:"+type(rb_exc).__name__+":"+str(rb_exc))
        if rule_created and created_rule_id:
            try:
                cf_call(
                    f"/zones/{zone_id}/rulesets/{ruleset_id}/rules/{created_rule_id}",
                    "DELETE",
                )
                _,chk=cf_call(f"/zones/{zone_id}/rulesets/{ruleset_id}")
                rollback["rule_deleted"]=not any(
                    r.get("ref")==RULE_REF for r in ((chk or {}).get("rules") or [])
                )
            except Exception as rb_exc:
                rollback["errors"].append("rule:"+type(rb_exc).__name__+":"+str(rb_exc))
        if production_worker_created:
            try:
                rollback["worker_deleted"]=delete_worker(PROD_WORKER) and not worker_exists(PROD_WORKER)
            except Exception as rb_exc:
                rollback["errors"].append("worker:"+type(rb_exc).__name__+":"+str(rb_exc))
        evidence["rollback_required"]=True
        evidence["rollback"]=rollback
        failure={
            **evidence,
            "gate":"MUSITU_CONNECT_PRODUCTION_RUNTIME_ROLLED_BACK",
            "error_type":type(exc).__name__,
            "error":str(exc),
        }
        Path("musitu-connect-production-runtime-failure.json").write_text(
            json.dumps(failure,indent=2,sort_keys=True)+"\n",
            encoding="utf-8",
        )
        if not all([
            rollback.get("domain_deleted"),
            rollback.get("rule_deleted"),
            rollback.get("worker_deleted"),
        ]):
            raise RuntimeError("production verification failed and rollback was incomplete") from exc
        raise
    finally:
        if prod_dir:
            shutil.rmtree(prod_dir,ignore_errors=True)

    if evidence.get("gate")!="MUSITU_CONNECT_PRODUCTION_RUNTIME_ENABLED":
        fail("production runtime did not reach enabled gate")

    raw=(json.dumps(evidence,indent=2,sort_keys=True)+"\n").encode("utf-8")
    out=Path("musitu-connect-production-runtime-enablement.json")
    out.write_bytes(raw)
    digest=hashlib.sha256(raw).hexdigest()
    Path("musitu-connect-production-runtime-enablement.sha256").write_text(
        digest+"  "+out.name+"\n",
        encoding="utf-8",
    )
    print("MUSITU_CONNECT_PRODUCTION_RUNTIME_EVIDENCE="+json.dumps({
        "gate":evidence["gate"],
        "canonical_hostname":evidence["canonical_hostname"],
        "canary_pass":True,
        "production_pass":True,
        "exact_usage_ledger_request_id_correlation":True,
        "pr_9_unmerged":True,
        "main_unchanged":True,
        "rollback_required":False,
        "evidence_sha256":digest,
    },sort_keys=True))

if __name__=="__main__":
    main()
