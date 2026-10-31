"""LIFELINE outbound-only Windows bridge. No shell, listening socket or trade operations.

The `probe` mode can run without any MT5 installation; compilation/backtest require a
separately reviewed executable and corresponding independently pinned source hashes.
Not an always-on host or a broker integration by itself.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import time
import urllib.parse
import urllib.request
from typing import Any, Callable
import agent

MAX_RESPONSE=131072

def canonical(obj:Any)->bytes:
    return json.dumps(obj,sort_keys=True,separators=(",", ":"),ensure_ascii=False).encode()

def headers(body:dict, key:bytes, agent_id:str, tenant:str, now:int|None=None, nonce:str|None=None)->dict[str,str]:
    if len(key)<32 or not agent_id.isascii() or len(agent_id)>100 or not tenant.isascii() or len(tenant)>100:
        raise agent.AgentError('invalid pairing configuration')
    timestamp=str(int(time.time()) if now is None else now)
    challenge=nonce or secrets.token_urlsafe(24)
    body_hash=hashlib.sha256(canonical(body)).hexdigest()
    signed=f"{agent_id}\n{tenant}\n{timestamp}\n{challenge}\n{body_hash}".encode()
    signature=hmac.new(key,signed,hashlib.sha256).hexdigest()
    return {'x-lifeline-agent-id':agent_id,'x-lifeline-tenant':tenant,
            'x-lifeline-time':timestamp,'x-lifeline-nonce':challenge,
            'x-lifeline-signature':signature,'content-type':'application/json'}


def authorized_headers(body:dict, given:dict[str,str], keys:dict[str,bytes], tenant_for_agent:dict[str,str],
                       now:int|None=None)->tuple[str,str,str]:
    ident=given.get('x-lifeline-agent-id','')
    tenant=given.get('x-lifeline-tenant','')
    timestamp=given.get('x-lifeline-time','')
    nonce=given.get('x-lifeline-nonce','')
    sig=given.get('x-lifeline-signature','')
    if (ident not in keys or tenant_for_agent.get(ident)!=tenant or not timestamp.isdecimal() or
        len(timestamp)>14 or not 16<=len(nonce)<=100 or not nonce.replace('-','').replace('_','').isalnum() or
        len(sig)!=64 or not all(c in '0123456789abcdef' for c in sig)):
        raise agent.AgentError('invalid service authentication')
    if abs((int(time.time()) if now is None else now)-int(timestamp))>120:
        raise agent.AgentError('expired service request')
    expected=headers(body,keys[ident],ident,tenant,int(timestamp),nonce)['x-lifeline-signature']
    if not hmac.compare_digest(sig,expected):
        raise agent.AgentError('invalid service authentication')
    return ident,tenant,nonce

class HTTPSClient:
    """Outbound-only, exact trusted HTTPS origin; no redirects, proxy, or token forwarding."""
    HOST = 'lifeline-mt5-stage.mftintelligence.com'

    def __init__(self,base_url:str,timeout:int=12):
        parsed=urllib.parse.urlsplit(base_url)
        if (parsed.scheme!='https' or parsed.hostname!=self.HOST or
            parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise agent.AgentError('agent gateway must use the pinned LIFELINE HTTPS origin')
        if parsed.port not in (None,443):
            raise agent.AgentError('gateway nonstandard port not allowed')
        if parsed.path not in ('','/'):
            raise agent.AgentError('gateway base path not permitted')
        if type(timeout) is not int or not 1<=timeout<=30:
            raise agent.AgentError('invalid gateway timeout')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        self.base_url='https://'+self.HOST
        self.timeout=timeout
        self._client=urllib.request.build_opener(
            urllib.request.ProxyHandler({}),NoRedirect())
    def post(self,path:str,body:dict,h:dict[str,str])->dict:
        if path not in ('/agent/pull','/agent/receipt'):
            raise agent.AgentError('unsupported bridge route')
        raw=canonical(body)
        if len(raw)>MAX_RESPONSE:raise agent.AgentError('outbound payload too large')
        req=urllib.request.Request(self.base_url+path,raw,headers=h,method='POST')
        try:
            with self._client.open(req,timeout=self.timeout) as response:
                # No HTTP redirect is ever authorized. Prevent accidental cross-site
                # disclosure of agent HMAC headers even if the edge is misconfigured.
                if response.status!=200:
                    raise agent.AgentError('agent gateway returned unexpected HTTP status')
                if response.geturl()!=self.base_url+path:
                    raise agent.AgentError('agent gateway origin changed')
                size=response.headers.get('content-length')
                if size:
                    try:
                        if int(size)>MAX_RESPONSE:raise agent.AgentError('oversized gateway response')
                    except ValueError:raise agent.AgentError('invalid response length') from None
                if response.headers.get_content_type()!='application/json':
                    raise agent.AgentError('non-JSON gateway response')
                payload=response.read(MAX_RESPONSE+1)
                if len(payload)>MAX_RESPONSE:raise agent.AgentError('oversized gateway response')
                result=json.loads(payload)
        except urllib.error.HTTPError as exc:
            # In particular 301/302/307/308 must never redirect an HMAC request.
            raise agent.AgentError('agent gateway rejected HTTP status '+str(exc.code)) from None
        except (urllib.error.URLError,TimeoutError) as exc:
            raise agent.AgentError('agent gateway unreachable') from None
        except (ValueError,UnicodeDecodeError):
            raise agent.AgentError('invalid gateway JSON response') from None
        if not isinstance(result,dict):raise agent.AgentError('unexpected response')
        return result

class OutboundAgent:
    def __init__(self,client,agent_id:str,tenant:str,key:bytes,workdir:Path,editor:str|None=None,terminal:str|None=None):
        self.client=client;self.agent_id=agent_id;self.tenant=tenant;self.key=key
        self.workdir=workdir.resolve();self.workdir.mkdir(parents=True,exist_ok=True)
        self.database=self.workdir/'lifeline-claims.sqlite'
        self.editor=editor;self.terminal=terminal
    def call(self,path:str,payload:dict)->dict:
        result=self.client.post(path,payload,headers(payload,self.key,self.agent_id,self.tenant))
        if not isinstance(result,dict) or result.get('schema')!='lifeline.bridge.v1':
            raise agent.AgentError('untrusted bridge response')
        return result
    def step(self)->dict:
        pulled=self.call('/agent/pull',{'request':'next','tenant':self.tenant})
        job=pulled.get('job')
        if job is None:return {'state':'idle'}
        # Untrusted response MUST contain a signed, tenant-scoped task.
        validated=agent.verify_job(job,self.key)
        if validated['tenant']!=self.tenant:raise agent.AgentError('cross-tenant task rejected')
        if validated['operation']!='probe' and os.environ.get('LIFELINE_ALLOW_NATIVE_DEVELOPMENT')!='1':
            raise agent.AgentError('native job requires explicit trusted-host enablement')
        receipt=agent.execute_once(job,self.key,self.workdir,self.editor,self.terminal,self.database)
        reply=self.call('/agent/receipt',{'receipt':receipt})
        if reply.get('job_id')!=validated['job_id'] or reply.get('accepted') is not True:
            raise agent.AgentError('gateway did not acknowledge correct job')
        return {'state':'acknowledged','job_id':validated['job_id'],'outcome':receipt['outcome']}

def main()->int:
    url=os.environ.get('LIFELINE_EDGE_URL','')
    agent_id=os.environ.get('LIFELINE_AGENT_ID','')
    tenant=os.environ.get('LIFELINE_TENANT','')
    key=os.environ.get('LIFELINE_AGENT_SECRET','').encode()
    if len(key)<32:raise SystemExit('LIFELINE_AGENT_SECRET missing or too short')
    workdir=Path(os.environ.get('LIFELINE_AGENT_WORKDIR','./lifeline-data'))
    worker=OutboundAgent(HTTPSClient(url),agent_id,tenant,key,workdir,
                         os.environ.get('LIFELINE_METAEDITOR'),os.environ.get('LIFELINE_TERMINAL'))
    # One bounded iteration; a service supervisor handles future execution with jitter and a budget.
    result=worker.step()
    print(json.dumps(result))
    return 0
if __name__=='__main__':raise SystemExit(main())
