import email, hashlib, json, os, re, urllib.error, urllib.parse, urllib.request

API=os.environ['CF_API'].rstrip('/')
AID=os.environ['ACCOUNT_ID']
WORKER='mft-fmi-billing'
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Billing-Reconcile-Contract/1.0'}

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

def windows(needle,radius=900):
    out=[];start=0
    while True:
        i=text.find(needle,start)
        if i<0:break
        w=text[max(0,i-radius):min(len(text),i+len(needle)+radius)]
        # Redact long quoted tokens defensively while preserving code shape.
        w=re.sub(r'(["\'])[A-Za-z0-9_\-]{32,}\1',r'\1<REDACTED_LONG_LITERAL>\1',w)
        out.append(w);start=i+len(needle)
    return out
needles=['/v1/billing/checkout','PLAN_ACTIVATED','billing_subscriptions','PAYNOW_TRANSPORT','poll_url','paynow_reference','completed_at']
out={
  'schema':'musitu.fmi.billing-reconcile-contract.v1',
  'worker':WORKER,
  'source_sha256':hashlib.sha256(src).hexdigest(),
  'occurrences':{n:len(windows(n)) for n in needles},
  'windows':{n:windows(n) for n in needles},
  'mutation_performed':False,
  'secret_values_read_or_logged':False,
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();open('fmi-billing-reconcile-contract.json','wb').write(blob)
dg=hashlib.sha256(blob).hexdigest();open('fmi-billing-reconcile-contract.sha256','w').write(dg+'  fmi-billing-reconcile-contract.json\n')
print(json.dumps({'gate':'FMI_BILLING_RECONCILE_CONTRACT_READONLY_PASS','source_sha256':out['source_sha256'],'occurrences':out['occurrences'],'evidence_sha256':dg,'mutation_performed':False},sort_keys=True))
