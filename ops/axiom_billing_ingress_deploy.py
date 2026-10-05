import email
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API=os.environ['CF_API']; AID=os.environ['ACCOUNT_ID']; ZID=os.environ['ZONE_ID']; DBID=os.environ['D1_UUID']
AUTH=os.environ['AUTHORITY']; AUTH_SHA=os.environ['AUTHORITY_SHA256']; TRANSPORT=os.environ['TRANSPORT']; BILLING=os.environ['BILLING']; ROUTE=os.environ['BILLING_ROUTE']; BASE=os.environ['PAYMENTS_BASE']
AUTH_HEADERS={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'User-Agent':'MUSITU-Axiom-Billing-Production-Deploy/1.1'}
bridge=secrets.token_urlsafe(48); original_authority=None
mut={'authority_content':False,'authority_secret':False,'billing_worker':False,'route_id':None}

def req(url,method='GET',headers=None,body=None,timeout=45):
    q=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()

def cf(path,method='GET',obj=None,expected=None):
    h=dict(AUTH_HEADERS); body=None
    if obj is not None:h['Content-Type']='application/json'; body=json.dumps(obj,separators=(',',':')).encode()
    c,hh,b=req(API+path,method,h,body)
    if expected is not None:
        if c not in expected:raise RuntimeError(f'Cloudflare HTTP {c} {path}: '+b[:300].decode('utf-8','ignore'))
    elif not 200<=c<300:raise RuntimeError(f'Cloudflare HTTP {c} {path}: '+b[:300].decode('utf-8','ignore'))
    try:x=json.loads(b or b'{}')
    except Exception:x=None
    if isinstance(x,dict) and x.get('success') is False:raise RuntimeError('Cloudflare success=false '+path+' '+str(x.get('errors'))[:300])
    return c,hh,b,x

def mp(metadata,filename,content):
    boundary='----MUSITU'+secrets.token_hex(18); p=[]
    def add(v):p.append(v.encode() if isinstance(v,str) else v)
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'); add(json.dumps(metadata,separators=(',',':'))); add('\r\n')
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="{filename}"; filename="{filename}"\r\nContent-Type: application/javascript+module\r\n\r\n'); add(content); add('\r\n'); add(f'--{boundary}--\r\n')
    return boundary,b''.join(p)

def extract_module(raw,ctype,needle):
    if 'multipart/' not in (ctype or '').lower():return raw
    msg=email.message_from_bytes((f'Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw); parts=[]
    for part in msg.walk():
        if part.is_multipart():continue
        d=part.get_payload(decode=True) or b''
        if needle.encode() in d:parts.append(d)
    if len(parts)!=1:raise RuntimeError(f'expected exactly one module, got {len(parts)}')
    return parts[0]

def upload_content(script,source):
    boundary,body=mp({'main_module':'index.mjs'},'index.mjs',source); h=dict(AUTH_HEADERS); h['Content-Type']='multipart/form-data; boundary='+boundary
    c,_,b=req(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(script,safe="")}/content','PUT',h,body)
    if not 200<=c<300:raise RuntimeError(f'content upload {script} HTTP {c}: '+b[:400].decode('utf-8','ignore'))

def upload_worker(script,source,bindings):
    boundary,body=mp({'main_module':'index.mjs','compatibility_date':'2026-09-05','bindings':bindings},'index.mjs',source); h=dict(AUTH_HEADERS); h['Content-Type']='multipart/form-data; boundary='+boundary
    c,_,b=req(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(script,safe="")}','PUT',h,body)
    if not 200<=c<300:raise RuntimeError(f'worker upload HTTP {c}: '+b[:500].decode('utf-8','ignore'))

def put_secret(script,name,value):cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(script,safe="")}/secrets','PUT',{'name':name,'text':value,'type':'secret_text'})
def del_secret(script,name):
    try:cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(script,safe="")}/secrets/{urllib.parse.quote(name,safe="")}','DELETE',expected={200,404})
    except Exception:pass

def patch_authority(src):
    text=src.decode(); pat=re.compile(r'(?P<p>(?:async\s+)?function\s+)authorized(?P<r>\s*\([^)]*\)\s*\{)'); ms=list(pat.finditer(text))
    if len(ms)!=1:raise RuntimeError(f'authorized definition count {len(ms)}')
    m=ms[0]; brace=text.find('{',m.start()); depth=0; quote=None; esc=False; end=None
    for i in range(brace,len(text)):
        ch=text[i]
        if quote:
            if esc:esc=False
            elif ch=='\\':esc=True
            elif ch==quote:quote=None
            continue
        if ch in ('"',"'",'`'):quote=ch;continue
        if ch=='{':depth+=1
        elif ch=='}':
            depth-=1
            if depth==0:end=i+1;break
    if end is None:raise RuntimeError('authorized function unmatched')
    original=text[m.start():end]; renamed=pat.sub(lambda z:z.group('p')+'authorizedLegacy'+z.group('r'),original,count=1)
    extra='''\nasync function authorized(request, env) {\n  if (await authorizedLegacy(request, env)) return true;\n  const expected = env.BILLING_BRIDGE_CAPABILITY_TOKEN;\n  const header = request.headers.get("authorization") || "";\n  if (!expected || !header.startsWith("Bearer ")) return false;\n  const provided = header.slice(7); const enc = new TextEncoder();\n  const a = enc.encode(provided), b = enc.encode(expected); let diff = a.length ^ b.length;\n  const n = Math.max(a.length, b.length); for (let i=0;i<n;i++) diff |= (a[i] || 0) ^ (b[i] || 0);\n  return diff === 0;\n}\n'''
    patched=text[:m.start()]+renamed+extra+text[end:]
    if patched.count('BILLING_BRIDGE_CAPABILITY_TOKEN')!=1:raise RuntimeError('bridge reference mismatch')
    return patched.encode()

BILLING_SOURCE=r'''const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const out=(s,b)=>new Response(JSON.stringify(b),{status:s,headers:H});
async function hex(t){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("");}
async function probe(env){try{const r=await env.PAYMENT_AUTHORITY.fetch("https://payment-authority.internal/internal/paynow/verify-callback",{method:"POST",headers:{authorization:"Bearer "+env.BILLING_BRIDGE_CAPABILITY_TOKEN,"content-type":"application/x-www-form-urlencoded"},body:""});return{reachable:true,bridge_auth_accepted:r.status!==401&&r.status!==403,status:r.status}}catch{return{reachable:false,bridge_auth_accepted:false,status:null}}}
async function verify(raw,env){const r=await env.PAYMENT_AUTHORITY.fetch("https://payment-authority.internal/internal/paynow/verify-callback",{method:"POST",headers:{authorization:"Bearer "+env.BILLING_BRIDGE_CAPABILITY_TOKEN,"content-type":"application/x-www-form-urlencoded"},body:raw});const text=await r.text();let o={};try{o=JSON.parse(text)}catch{}if(r.status===401||r.status===403)return{ok:false,kind:"auth"};if(!r.ok)return{ok:false,kind:"upstream"};if(o?.valid!==true)return{ok:false,kind:"invalid"};return{ok:true}}
async function health(env){let d1=false;try{const r=await env.AXIOM_DB.prepare("SELECT 1 AS ok").first();d1=Number(r?.ok)===1}catch{}const a=await probe(env);const ok=d1&&a.reachable&&a.bridge_auth_accepted;return out(ok?200:503,{ok,service:"MUSITU Axiom Billing Ingress",mode:"catalog_fail_closed",catalog_configured:false,charges_enabled:false,subscription_activation_enabled:false,d1,authority:a,transport_bound:Boolean(env.PAYNOW_TRANSPORT)})}
async function webhook(req,env){const ct=(req.headers.get("content-type")||"").toLowerCase();if(!ct.startsWith("application/x-www-form-urlencoded"))return out(415,{ok:false,error:"unsupported_media_type"});if(Number(req.headers.get("content-length")||0)>65536)return out(413,{ok:false,error:"payload_too_large"});const raw=await req.text();if(new TextEncoder().encode(raw).length>65536)return out(413,{ok:false,error:"payload_too_large"});const v=await verify(raw,env);if(!v.ok)return out(v.kind==="invalid"?400:502,{ok:false,error:v.kind==="invalid"?"invalid_paynow_callback":"payment_authority_unavailable"});const digest=await hex(raw),now=new Date().toISOString();const payload=JSON.stringify({verified:true,body_sha256:digest,raw_payload_stored:false,catalog_mapped:false,subscription_mutated:false});await env.AXIOM_DB.prepare("INSERT OR IGNORE INTO webhook_events (id,provider,event_type,payload_json,processed_at) VALUES (?1,?2,?3,?4,?5)").bind("paynow_"+digest,"paynow","paynow.callback.verified.unmapped",payload,now).run();return out(202,{ok:true,verified:true,processed:false,subscription_mutated:false,reason:"catalog_not_configured"})}
export default{async fetch(req,env){const p=new URL(req.url).pathname;if(p==="/billing/healthz"&&req.method==="GET")return health(env);if(p==="/billing/catalog"&&req.method==="GET")return out(503,{ok:false,error:"catalog_not_configured",charges_enabled:false});if(p==="/billing/checkout"&&req.method==="POST")return out(503,{ok:false,error:"catalog_not_configured",charge_attempted:false});if(p==="/billing/webhooks/paynow"&&req.method==="POST")return webhook(req,env);return out(404,{ok:false,error:"not_found"})}};
'''.encode()

def syntax(path,data):open(path,'wb').write(data);subprocess.run(['node','--check',path],check=True,stdout=subprocess.DEVNULL)
def d1(sql):
    _,_,_,x=cf(f'/accounts/{AID}/d1/database/{DBID}/query','POST',{'sql':sql}); rows=[]
    for rr in (x or {}).get('result') or []:rows.extend(rr.get('results') or [])
    return rows

def rollback():
    rid=mut.get('route_id')
    if rid:
        try:cf(f'/zones/{ZID}/workers/routes/{rid}','DELETE',expected={200,404})
        except Exception:pass
    if mut.get('billing_worker'):
        try:cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(BILLING,safe="")}','DELETE',expected={200,404})
        except Exception:pass
    if mut.get('authority_content') and original_authority is not None:
        try:upload_content(AUTH,original_authority)
        except Exception:pass
    if mut.get('authority_secret'):del_secret(AUTH,'BILLING_BRIDGE_CAPABILITY_TOKEN')

try:
    c,h,b,_=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(AUTH,safe="")}'); original_authority=extract_module(b,h.get('content-type',''),'verifyPaynowCallback')
    if hashlib.sha256(original_authority).hexdigest()!=AUTH_SHA:raise RuntimeError('authority source hash mismatch')
    _,_,_,sx=cf(f'/accounts/{AID}/workers/scripts'); names={str(z.get('id') or z.get('name')) for z in (sx or {}).get('result') or [] if isinstance(z,dict)}
    if BILLING in names:raise RuntimeError('billing worker already exists')
    _,_,_,rx=cf(f'/zones/{ZID}/workers/routes'); routes=(rx or {}).get('result') or []
    if any(r.get('pattern')==ROUTE for r in routes if isinstance(r,dict)):raise RuntimeError('billing route already exists')
    _,_,_,dx=cf(f'/accounts/{AID}/workers/domains'); matches=[d for d in (dx or {}).get('result') or [] if isinstance(d,dict) and d.get('hostname')=='payments.mftintelligence.com']
    if len(matches)!=1 or matches[0].get('service')!=TRANSPORT:raise RuntimeError('payments Custom Domain owner mismatch')
    patched=patch_authority(original_authority); syntax('authority-patched.mjs',patched); syntax('billing-index.mjs',BILLING_SOURCE)
    upload_content(AUTH,patched); mut['authority_content']=True
    put_secret(AUTH,'BILLING_BRIDGE_CAPABILITY_TOKEN',bridge); mut['authority_secret']=True
    _,_,_,aset=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(AUTH,safe="")}/settings'); an={z.get('name') for z in ((aset or {}).get('result') or {}).get('bindings') or [] if isinstance(z,dict)}
    if not {'AUTHORITY_CAPABILITY_TOKEN','PAYNOW_INTEGRATION_KEY','BILLING_BRIDGE_CAPABILITY_TOKEN'}.issubset(an):raise RuntimeError('authority binding preservation failed')
    bindings=[{'type':'d1','name':'AXIOM_DB','id':DBID},{'type':'service','name':'PAYMENT_AUTHORITY','service':AUTH},{'type':'service','name':'PAYNOW_TRANSPORT','service':TRANSPORT}]
    upload_worker(BILLING,BILLING_SOURCE,bindings); mut['billing_worker']=True
    put_secret(BILLING,'BILLING_BRIDGE_CAPABILITY_TOKEN',bridge)
    cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(BILLING,safe="")}/subdomain','POST',{'enabled':False,'previews_enabled':False})
    _,_,_,bset=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(BILLING,safe="")}/settings'); nt={(z.get('name'),z.get('type')) for z in (((bset or {}).get('result') or {}).get('bindings') or []) if isinstance(z,dict)}
    for need in [('AXIOM_DB','d1'),('PAYMENT_AUTHORITY','service'),('PAYNOW_TRANSPORT','service'),('BILLING_BRIDGE_CAPABILITY_TOKEN','secret_text')]:
        if need not in nt:raise RuntimeError('billing binding missing '+str(need))
    _,_,_,created=cf(f'/zones/{ZID}/workers/routes','POST',{'pattern':ROUTE,'script':BILLING}); rid=((created or {}).get('result') or {}).get('id')
    if not rid:raise RuntimeError('route id absent')
    mut['route_id']=rid; time.sleep(2)
    def pub(path,method='GET',body=None,ctype=None):
        h={'Accept':'application/json','User-Agent':'MUSITU-Axiom-Billing-Deploy-Probe/1.1'}
        if ctype:h['Content-Type']=ctype
        return req(BASE+path,method,h,body,30)
    c,_,b=pub('/billing/healthz'); health=json.loads(b or b'{}')
    if c!=200 or health.get('ok') is not True or health.get('catalog_configured') is not False or health.get('charges_enabled') is not False or health.get('authority',{}).get('bridge_auth_accepted') is not True:raise RuntimeError('health contract failed '+str(c)+' '+b[:300].decode('utf-8','ignore'))
    c,_,b=pub('/billing/catalog');
    if c!=503 or json.loads(b).get('error')!='catalog_not_configured':raise RuntimeError('catalog gate failed')
    c,_,b=pub('/billing/checkout','POST',b'{"price_id":"attacker","amount":"0.01"}','application/json'); o=json.loads(b)
    if c!=503 or o.get('charge_attempted') is not False:raise RuntimeError('checkout fail-closed gate failed')
    before=d1('SELECT count(*) AS n FROM webhook_events;')[0]['n']; sb=d1('SELECT count(*) AS n FROM billing_subscriptions;')[0]['n']
    c,_,_=pub('/billing/webhooks/paynow','POST',b'status=Paid&reference=invalid&hash=definitely-invalid','application/x-www-form-urlencoded')
    if c not in (400,502):raise RuntimeError('invalid webhook status '+str(c))
    after=d1('SELECT count(*) AS n FROM webhook_events;')[0]['n']; sa=d1('SELECT count(*) AS n FROM billing_subscriptions;')[0]['n']
    if before!=after or sb!=sa:raise RuntimeError('invalid webhook mutated state')
    c,_,b=req(BASE+'/',headers={'Accept':'application/json','User-Agent':'MUSITU-Axiom-Billing-Deploy-Probe/1.1'}); root=json.loads(b or b'{}')
    if c!=200 or root.get('authority')!='transport_only' or root.get('certifies_payments') is not False:raise RuntimeError('legacy transport contract changed')
    c,_,_=req(BASE+'/internal/paynow/poll','POST',{'Content-Type':'application/json','User-Agent':'MUSITU-Axiom-Billing-Deploy-Probe/1.1'},b'{}')
    if c!=401:raise RuntimeError('legacy internal auth weakened')
    _,_,_,rr=cf(f'/zones/{ZID}/workers/routes'); exact=[r for r in (rr or {}).get('result') or [] if isinstance(r,dict) and r.get('pattern')==ROUTE and r.get('script')==BILLING]
    if len(exact)!=1:raise RuntimeError('final route verification failed')
    _,_,_,sub=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(BILLING,safe="")}/subdomain'); sr=(sub or {}).get('result') or {}
    if sr.get('enabled') is not False or sr.get('previews_enabled') is not False:raise RuntimeError('workers.dev not disabled')
    ev={'schema':'musitu.axiom.billing_ingress_production_deploy.v1','billing_worker':BILLING,'route':ROUTE,'route_id':rid,'authority_worker':AUTH,'transport_worker':TRANSPORT,'d1_uuid':DBID,'authority_original_sha256':AUTH_SHA,'authority_patched_sha256':hashlib.sha256(patched).hexdigest(),'billing_source_sha256':hashlib.sha256(BILLING_SOURCE).hexdigest(),'catalog_configured':False,'charges_enabled':False,'subscription_activation_enabled':False,'bridge_secret_generated_in_ci':True,'bridge_secret_exposed':False,'workers_dev_enabled':False,'preview_urls_enabled':False,'invalid_webhook_state_mutation':False,'legacy_transport_internal_unauthorized_http':401,'gate':'AXIOM_BILLING_INGRESS_PRODUCTION_FAIL_CLOSED_PASS'}
    raw=(json.dumps(ev,indent=2,sort_keys=True)+'\n').encode();open('billing-ingress-deploy-evidence.json','wb').write(raw);dg=hashlib.sha256(raw).hexdigest();open('billing-ingress-deploy-evidence.sha256','w').write(dg+'  billing-ingress-deploy-evidence.json\n')
    print(json.dumps({'gate':ev['gate'],'billing_worker':BILLING,'route':ROUTE,'catalog_configured':False,'charges_enabled':False,'subscription_activation_enabled':False,'bridge_secret_exposed':False,'workers_dev_enabled':False,'invalid_webhook_state_mutation':False,'legacy_transport_internal_unauthorized_http':401,'evidence_sha256':dg},sort_keys=True))
except Exception as e:
    print('DEPLOYMENT_FAIL_CLOSED:',str(e),file=sys.stderr);rollback();raise
finally:
    bridge=''
