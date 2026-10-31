"""Local HTTP contract for LIFELINE agent/edge; not a production Modal backend.

Production MUST use NeonStore with tenant RLS, Modal proxy auth and Cloudflare Access.
Never publish this local SQLite backend directly to the internet.
"""
from __future__ import annotations
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import sys
import time
import uuid
from typing import Any
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, Response

WINDOWS=Path(__file__).resolve().parents[2]/'windows'
if str(WINDOWS) not in sys.path:sys.path.insert(0,str(WINDOWS))
import agent
import poller
from bridge import SQLiteQueue,QueueError

def create_local_app(store:SQLiteQueue,keys:dict[str,bytes],tenants:dict[str,str],edge_secret:str)->FastAPI:
    if len(edge_secret)<32:raise ValueError('invalid edge secret')
    if not keys or any(len(k)<32 for k in keys.values()):raise ValueError('agent pairing key missing')
    api=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)

    async def payload(req:Request)->dict:
        b=await req.body()
        if len(b)>131072:raise HTTPException(413,'payload too large')
        try:obj=json.loads(b)
        except Exception:raise HTTPException(400,'invalid JSON')
        if not isinstance(obj,dict):raise HTTPException(400,'object required')
        return obj

    def require_agent(request:Request,body:dict)->tuple[str,str]:
        hdrs={k.lower():v for k,v in request.headers.items()}
        try:
            ident,tenant,nonce=poller.authorized_headers(body,hdrs,keys,tenants)
            store.nonce_once(ident,nonce,tenant)
            return ident,tenant
        except (agent.AgentError,QueueError):raise HTTPException(401,'agent not authorized or replayed')
        except Exception:raise HTTPException(503,'private persistence unavailable')

    def require_edge(request:Request)->str:
        secret=request.headers.get('x-lifeline-edge-secret','')
        subject=request.headers.get('x-lifeline-subject','')
        if not secrets.compare_digest(secret,edge_secret) or not subject or len(subject)>100:
            raise HTTPException(401,'operator not authorized')
        return subject

    @api.post('/agent/pull')
    async def agent_pull(request:Request):
        body=await payload(request)
        ident,tenant=require_agent(request,body)
        if body!={'request':'next','tenant':tenant}:
            raise HTTPException(400,'not a valid poll request')
        job=store.pull(tenant,ident,keys[ident])
        return {'schema':'lifeline.bridge.v1','job':job}

    @api.post('/agent/receipt')
    async def agent_receipt(request:Request):
        body=await payload(request)
        ident,tenant=require_agent(request,body)
        if set(body)!={'receipt'} or not isinstance(body.get('receipt'),dict):
            raise HTTPException(400,'invalid receipt')
        receipt=body['receipt']
        signature=receipt.get('signature','')
        unsigned={k:v for k,v in receipt.items() if k!='signature'}
        if not (isinstance(signature,str) and hmac.compare_digest(signature,agent.sign(unsigned,keys[ident]))):
            raise HTTPException(401,'invalid receipt signature')
        if (set(receipt)!={'schema','job_id','tenant','operation','outcome','result',
                           'created_at','trading_enabled','signature'} or
            receipt.get('schema')!='lifeline.agent.receipt.v1' or
            receipt.get('tenant')!=tenant or
            receipt.get('trading_enabled') is not False or
            receipt.get('operation') not in ('probe','compile','backtest') or
            receipt.get('outcome') not in ('completed','rejected') or
            type(receipt.get('created_at')) is not int or
            not isinstance(receipt.get('result'),dict)):
            raise HTTPException(400,'incorrect receipt binding')
        if not store.receipt(tenant,ident,receipt):
            raise HTTPException(409,'not claimed or receipt mismatch')
        return {'schema':'lifeline.bridge.v1','accepted':True,'job_id':receipt['job_id']}

    @api.post('/operator/probe')
    async def operator_probe(request:Request):
        subject=require_edge(request)
        body=await payload(request)
        if body!={'operation':'probe'}:raise HTTPException(403,'operation not enabled')
        candidates=[ident for ident,tenant in tenants.items() if tenant==subject]
        if len(candidates)!=1:raise HTTPException(403,'agent not paired for operator')
        ident=candidates[0]
        unsigned={'job_id':str(uuid.uuid4()),'issued_at':int(time.time()),'nonce':secrets.token_urlsafe(18),
                  'operation':'probe','args':{},'tenant':subject}
        job=dict(unsigned,signature=agent.sign(unsigned,keys[ident]))
        try:
            store.enqueue(subject,ident,job)
        except QueueError:
            raise HTTPException(429,'stage queue capacity exceeded') from None
        return {'schema':'lifeline.bridge.v1','job_id':job['job_id'],'state':'PENDING','trade_execution':False}

    @api.post('/operator/status')
    async def operator_status(request:Request):
        subject=require_edge(request)
        body=await payload(request)
        if body!={}:raise HTTPException(400,'unsupported status parameters')
        candidates=[ident for ident,tenant in tenants.items() if tenant==subject]
        if len(candidates)!=1:raise HTTPException(403,'agent not paired')
        return {'schema':'lifeline.bridge.v1','jobs':store.summary(subject,candidates[0]),'trade_execution':False}
    return mount_readonly_mcp(api,edge_secret,frozenset(tenants.values()))

# Read-only MCP status: one surface, zero investment execution tools.
def mount_readonly_mcp(api:FastAPI, edge_secret:str, allowed_subjects:frozenset[str]):
    @api.post('/mcp')
    async def mcp(request:Request):
        # Caller MUST arrive via Modal proxy-auth and the Cloudflare Worker.
        require_headers={'x-lifeline-edge-secret','x-lifeline-subject'}
        if not require_headers.issubset(request.headers) or not secrets.compare_digest(request.headers.get('x-lifeline-edge-secret',''),edge_secret):
            raise HTTPException(401,'private edge required')
        if request.headers.get('x-lifeline-subject','') not in allowed_subjects:
            raise HTTPException(403,'unrecognized private staging tenant')
        # Even though Modal proxy authentication is mandatory, reject malformed or
        # overlarge RPC bodies before parsing.  The status tool accepts NO arguments;
        # it must not become a generic pass-through when the private bridge is enabled.
        raw=await request.body()
        if len(raw)>65536:raise HTTPException(413,'MCP request too large')
        try:obj=json.loads(raw)
        except (ValueError,UnicodeDecodeError):raise HTTPException(400,'invalid MCP JSON') from None
        if not isinstance(obj,dict) or obj.get('jsonrpc')!='2.0':
            raise HTTPException(400,'invalid MCP JSON-RPC envelope')
        method=obj.get('method')
        if method=='notifications/initialized':
            if ('id' in obj or set(obj)-{'jsonrpc','method','params'} or
                obj.get('params',{})!={}):
                raise HTTPException(400,'invalid MCP lifecycle notification')
            return Response(status_code=202)
        rpc_id=obj.get('id')
        valid_id=(type(rpc_id) is int and abs(rpc_id)<=9007199254740991) or (
            type(rpc_id) is str and 1<=len(rpc_id)<=128 and
            all(' '<=ch<='~' for ch in rpc_id))
        if 'id' not in obj or not valid_id or set(obj)-{'jsonrpc','id','method','params'}:
            raise HTTPException(400,'invalid MCP JSON-RPC envelope')
        if method=='initialize':
            params=obj.get('params')
            client=params.get('clientInfo') if type(params) is dict else None
            def bounded(value,size):
                return (type(value) is str and 0<len(value)<=size and
                    all(ord(ch)>=32 and ord(ch)!=127 for ch in value))
            if (type(params) is not dict or
                set(params)-{'protocolVersion','capabilities','clientInfo'} or
                params.get('protocolVersion')!='2025-03-26' or
                type(params.get('capabilities')) is not dict or
                type(client) is not dict or set(client)-{'name','version'} or
                not bounded(client.get('name'),100) or not bounded(client.get('version'),60)):
                return {'jsonrpc':'2.0','id':rpc_id,
                    'error':{'code':-32602,'message':'Invalid parameters'}}
            result={'protocolVersion':'2025-03-26','serverInfo':{'name':'lifeline-mt5','version':'0.4.0'},'capabilities':{'tools':{}}}
        elif method in ('ping','tools/list') and ('params' in obj and obj['params']!={}):
            return {'jsonrpc':'2.0','id':rpc_id,
                'error':{'code':-32602,'message':'Invalid parameters'}}
        elif method=='ping':result={}
        elif method=='tools/list':
            result={'tools':[{'name':'lifeline_status','description':'Private MT5 integration staging status (no trading)',
                              'inputSchema':{'type':'object','properties':{},'additionalProperties':False},
                              'annotations':{'readOnlyHint':True,'destructiveHint':False,'openWorldHint':False}}]}
        elif method=='tools/call':
            params=obj.get('params')
            if (not isinstance(params,dict) or set(params)-{'name','arguments'} or
                params.get('arguments',{})!={}):
                return {'jsonrpc':'2.0','id':rpc_id,
                    'error':{'code':-32602,'message':'Invalid parameters'}}
            if params.get('name')!='lifeline_status':
                return {'jsonrpc':'2.0','id':rpc_id,
                    'error':{'code':-32601,'message':'Not enabled'}}
            result={'content':[{'type':'text','text':'Windows native compiler verified. Hosted agent pairing pending; trading disabled.'}]}
        else:return {'jsonrpc':'2.0','id':rpc_id,'error':{'code':-32601,'message':'Not enabled'}}
        return {'jsonrpc':'2.0','id':rpc_id,'result':result}
    return api
