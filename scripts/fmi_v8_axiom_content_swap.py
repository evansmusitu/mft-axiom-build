import email,hashlib,json,os,secrets,sys,time,urllib.error,urllib.parse,urllib.request,pathlib

API=os.environ['CF_API']; AID=os.environ['CLOUDFLARE_ACCOUNT_ID']; EDGE=os.environ['FMI_EDGE']
EXPECTED_CURRENT=os.environ['EXPECTED_CURRENT_EDGE_SHA']; EXPECTED_V8=os.environ['EXPECTED_V8_EDGE_SHA']
EXPECTED_BILLING=os.environ['EXPECTED_BILLING_SHA']; EXPECTED_ADAPTER=os.environ['EXPECTED_ADAPTER_SHA']
BILLING=os.environ['FMI_BILLING']; ADAPTER=os.environ['FMI_ADAPTER']; DBID=os.environ['FMI_DB_UUID']
CANDIDATE=pathlib.Path(os.environ.get('V8_SOURCE_PATH','/tmp/fmi-v8-runtime/edge/fmi-global/worker.js'))
SNAP=pathlib.Path('/tmp/fmi-v8-content-swap-original.mjs'); SNAP_META=pathlib.Path('/tmp/fmi-v8-content-swap-original.json')
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-V8-Axiom-Content-Swap/1.1'}

def http(url,method='GET',headers=None,body=None,timeout=60):
    q=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()

def worker_source(name):
    c,hh,raw=http(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}',headers=H)
    if c!=200:raise RuntimeError(f'Worker source read HTTP {c}: {name}')
    ct=hh.get('content-type',''); src=raw
    if 'multipart/' in ct.lower():
        msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw); parts=[]
        for p in msg.walk():
            if p.is_multipart():continue
            d=p.get_payload(decode=True) or b''
            if any(k in d for k in (b'export default',b'addEventListener',b'fetch(')):parts.append(d)
        if len(parts)!=1:raise RuntimeError(f'Executable module count {len(parts)} for {name}')
        src=parts[0]
    return src

def settings(name):
    c,_,b=http(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}/settings',headers=H)
    if c!=200:raise RuntimeError(f'Settings read HTTP {c}: {name}')
    x=json.loads(b or b'{}'); r=x.get('result') or {}; out=[]
    for v in r.get('bindings') or []:
        if not isinstance(v,dict):continue
        z={'name':v.get('name'),'type':v.get('type')}
        if v.get('type')=='d1':z['id']=v.get('id')
        if v.get('type')=='service':z['service']=v.get('service')
        out.append(z)
    return sorted(out,key=lambda z:z.get('name') or '')

def subdomain(name):
    c,_,b=http(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}/subdomain',headers=H)
    if c!=200:raise RuntimeError(f'Subdomain read HTTP {c}: {name}')
    return json.loads(b or b'{}').get('result') or {}

def set_edge_exposure():
    h=dict(H);h['Content-Type']='application/json';body=b'{"enabled":true,"previews_enabled":false}'
    c,_,b=http(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(EDGE,safe="")}/subdomain','POST',h,body)
    if not 200<=c<300:raise RuntimeError(f'Edge subdomain policy HTTP {c}: '+b[:300].decode('utf-8','ignore'))
    s=subdomain(EDGE)
    if s.get('enabled') is not True or s.get('previews_enabled') is not False:raise RuntimeError('Fail-closed edge subdomain policy mismatch')

def d1_table_guard():
    req={'sql':"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('analysis_evidence_index','evidence_monitors','evidence_monitor_events','market_context_attestations') ORDER BY name"}
    h=dict(H);h['Content-Type']='application/json'
    c,_,b=http(f'{API}/accounts/{AID}/d1/database/{DBID}/query','POST',h,json.dumps(req,separators=(',',':')).encode())
    if c!=200:raise RuntimeError(f'D1 table guard HTTP {c}')
    x=json.loads(b or b'{}'); names=[]
    for rr in x.get('result') or []:
        if rr.get('success') is not True:raise RuntimeError('D1 table guard success=false')
        names.extend(str(row.get('name')) for row in (rr.get('results') or []) if row.get('name'))
    required={'analysis_evidence_index','evidence_monitors','evidence_monitor_events','market_context_attestations'}
    if set(names)!=required:raise RuntimeError('Fail-closed V8 D1 table set mismatch: '+repr(sorted(names)))
    return sorted(names)

def multipart(src):
    bd='----MUSITUFMI'+secrets.token_hex(16); p=[]
    def add(x):p.append(x.encode() if isinstance(x,str) else x)
    add(f'--{bd}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add('{"main_module":"index.mjs"}\r\n')
    add(f'--{bd}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n')
    add(src); add('\r\n'); add(f'--{bd}--\r\n')
    return bd,b''.join(p)

def upload_content(src):
    bd,body=multipart(src); h=dict(H); h['Content-Type']='multipart/form-data; boundary='+bd
    c,_,b=http(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(EDGE,safe="")}/content','PUT',h,body,90)
    if not 200<=c<300:raise RuntimeError(f'Worker content upload HTTP {c}: '+b[:300].decode('utf-8','ignore'))

def sha(b):return hashlib.sha256(b).hexdigest()

def guard_and_snapshot():
    edge=worker_source(EDGE); edge_sha=sha(edge)
    if edge_sha!=EXPECTED_CURRENT:raise RuntimeError(f'Fail-closed current edge drift: {edge_sha}')
    billing=worker_source(BILLING); adapter=worker_source(ADAPTER)
    if sha(billing)!=EXPECTED_BILLING:raise RuntimeError('Fail-closed billing Worker drift')
    if sha(adapter)!=EXPECTED_ADAPTER:raise RuntimeError('Fail-closed adapter Worker drift')
    bs=settings(EDGE); by={x['name']:x for x in bs if x.get('name')}
    if set(by)!={'FMI_DB','FMI_BILLING','FMI_KERNEL'}:raise RuntimeError('Fail-closed binding-name drift: '+repr(sorted(by)))
    if by['FMI_DB'].get('type')!='d1' or by['FMI_DB'].get('id')!=DBID:raise RuntimeError('Fail-closed FMI_DB binding drift')
    if by['FMI_BILLING'].get('type')!='service' or by['FMI_BILLING'].get('service')!=BILLING:raise RuntimeError('Fail-closed FMI_BILLING binding drift')
    if by['FMI_KERNEL'].get('type')!='service' or by['FMI_KERNEL'].get('service')!=ADAPTER:raise RuntimeError('Fail-closed FMI_KERNEL binding drift')
    if subdomain(BILLING).get('enabled') is not False:raise RuntimeError('Fail-closed billing Worker public exposure drift')
    if subdomain(ADAPTER).get('enabled') is not False:raise RuntimeError('Fail-closed adapter Worker public exposure drift')
    tables=d1_table_guard()
    SNAP.write_bytes(edge)
    SNAP_META.write_text(json.dumps({'sha256':edge_sha,'size':len(edge),'bindings':bs,'tables':tables},sort_keys=True)+'\n')
    return edge_sha,bs,tables

def rollback():
    if not SNAP.is_file() or not SNAP_META.is_file():raise RuntimeError('Rollback snapshot missing')
    src=SNAP.read_bytes(); meta=json.loads(SNAP_META.read_text()); expected=meta['sha256']
    if sha(src)!=expected:raise RuntimeError('Rollback snapshot integrity mismatch')
    upload_content(src); set_edge_exposure(); time.sleep(1)
    got=sha(worker_source(EDGE))
    if got!=expected:raise RuntimeError(f'Rollback exact readback mismatch: {got} != {expected}')
    after=settings(EDGE)
    if after!=meta['bindings']:raise RuntimeError('Rollback binding readback mismatch')
    print(json.dumps({'gate':'ROLLBACK_PASS','edge_sha256':got,'content_only':True,'previews_enabled':False,'bindings_unchanged':True},sort_keys=True))

def promote():
    if not CANDIDATE.is_file():raise RuntimeError('V8 candidate source missing')
    candidate=CANDIDATE.read_bytes(); cand_sha=sha(candidate)
    if cand_sha!=EXPECTED_V8:raise RuntimeError(f'Fail-closed V8 candidate SHA mismatch: {cand_sha}')
    if b'PAPER_SHADOW_ONLY' not in candidate:raise RuntimeError('Fail-closed PAPER_SHADOW_ONLY authority marker absent')
    original_sha,bindings,tables=guard_and_snapshot(); changed=False
    try:
        upload_content(candidate); changed=True; set_edge_exposure(); time.sleep(1)
        got=sha(worker_source(EDGE))
        if got!=EXPECTED_V8:raise RuntimeError(f'Exact V8 readback mismatch: {got}')
        after=settings(EDGE)
        if after!=bindings:raise RuntimeError('Content-only upload changed Worker bindings')
        ev={'schema':'musitu-fmi.v8-axiom-content-swap.v1','gate':'CONTENT_SWAP_PASS','mechanism':'CLOUDFLARE_WORKER_CONTENT_PUT','original_edge_sha256':original_sha,'deployed_edge_sha256':got,'billing_worker_sha256':EXPECTED_BILLING,'adapter_worker_sha256':EXPECTED_ADAPTER,'bindings_unchanged':True,'d1_tables':tables,'market_data_bound':False,'edge_workers_dev':True,'edge_previews_enabled':False,'private_workers_public':False,'wrangler_used_for_worker_content':False,'secret_values_read_or_logged':False}
        pathlib.Path('fmi-v8-content-swap-evidence.json').write_text(json.dumps(ev,indent=2,sort_keys=True)+'\n')
        print(json.dumps(ev,sort_keys=True))
    except Exception:
        if changed:
            try:rollback()
            except Exception as re:print('ROLLBACK_FAILURE '+repr(re),file=sys.stderr)
        raise

if __name__=='__main__':
    mode=sys.argv[1] if len(sys.argv)>1 else 'promote'
    try:
        if mode=='promote':promote()
        elif mode=='rollback':rollback()
        else:raise RuntimeError('mode must be promote or rollback')
    except Exception as e:
        print('FAIL '+type(e).__name__+' '+str(e),file=sys.stderr);sys.exit(1)
