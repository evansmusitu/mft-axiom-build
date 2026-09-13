import email,hashlib,json,os,urllib.error,urllib.parse,urllib.request,pathlib
API=os.environ['CF_API']; AID=os.environ['CLOUDFLARE_ACCOUNT_ID']
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'User-Agent':'MUSITU-FMI-V8-AxiomPattern/1.0'}
def raw(path,method='GET',obj=None):
    h=dict(H); body=None
    if obj is not None:
        h['Content-Type']='application/json'; body=json.dumps(obj,separators=(',',':')).encode()
    q=urllib.request.Request(API+path,headers=h,method=method,data=body)
    try:
        with urllib.request.urlopen(q,timeout=45) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
def get(path):
    code,h,b=raw(path)
    if code!=200: raise SystemExit(f'Fail-closed Cloudflare readback HTTP {code}: {path}')
    return h,b
def src(name):
    h,b=get(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}')
    ct=h.get('content-type','')
    if 'multipart/' not in ct.lower(): return b
    msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+b)
    parts=[]
    for p in msg.walk():
        if p.is_multipart(): continue
        d=p.get_payload(decode=True) or b''
        if any(k in d for k in (b'export default',b'addEventListener',b'fetch(')): parts.append(d)
    if len(parts)!=1: raise SystemExit(f'Fail-closed executable module count for {name}: {len(parts)}')
    return parts[0]
def settings(name):
    _,b=get(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}/settings')
    x=json.loads(b or b'{}')
    return x.get('result') or {}
def sub(name):
    _,b=get(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}/subdomain')
    return json.loads(b or b'{}').get('result') or {}
edge=os.environ['FMI_EDGE']; billing=os.environ['FMI_BILLING']; adapter=os.environ['FMI_ADAPTER']
old=src(edge); bill=src(billing)
old_sha=hashlib.sha256(old).hexdigest(); bill_sha=hashlib.sha256(bill).hexdigest()
if old_sha!=os.environ['EXPECTED_CURRENT_EDGE_SHA']:
    raise SystemExit(f'Fail-closed production edge drift: {old_sha}')
if bill_sha!=os.environ['EXPECTED_BILLING_SHA']:
    raise SystemExit(f'Fail-closed billing Worker drift: {bill_sha}')
s=settings(edge); bindings=s.get('bindings') or []
by={b.get('name'):b for b in bindings if isinstance(b,dict) and b.get('name')}
required={'FMI_DB','FMI_KERNEL','FMI_BILLING'}; optional={'FMI_MARKET_DATA'}
missing=sorted(required-set(by)); unexpected=sorted(set(by)-required-optional)
if missing: raise SystemExit('Fail-closed missing production bindings: '+repr(missing))
if unexpected: raise SystemExit('Fail-closed unexpected production bindings; refusing destructive redeploy: '+repr(unexpected))
if by['FMI_DB'].get('type')!='d1' or by['FMI_DB'].get('id')!=os.environ['FMI_DB_UUID']:
    raise SystemExit('Fail-closed FMI_DB binding mismatch')
if by['FMI_KERNEL'].get('type')!='service' or by['FMI_KERNEL'].get('service')!=adapter:
    raise SystemExit('Fail-closed FMI_KERNEL binding mismatch')
if by['FMI_BILLING'].get('type')!='service' or by['FMI_BILLING'].get('service')!=billing:
    raise SystemExit('Fail-closed FMI_BILLING binding mismatch')
if 'FMI_MARKET_DATA' in by and by['FMI_MARKET_DATA'].get('type')!='service':
    raise SystemExit('Fail-closed FMI_MARKET_DATA has unsupported binding type')
if sub(billing).get('enabled') is not False or sub(adapter).get('enabled') is not False:
    raise SystemExit('Fail-closed private Worker exposure drift')
if sub(edge).get('enabled') is not True:
    raise SystemExit('Fail-closed public edge subdomain disabled')
safe=[]
for name in sorted(by):
    b=by[name]
    if b.get('type')=='d1': safe.append({'type':'d1','name':name,'id':b.get('id')})
    elif b.get('type')=='service': safe.append({'type':'service','name':name,'service':b.get('service')})
    else: raise SystemExit('Fail-closed unsupported binding shape: '+name)
pathlib.Path('/tmp/previous-edge.mjs').write_bytes(old)
pathlib.Path('/tmp/frozen-edge-bindings.json').write_text(json.dumps(safe,sort_keys=True))
state={'schema':'musitu-fmi.v8-predeploy-readback.v1','gate':'PASS','edge_sha256':old_sha,'billing_sha256':bill_sha,'binding_names':sorted(by),'market_data_bound':'FMI_MARKET_DATA' in by,'billing_worker_private':True,'adapter_worker_private':True,'mutation_performed':False,'secret_values_read_or_logged':False}
pathlib.Path('fmi-v8-predeploy-readback.json').write_text(json.dumps(state,indent=2,sort_keys=True)+'\n')
print(json.dumps(state,sort_keys=True))
