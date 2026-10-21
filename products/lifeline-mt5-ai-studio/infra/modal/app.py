"""Private authenticated LIFELINE signed Windows-agent probe queue, no trading."""
import os,sys,base64,json
from pathlib import Path
from urllib.parse import urlsplit
import modal
APP_ROOT="products/lifeline-mt5-ai-studio"
app=modal.App("lifeline-mt5-analytics-isolated")
image=(modal.Image.debian_slim(python_version="3.12")
 .pip_install("fastapi>=0.115,<1","psycopg[binary]>=3.2,<4","certifi>=2025.1","cryptography>=44,<47")
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
