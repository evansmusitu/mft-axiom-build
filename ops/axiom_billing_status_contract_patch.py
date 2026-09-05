import email
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API=os.environ['CF_API']; AID=os.environ['ACCOUNT_ID']; DBID=os.environ['D1_UUID']; BILLING=os.environ['BILLING']; BASE=os.environ['BASE']; EXPECTED_SHA=os.environ['EXPECTED_BILLING_SHA256']
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-Axiom-Billing-Status-Contract-Patch/1.0'}

def http(url,method='GET',headers=None,body=None):
    q=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(q,timeout=40) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()

def cf(path,method='GET',obj=None):
    h=dict(H);body=None
    if obj is not None:h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,hh,b=http(API+path,method,h,body)
    if not 200<=c<300:raise RuntimeError(f'Cloudflare HTTP {c} {path}: '+b[:300].decode('utf-8','ignore'))
    x=json.loads(b or b'{}')
    if isinstance(x,dict) and x.get('success') is False:raise RuntimeError('Cloudflare success=false '+path)
    return c,hh,b,x

def source():
    c,hh,raw=http(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(BILLING,safe="")}',headers=H)
    if c!=200:raise RuntimeError(f'Worker source read HTTP {c}')
    ct=hh.get('content-type','');src=raw
    if 'multipart/' in ct.lower():
        msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw);parts=[]
        for p in msg.walk():
            if p.is_multipart():continue
            d=p.get_payload(decode=True) or b''
            if b'/billing/checkout' in d and b'billing_checkout_intents' in d:parts.append(d)
        if len(parts)!=1:raise RuntimeError(f'billing module count {len(parts)}')
        src=parts[0]
    return src

def multipart(src):
    boundary='----MUSITU'+secrets.token_hex(16);chunks=[]
    def add(x):chunks.append(x.encode() if isinstance(x,str) else x)
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n');add('{"main_module":"index.mjs"}\r\n')
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n');add(src);add('\r\n');add(f'--{boundary}--\r\n')
    return boundary,b''.join(chunks)

def upload(src):
    boundary,body=multipart(src);h=dict(H);h['Content-Type']='multipart/form-data; boundary='+boundary
    c,_,b=http(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(BILLING,safe="")}/content','PUT',h,body)
    if not 200<=c<300:raise RuntimeError('billing upload HTTP '+str(c)+' '+b[:300].decode('utf-8','ignore'))

def live(path,method='GET',body=None,ctype=None):
    h={'Accept':'application/json','User-Agent':'MUSITU-Axiom-Billing-Status-Contract-Patch/1.0'}
    if ctype:h['Content-Type']=ctype
    return http(BASE+path,method,h,body)

def d1(sql):
    _,_,_,x=cf(f'/accounts/{AID}/d1/database/{DBID}/query','POST',{'sql':sql});rows=[]
    for rr in x.get('result') or []:rows.extend(rr.get('results') or [])
    return rows

orig=source();orig_sha=hashlib.sha256(orig).hexdigest()
if orig_sha!=EXPECTED_SHA:raise SystemExit('Fail-closed: billing source hash changed '+orig_sha)
text=orig.decode('utf-8')
replacements=[
    ("'initiating'","'created'",1),
    ("status='initiation_failed'","status='failed'",1),
    ("status='transport_failed'","status='failed'",1),
    ("status='provider_failed'","status='failed'",1),
    ("status='provider_response_unverified'","status='failed'",1),
    ("status='provider_response_invalid'","status='failed'",1),
    ("status='pending'","status='initiated'",1),
    ("status='completed'","status='paid'",1),
    ('intent.status==="completed"','intent.status==="paid"',1),
]
for old,new,count in replacements:
    actual=text.count(old)
    if actual!=count:raise SystemExit(f'Fail-closed replacement count for {old}: {actual}')
    text=text.replace(old,new,count)
dynamic='bind(intent.reference,status||"unknown",callbackFields.paynowreference||null,nowIso()).run()'
normalized='bind(intent.reference,(status==="cancelled"?"cancelled":status==="expired"?"expired":status==="failed"?"failed":"initiated"),callbackFields.paynowreference||null,nowIso()).run()'
if text.count(dynamic)!=1:raise SystemExit('Fail-closed dynamic provider-status bind shape changed')
text=text.replace(dynamic,normalized,1)
# API error labels may intentionally retain descriptive names such as
# provider_response_unverified. Guard only database transition expressions.
for forbidden in ("'initiating'","status='pending'","status='completed'",'status||"unknown"'):
    if forbidden in text:raise SystemExit('Fail-closed noncanonical checkout DB transition remains: '+forbidden)
patched=text.encode();open('billing-status-patched.mjs','wb').write(patched);subprocess.run(['node','--check','billing-status-patched.mjs'],check=True,stdout=subprocess.DEVNULL)
changed=False
try:
    upload(patched);changed=True;time.sleep(1)
    c,_,b=live('/billing/healthz');o=json.loads(b or b'{}')
    if c!=200 or o.get('ok') is not True or o.get('checkout_enabled') is not True:raise RuntimeError('health failed after status patch')
    c,_,_=live('/billing/checkout','POST',b'{"plan":"developer"}','application/json')
    if c!=401:raise RuntimeError('checkout noauth gate changed')
    wb=d1('SELECT count(*) AS n FROM webhook_events;')[0]['n'];sb=d1('SELECT count(*) AS n FROM billing_subscriptions;')[0]['n'];ib=d1('SELECT count(*) AS n FROM billing_checkout_intents;')[0]['n']
    invalid=('status=Paid&reference=STATUSPATCHNEGATIVE&amount=19.00&hash='+'0'*128).encode();c,_,_=live('/billing/webhooks/paynow','POST',invalid,'application/x-www-form-urlencoded')
    wa=d1('SELECT count(*) AS n FROM webhook_events;')[0]['n'];sa=d1('SELECT count(*) AS n FROM billing_subscriptions;')[0]['n'];ia=d1('SELECT count(*) AS n FROM billing_checkout_intents;')[0]['n']
    if c!=400 or (wb,sb,ib)!=(wa,sa,ia):raise RuntimeError('invalid webhook mutation gate changed')
    new=source();new_sha=hashlib.sha256(new).hexdigest()
    if new_sha!=hashlib.sha256(patched).hexdigest():raise RuntimeError('deployed billing hash mismatch')
    evidence={'schema':'musitu.axiom.billing_status_contract_patch.v1','original_source_sha256':orig_sha,'patched_source_sha256':new_sha,'allowed_checkout_statuses':['created','initiated','paid','expired','cancelled','failed'],'health_http':200,'checkout_noauth_http':401,'invalid_webhook_http':400,'invalid_webhook_mutation':False,'secret_values_read':False,'gate':'AXIOM_BILLING_STATUS_CONTRACT_PATCH_PASS'}
    raw=(json.dumps(evidence,indent=2,sort_keys=True)+'\n').encode();open('billing-status-contract-evidence.json','wb').write(raw);dg=hashlib.sha256(raw).hexdigest();open('billing-status-contract-evidence.sha256','w').write(dg+'  billing-status-contract-evidence.json\n')
    print(json.dumps({'gate':evidence['gate'],'original_source_sha256':orig_sha,'patched_source_sha256':new_sha,'allowed_checkout_statuses':evidence['allowed_checkout_statuses'],'invalid_webhook_mutation':False,'secret_values_read':False,'evidence_sha256':dg},sort_keys=True))
except Exception as e:
    if changed:
        try:upload(orig)
        except Exception:pass
    print('FAIL',type(e).__name__,str(e),file=sys.stderr);sys.exit(1)
