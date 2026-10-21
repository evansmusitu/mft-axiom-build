"""LIFELINE MT5 *isolated* private Modal connectivity proof.

No trading, Windows execution, worker forwarding, Neon DSN or external user operations.
Do NOT connect to this app with public Cloudflare Worker or Vercel clients.
"""
import modal

app = modal.App("lifeline-mt5-private-probe-isolated")
image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "fastapi>=0.115,<1"
)

@app.function(
    image=image,
    name="private_status",
    min_containers=0,
    max_containers=1,
    scaledown_window=10,
    timeout=15,
    cpu=0.125,
    memory=128,
)
@modal.asgi_app(requires_proxy_auth=True)
def private_status():
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    api = FastAPI(
        title="LIFELINE Private Stage",
        docs_url=None, redoc_url=None, openapi_url=None,
    )
    @api.get("/healthz")
    def healthz():
        return JSONResponse({
            "schema": "lifeline.private_modal_probe.v1",
            "runtime": "modal-private-stage",
            "access": "proxy_auth_required",
            "neon_connected": False,
            "windows_agent_connected": False,
            "cloudflare_gateway_connected": False,
            "live_trading": False,
            "public_mcp_enabled": False,
        }, headers={"Cache-Control": "no-store"})
    return api
