import email, hashlib, json, os, re, urllib.error, urllib.parse, urllib.request
API=os.environ['CF_API'].rstrip('/'); AID=os.environ['ACCOUNT_ID']; WORKER='mft-fmi-global-edge'
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Live-Route-Inventory/1.0'}
def get(path):
    req=urllib.request.Request(API+path,headers=H)
    try:
        with urllib.request.urlopen(req,timeout=45) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
code,h,raw=get(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}')
if code!=200:raise RuntimeError(f'worker source HTTP {code}')
ct=h.get('content-type','');src=raw
if 'multipart/' in ct.lower():
    msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw);parts=[]
    for p in msg.walk():
        if p.is_multipart():continue
        d=p.get_payload(decode=True) or b''
        if any(k in d for k in (b'export default',b'addEventListener',b'fetch(')):parts.append(d)
    if len(parts)!=1:raise RuntimeError(f'executable module count={len(parts)}')
    src=parts[0]
text=src.decode('utf-8','ignore')
routes=sorted(set(re.findall(r'["\'](/v1/[A-Za-z0-9_./:-]+)["\']',text)))
items=[]
for route in routes:
    idx=text.find(route);w=text[max(0,idx-1200):min(len(text),idx+len(route)+2200)]
    methods=sorted(set(re.findall(r'(?:request|req)\.method\s*(?:===|==)\s*["\']([A-Z]+)["\']',w)))
    auth=bool(re.search(r'authorization|bearer|api[_-]?key|authenticate|requireAuth',w,re.I))
    body_parse=bool(re.search(r'\.json\s*\(|JSON\.parse|formData\s*\(',w))
    items.append({'route':route,'methods':methods,'auth_nearby':auth,'body_parse_nearby':body_parse})
out={'schema':'musitu.fmi.live-route-inventory.v1','gate':'FMI_LIVE_ROUTE_INVENTORY_READONLY_PASS','worker':WORKER,'source_sha256':hashlib.sha256(src).hexdigest(),'routes':items,'route_count':len(items),'mutation_performed':False,'raw_worker_source_published':False,'secret_values_read_or_logged':False}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();open('fmi-live-route-inventory.json','wb').write(blob);dg=hashlib.sha256(blob).hexdigest();open('fmi-live-route-inventory.sha256','w').write(dg+'  fmi-live-route-inventory.json\n')
print(json.dumps({'gate':out['gate'],'source_sha256':out['source_sha256'],'route_count':len(items),'routes':items,'mutation_performed':False,'raw_worker_source_published':False,'evidence_sha256':dg},sort_keys=True))