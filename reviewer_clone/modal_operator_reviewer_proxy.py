from __future__ import annotations

import json
import sys

import modal

APP_NAME="musitu-axiom-operator-reviewer-private-20261006"
VOLUME_NAME="musitu-axiom-operator-reviewer-state-20261006"
OPERATOR_TENANT="musitu-private-operator-reviewer"
OPERATOR_ACTOR="chatgpt-operator-reviewer"
INTERNAL_BEARER="reviewer-modal-proxy-authenticated-internal-only"

image=(
    modal.Image.debian_slim(python_version="3.13")
    .pip_install("fastapi==0.128.2","uvicorn==0.38.0")
    .add_local_dir("frontier_v5","/opt/axiom/frontier_v5",copy=True)
    .add_local_dir("reviewer_clone","/opt/axiom/reviewer_clone",copy=True)
)
volume=modal.Volume.from_name(VOLUME_NAME,create_if_missing=True)
app=modal.App(APP_NAME,include_source=True)


@app.function(
    image=image,
    volumes={"/state":volume},
    min_containers=0,
    max_containers=1,
    scaledown_window=300,
    timeout=300,
)
@modal.asgi_app(requires_proxy_auth=True)
def operator_endpoint():
    sys.path.insert(0,"/opt/axiom")
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    from frontier_v5.runtime.operator_daemon import OperatorDaemonApplication
    from reviewer_clone.operator_reviewer_transport import trusted_operator_headers

    operator=OperatorDaemonApplication(
        root="/state",
        tenant=OPERATOR_TENANT,
        actor_id=OPERATOR_ACTOR,
        bearer_token=INTERNAL_BEARER,
    )
    api=FastAPI(
        title="MUSITU Axiom Operator Reviewer Private",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @api.api_route("/{path:path}",methods=["GET","POST","PUT","DELETE"])
    async def dispatch(path: str, request: Request):
        body=await request.body()
        incoming=dict(request.headers)
        if request.method=="POST" and path=="mcp":
            try:
                incoming=trusted_operator_headers(incoming,body)
            except Exception as exc:
                return JSONResponse(
                    content={"error":"TRUSTED_TRANSPORT_REJECTED","message":str(exc)},
                    status_code=400,
                    headers={"cache-control":"no-store"},
                )
        incoming["authorization"]="Bearer "+INTERNAL_BEARER
        status,headers,payload=operator.handle(
            request.method,
            "/"+path,
            incoming,
            body,
        )
        if request.method=="POST" and path=="mcp" and status < 500:
            await volume.commit.aio()
        safe_headers={
            str(k):str(v)
            for k,v in headers.items()
            if str(k).lower() in {"content-type","cache-control","mcp-protocol-version"}
        }
        return JSONResponse(content=payload,status_code=status,headers=safe_headers)

    return api
