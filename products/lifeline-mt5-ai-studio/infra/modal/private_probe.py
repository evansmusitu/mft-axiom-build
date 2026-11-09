"""LIFELINE isolated private Modal research staging, not a broker/terminal service."""
import sys
import modal

app = modal.App("lifeline-mt5-private-probe-isolated")
image = (modal.Image.debian_slim(python_version="3.12")
  .pip_install("fastapi>=0.115,<1","cryptography>=44,<47",
               "psycopg[binary]>=3.2,<4","certifi>=2025.1")
  .add_local_file("products/lifeline-mt5-ai-studio/infra/modal/research_math.py",
                  "/opt/lifeline/research_math.py", copy=True)
  .add_local_file("products/lifeline-mt5-ai-studio/infra/modal/neon_envelope.json",
                  "/opt/lifeline/neon_envelope.json", copy=True))

@app.function(
    image=image,name="private_status",min_containers=0,max_containers=1,
    scaledown_window=10, timeout=35, cpu=0.125, memory=256,
    secrets=[modal.Secret.from_name("lifeline-mt5-neon-stage-unwrap-key-20261021",
                                    required_keys=["RSA_PRIVATE_PEM_B64"])],
)
@modal.asgi_app(requires_proxy_auth=True)
def private_status():
    import json
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import JSONResponse
    sys.path.insert(0,"/opt/lifeline")
    from research_math import summarize

    api=FastAPI(title="LIFELINE Private Research Stage",
        docs_url=None,redoc_url=None,openapi_url=None)

    @api.get("/healthz")
    def healthz():
        return JSONResponse({
            "schema":"lifeline.private_modal_probe.v2",
            "runtime":"modal-private-stage",
            "access":"proxy_auth_required",
            "research_pnl_enabled":True,
            "neon_connected":False,
            "windows_agent_connected":False,
            "cloudflare_gateway_connected":False,
            "live_trading":False,
            "public_mcp_enabled":False,
        },headers={"Cache-Control":"no-store"})

    @api.post("/research/summary")
    async def research_summary(request:Request):
        if request.headers.get("content-type","").split(";",1)[0].strip().lower()!="application/json":
            raise HTTPException(415,"application/json required")
        raw=await request.body()
        if len(raw)>16384:
            raise HTTPException(413,"research payload too large")
        try:
            obj=json.loads(raw)
        except (ValueError,UnicodeDecodeError):
            raise HTTPException(400,"invalid JSON")
        if not isinstance(obj,dict) or set(obj)!={"pnl"}:
            raise HTTPException(422,"pnl-only schema required")
        try:
            output=summarize(obj["pnl"])
        except ValueError as exc:
            raise HTTPException(422,str(exc))
        return JSONResponse(output,headers={"Cache-Control":"no-store"})

    @api.get("/research/neon-readiness")
    def neon_readiness():
        """Authenticated Modal-only read-through health check; NO SQL exposed."""
        from pathlib import Path
        from urllib.parse import urlsplit
        import base64
        import os
        import certifi
        import psycopg
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
        try:
            envelope=json.loads(Path("/opt/lifeline/neon_envelope.json").read_text())
            if envelope.get("schema")!="lifeline.secret_envelope.rsa_oaep_sha256.v1":
                raise ValueError("unqualified envelope")
            private_key=serialization.load_pem_private_key(
                base64.b64decode(os.environ["RSA_PRIVATE_PEM_B64"],validate=True), password=None)
            dsn=private_key.decrypt(
                base64.b64decode(envelope["ciphertext_b64"],validate=True),
                padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                             algorithm=hashes.SHA256(),label=None)).decode("utf-8")
            u=urlsplit(dsn)
            if (u.scheme!="postgresql" or u.username!="lifeline_stage_app" or
                u.path!="/lifeline_mt5_stage" or not u.hostname or
                not u.hostname.endswith(".neon.tech") or not u.password or u.fragment):
                raise ValueError("unqualified database identity")
            with psycopg.connect(dsn,sslmode="verify-full",sslrootcert=certifi.where(),
                                 connect_timeout=10,autocommit=True,
                                 prepare_threshold=None) as conn:
                role=conn.execute("SELECT current_user,rolbypassrls,rolcreaterole,rolsuper "
                                  "FROM pg_roles WHERE rolname=current_user").fetchone()
                if role is None or role[0]!="lifeline_stage_app" or any(role[1:]):
                    raise ValueError("unsafe runtime role")
                if not all(conn.execute("SELECT row_security_active(%s::regclass)",(table,)).fetchone()[0]
                     for table in ("lifeline.agent_jobs","lifeline.agent_nonces",
                                   "lifeline.research_receipts")):
                    raise ValueError("missing tenant RLS")
                def visible(tenant):
                    with conn.transaction():
                        conn.execute("SELECT set_config('lifeline.tenant_subject',%s,true)",(tenant,))
                        cross=conn.execute("SELECT count(*) FROM lifeline.agent_jobs WHERE tenant_subject<>%s",
                                           (tenant,)).fetchone()[0]
                        own=conn.execute("SELECT count(*) FROM lifeline.agent_jobs WHERE tenant_subject=%s",
                                         (tenant,)).fetchone()[0]
                        if cross!=0 or own<1:
                            raise ValueError("RLS isolation or synthetic fixtures missing")
                        return own
                a,b=visible("test_tenant_A"),visible("test_tenant_B")
            return JSONResponse({"schema":"lifeline.modal_neon_readiness.v1",
                 "authenticated_private_runtime":True,
                 "live_restricted_neon_login":True,
                 "tls_verify_full":True,
                 "three_tables_rls_active":True,
                 "synthetic_tenant_a_isolated":a>0,
                 "synthetic_tenant_b_isolated":b>0,
                 "windows_host_connected":False,
                 "cloudflare_access_gateway_connected":False,
                 "live_trading":False},
                 headers={"Cache-Control":"no-store"})
        except Exception:
            # NEVER reflect DSN, SQL details, cert path, token or database errors.
            raise HTTPException(503,"private Neon readiness unavailable") from None

    return api
