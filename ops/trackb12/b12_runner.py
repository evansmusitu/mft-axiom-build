#!/usr/bin/env python3
"""B12 isolated S0: two real OpenHands SDK processes, synthetic model only.

This is an integration test of SDK/tool/workspace concurrency, NOT inference or
independent authorization-gateway qualification. Never receives provider keys.
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

BASE = Path('/tmp/axiom-b12')
PORT = 18769
TASKS = {
    'agent-a': {'uid': 65532, 'file': 'mathfix.py', 'seed': 'def multiply(a, b):\n    return a + b\n',
                'old': 'return a + b', 'new': 'return a * b'},
    'agent-b': {'uid': 65533, 'file': 'clampfix.py', 'seed': 'def clamp(value, low, high):\n    return value\n',
                'old': 'return value', 'new': 'return max(low, min(high, value))'},
}

class Broker(http.server.BaseHTTPRequestHandler):
    state = {} # reset by coordinator; only synthetic model responses
    gate = threading.Lock()
    first_barrier = threading.Condition()
    first_arrivals = set()
    def log_message(self, *args): pass
    def send_json(self, code, data):
        raw=json.dumps(data, separators=(',',':')).encode()
        self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if self.path == '/v1/models':
            return self.send_json(200, {'object':'list','data':[{'id':'b12-synthetic','object':'model','owned_by':'AXIOM-S0'}]})
        return self.send_json(404, {'error':{'message':'not_found'}})
    def do_POST(self):
        wid=self.headers.get('X-Axiom-Workload-ID','')
        auth=self.headers.get('Authorization','')
        if self.path!='/v1/chat/completions' or wid not in TASKS or auth!='Bearer '+self.state.get(wid,{}).get('token','none'):
            return self.send_json(403,{'error':{'message':'forbidden'}})
        n=self.headers.get('Content-Length','')
        if not n.isdecimal() or not 1<=int(n)<=60000:
            return self.send_json(403,{'error':{'message':'invalid_body_size'}})
        try:
            raw=self.rfile.read(int(n));request=json.loads(raw)
            assert type(request) is dict and request.get('model') in ('b12-synthetic','openai/b12-synthetic')
            assert request.get('stream',False) is False
            assert type(request.get('messages')) is list and len(raw)<=60000
            assert type(request.get('tools')) is list
            funcs={x['function']['name'] for x in request['tools']}
            assert {'file_editor','finish'}.issubset(funcs)
        except (ValueError,TypeError,KeyError,AssertionError):
            return self.send_json(403,{'error':{'message':'invalid_request'}})
        with self.gate:
            st=self.state[wid]
            if st['requests']>=3:
                return self.send_json(429,{'error':{'message':'synthetic_budget_exceeded'}})
            index=st['requests'];st['requests']+=1
            st['times'].append(time.monotonic())
        if index==0:
            with self.first_barrier:
                self.first_arrivals.add(wid)
                if len(self.first_arrivals)==2:self.first_barrier.notify_all()
                elif not self.first_barrier.wait_for(lambda:len(self.first_arrivals)==2,timeout=22):
                    return self.send_json(503,{'error':{'message':'parallel_start_barrier_failed'}})
        file=str(BASE / wid / TASKS[wid]['file'])
        if index==0:
            name='file_editor';args={'command':'view','path':file}
        elif index==1:
            name='file_editor';args={'command':'str_replace','path':file,'old_str':TASKS[wid]['old'],'new_str':TASKS[wid]['new']}
        else:
            name='finish';args={'message':'Synthetic tool execution complete, submit to grader.'}
        return self.send_json(200,{
            'id':f'chatcmpl-{wid}-{index}','object':'chat.completion','created':int(time.time()),
            'model':'b12-synthetic','choices':[{'index':0,'finish_reason':'tool_calls','message':{
                'role':'assistant','content':None,'tool_calls':[{'id':f'call-{wid}-{index}','type':'function',
                'function':{'name':name,'arguments':json.dumps(args)}}]}}],
            'usage':{'prompt_tokens':200,'completion_tokens':30,'total_tokens':230}
        })

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
    llm=LLM(model='openai/b12-synthetic',base_url=f'http://127.0.0.1:{PORT}/v1',api_key=token,
        extra_headers={'X-Axiom-Workload-ID':wid},temperature=0,stream=False,
        max_output_tokens=256,timeout=8,drop_params=True)
    agent=Agent(llm=llm,tools=[Tool(name=FileEditorTool.name)])
    c=Conversation(agent=agent,workspace=str(folder),max_iteration_per_run=5,
        visualizer=None,callbacks=[cb])
    exc='';state='ERROR'
    try:
        c.send_message('S0 orchestration test: read and fix '+TASKS[wid]['file']+' in workspace; finish when complete.')
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
    print('B12_WORKER_RECEIPT='+json.dumps(receipt,sort_keys=True),flush=True)
    return 0 if (state=='RETURNED' and receipt['source_changed'] and receipt['native_finish']>0) else 1

def main():
    if os.geteuid()!=0:
        raise SystemExit('TRUSTED_S0_COORDINATOR_REQUIRES_ROOT')
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
    # Fake model must reject unauthorized workload / bearer before running any agent.
    probe={'model':'b12-synthetic','messages':[{'role':'user','content':'probe'}], 'tools':[]}
    try:
        request=Request(f'http://127.0.0.1:{PORT}/v1/chat/completions',json.dumps(probe).encode(),{'Authorization':'Bearer bad','X-Axiom-Workload-ID':'agent-a'},method='POST')
        urlopen(request,timeout=2)
        raise AssertionError('NEGATIVE_AUTHENTICATION_BYPASS')
    except HTTPError as e:assert e.code==403
    print('B12_UNAUTHORIZED_LOOPBACK_DENIED_PASS',flush=True)
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
            if line.startswith('B12_WORKER_RECEIPT='):rows[wid]=json.loads(line.split('=',1)[1])
    print('B12_MODEL_REQUEST_COUNTS='+json.dumps({k:v['requests'] for k,v in Broker.state.items()},sort_keys=True),flush=True)
    time_bounds={k:(min(v['times']),max(v['times'])) for k,v in Broker.state.items() if v['times']}
    overlap=len(time_bounds)==2 and max(t[0] for t in time_bounds.values())<min(t[1] for t in time_bounds.values())
    print('B12_MODEL_EXECUTION_WINDOWS_OVERLAP='+str(overlap),flush=True)
    print('B12_PARALLEL_FIRST_REQUEST_BARRIER='+str(len(Broker.first_arrivals)==2),flush=True)
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
                'print("B12_CREDENTIALLESS_GRADER="+str(good));'
                'sys.exit(0 if good else 2)')
        graded=subprocess.run(['setpriv',f'--reuid={t["uid"]}',f'--regid={t["uid"]}',
            '--clear-groups',sys.executable,'-I','-S','-c',grader,
            str(BASE/wid/t['file']),wid],capture_output=True,text=True,timeout=7,
            env={'HOME':str(BASE/wid),'PATH':'/usr/bin:/bin'})
        good=graded.returncode==0 and 'B12_CREDENTIALLESS_GRADER=True' in graded.stdout
        print('B12_ISOLATED_AGENT_BEHAVIOR',wid,good,flush=True)
        ok=ok and good
    server.shutdown();server.server_close()
    # Stricter than mere simultaneous process lifetimes: overlap in model request windows.
    # This signal is recorded separately and doesn't falsify result if actions interleave.
    if not ok or len(rows)!=2 or len(Broker.first_arrivals)!=2:raise SystemExit('B12_S0_MULTIPROCESS_AGENT_INTEGRATION_FAILED')
    print('MUSITU_AXIOM_B12_TWO_NATIVE_SDK_AGENT_PROCESSES_SYNTHETIC_MODEL_PASS',flush=True)

if __name__=='__main__':
    cli=argparse.ArgumentParser();cli.add_argument('--worker',choices=list(TASKS));args=cli.parse_args()
    if args.worker:sys.exit(worker(args.worker))
    main()