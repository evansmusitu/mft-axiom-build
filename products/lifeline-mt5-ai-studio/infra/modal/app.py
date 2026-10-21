"""Private authenticated LIFELINE signed Windows-agent probe queue, no trading."""
import os,sys,base64,json
from pathlib import Path
from urllib.parse import urlsplit
import modal
APP_ROOT="products/lifeline-mt5-ai-studio"
app=modal.App("lifeline-mt5-analytics-isolated")
image=(modal.Image.debian_slim(python_version="3.12")
 .pip_install("fastapi>=0.115,<1","httpx>=0.28,<1","psycopg[binary]>=3.2,<4","certifi>=2025.1","cryptography>=44,<47")
 .add_local_dir(APP_ROOT+"/infra/modal","/opt/lifeline/modal",copy=True)
 .add_local_dir(APP_ROOT+"/windows","/opt/lifeline/windows",copy=True))
@app.function(image=image,min_containers=0,max_containers=1,cpu=0.125,memory=256,
              scaledown_window=10,timeout=40,
              secrets=[
                 modal.Secret.from_name("lifeline-mt5-neon-stage-unwrap-key-20261021",
                                        required_keys=["RSA_PRIVATE_PEM_B64"]),
                 modal.Secret.from_name("lifeline-mt5-bridge-probe-20261021",
                                        required_keys=["AGENT_ID","AGENT_TENANT","AGENT_HMAC_KEY","EDGE_SHARED_SECRET"])])
@modal.asgi_app(requires_proxy_auth=True)
def private_api():
    from cryptography.hazmat.primitives import serialization,hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from fastapi import FastAPI,HTTPException
    from fastapi.responses import JSONResponse
    sys.path.insert(0,"/opt/lifeline/windows")
    sys.path.insert(0,"/opt/lifeline/modal")
    from pg_queue import PostgresQueue
    from staging_api import create_local_app
    try:
        obj=json.loads(Path("/opt/lifeline/modal/neon_envelope.json").read_text())
        if obj.get("schema")!="lifeline.secret_envelope.rsa_oaep_sha256.v1":raise ValueError()
        rsa=serialization.load_pem_private_key(
           base64.b64decode(os.environ["RSA_PRIVATE_PEM_B64"],validate=True),password=None)
        dsn=rsa.decrypt(base64.b64decode(obj["ciphertext_b64"],validate=True),
            padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=None)).decode()
        url=urlsplit(dsn)
        if (url.scheme!="postgresql" or url.username!="lifeline_stage_app" or
            url.path!="/lifeline_mt5_stage" or not url.password or not url.hostname or
            not url.hostname.endswith(".neon.tech") or url.fragment):raise ValueError()
        ident=os.environ["AGENT_ID"];tenant=os.environ["AGENT_TENANT"]
        key=os.environ["AGENT_HMAC_KEY"].encode();edge=os.environ["EDGE_SHARED_SECRET"]
        if len(key)<32 or len(edge)<32:raise ValueError()
        api=create_local_app(PostgresQueue(dsn),{ident:key},{ident:tenant},edge)
    except Exception:
        api=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
        @api.get("/healthz")
        def fail_closed():raise HTTPException(503,"private stage not configured")
        return api
    @api.get("/healthz")
    def healthz():
        return JSONResponse({"schema":"lifeline.private_bridge.v1",
            "auth":"modal_proxy_only","queue":"neon_restricted_signed_probe",
            "windows_persistent":False,"cloudflare_access_connected":False,
            "live_trading":False},headers={"Cache-Control":"no-store"})
    return api

@app.function(image=image,name="verify_private_neon_receipt_binding",
              min_containers=0,max_containers=1,cpu=0.125,memory=256,
              timeout=65,scaledown_window=10,
              secrets=[
                 modal.Secret.from_name("lifeline-mt5-neon-stage-unwrap-key-20261021",
                                        required_keys=["RSA_PRIVATE_PEM_B64"]),
                 modal.Secret.from_name("lifeline-mt5-bridge-probe-20261021",
                                        required_keys=["AGENT_ID","AGENT_TENANT",
                                                       "AGENT_HMAC_KEY","EDGE_SHARED_SECRET"])
              ])
def verify_private_neon_receipt_binding():
    """Internal-only real restricted Neon regression test; no HTTP route."""
    from cryptography.hazmat.primitives import serialization,hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from fastapi.testclient import TestClient
    from urllib.parse import urlsplit
    import pathlib
    import tempfile
    import time
    sys.path.insert(0,"/opt/lifeline/modal")
    sys.path.insert(0,"/opt/lifeline/windows")
    import agent,poller
    from pg_queue import PostgresQueue
    from staging_api import create_local_app
    result={"schema":"lifeline.private_sql_hardening.v1","operation":"probe",
            "signed_job":False,"cross_operation_receipt_rejected":False,
            "replayed_agent_request_rejected":False,
            "exact_matching_receipt_committed":False,
            "out_of_tenant_operator_rejected":False,
            "live_trading":False,"host_persistent":False}
    try:
        sealed=json.loads(pathlib.Path("/opt/lifeline/modal/neon_envelope.json").read_text())
        if sealed.get("schema")!="lifeline.secret_envelope.rsa_oaep_sha256.v1":
            raise ValueError("envelope")
        priv=serialization.load_pem_private_key(
            base64.b64decode(os.environ["RSA_PRIVATE_PEM_B64"],validate=True),password=None)
        dsn=priv.decrypt(base64.b64decode(sealed["ciphertext_b64"],validate=True),
            padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                         algorithm=hashes.SHA256(),label=None)).decode()
        u=urlsplit(dsn)
        if (u.username!="lifeline_stage_app" or
            not u.hostname or not u.hostname.endswith(".neon.tech") or
            u.path!="/lifeline_mt5_stage"):raise ValueError("not restricted Neon")
        ident=os.environ["AGENT_ID"];tenant=os.environ["AGENT_TENANT"]
        key=os.environ["AGENT_HMAC_KEY"].encode()
        edge=os.environ["EDGE_SHARED_SECRET"]
        client=TestClient(create_local_app(PostgresQueue(dsn),{ident:key},{ident:tenant},edge))
        op_headers={"x-lifeline-edge-secret":edge,"x-lifeline-subject":tenant}
        unauthorized=client.post("/operator/status",json={},
                    headers={**op_headers,"x-lifeline-subject":"other-tenant"})
        if unauthorized.status_code!=403:raise ValueError("cross tenant operator")
        result["out_of_tenant_operator_rejected"]=True
        created=client.post("/operator/probe",json={"operation":"probe"},headers=op_headers)
        if created.status_code!=200:raise ValueError("cannot create safe probe")
        job_id=created.json()["job_id"]
        body={"request":"next","tenant":tenant}
        headers=poller.headers(body,key,ident,tenant)
        first=client.post("/agent/pull",json=body,headers=headers)
        if first.status_code!=200:raise ValueError("cannot retrieve signed probe")
        job=first.json().get("job")
        if not isinstance(job,dict) or job.get("job_id")!=job_id:
            raise ValueError("job id mismatch")
        if agent.verify_job(job,key)["operation"]!="probe":
            raise ValueError("not a permitted probe")
        result["signed_job"]=True
        duplicate=client.post("/agent/pull",json=body,headers=headers)
        if duplicate.status_code!=401:raise ValueError("replay admitted")
        result["replayed_agent_request_rejected"]=True
        # Authenticated HMAC alone does not permit asserting a DIFFERENT operation.
        tampered={"schema":"lifeline.agent.receipt.v1","job_id":job_id,
             "tenant":tenant,"operation":"backtest","outcome":"completed",
             "result":{"verified":True},"created_at":int(time.time()),
             "trading_enabled":False}
        tampered["signature"]=agent.sign(tampered,key)
        payload={"receipt":tampered}
        bad=client.post("/agent/receipt",json=payload,
            headers=poller.headers(payload,key,ident,tenant))
        if bad.status_code!=409:raise ValueError("mismatched receipt accepted")
        result["cross_operation_receipt_rejected"]=True
        with tempfile.TemporaryDirectory() as tmp:
            home=pathlib.Path(tmp)
            receipt=agent.execute_once(job,key,home,None,None,home/"durable.sqlite")
        request={"receipt":receipt}
        accepted=client.post("/agent/receipt",json=request,
             headers=poller.headers(request,key,ident,tenant))
        if accepted.status_code!=200 or accepted.json().get("accepted") is not True:
            raise ValueError("legitimate receipt not durable")
        status=client.post("/operator/status",json={},headers=op_headers)
        if status.status_code!=200 or int(status.json().get("jobs",{}).get("COMPLETED",0))<1:
            raise ValueError("Neon receipt missing")
        result["exact_matching_receipt_committed"]=True
        return result
    except Exception:
        # No DSN, credentials, agent signature or raw driver errors in workflow logs.
        raise RuntimeError("internal private Neon hardening regression failed") from None
