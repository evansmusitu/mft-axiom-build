"""Modal private ASGI kernel for LIFELINE MT5.

Deploy is MANUAL and requires a distinct isolated Neon database, Cloudflare JWT edge,
modal proxy-auth and a reviewed secret set. No trading endpoints exist.
"""
from __future__ import annotations
import os
import sys
import modal

ROOT='products/lifeline-mt5-ai-studio'
app=modal.App('lifeline-mt5-analytics-isolated')
image=(modal.Image.debian_slim(python_version='3.12')
    .pip_install('fastapi>=0.115,<1','psycopg[binary]>=3.2,<4')
    .add_local_dir(ROOT+'/infra/modal','/opt/lifeline/modal',copy=True)
    .add_local_dir(ROOT+'/windows','/opt/lifeline/windows',copy=True))

@app.function(image=image,min_containers=0,max_containers=1,timeout=120,
              secrets=[modal.Secret.from_name('lifeline-mt5-stage-secrets')])
@modal.asgi_app(requires_proxy_auth=True)
def private_api():
    sys.path.insert(0,'/opt/lifeline/modal')
    sys.path.insert(0,'/opt/lifeline/windows')
    from fastapi import FastAPI, Header, HTTPException
    from pg_queue import PostgresQueue
    from staging_api import create_local_app
    import secrets
    agent_id=os.environ.get('AGENT_ID','')
    tenant=os.environ.get('AGENT_TENANT','')
    key=os.environ.get('AGENT_HMAC_KEY','').encode()
    edge=os.environ.get('EDGE_SHARED_SECRET','')
    dsn=os.environ.get('DATABASE_URL','')
    if not agent_id or not tenant or len(key)<32 or len(edge)<32 or not dsn:
        # Qualify as unconfigured, not operational. Never start insecure defaults.
        api=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
        @api.get('/healthz')
        def not_configured():raise HTTPException(503,'private runtime not configured')
        return api
    return create_local_app(PostgresQueue(dsn),{agent_id:key},{agent_id:tenant},edge)
