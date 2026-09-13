import email, hashlib, json, os, re, urllib.error, urllib.parse, urllib.request
API=os.environ['CF_API'].rstrip('/'); AID=os.environ['ACCOUNT_ID']; WORKER='mft-fmi-global-edge'
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Edge-Billing-Route-Probe/1.0'}
def get(path):
    q=urllib.request.Request(API+path,headers=H)
    try:
        with urllib.request.urlopen(q,timeout=45) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
code,h,raw=get(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}')
if code!=200:raise RuntimeError(f'edge source HTTP {code}')
ct=h.get('content-type','');src=raw
if 'multipart/' in ct.lower():
    m=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw);parts=[]
    for p in m.walk():
        if p.is_multipart():continue
        d=p.get_payload(decode=True) or b''
        if any(k in d for k in (b'export default',b'addEventListener',b'fetch(')):parts.append(d)
    if len(parts)!=1:raise RuntimeError(f'executable module count={len(parts)}')
    src=parts[0]
t=src.decode('utf-8','ignore')
# Only extract route-like string literals containing billing; no credentials/data.
routes=sorted(set(re.findall(r'["\']([^"\']*billing[^"\']*)["\']',t,re.I)))
# Extract compact redacted windows around route literals.
windows=[]
for route in routes:
    start=0
    while True:
        i=t.find(route,start)
        if i<0:break
        w=t[max(0,i-350):min(len(t),i+len(route)+500)]
        w=re.sub(r'(["\'])[A-Za-z0-9_\-]{32,}\1',r'\1<REDACTED_LONG_LITERAL>\1',w)
        windows.append(w);start=i+len(route)
out={'schema':'musitu.fmi.edge-billing-route.v1','edge_source_sha256':hashlib.sha256(src).hexdigest(),'billing_route_literals':routes,'windows':windows,'mutation_performed':False,'secret_values_read_or_logged':False}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();open('fmi-edge-billing-route.json','wb').write(blob)
dg=hashlib.sha256(blob).hexdigest();open('fmi-edge-billing-route.sha256','w').write(dg+'  fmi-edge-billing-route.json\n')
print(json.dumps({'gate':'FMI_EDGE_BILLING_ROUTE_READONLY_PASS','edge_source_sha256':out['edge_source_sha256'],'billing_route_literals':routes,'evidence_sha256':dg,'mutation_performed':False},sort_keys=True))
