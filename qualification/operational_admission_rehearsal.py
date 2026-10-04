"""Isolated operational rehearsal for MUSITU Connect production admission.

Proves on an ephemeral Cloudflare Workers.dev canary only:
- secret rotation and recovery (old secret rejected, new secret accepted),
- canary health/auth gates and a bounded latency/error SLO window,
- synthetic failure detection,
- real code deployment rollback to the last-known-good source,
- cleanup of the ephemeral worker.

It never attaches a custom domain, mutates a production route, or enables Axiom
production integration. External paging/alert delivery is intentionally not claimed.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import secrets
import shutil
import statistics
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/"qualification"/"connect_admission_canary_worker.mjs"
CF_API=os.environ.get("CF_API","https://api.cloudflare.com/client/v4")
ACCOUNT_ID=os.environ["CLOUDFLARE_ACCOUNT_ID"]
TOKEN=os.environ.get("CLOUDFLARE_API_TOKEN","").strip()
EMAIL=os.environ.get("CLOUDFLARE_EMAIL","").strip()
API_KEY=os.environ.get("CLOUDFLARE_API_KEY","").strip()
WRANGLER=os.environ.get("WRANGLER_BIN","wrangler")
RUN_ID=os.environ.get("GITHUB_RUN_ID") or uuid.uuid4().hex[:12]
WORKER=("musitu-connect-adm-"+RUN_ID.lower())[:60]
SAMPLES=20
P95_LIMIT_MS=2000.0

def mask(value: str) -> None:
    print("::add-mask::"+value)

def cf_headers() -> dict[str,str]:
    if EMAIL and API_KEY:
        return {
            "X-Auth-Email":EMAIL,
            "X-Auth-Key":API_KEY,
            "Accept":"application/json",
            "User-Agent":"MUSITU-Connect-Admission-Rehearsal/1.0",
        }
    if TOKEN:
        return {
            "Authorization":"Bearer "+TOKEN,
            "Accept":"application/json",
            "User-Agent":"MUSITU-Connect-Admission-Rehearsal/1.0",
        }
    raise RuntimeError("no Cloudflare Workers credential is available")

def wrangler_env() -> tuple[dict[str,str],str]:
    env=dict(os.environ)
    if EMAIL and API_KEY:
        env.pop("CLOUDFLARE_API_TOKEN",None)
        env["CLOUDFLARE_EMAIL"]=EMAIL
        env["CLOUDFLARE_API_KEY"]=API_KEY
        return env,"legacy_api_key"
    if TOKEN:
        env["CLOUDFLARE_API_TOKEN"]=TOKEN
        return env,"api_token"
    raise RuntimeError("no Cloudflare Workers credential is available")

def run(command: list[str], *, cwd: Path, stdin: str | None=None) -> str:
    completed=subprocess.run(
        command,
        cwd=cwd,
        env=WRANGLER_ENV,
        input=stdin,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if completed.returncode!=0:
        tail="\n".join(completed.stdout.splitlines()[-80:])
        raise RuntimeError(
            "command failed: "+" ".join(command)+"\n"+tail
        )
    return completed.stdout

def cf_json(path: str, method: str="GET") -> tuple[int,dict]:
    request=urllib.request.Request(
        CF_API+path,
        headers=cf_headers(),
        method=method,
    )
    try:
        with urllib.request.urlopen(request,timeout=45) as response:
            raw=response.read()
            obj=json.loads(raw or b"{}")
            return response.status,obj
    except urllib.error.HTTPError as exc:
        raw=exc.read()
        try:
            obj=json.loads(raw or b"{}")
        except Exception:
            obj={}
        return exc.code,obj

def http_json(
    url: str,
    method: str="GET",
    *,
    secret: str | None=None,
    request_id: str | None=None,
) -> tuple[int,dict,float]:
    headers={
        "Accept":"application/json",
        "User-Agent":"MUSITU-Connect-Admission-Rehearsal/1.0",
    }
    body=None
    if method=="POST":
        headers["Content-Type"]="application/json"
        body=b"{}"
    if secret is not None:
        headers["Authorization"]="Bearer "+secret
    if request_id:
        headers["x-musitu-request-id"]=request_id
    req=urllib.request.Request(url,headers=headers,method=method,data=body)
    started=time.perf_counter()
    try:
        with urllib.request.urlopen(req,timeout=20) as response:
            raw=response.read()
            status=response.status
    except urllib.error.HTTPError as exc:
        raw=exc.read()
        status=exc.code
    elapsed=(time.perf_counter()-started)*1000.0
    try:
        obj=json.loads(raw or b"{}")
    except Exception:
        obj={}
    return status,obj,elapsed

def wait_probe(url: str, secret: str, expected: int, *, attempts: int=30) -> tuple[dict,float]:
    last=None
    for _ in range(attempts):
        rid="MUSITU-CONNECT-CANARY-"+uuid.uuid4().hex[:20]
        status,obj,elapsed=http_json(url+"/probe","POST",secret=secret,request_id=rid)
        last=(status,obj,elapsed,rid)
        if status==expected:
            if expected==200 and (
                obj.get("ok") is not True
                or obj.get("request_id")!=rid
                or obj.get("production") is not False
            ):
                raise RuntimeError("canary probe response contract mismatch")
            return obj,elapsed
        time.sleep(1)
    raise RuntimeError("canary probe did not reach expected HTTP "+str(expected)+"; last="+repr(last))

def deploy_source(workdir: Path, source: str) -> str:
    (workdir/"worker.mjs").write_text(source,encoding="utf-8")
    return run([WRANGLER,"deploy","--config","wrangler.json"],cwd=workdir)

def put_secret(workdir: Path, value: str) -> None:
    run(
        [WRANGLER,"secret","put","CANARY_SECRET","--config","wrangler.json"],
        cwd=workdir,
        stdin=value+"\n",
    )

def delete_worker() -> bool:
    status,obj=cf_json(
        f"/accounts/{ACCOUNT_ID}/workers/scripts/{WORKER}",
        "DELETE",
    )
    if status not in (200,204,404):
        return False
    return not (isinstance(obj,dict) and obj.get("success") is False)

WRANGLER_ENV,AUTH_MODE=wrangler_env()

def main() -> None:
    baseline=SOURCE.read_text(encoding="utf-8")
    if 'const RELEASE="baseline";' not in baseline or "const PROBE_STATUS=200;" not in baseline:
        raise RuntimeError("canary source baseline markers missing")
    candidate=baseline.replace(
        'const RELEASE="baseline";',
        'const RELEASE="candidate-failure";',
        1,
    ).replace(
        "const PROBE_STATUS=200;",
        "const PROBE_STATUS=503;",
        1,
    )
    if candidate==baseline:
        raise RuntimeError("candidate failure mutation did not apply")

    secret_a=secrets.token_urlsafe(48)
    secret_b=secrets.token_urlsafe(48)
    mask(secret_a)
    mask(secret_b)

    evidence={
        "schema":"musitu.connect.operational_admission_rehearsal.v1",
        "gate":"PENDING",
        "source_commit":os.environ.get("GITHUB_SHA"),
        "workflow_run_id":os.environ.get("GITHUB_RUN_ID"),
        "worker":WORKER,
        "surface":"ephemeral workers.dev canary",
        "custom_domain_attached":False,
        "production_route_mutated":False,
        "production_axiom_integration_enabled":False,
        "cloudflare_auth_mode":AUTH_MODE,
        "baseline_source_sha256":hashlib.sha256(baseline.encode("utf-8")).hexdigest(),
        "candidate_source_sha256":hashlib.sha256(candidate.encode("utf-8")).hexdigest(),
        "cleanup_complete":False,
    }

    workdir=Path(tempfile.mkdtemp(prefix="musitu-connect-canary-"))
    worker_created=False
    try:
        shutil.copy2(SOURCE,workdir/"worker.mjs")
        config={
            "$schema":"node_modules/wrangler/config-schema.json",
            "name":WORKER,
            "main":"worker.mjs",
            "compatibility_date":"2026-09-05",
            "workers_dev":True,
            "observability":{"enabled":True},
        }
        (workdir/"wrangler.json").write_text(
            json.dumps(config,indent=2)+"\n",
            encoding="utf-8",
        )

        deploy_source(workdir,baseline)
        worker_created=True

        status,subdomain_payload=cf_json(
            f"/accounts/{ACCOUNT_ID}/workers/subdomain"
        )
        result=subdomain_payload.get("result") if isinstance(subdomain_payload,dict) else None
        subdomain=(result or {}).get("subdomain") if isinstance(result,dict) else None
        if status!=200 or not subdomain:
            raise RuntimeError("Cloudflare workers.dev subdomain unavailable")
        url=f"https://{WORKER}.{subdomain}.workers.dev"
        evidence["canary_url_host"]=urllib.parse.urlparse(url).hostname

        # Workers.dev propagation is asynchronous. Poll the exact baseline contract.
        health_status=None
        health={}
        health_ms=0.0
        health_last=None
        for _ in range(45):
            health_status,health,health_ms=http_json(url+"/health")
            health_last=(health_status,health)
            if (
                health_status==200
                and health.get("ok") is True
                and health.get("release")=="baseline"
                and health.get("production") is False
            ):
                break
            time.sleep(1)
        else:
            raise RuntimeError("baseline canary health failed after propagation window: "+repr(health_last))
        pre_status,pre_body,_=http_json(url+"/probe","POST")
        if pre_status < 400:
            raise RuntimeError(
                "canary probe did not fail closed before secret installation: "
                +repr((pre_status,pre_body))
            )
        evidence["pre_secret_probe_http"]=pre_status

        put_secret(workdir,secret_a)
        a_response,a_ms=wait_probe(url,secret_a,200)

        # Real secret rotation: replace secret A with B, then require A rejection and B recovery.
        put_secret(workdir,secret_b)
        old_rejected=False
        old_status=None
        for _ in range(30):
            old_status,_,_=http_json(
                url+"/probe",
                "POST",
                secret=secret_a,
                request_id="MUSITU-CONNECT-CANARY-OLD-"+uuid.uuid4().hex[:12],
            )
            if old_status==401:
                old_rejected=True
                break
            time.sleep(1)
        if not old_rejected:
            raise RuntimeError("old canary secret remained valid after rotation")
        b_response,b_ms=wait_probe(url,secret_b,200)

        evidence["secret_rotation_recovery"]={
            "pass":True,
            "old_secret_rejected":True,
            "old_secret_http":old_status,
            "new_secret_accepted":True,
            "new_secret_http":200,
            "secret_values_published":False,
        }

        # Bounded canary/SLO sample window after rotation.
        latencies=[]
        errors=0
        correlation_failures=0
        for index in range(SAMPLES):
            rid=f"MUSITU-CONNECT-CANARY-SLO-{RUN_ID}-{index:03d}"
            status,obj,elapsed=http_json(
                url+"/probe",
                "POST",
                secret=secret_b,
                request_id=rid,
            )
            latencies.append(elapsed)
            if status!=200 or obj.get("ok") is not True:
                errors+=1
            if obj.get("request_id")!=rid:
                correlation_failures+=1
        ordered=sorted(latencies)
        p95=ordered[max(0,math.ceil(0.95*len(ordered))-1)]
        avg=statistics.fmean(latencies)
        error_rate=errors/len(latencies)
        slo_pass=(
            errors==0
            and correlation_failures==0
            and p95<=P95_LIMIT_MS
        )
        if not slo_pass:
            raise RuntimeError(
                f"canary SLO failed: p95={p95:.2f}ms errors={errors} correlation={correlation_failures}"
            )
        evidence["canary"]={
            "pass":True,
            "sample_count":SAMPLES,
            "error_count":errors,
            "error_rate":error_rate,
            "request_id_correlation_failures":correlation_failures,
            "latency_avg_ms":round(avg,3),
            "latency_p95_ms":round(p95,3),
            "latency_p95_limit_ms":P95_LIMIT_MS,
            "health_http":health_status,
            "unauthorized_fail_closed":True,
            "pre_secret_probe_http":pre_status,
            "post_rotation_probe_http":200,
        }
        evidence["observability_slo"]={
            "observability_configured":True,
            "synthetic_request_metrics_collected":True,
            "slo_window_pass":True,
            "p95_latency_ms":round(p95,3),
            "p95_limit_ms":P95_LIMIT_MS,
            "error_rate":error_rate,
            "external_alert_delivery_verified":False,
        }

        # Deploy a known-bad candidate to the isolated worker.
        deploy_source(workdir,candidate)
        candidate_detected=False
        candidate_status=None
        for _ in range(30):
            candidate_status,obj,_=http_json(
                url+"/probe",
                "POST",
                secret=secret_b,
                request_id="MUSITU-CONNECT-CANARY-CANDIDATE-"+uuid.uuid4().hex[:12],
            )
            if candidate_status==503 and obj.get("release")=="candidate-failure":
                candidate_detected=True
                break
            time.sleep(1)
        if not candidate_detected:
            raise RuntimeError("known-bad canary candidate was not detected")
        print("::warning title=MUSITU Connect canary alert::Known-bad candidate produced HTTP 503; rollback initiated")
        evidence["synthetic_alert"]={
            "triggered":True,
            "condition":"authenticated canary probe returned HTTP 503",
            "signal_channel":"GitHub Actions workflow annotation",
            "external_paging_verified":False,
        }

        # Real code rollback to last-known-good source and verify recovery with rotated secret B.
        deploy_source(workdir,baseline)
        rollback_response,rollback_ms=wait_probe(url,secret_b,200)
        if rollback_response.get("release")!="baseline":
            raise RuntimeError("rollback did not restore baseline release")
        evidence["rollback_rehearsal"]={
            "pass":True,
            "bad_candidate_detected":True,
            "bad_candidate_http":candidate_status,
            "rollback_source_sha256":evidence["baseline_source_sha256"],
            "rollback_probe_http":200,
            "rollback_release":"baseline",
            "rotated_secret_survived_code_rollback":True,
            "recovery_latency_ms":round(rollback_ms,3),
        }

        evidence["gate"]="MUSITU_CONNECT_OPERATIONAL_CANARY_REHEARSAL_PASS"
    finally:
        cleanup_ok=True
        if worker_created:
            try:
                cleanup_ok=delete_worker()
            except Exception:
                cleanup_ok=False
        evidence["cleanup_complete"]=cleanup_ok
        evidence["ephemeral_worker_deleted"]=cleanup_ok
        shutil.rmtree(workdir,ignore_errors=True)

    if evidence.get("gate")!="MUSITU_CONNECT_OPERATIONAL_CANARY_REHEARSAL_PASS":
        raise RuntimeError("operational canary rehearsal did not reach PASS gate")
    if evidence.get("cleanup_complete") is not True:
        raise RuntimeError("ephemeral canary cleanup failed")

    raw=(json.dumps(evidence,indent=2,sort_keys=True)+"\n").encode("utf-8")
    out=Path("musitu-connect-operational-canary-rehearsal.json")
    out.write_bytes(raw)
    digest=hashlib.sha256(raw).hexdigest()
    Path("musitu-connect-operational-canary-rehearsal.sha256").write_text(
        digest+"  "+out.name+"\n",
        encoding="utf-8",
    )
    print("MUSITU_CONNECT_OPERATIONAL_CANARY_EVIDENCE="+json.dumps({
        "gate":evidence["gate"],
        "secret_rotation_recovery":True,
        "rollback_rehearsal":True,
        "canary":True,
        "slo_window_pass":True,
        "external_alert_delivery_verified":False,
        "cleanup_complete":True,
        "production_axiom_integration_enabled":False,
        "evidence_sha256":digest,
    },sort_keys=True))

if __name__=="__main__":
    main()
