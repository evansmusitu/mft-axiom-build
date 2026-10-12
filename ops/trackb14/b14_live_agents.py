#!/usr/bin/env python3
"""B14 isolated S2: two real OpenHands workers via live Cloudflare Free-native model.
Separate ephemeral Ed25519 CI-job signer, in-memory two-worker admission (NOT global),
no production, no public routes, provider secret only in the broker.
"""
import argparse
import hashlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import datetime as dt
import urllib.request
import urllib.error
import math

BASE = Path('/tmp/axiom-b14')
PORT = 18770
TASKS = {
    'agent-a': {'uid': 65532, 'file': 'mathfix.py', 'seed': 'def multiply(a, b):\n    return a + b\n',
                'old': 'return a + b', 'new': 'return a * b'},
    'agent-b': {'uid': 65533, 'file': 'clampfix.py', 'seed': 'def clamp(value, low, high):\n    return value\n',
                'old': 'return value', 'new': 'return max(low, min(high, value))'},
}

ACCOUNT='93f395f5121954671f92fffa453d6b61'
MODEL='@cf/zai-org/glm-4.7-flash'

class Forbidden(Exception): pass

def authorize_claim(g, *, when=None, day=None):
    when=when if when is not None else time.time()
    day=day or dt.datetime.fromtimestamp(when,dt.timezone.utc).strftime('%Y-%m-%d')
    mandatory={'schema':'axiom.trackb14.single-run.s2.v1','account_id':ACCOUNT,
        'model':MODEL,'max_calls_per_worker':8,'max_total_calls':16,
        'max_output_tokens':384,'no_production':True,'no_paid_plan_evidence':True,
        'workloads':['agent-a','agent-b']}
    if not isinstance(g,dict) or any(g.get(k)!=v or type(g.get(k))!=type(v) for k,v in mandatory.items()):
        raise Forbidden('SIGNED_GRANT_SCOPE_DENIED')
    if g.get('utc_day')!=day or type(g.get('expires_at')) is not int or not when<g['expires_at']:
        raise Forbidden('SIGNED_GRANT_EXPIRED_OR_WRONG_UTC_DAY')
    return True

class Ledger:
    def __init__(self):
        self.lock=threading.Lock();self.calls={k:0 for k in TASKS};self.global_count=0
    def admit(self, wid, g):
        if wid not in TASKS:raise Forbidden('UNAPPROVED_WORKLOAD')
        with self.lock:
            if self.calls[wid]>=g['max_calls_per_worker'] or self.global_count>=g['max_total_calls']:
                raise Forbidden('SIGNED_MODEL_BUDGET_EXHAUSTED')
            self.calls[wid]+=1;self.global_count+=1
            return self.calls[wid]

def verify_signed_grant(directory):
    directory=Path(directory)
    pub,sig,grant=(directory/x for x in ('public.pem','sig.bin','grant.json'))
    x=subprocess.run(['openssl','pkeyutl','-verify','-pubin','-inkey',str(pub),
        '-rawin','-in',str(grant),'-sigfile',str(sig)],stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,timeout=4)
    if x.returncode:raise Forbidden('INDEPENDENT_ED25519_SIGNATURE_INVALID')
    g=json.loads(grant.read_text())
    authorize_claim(g)
    return g

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k):raise Forbidden('PROVIDER_REDIRECT_DENIED')

class Broker(http.server.BaseHTTPRequestHandler):
    state = {}
    grant = None
    budget = Ledger()
    first_barrier = threading.Condition()
    first_arrivals = set()
    def log_message(self, *args): pass
    def send_json(self, code, data):
        raw=json.dumps(data,separators=(',',':')).encode()
        self.send_response(code);self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if self.path=='/v1/models':
            return self.send_json(200,{'object':'list','data':[{'id':MODEL,'object':'model','owned_by':'axiom-isolated'}]})
        return self.send_json(404,{'error':{'message':'not_found'}})
    def do_POST(self):
        wid=self.headers.get('X-Axiom-Workload-ID','')
        token=self.state.get(wid,{}).get('token','unreachable')
        if self.path!='/v1/chat/completions' or wid not in TASKS or self.headers.get('Authorization')!='Bearer '+token:
            return self.send_json(403,{'error':{'message':'forbidden'}})
        try:
            # Reverify origin-signed exact workload grant on every external request.
            if not verify_signed_grant(os.environ['AXIOM_SIGNED_GRANT_DIR']):raise Forbidden('INVALID_GRANT')
            n=self.headers.get('Content-Length','')
            if not n.isdecimal() or not 1<=int(n)<=65000:raise Forbidden('REQUEST_SIZE_DENIED')
            body=self.rfile.read(int(n));request=json.loads(body)
            if type(request) is not dict or request.get('model') not in (MODEL,'openai/'+MODEL) or request.get('stream',False) is not False:
                raise Forbidden('MODEL_SCOPE_DENIED')
            limit=request.get('max_completion_tokens',request.get('max_tokens',384))
            if type(limit) is not int or not 1<=limit<=384:raise Forbidden('OUTPUT_LIMIT_DENIED')
            messages=request.get('messages')
            if type(messages) is not list or not 1<=len(messages)<=75:raise Forbidden('MESSAGES_DENIED')
            if any(type(m) is not dict or m.get('role') not in ('system','user','assistant','tool') for m in messages):
                raise Forbidden('MESSAGE_ROLE_DENIED')
            raw=json.dumps(messages,separators=(',',':'))
            if len(raw)>50000 or 'CLOUDFLARE_API_TOKEN' in raw or 'ghp_' in raw or 'sk-proj-' in raw:
                raise Forbidden('SECRET_OR_PROMPT_SIZE_DENIED')
            tools=request.get('tools',[])
            if type(tools) is not list or not 1<=len(tools)<=3 or any((t.get('function') or {}).get('name') not in ('file_editor','finish','think') for t in tools):
                raise Forbidden('TOOL_SCOPE_DENIED')
        except (Forbidden,ValueError,KeyError,TypeError,UnicodeError,OSError):
            print('B14_REQUEST_FAIL_CLOSED',wid,flush=True)
            return self.send_json(403,{'error':{'message':'synthetic_scope_denied'}})
        # Both distinct workload identities must reach the broker concurrently before forwarding.
        with self.first_barrier:
            if wid not in self.first_arrivals:
                self.first_arrivals.add(wid)
                if len(self.first_arrivals)==2:self.first_barrier.notify_all()
                elif not self.first_barrier.wait_for(lambda:len(self.first_arrivals)==2,timeout=25):
                    return self.send_json(503,{'error':{'message':'parallel_start_barrier_failed'}})
        try:num=self.budget.admit(wid,self.grant)
        except Forbidden:return self.send_json(429,{'error':{'message':'quota_exhausted'}})
        self.state[wid]['times'].append(time.monotonic())
        payload={'model':MODEL,'messages':messages,'tools':tools,'tool_choice':'auto',
                 'max_completion_tokens':limit,'temperature':0,'stream':False}
        req=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/ai/run/'+MODEL,
                 data=json.dumps(payload,separators=(',',':')).encode(),method='POST',
                 headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],
                          'Content-Type':'application/json','Accept':'application/json'})
        try:
            with urllib.request.build_opener(NoRedirect).open(req,timeout=35) as rsp:
                raw=rsp.read(131073)
                if rsp.status!=200 or len(raw)>131072:raise Forbidden('PROVIDER_RESPONSE_DENIED')
            result=json.loads(raw)
            if type(result) is dict and type(result.get('result')) is dict:result=result['result']
            if type(result) is not dict or type(result.get('choices')) is not list or not result['choices']:
                raise Forbidden('PROVIDER_CHAT_RESPONSE_INVALID')
            result.setdefault('id','chatcmpl-axiom-b14');result.setdefault('object','chat.completion')
            result.setdefault('created',int(time.time()));result.setdefault('model',MODEL)
            result.setdefault('usage',{'prompt_tokens':0,'completion_tokens':0,'total_tokens':0})
            print('B14_PROVIDER_LIVE_CALL_SUCCESS',wid,num,flush=True)
            return self.send_json(200,result)
        except urllib.error.HTTPError as err:
            print('B14_PROVIDER_LIVE_HTTP_STATUS',wid,err.code,flush=True)
        except Exception as err:
            print('B14_PROVIDER_LIVE_REQUEST_FAILED',wid,type(err).__name__,flush=True)
        return self.send_json(502,{'error':{'message':'provider_failed'}})

def worker(wid):
    os.environ.update({'DO_NOT_TRACK':'1','OPENHANDS_DISABLE_TELEMETRY':'true',
        'OPENHANDS_SUPPRESS_BANNER':'1','OTEL_SDK_DISABLED':'true','LITELLM_TELEMETRY':'false'})
    if any(x in os.environ for x in ('CLOUDFLARE_API_TOKEN','GH_TOKEN','GITHUB_TOKEN','AXIOM_SIGNER_PRIVATE_KEY')):
        raise SystemExit('WORKER_SECRET_ENV_NOT_EMPTY')
    from openhands.sdk import Agent, LLM, Conversation, Tool
    from openhands.tools.file_editor import FileEditorTool
    folder=BASE/wid
    token=(folder/'broker_token').read_text().strip()
    events=[]
    def cb(e):
        try:
            d=e.model_dump(mode='json')
            x={k:d.get(k) for k in ('kind','id','tool_call_id','tool_name','action_id')}
            events.append(x)
            with (folder/'native_events.jsonl').open('a') as f:f.write(json.dumps(x,sort_keys=True)+'\n')
        except Exception:pass
    llm=LLM(model='openai/'+MODEL,base_url=f'http://127.0.0.1:{PORT}/v1',api_key=token,
        extra_headers={'X-Axiom-Workload-ID':wid},temperature=0,stream=False,
        max_output_tokens=384,timeout=26,drop_params=True)
    agent=Agent(llm=llm,tools=[Tool(name=FileEditorTool.name)])
    c=Conversation(agent=agent,workspace=str(folder),max_iteration_per_run=10,
        visualizer=None,callbacks=[cb])
    exc='';state='ERROR'
    try:
        c.send_message('Synthetic S2 live Cloudflare engineering test: read and correct '+TASKS[wid]['file']+' in workspace; finish when complete.')
        c.run();state='RETURNED'
    except Exception as e:exc=type(e).__name__+': '+str(e)[:250]
    finally:
        try:c.close()
        except Exception:pass
    src=(folder/TASKS[wid]['file']).read_bytes()
    receipt={'worker':wid,'uid':os.geteuid(),'state':state,'error':exc,
        'source_sha256':hashlib.sha256(src).hexdigest(),
        'source_changed':src!=TASKS[wid]['seed'].encode(),
        'native_actions':sum(x.get('kind')=='ActionEvent' for x in events),
        'native_observations':sum(x.get('kind')=='ObservationEvent' for x in events),
        'native_finish':sum(x.get('kind')=='ActionEvent' and x.get('tool_name')=='finish' for x in events)}
    print('B14_WORKER_RECEIPT='+json.dumps(receipt,sort_keys=True),flush=True)
    return 0 if (state=='RETURNED' and receipt['source_changed'] and receipt['native_finish']>0) else 1

def main():
    if os.geteuid()!=0:
        raise SystemExit('TRUSTED_S0_COORDINATOR_REQUIRES_ROOT')
    if not os.environ.get('CLOUDFLARE_API_TOKEN'):
        raise SystemExit('B14_NO_PROTECTED_PROVIDER_TOKEN')
    Broker.grant=verify_signed_grant(os.environ['AXIOM_SIGNED_GRANT_DIR'])
    BASE.mkdir(mode=0o755,parents=True,exist_ok=True)
    for wid,t in TASKS.items():
        path=BASE/wid
        path.mkdir(mode=0o700,exist_ok=False)
        (path/t['file']).write_text(t['seed'])
        (path/'broker_token').write_text(secrets.token_urlsafe(32))
        for f in path.iterdir():f.chmod(0o600)
        os.chown(path,t['uid'],t['uid'])
        for f in path.iterdir():os.chown(f,t['uid'],t['uid'])
        Broker.state[wid]={'token':(path/'broker_token').read_text(),'requests':0,'times':[]}
    server=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),Broker)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    # Provider broker must reject unauthorized workload / bearer before running any agent.
    probe={'model':MODEL,'messages':[{'role':'user','content':'probe'}], 'tools':[]}
    try:
        request=Request(f'http://127.0.0.1:{PORT}/v1/chat/completions',json.dumps(probe).encode(),{'Authorization':'Bearer bad','X-Axiom-Workload-ID':'agent-a'},method='POST')
        urlopen(request,timeout=2)
        raise AssertionError('NEGATIVE_AUTHENTICATION_BYPASS')
    except HTTPError as e:assert e.code==403
    print('B14_UNAUTHORIZED_LOOPBACK_DENIED_PASS',flush=True)
    children={}
    for wid in TASKS:
        uid=TASKS[wid]['uid']
        cmd=['setpriv',f'--reuid={uid}',f'--regid={uid}','--clear-groups',sys.executable,__file__,'--worker',wid]
        children[wid]=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,
            env={'HOME':str(BASE/wid),'PATH':'/usr/bin:/bin','PYTHONUNBUFFERED':'1',
                'OPENHANDS_DISABLE_TELEMETRY':'true','OTEL_SDK_DISABLED':'true'},cwd=str(BASE/wid))
    rows={}
    for wid,p in children.items():
        try:out,err=p.communicate(timeout=90)
        except subprocess.TimeoutExpired:
            p.kill();out,err=p.communicate(timeout=4)
        print('WORKER_RESULT',wid,'exit',p.returncode,flush=True)
        print(out[-1500:],flush=True)
        if p.returncode!=0:print('WORKER_STDERR_TAIL',wid,err[-800:],flush=True)
        for line in out.splitlines():
            if line.startswith('B14_WORKER_RECEIPT='):rows[wid]=json.loads(line.split('=',1)[1])
    print('B14_MODEL_REQUEST_COUNTS='+json.dumps(Broker.budget.calls,sort_keys=True),flush=True)
    time_bounds={k:(v['times'][0],v['times'][-1]) for k,v in Broker.state.items() if v['times']}
    overlap=len(time_bounds)==2 and max(t[0] for t in time_bounds.values())<min(t[1] for t in time_bounds.values())
    print('B14_MODEL_EXECUTION_WINDOWS_OVERLAP='+str(overlap),flush=True)
    print('B14_PARALLEL_FIRST_REQUEST_BARRIER='+str(len(Broker.first_arrivals)==2),flush=True)
    # Independent post-run behavior verifier is invoked under no model credentials.
    ok=True
    for wid,t in TASKS.items():
        if wid not in rows or rows[wid]['uid']!=t['uid'] or rows[wid]['native_actions']<3 or rows[wid]['native_observations']<3 or rows[wid]['native_finish']<1:
            ok=False;continue
        # Explicit denial of cross-workspace access under distinct UIDs.
        other='agent-b' if wid=='agent-a' else 'agent-a'
        deny=subprocess.run(['setpriv',f'--reuid={t["uid"]}',f'--regid={t["uid"]}','--clear-groups','cat',str(BASE/other/TASKS[other]['file'])],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        if deny.returncode==0:ok=False
        # Execute agent-authored code only under its own unprivileged UID;
        # the privileged runner never imports or evaluates untrusted source.
        grader=('import importlib.util,sys;'
                'p=sys.argv[1];name=sys.argv[2];'
                's=importlib.util.spec_from_file_location("case",p);'
                'm=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
                'tests=([(-7,9),(0,80),(100,90)] if name=="agent-a" '
                'else [(-7,0,10),(30,1,20),(10,0,20)]);'
                'good=(all(m.multiply(a,b)==a*b for a,b in tests) if name=="agent-a" '
                'else all(m.clamp(x,lo,hi)==max(lo,min(hi,x)) for x,lo,hi in tests));'
                'print("B14_CREDENTIALLESS_GRADER="+str(good));'
                'sys.exit(0 if good else 2)')
        graded=subprocess.run(['setpriv',f'--reuid={t["uid"]}',f'--regid={t["uid"]}',
            '--clear-groups',sys.executable,'-I','-S','-c',grader,
            str(BASE/wid/t['file']),wid],capture_output=True,text=True,timeout=7,
            env={'HOME':str(BASE/wid),'PATH':'/usr/bin:/bin'})
        good=graded.returncode==0 and 'B14_CREDENTIALLESS_GRADER=True' in graded.stdout
        print('B14_ISOLATED_AGENT_BEHAVIOR',wid,good,flush=True)
        ok=ok and good
    server.shutdown();server.server_close()
    # Stricter than mere simultaneous process lifetimes: overlap in model request windows.
    # This signal is recorded separately and doesn't falsify result if actions interleave.
    if not ok or len(rows)!=2 or len(Broker.first_arrivals)!=2 or not all(Broker.budget.calls[w]>0 for w in TASKS):raise SystemExit('B14_S0_MULTIPROCESS_AGENT_INTEGRATION_FAILED')
    print('MUSITU_AXIOM_B14_TWO_NATIVE_SDK_LIVE_CLOUDFLARE_WORKERS_PASS',flush=True)

if __name__=='__main__':
    cli=argparse.ArgumentParser();cli.add_argument('--worker',choices=list(TASKS));args=cli.parse_args()
    if args.worker:sys.exit(worker(args.worker))
    main()