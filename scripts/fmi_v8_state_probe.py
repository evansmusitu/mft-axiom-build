import email,hashlib,json,os,urllib.error,urllib.parse,urllib.request,pathlib,uuid
API=os.environ['CF_API']; AID=os.environ['CLOUDFLARE_ACCOUNT_ID']; BASE=os.environ['PUBLIC_BASE'].rstrip('/')
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'User-Agent':'MUSITU-FMI-V8-StateProbe/1.0'}
def raw(url,method='GET',headers=None,body=None,timeout=45):
    q=urllib.request.Request(url,method=method,headers=headers or {},data=body)
    try:
        with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
def cfget(path):
    c,h,b=raw(API+path,headers=H)
    if c!=200: raise SystemExit(f'Cloudflare read failed {c}: {path}')
    return h,b
def src(name):
    h,b=cfget(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}'); ct=h.get('content-type','')
    if 'multipart/' not in ct.lower(): return b
    msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+b); parts=[]
    for p in msg.walk():
        if p.is_multipart(): continue
        d=p.get_payload(decode=True) or b''
        if any(k in d for k in (b'export default',b'addEventListener',b'fetch(')): parts.append(d)
    if len(parts)!=1: raise SystemExit(f'Executable module ambiguity for {name}: {len(parts)}')
    return parts[0]
def settings(name):
    _,b=cfget(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}/settings')
    r=json.loads(b or b'{}').get('result') or {}
    out=[]
    for x in r.get('bindings') or []:
        if not isinstance(x,dict): continue
        item={'name':x.get('name'),'type':x.get('type')}
        if x.get('type')=='d1': item['id']=x.get('id')
        if x.get('type')=='service': item['service']=x.get('service')
        out.append(item)
    return sorted(out,key=lambda x:(x.get('name') or ''))
def sub(name):
    _,b=cfget(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}/subdomain')
    return json.loads(b or b'{}').get('result') or {}
def public(path):
    c,h,b=raw(BASE+path,headers={'Accept':'application/json','User-Agent':'MUSITU-FMI-V8-StateProbe/1.0'},timeout=30)
    return c,{k.lower():v for k,v in h.items()},b
edge=src(os.environ['FMI_EDGE']); billing=src(os.environ['FMI_BILLING']); adapter=src(os.environ['FMI_ADAPTER'])
edge_sha=hashlib.sha256(edge).hexdigest(); billing_sha=hashlib.sha256(billing).hexdigest(); adapter_sha=hashlib.sha256(adapter).hexdigest()
hc,hh,hb=public('/healthz?probe='+uuid.uuid4().hex)
wc,wh,wb=public('/assets/workspace.js?probe='+uuid.uuid4().hex)
workspace_sha=hashlib.sha256(wb).hexdigest() if wc==200 else None
try: health=json.loads(hb or b'{}')
except: health=None
sql={'sql':"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('analysis_evidence_index','evidence_monitors','evidence_monitor_events','market_context_attestations') ORDER BY name"}
h=dict(H); h['Content-Type']='application/json'
dc,_,db=raw(f"{API}/accounts/{AID}/d1/database/{os.environ['FMI_DB_UUID']}/query",'POST',h,json.dumps(sql,separators=(',',':')).encode(),45)
try: d1=json.loads(db or b'{}')
except: d1=None
state={
 'schema':'musitu-fmi.v8-current-state-probe.v1','read_only':True,'mutation_performed':False,
 'edge_sha256':edge_sha,'billing_sha256':billing_sha,'adapter_sha256':adapter_sha,
 'edge_matches_pre_v8':edge_sha==os.environ['EXPECTED_PREV_EDGE_SHA'],
 'edge_matches_v8_source':edge_sha==os.environ['EXPECTED_V8_EDGE_SHA'],
 'edge_contains_v8_monitor_routes':all(s in edge.decode('utf-8','ignore') for s in ['/v1/evidence/monitors','/v1/evidence/monitor-events']),
 'workspace_http':wc,'workspace_sha256':workspace_sha,'workspace_matches_v8':workspace_sha==os.environ['EXPECTED_V8_WORKSPACE_SHA'],
 'health_http':hc,'health':health,
 'bindings':settings(os.environ['FMI_EDGE']),
 'edge_subdomain':sub(os.environ['FMI_EDGE']), 'billing_subdomain':sub(os.environ['FMI_BILLING']), 'adapter_subdomain':sub(os.environ['FMI_ADAPTER']),
 'd1_http':dc,'d1_result':d1,
 'secret_values_read_or_logged':False
}
pathlib.Path('fmi-v8-current-state-probe.json').write_text(json.dumps(state,indent=2,sort_keys=True)+'\n')
print(json.dumps({k:state[k] for k in ['edge_sha256','edge_matches_pre_v8','edge_matches_v8_source','edge_contains_v8_monitor_routes','workspace_sha256','workspace_matches_v8','health_http','d1_http']},sort_keys=True))
