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
AUTH=os.environ['AUTHORITY']; TRANSPORT=os.environ['TRANSPORT']; BILLING=os.environ['BILLING']; ROUTE=os.environ['BILLING_ROUTE']; BASE=os.environ['PAYMENTS_BASE']
AUTH_SHA=os.environ['AUTHORITY_SHA256']; TRANSPORT_SHA=os.environ['TRANSPORT_SHA256']
CFH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'User-Agent':'MUSITU-Axiom-Billing-Commercial-Enable/1.0'}
transport_bridge=secrets.token_urlsafe(48)
original={'authority':None,'transport':None,'billing':None}
changed={'authority':False,'transport':False,'billing':False,'transport_secret_transport':False,'transport_secret_billing':False}
PAYNOW_ID='26343'

CATALOG={
  'developer': {'price_id':'axiom-developer-monthly','amount_cents':1900,'currency':'USD','monthly_unit_limit':1000,'billing_period_days':30},
  'pro': {'price_id':'axiom-pro-monthly','amount_cents':4900,'currency':'USD','monthly_unit_limit':5000,'billing_period_days':30},
  'enterprise': {'price_id':'axiom-enterprise-monthly','amount_cents':14900,'currency':'USD','monthly_unit_limit':25000,'billing_period_days':30},
}

def req(url,method='GET',headers=None,body=None,timeout=45):
    q=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(q,timeout=timeout) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()

def cf(path,method='GET',obj=None,expected=None):
    h=dict(CFH); body=None
    if obj is not None:h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,hh,b=req(API+path,method,h,body)
    if expected is not None:
        if c not in expected:raise RuntimeError(f'Cloudflare HTTP {c} {path}: '+b[:400].decode('utf-8','ignore'))
    elif not 200<=c<300:raise RuntimeError(f'Cloudflare HTTP {c} {path}: '+b[:400].decode('utf-8','ignore'))
    try:x=json.loads(b or b'{}')
    except Exception:x=None
    if isinstance(x,dict) and x.get('success') is False:raise RuntimeError('Cloudflare success=false '+path+' '+str(x.get('errors'))[:400])
    return c,hh,b,x

def extract_module(raw,ctype,needle):
    if 'multipart/' not in (ctype or '').lower():return raw
    msg=email.message_from_bytes((f'Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw);parts=[]
    for p in msg.walk():
        if p.is_multipart():continue
        d=p.get_payload(decode=True) or b''
        if needle.encode() in d:parts.append(d)
    if len(parts)!=1:raise RuntimeError(f'expected one executable module for {needle}, got {len(parts)}')
    return parts[0]

def read_script(name,needle):
    _,h,b,_=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(name,safe="")}')
    return extract_module(b,h.get('content-type',''),needle)

def mp(metadata,source):
    boundary='----MUSITU'+secrets.token_hex(16); chunks=[]
    def add(x):chunks.append(x.encode() if isinstance(x,str) else x)
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(metadata,separators=(',',':')));add('\r\n')
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n')
    add(source);add('\r\n');add(f'--{boundary}--\r\n')
    return boundary,b''.join(chunks)

def upload_content(script,source):
    boundary,body=mp({'main_module':'index.mjs'},source);h=dict(CFH);h['Content-Type']='multipart/form-data; boundary='+boundary
    c,_,b=req(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(script,safe="")}/content','PUT',h,body)
    if not 200<=c<300:raise RuntimeError(f'content upload {script} HTTP {c}: '+b[:500].decode('utf-8','ignore'))

def put_secret(script,name,value):
    cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(script,safe="")}/secrets','PUT',{'name':name,'text':value,'type':'secret_text'})

def del_secret(script,name):
    try:cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(script,safe="")}/secrets/{urllib.parse.quote(name,safe="")}','DELETE',expected={200,404})
    except Exception:pass

def syntax(name,data):
    open(name,'wb').write(data)
    subprocess.run(['node','--check',name],check=True,stdout=subprocess.DEVNULL)

def d1(sql):
    _,_,_,x=cf(f'/accounts/{AID}/d1/database/{DBID}/query','POST',{'sql':sql})
    rows=[]
    for rr in (x or {}).get('result') or []:
        if rr.get('success') is not True:raise RuntimeError('D1 query failed')
        rows.extend(rr.get('results') or [])
    return rows

def patch_fetch_route(text, route_expr):
    pat=re.compile(r'async\s+fetch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*)?\s*\)\s*\{')
    ms=list(pat.finditer(text))
    if len(ms)!=1:raise RuntimeError(f'fetch method count {len(ms)}')
    m=ms[0];request_var=m.group(1);env_var=m.group(2)
    injected=f'\n  {route_expr.format(request=request_var,env=env_var)}\n'
    return text[:m.end()]+injected+text[m.end():]

AUTH_HELPER=r'''
async function __musituAxiomPaynowSignInitiate(request, env) {
  const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
  if (!(await authorized(request, env))) return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:H});
  let body={}; try { body=await request.json(); } catch { return new Response(JSON.stringify({ok:false,error:"invalid_json"}),{status:400,headers:H}); }
  const reference=String(body.reference||"");
  const amount=String(body.amount||"");
  const additionalinfo=String(body.additionalinfo||"");
  if (!/^[A-Z0-9_-]{8,80}$/.test(reference)) return new Response(JSON.stringify({ok:false,error:"invalid_reference"}),{status:400,headers:H});
  if (!/^(?:0|[1-9][0-9]{0,8})\.[0-9]{2}$/.test(amount) || amount==="0.00") return new Response(JSON.stringify({ok:false,error:"invalid_amount"}),{status:400,headers:H});
  if (additionalinfo.length<1 || additionalinfo.length>120) return new Response(JSON.stringify({ok:false,error:"invalid_additionalinfo"}),{status:400,headers:H});
  const id="26343";
  const returnurl="https://payments.mftintelligence.com/billing/return?reference="+encodeURIComponent(reference);
  const resulturl="https://payments.mftintelligence.com/billing/webhooks/paynow";
  const status="Message";
  const key=env.PAYNOW_INTEGRATION_KEY;
  if (!key) return new Response(JSON.stringify({ok:false,error:"paynow_key_unavailable"}),{status:503,headers:H});
  const material=id+reference+amount+additionalinfo+returnurl+resulturl+status+key;
  const digest=await crypto.subtle.digest("SHA-512",new TextEncoder().encode(material));
  const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
  return new Response(JSON.stringify({ok:true,fields:{id,reference,amount,additionalinfo,returnurl,resulturl,status,hash}}),{status:200,headers:H});
}
'''

def patch_authority(src):
    text=src.decode()
    if '__musituAxiomPaynowSignInitiate' in text:return src
    if hashlib.sha256(src).hexdigest()!=AUTH_SHA:raise RuntimeError('authority source hash mismatch')
    pos=text.find('export default')
    if pos<0:raise RuntimeError('authority export default absent')
    text=text[:pos]+AUTH_HELPER+'\n'+text[pos:]
    text=patch_fetch_route(text,'if (new URL({request}.url).pathname === "/internal/paynow/sign-initiate" && {request}.method === "POST") return __musituAxiomPaynowSignInitiate({request}, {env});')
    if text.count('/internal/paynow/sign-initiate')!=1:raise RuntimeError('authority signer route count mismatch')
    return text.encode()

def patch_transport(src):
    text=src.decode()
    if 'BILLING_TRANSPORT_CAPABILITY_TOKEN' in text:return src
    if hashlib.sha256(src).hexdigest()!=TRANSPORT_SHA:raise RuntimeError('transport source hash mismatch')
    pat=re.compile(r'(?P<p>(?:async\s+)?function\s+)authorized(?P<r>\s*\([^)]*\)\s*\{)')
    ms=list(pat.finditer(text))
    if len(ms)!=1:raise RuntimeError(f'transport authorized definition count {len(ms)}')
    m=ms[0];brace=text.find('{',m.start());depth=0;quote=None;esc=False;end=None
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
    if end is None:raise RuntimeError('transport authorized function unmatched')
    original=text[m.start():end]
    renamed=pat.sub(lambda z:z.group('p')+'authorizedTransportLegacy'+z.group('r'),original,count=1)
    extra=r'''
async function authorized(request, env) {
  if (await authorizedTransportLegacy(request, env)) return true;
  const expected=env.BILLING_TRANSPORT_CAPABILITY_TOKEN;
  const header=request.headers.get("authorization")||"";
  if (!expected || !header.startsWith("Bearer ")) return false;
  const provided=header.slice(7), enc=new TextEncoder(), a=enc.encode(provided), b=enc.encode(expected);
  let diff=a.length^b.length; const n=Math.max(a.length,b.length);
  for(let i=0;i<n;i++) diff|=(a[i]||0)^(b[i]||0);
  return diff===0;
}
'''
    patched=text[:m.start()]+renamed+extra+text[end:]
    if patched.count('BILLING_TRANSPORT_CAPABILITY_TOKEN')!=1:raise RuntimeError('transport bridge marker mismatch')
    return patched.encode()

CATALOG_JS=json.dumps(CATALOG,separators=(',',':'))
BILLING_SOURCE=f'''const J={{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}};
const CATALOG={CATALOG_JS};
const PAYNOW_ID="{PAYNOW_ID}";
const out=(s,b)=>new Response(JSON.stringify(b),{{status:s,headers:J}});
const nowIso=()=>new Date().toISOString();
const monthKey=()=>new Date().toISOString().slice(0,7);
function b64(bytes){{let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(s)}}
async function sha256Text(s){{const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}}
async function sha256Bytes(bytes){{const d=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}}
function safePaynowUrl(v){{try{{const u=new URL(v);return u.protocol==="https:"&&(u.hostname==="www.paynow.co.zw"||u.hostname==="paynow.co.zw")}}catch{{return false}}}}
function parseForm(text){{const p=new URLSearchParams(text);const o={{}};for(const [k,v] of p.entries())o[k.toLowerCase()]=v;return o}}
async function authCustomer(req,env){{
  const h=req.headers.get("authorization")||""; if(!h.startsWith("Bearer "))return null;
  const token=h.slice(7); if(token.length<16||token.length>512)return null;
  const hash=await sha256Text(token);
  const row=await env.AXIOM_DB.prepare("SELECT k.id AS key_id,k.customer_id,k.status AS key_status,k.expires_at,k.revoked_at,c.email,c.plan,c.status AS customer_status FROM api_keys k JOIN customers c ON c.id=k.customer_id WHERE k.key_hash=?1 LIMIT 1").bind(hash).first();
  if(!row||row.key_status!=="active"||row.customer_status!=="active"||row.revoked_at)return null;
  if(row.expires_at&&Date.parse(row.expires_at)<=Date.now())return null;
  return row;
}}
async function authority(path,payload,env){{
  let r;try{{r=await env.PAYMENT_AUTHORITY.fetch("https://payment-authority.internal"+path,{{method:"POST",headers:{{authorization:"Bearer "+env.BILLING_BRIDGE_CAPABILITY_TOKEN,"content-type":"application/json"}},body:JSON.stringify(payload)}})}}catch{{return{{ok:false,error:"authority_unreachable"}}}}
  let o={{}};try{{o=await r.json()}}catch{{}}
  if(r.status===401||r.status===403)return{{ok:false,error:"authority_auth"}};
  if(!r.ok)return{{ok:false,error:o.error||"authority_error"}};
  return{{ok:true,data:o}};
}}
async function verifyMessage(bytes,env){{
  const a=await authority("/internal/paynow/verify-callback",{{raw_body_base64:b64(bytes)}},env);
  if(!a.ok)return{{ok:false,error:a.error}};
  if(a.data?.valid!==true)return{{ok:false,error:"invalid_paynow_hash"}};
  const digest=await sha256Bytes(bytes);
  if(a.data.callback_sha256&&a.data.callback_sha256!==digest)return{{ok:false,error:"authority_digest_mismatch"}};
  return{{ok:true,digest}};
}}
async function transport(path,body,ctype,env){{
  try{{return await env.PAYNOW_TRANSPORT.fetch("https://paynow-transport.internal"+path,{{method:"POST",headers:{{authorization:"Bearer "+env.BILLING_TRANSPORT_CAPABILITY_TOKEN,"content-type":ctype}},body}})}}catch{{return null}}
}}
async function health(env){{
  let d1=false;try{{const r=await env.AXIOM_DB.prepare("SELECT 1 AS ok").first();d1=Number(r?.ok)===1}}catch{{}}
  const invalid=new TextEncoder().encode("status=Paid&reference=MUSITUHEALTH&hash="+"0".repeat(128));
  const a=await authority("/internal/paynow/verify-callback",{{raw_body_base64:b64(invalid)}},env);
  const authority_ok=a.ok&&typeof a.data?.valid==="boolean";
  return out(d1&&authority_ok&&Boolean(env.PAYNOW_TRANSPORT)?200:503,{{ok:d1&&authority_ok&&Boolean(env.PAYNOW_TRANSPORT),service:"MUSITU Axiom Billing Ingress",catalog_configured:true,checkout_enabled:true,live_money_certified:false,provider:"paynow",provider_mode:"test_or_provider_controlled",d1,authority_reachable:authority_ok,transport_bound:Boolean(env.PAYNOW_TRANSPORT),plans:Object.keys(CATALOG)}})
}}
async function checkout(req,env){{
  const customer=await authCustomer(req,env); if(!customer)return out(401,{{ok:false,error:"invalid_bearer"}});
  let body={{}};try{{body=await req.json()}}catch{{return out(400,{{ok:false,error:"invalid_json"}})}}
  const forbidden=["amount","amount_cents","currency","monthly_unit_limit","price","price_id"];if(forbidden.some(k=>Object.prototype.hasOwnProperty.call(body,k)))return out(400,{{ok:false,error:"client_pricing_not_allowed"}});
  const plan=String(body.plan||"");const item=CATALOG[plan];if(!item)return out(400,{{ok:false,error:"unknown_plan"}});
  const ref=("AXIOM-"+Date.now().toString(36)+"-"+crypto.randomUUID().replaceAll("-","").slice(0,12)).toUpperCase();
  const created=nowIso(),expires=new Date(Date.now()+30*60*1000).toISOString(),amount=(item.amount_cents/100).toFixed(2);
  await env.AXIOM_DB.prepare("INSERT INTO billing_checkout_intents(reference,customer_id,plan,amount_cents,currency,monthly_unit_limit,status,browser_url,poll_url,paynow_reference,created_at,expires_at,updated_at,completed_at) VALUES(?1,?2,?3,?4,?5,?6,'initiating',NULL,NULL,NULL,?7,?8,?7,NULL)").bind(ref,customer.customer_id,plan,item.amount_cents,item.currency,item.monthly_unit_limit,created,expires).run();
  const sig=await authority("/internal/paynow/sign-initiate",{{reference:ref,amount,additionalinfo:"MUSITU Axiom "+plan+" 30-day access"}},env);
  if(!sig.ok||sig.data?.ok!==true||!sig.data.fields){{await env.AXIOM_DB.prepare("UPDATE billing_checkout_intents SET status='initiation_failed',updated_at=?2 WHERE reference=?1").bind(ref,nowIso()).run();return out(502,{{ok:false,error:"payment_signing_failed",reference:ref}})}}
  const f=sig.data.fields;if(String(f.id)!==PAYNOW_ID||f.reference!==ref||f.amount!==amount||f.status!=="Message")return out(502,{{ok:false,error:"signing_contract_mismatch"}});
  const form=new URLSearchParams();for(const k of ["id","reference","amount","additionalinfo","returnurl","resulturl","status","hash"])form.append(k,String(f[k]));
  const tr=await transport("/internal/paynow/initiate",form.toString(),"application/x-www-form-urlencoded",env);
  if(!tr){{await env.AXIOM_DB.prepare("UPDATE billing_checkout_intents SET status='transport_failed',updated_at=?2 WHERE reference=?1").bind(ref,nowIso()).run();return out(502,{{ok:false,error:"payment_transport_unavailable",reference:ref}})}}
  const raw=await tr.text();if(!tr.ok){{await env.AXIOM_DB.prepare("UPDATE billing_checkout_intents SET status='provider_failed',updated_at=?2 WHERE reference=?1").bind(ref,nowIso()).run();return out(502,{{ok:false,error:"payment_provider_error",reference:ref}})}}
  const bytes=new TextEncoder().encode(raw),verified=await verifyMessage(bytes,env);if(!verified.ok){{await env.AXIOM_DB.prepare("UPDATE billing_checkout_intents SET status='provider_response_unverified',updated_at=?2 WHERE reference=?1").bind(ref,nowIso()).run();return out(502,{{ok:false,error:"provider_response_unverified",reference:ref}})}}
  const p=parseForm(raw);if((p.status||"").toLowerCase()!=="ok"||!safePaynowUrl(p.browserurl)||!safePaynowUrl(p.pollurl)){{await env.AXIOM_DB.prepare("UPDATE billing_checkout_intents SET status='provider_response_invalid',updated_at=?2 WHERE reference=?1").bind(ref,nowIso()).run();return out(502,{{ok:false,error:"provider_response_invalid",reference:ref}})}}
  await env.AXIOM_DB.prepare("UPDATE billing_checkout_intents SET status='pending',browser_url=?2,poll_url=?3,updated_at=?4 WHERE reference=?1").bind(ref,p.browserurl,p.pollurl,nowIso()).run();
  return out(201,{{ok:true,reference:ref,plan,price_id:item.price_id,amount_cents:item.amount_cents,currency:item.currency,browser_url:p.browserurl,expires_at:expires,payment_status:"pending",live_money_certified:false}})
}}
async function pollIntent(intent,env){{
  if(!intent.poll_url||!safePaynowUrl(intent.poll_url))return{{ok:false,error:"poll_url_invalid"}};
  const tr=await transport("/internal/paynow/poll",JSON.stringify({{poll_url:intent.poll_url}}),"application/json",env);if(!tr)return{{ok:false,error:"poll_transport_unavailable"}};
  const raw=await tr.text();if(!tr.ok)return{{ok:false,error:"poll_provider_error"}};
  const bytes=new TextEncoder().encode(raw),v=await verifyMessage(bytes,env);if(!v.ok)return{{ok:false,error:v.error}};
  const p=parseForm(raw);return{{ok:true,fields:p,digest:v.digest}};
}}
function moneyToCents(s){{if(!/^(?:0|[1-9][0-9]{{0,8}})\.[0-9]{{2}}$/.test(String(s||"")))return null;const [a,b]=String(s).split(".");return Number(a)*100+Number(b)}}
async function activate(intent,p,env,eventDigest){{
  const item=CATALOG[intent.plan];if(!item)return{{ok:false,error:"catalog_mapping_absent"}};
  if(moneyToCents(p.amount)!==Number(intent.amount_cents))return{{ok:false,error:"amount_mismatch"}};
  if(p.reference!==intent.reference)return{{ok:false,error:"reference_mismatch"}};
  if((p.status||"").toLowerCase()!=="paid")return{{ok:true,paid:false,status:p.status||"unknown"}};
  const existing=await env.AXIOM_DB.prepare("SELECT provider_subscription_id,current_period_end FROM billing_subscriptions WHERE customer_id=?1 AND provider='paynow' LIMIT 1").bind(intent.customer_id).first();
  if(existing?.provider_subscription_id && (existing.provider_subscription_id===p.paynowreference||existing.provider_subscription_id===intent.reference))return{{ok:true,paid:true,idempotent:true}};
  const base=(existing?.current_period_end&&Date.parse(existing.current_period_end)>Date.now())?Date.parse(existing.current_period_end):Date.now();
  const periodEnd=new Date(base+item.billing_period_days*86400000).toISOString(),ts=nowIso();
  const providerRef=p.paynowreference||intent.reference;
  await env.AXIOM_DB.batch([
    env.AXIOM_DB.prepare("INSERT INTO billing_subscriptions(customer_id,provider,provider_customer_id,provider_subscription_id,status,price_id,current_period_end,updated_at) VALUES(?1,'paynow',NULL,?2,'active',?3,?4,?5) ON CONFLICT(customer_id,provider) DO UPDATE SET provider_subscription_id=excluded.provider_subscription_id,status='active',price_id=excluded.price_id,current_period_end=excluded.current_period_end,updated_at=excluded.updated_at").bind(intent.customer_id,providerRef,item.price_id,periodEnd,ts),
    env.AXIOM_DB.prepare("UPDATE customers SET plan=?2,monthly_unit_override=?3,updated_at=?4 WHERE id=?1 AND status='active'").bind(intent.customer_id,intent.plan,item.monthly_unit_limit,ts),
    env.AXIOM_DB.prepare("INSERT INTO usage_buckets(customer_id,month,used_units,unit_limit,updated_at) VALUES(?1,?2,0,?3,?4) ON CONFLICT(customer_id,month) DO UPDATE SET unit_limit=excluded.unit_limit,updated_at=excluded.updated_at").bind(intent.customer_id,monthKey(),item.monthly_unit_limit,ts),
    env.AXIOM_DB.prepare("UPDATE billing_checkout_intents SET status='completed',paynow_reference=?2,completed_at=?3,updated_at=?3 WHERE reference=?1").bind(intent.reference,providerRef,ts),
    env.AXIOM_DB.prepare("INSERT OR IGNORE INTO webhook_events(id,provider,event_type,payload_json,processed_at) VALUES(?1,'paynow','paynow.payment.verified.paid',?2,?3)").bind("paynow_"+eventDigest,JSON.stringify({{verified:true,reference:intent.reference,plan:intent.plan,amount_cents:Number(intent.amount_cents),paynow_reference:providerRef,raw_payload_stored:false,poll_confirmed:true}}),ts)
  ]);
  return{{ok:true,paid:true,activated:true,plan:intent.plan,current_period_end:periodEnd}};
}}
async function verifyAndMaybeActivate(intent,callbackFields,callbackDigest,env){{
  if(moneyToCents(callbackFields.amount)!==Number(intent.amount_cents)||callbackFields.reference!==intent.reference)return{{ok:false,error:"callback_intent_mismatch"}};
  const status=(callbackFields.status||"").toLowerCase();
  if(status!=="paid"){{await env.AXIOM_DB.prepare("UPDATE billing_checkout_intents SET status=?2,paynow_reference=?3,updated_at=?4 WHERE reference=?1 AND status!='completed'").bind(intent.reference,status||"unknown",callbackFields.paynowreference||null,nowIso()).run();return{{ok:true,paid:false,status:callbackFields.status||"unknown"}}}}
  const polled=await pollIntent(intent,env);if(!polled.ok)return polled;
  return activate(intent,polled.fields,env,callbackDigest+"_"+polled.digest);
}}
async function webhook(req,env){{
  const ct=(req.headers.get("content-type")||"").toLowerCase();if(!ct.startsWith("application/x-www-form-urlencoded"))return out(415,{{ok:false,error:"unsupported_media_type"}});
  const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>65536)return out(413,{{ok:false,error:"payload_too_large"}});
  const v=await verifyMessage(bytes,env);if(!v.ok)return out(v.error==="invalid_paynow_hash"?400:502,{{ok:false,error:v.error}});
  const p=parseForm(new TextDecoder().decode(bytes));const ref=p.reference||"";if(!ref)return out(400,{{ok:false,error:"reference_absent"}});
  const intent=await env.AXIOM_DB.prepare("SELECT * FROM billing_checkout_intents WHERE reference=?1 LIMIT 1").bind(ref).first();if(!intent)return out(202,{{ok:true,verified:true,processed:false,reason:"unknown_reference"}});
  const r=await verifyAndMaybeActivate(intent,p,v.digest,env);if(!r.ok)return out(409,{{ok:false,error:r.error}});
  return out(200,{{ok:true,verified:true,processed:true,payment_status:r.paid?"paid":(r.status||"pending"),subscription_activated:Boolean(r.activated),idempotent:Boolean(r.idempotent)}})
}}
async function status(req,env,ref){{
  const customer=await authCustomer(req,env);if(!customer)return out(401,{{ok:false,error:"invalid_bearer"}});
  const intent=await env.AXIOM_DB.prepare("SELECT * FROM billing_checkout_intents WHERE reference=?1 AND customer_id=?2 LIMIT 1").bind(ref,customer.customer_id).first();if(!intent)return out(404,{{ok:false,error:"checkout_not_found"}});
  if(intent.status==="completed")return out(200,{{ok:true,reference:ref,payment_status:"paid",plan:intent.plan}});
  if(!intent.poll_url)return out(200,{{ok:true,reference:ref,payment_status:intent.status,plan:intent.plan}});
  const polled=await pollIntent(intent,env);if(!polled.ok)return out(502,{{ok:false,error:polled.error,reference:ref}});
  const digest=await sha256Text(ref+"|"+(polled.digest||""));
  const r=await activate(intent,polled.fields,env,digest);if(!r.ok)return out(409,{{ok:false,error:r.error,reference:ref}});
  return out(200,{{ok:true,reference:ref,payment_status:r.paid?"paid":(r.status||"pending"),plan:intent.plan,subscription_activated:Boolean(r.activated),idempotent:Boolean(r.idempotent)}})
}}
export default{{async fetch(req,env){{
  const u=new URL(req.url),p=u.pathname;
  if(p==="/billing/healthz"&&req.method==="GET")return health(env);
  if(p==="/billing/catalog"&&req.method==="GET")return out(200,{{ok:true,currency:"USD",billing_period:"30_days",live_money_certified:false,plans:Object.entries(CATALOG).map(([id,x])=>({{id,price_id:x.price_id,amount_cents:x.amount_cents,currency:x.currency,monthly_unit_limit:x.monthly_unit_limit}}))}});
  if(p==="/billing/checkout"&&req.method==="POST")return checkout(req,env);
  if(p.startsWith("/billing/checkout/")&&req.method==="GET")return status(req,env,decodeURIComponent(p.slice("/billing/checkout/".length)));
  if(p==="/billing/webhooks/paynow"&&req.method==="POST")return webhook(req,env);
  if(p==="/billing/return"&&req.method==="GET")return out(200,{{ok:true,reference:u.searchParams.get("reference"),message:"Payment return received. Settlement is verified independently by MUSITU Axiom; query checkout status with your API key."}});
  return out(404,{{ok:false,error:"not_found"}});
}}}};
'''.encode()

def rollback():
    for logical,script in [('billing',BILLING),('transport',TRANSPORT),('authority',AUTH)]:
        if changed.get(logical) and original.get(logical) is not None:
            try:upload_content(script,original[logical])
            except Exception:pass
    if changed['transport_secret_transport']:del_secret(TRANSPORT,'BILLING_TRANSPORT_CAPABILITY_TOKEN')
    if changed['transport_secret_billing']:del_secret(BILLING,'BILLING_TRANSPORT_CAPABILITY_TOKEN')

def public(path,method='GET',body=None,headers=None):
    h={'Accept':'application/json','User-Agent':'MUSITU-Axiom-Billing-Commercial-Probe/1.0'}
    h.update(headers or {})
    return req(BASE+path,method,h,body,30)

try:
    original['authority']=read_script(AUTH,'verifyPaynowCallback')
    original['transport']=read_script(TRANSPORT,'/internal/paynow/initiate')
    original['billing']=read_script(BILLING,'/billing/healthz')
    if '__musituAxiomPaynowSignInitiate' in original['authority'].decode():raise RuntimeError('authority signer already present; refusing ambiguous reapply')
    if 'BILLING_TRANSPORT_CAPABILITY_TOKEN' in original['transport'].decode():raise RuntimeError('transport bridge already present; refusing ambiguous reapply')
    btext=original['billing'].decode()
    if 'catalog_fail_closed' not in btext or 'catalog_not_configured' not in btext:raise RuntimeError('billing source is not expected fail-closed predecessor')
    _,_,_,rx=cf(f'/zones/{ZID}/workers/routes'); exact=[r for r in (rx or {}).get('result') or [] if isinstance(r,dict) and r.get('pattern')==ROUTE and r.get('script')==BILLING]
    if len(exact)!=1:raise RuntimeError('billing route invariant failed')
    cols={r.get('name') for r in d1('PRAGMA table_info("billing_checkout_intents");')}
    required={'reference','customer_id','plan','amount_cents','currency','monthly_unit_limit','status','browser_url','poll_url','paynow_reference','created_at','expires_at','updated_at','completed_at'}
    if not required.issubset(cols):raise RuntimeError('billing checkout intents schema incomplete')
    for table in ('customers','api_keys','billing_subscriptions','usage_buckets','webhook_events'):
        if not d1(f'PRAGMA table_info("{table}");'):raise RuntimeError('required table absent '+table)
    auth_new=patch_authority(original['authority']);transport_new=patch_transport(original['transport'])
    syntax('authority-commercial.mjs',auth_new);syntax('transport-commercial.mjs',transport_new);syntax('billing-commercial.mjs',BILLING_SOURCE)

    upload_content(AUTH,auth_new);changed['authority']=True
    upload_content(TRANSPORT,transport_new);changed['transport']=True
    put_secret(TRANSPORT,'BILLING_TRANSPORT_CAPABILITY_TOKEN',transport_bridge);changed['transport_secret_transport']=True
    put_secret(BILLING,'BILLING_TRANSPORT_CAPABILITY_TOKEN',transport_bridge);changed['transport_secret_billing']=True
    upload_content(BILLING,BILLING_SOURCE);changed['billing']=True
    time.sleep(2)

    c,_,b=public('/billing/healthz');health=json.loads(b or b'{}')
    if c!=200 or health.get('ok') is not True or health.get('catalog_configured') is not True or health.get('checkout_enabled') is not True:raise RuntimeError('billing health failed')
    c,_,b=public('/billing/catalog');cat=json.loads(b or b'{}')
    if c!=200 or [p.get('id') for p in cat.get('plans',[])]!=['developer','pro','enterprise']:raise RuntimeError('catalog contract failed')
    c,_,_=public('/billing/checkout','POST',json.dumps({'plan':'developer'}).encode(),{'Content-Type':'application/json'})
    if c!=401:raise RuntimeError('checkout noauth gate failed')
    c,_,_=public('/billing/checkout','POST',json.dumps({'plan':'developer','amount_cents':1}).encode(),{'Content-Type':'application/json','Authorization':'Bearer definitely-invalid'})
    if c!=401:raise RuntimeError('checkout invalid bearer gate failed')
    wb=d1('SELECT count(*) AS n FROM webhook_events;')[0]['n'];sb=d1('SELECT count(*) AS n FROM billing_subscriptions;')[0]['n']
    invalid=('status=Paid&reference=NEGATIVE&hash='+'0'*128).encode()
    c,_,_=public('/billing/webhooks/paynow','POST',invalid,{'Content-Type':'application/x-www-form-urlencoded'})
    wa=d1('SELECT count(*) AS n FROM webhook_events;')[0]['n'];sa=d1('SELECT count(*) AS n FROM billing_subscriptions;')[0]['n']
    if c!=400 or wb!=wa or sb!=sa:raise RuntimeError('invalid callback mutation gate failed')

    _,_,_,bset=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(BILLING,safe="")}/settings')
    binds=((bset or {}).get('result') or {}).get('bindings') or [];names={x.get('name'):x.get('type') for x in binds if isinstance(x,dict)}
    for k,t in {'AXIOM_DB':'d1','PAYMENT_AUTHORITY':'service','PAYNOW_TRANSPORT':'service','BILLING_BRIDGE_CAPABILITY_TOKEN':'secret_text','BILLING_TRANSPORT_CAPABILITY_TOKEN':'secret_text'}.items():
        if names.get(k)!=t:raise RuntimeError('binding missing '+k)
    _,_,_,tset=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(TRANSPORT,safe="")}/settings')
    tn={x.get('name'):x.get('type') for x in (((tset or {}).get('result') or {}).get('bindings') or []) if isinstance(x,dict)}
    if tn.get('BILLING_TRANSPORT_CAPABILITY_TOKEN')!='secret_text':raise RuntimeError('transport bridge secret absent')
    evidence={'schema':'musitu.axiom.billing_commercial_enable.v1','catalog':CATALOG,'integration_id':PAYNOW_ID,'billing_route':ROUTE,'checks':{'health_http':200,'catalog_http':200,'checkout_noauth_http':401,'checkout_invalid_bearer_http':401,'invalid_webhook_http':400,'invalid_webhook_mutation':False,'authority_signer_private':True,'transport_bridge_private':True,'live_money_certified':False},'secret_values_published':False,'real_checkout_created':False,'real_payment_moved':False,'gate':'AXIOM_BILLING_COMMERCIAL_PLUMBING_PASS'}
    blob=(json.dumps(evidence,indent=2,sort_keys=True)+'\n').encode();open('commercial-enable-evidence.json','wb').write(blob);dg=hashlib.sha256(blob).hexdigest();open('commercial-enable-evidence.sha256','w').write(dg+'  commercial-enable-evidence.json\n')
    print(json.dumps({'gate':evidence['gate'],'catalog':CATALOG,'checks':evidence['checks'],'evidence_sha256':dg,'secret_values_published':False,'real_checkout_created':False,'real_payment_moved':False},sort_keys=True))
except Exception as e:
    rollback()
    print('FAIL',type(e).__name__,str(e),file=sys.stderr)
    sys.exit(1)
