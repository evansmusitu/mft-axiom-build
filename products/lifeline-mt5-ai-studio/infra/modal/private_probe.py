"""LIFELINE isolated private Modal research staging, not a broker/terminal service."""
import sys
import modal

app = modal.App("lifeline-mt5-private-probe-isolated")
image = (modal.Image.debian_slim(python_version="3.12")
  .pip_install("fastapi>=0.115,<1")
  .add_local_file("products/lifeline-mt5-ai-studio/infra/modal/research_math.py",
                  "/opt/lifeline/research_math.py", copy=True))

@app.function(
    image=image,name="private_status",min_containers=0,max_containers=1,
    scaledown_window=10, timeout=15, cpu=0.125, memory=128,
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

    return api
