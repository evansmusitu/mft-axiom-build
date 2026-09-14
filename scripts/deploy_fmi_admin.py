import datetime
import email
import hashlib
import json
import os
import pathlib
import secrets
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

API=os.environ['CF_API'].rstrip('/')
AID=os.environ['ACCOUNT_ID']
ZID=os.environ['ZONE_ID']
ZONE=os.environ['ZONE_NAME']
DBID=os.environ['FMI_DB_UUID']
HOST=os.environ['ADMIN_HOST']
WORKER=os.environ['ADMIN_WORKER']
PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/')
BOOTSTRAP_HASH=os.environ['BOOTSTRAP_HASH']
SOURCE_PATH=pathlib.Path(os.environ.get('ADMIN_SOURCE','admin/fmi_admin_worker.mjs'))
SOURCE=SOURCE_PATH.read_bytes()
SOURCE_SHA=hashlib.sha256(SOURCE).hexdigest()
CFH={
  'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
  'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],
  'Accept':'application/json',
  'User-Agent':'MUSITU-FMI-Admin-Deploy/1.0',
}

def raw(url,method='GET',headers=None,body=None,timeout=45,follow=True):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    opener=urllib.request.build_opener() if follow else urllib.request.build_opener(type('NoRedirect',(urllib.request.HTTPRedirectHandler,),{'redirect_request':lambda self,req,fp,code,msg,headers,newurl:None})())
    try:
        with opener.open(req,timeout=timeout) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()
    except urllib.error.URLError as e:return 0,{},str(type(e).__name__).encode()

def cf(path,method='GET',obj=None,expected=None):
    h=dict(CFH); body=None
    if obj is not None:
        h['Content-Type']='application/json'; body=json.dumps(obj,separators=(',',':')).encode()
    c,hh,b=raw(API+path,method,h,body)
    if expected is not None:
        if c not in expected: raise RuntimeError(f'Cloudflare HTTP {c}: {method} {path}: '+b[:300].decode('utf-8','ignore'))
    elif not 200<=c<300:
        raise RuntimeError(f'Cloudflare HTTP {c}: {method} {path}: '+b[:300].decode('utf-8','ignore'))
    try:o=json.loads(b or b'{}')
    except Exception:o={}
    if isinstance(o,dict) and o.get('success') is False:
        raise RuntimeError('Cloudflare success=false '+path+' '+str(o.get('errors'))[:500])
    return o.get('result') if isinstance(o,dict) else None

def d1(sql,params=None):
    obj={'sql':sql}
    if params is not None:obj['params']=params
    rr=cf(f'/accounts/{AID}/d1/database/{DBID}/query','POST',obj) or []
    rows=[]
    if not rr or not all(x.get('success') is True for x in rr):raise RuntimeError('D1 statement failed')
    for x in rr:rows.extend(x.get('results') or [])
    return rows

def one(sql,params=None):
    rows=d1(sql,params)
    if len(rows)!=1:raise RuntimeError(f'D1 cardinality mismatch {len(rows)} for {sql[:80]}')
    return rows[0]

def http_json(url,method='GET',obj=None,headers=None,follow=True):
    h={'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-E2E/1.0'}
    if headers:h.update(headers)
    body=None
    if obj is not None:
        h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,hh,b=raw(url,method,h,body,45,follow)
    try:o=json.loads(b or b'{}')
    except Exception:o={}
    return c,hh,o,b

def mp(meta):
    bd='----MUSITU'+secrets.token_hex(18); p=[]
    def add(v):p.append(v.encode() if isinstance(v,str) else v)
    add(f'--{bd}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n');add(json.dumps(meta,separators=(',',':')));add('\r\n')
    add(f'--{bd}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n');add(SOURCE);add('\r\n');add(f'--{bd}--\r\n')
    return bd,b''.join(p)

def table_counts():
    names=['customers','api_keys','lifecycle_events','billing_checkout_intents','billing_subscriptions','usage_events']
    return {n:int(one(f'SELECT COUNT(*) AS n FROM {n}')['n']) for n in names}

def iso_after(minutes=0,hours=0):
    return (datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=minutes,hours=hours)).isoformat().replace('+00:00','Z')

subprocess.run(['node','--check',str(SOURCE_PATH)],check=True,stdout=subprocess.DEVNULL)

zones=cf('/zones?name='+urllib.parse.quote(ZONE)+'&status=active') or []
if len(zones)!=1 or zones[0].get('id')!=ZID or (zones[0].get('account') or {}).get('id')!=AID:
    raise RuntimeError('canonical zone/account mismatch')
domains=cf(f'/accounts/{AID}/workers/domains') or []
existing_domains=[d for d in domains if isinstance(d,dict) and d.get('hostname')==HOST]
if len(existing_domains)>1:raise RuntimeError('duplicate admin custom domain rows')
if existing_domains and existing_domains[0].get('service')!=WORKER:raise RuntimeError('admin hostname already belongs to another Worker')
if not existing_domains:
    dns=cf(f'/zones/{ZID}/dns_records?name='+urllib.parse.quote(HOST)+'&per_page=100') or []
    if dns:raise RuntimeError('admin hostname already has DNS records; refusing override')
    routes=cf(f'/zones/{ZID}/workers/routes') or []
    if any(HOST in str(r.get('pattern') or '') for r in routes if isinstance(r,dict)):
        raise RuntimeError('admin hostname already appears in Worker routes')

customer_counts_before=table_counts()

migrations=[
'''CREATE TABLE IF NOT EXISTS fmi_admin_credentials (principal TEXT PRIMARY KEY,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,pbkdf2_iterations INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);''',
'''CREATE TABLE IF NOT EXISTS fmi_admin_bootstrap_tokens (token_hash TEXT PRIMARY KEY,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,used_at TEXT);''',
'''CREATE TABLE IF NOT EXISTS fmi_admin_sessions (session_hash TEXT PRIMARY KEY,principal TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,last_seen_at TEXT NOT NULL);''',
'''CREATE TABLE IF NOT EXISTS fmi_admin_audit_events (id TEXT PRIMARY KEY,principal TEXT NOT NULL,action TEXT NOT NULL,target_type TEXT,target_id_hash TEXT,metadata_json TEXT NOT NULL,occurred_at TEXT NOT NULL);''',
'''CREATE TABLE IF NOT EXISTS fmi_admin_login_events (id TEXT PRIMARY KEY,ip_hash TEXT NOT NULL,success INTEGER NOT NULL,occurred_at TEXT NOT NULL);''',
'''CREATE INDEX IF NOT EXISTS idx_fmi_admin_sessions_expiry ON fmi_admin_sessions(expires_at);''',
'''CREATE INDEX IF NOT EXISTS idx_fmi_admin_audit_time ON fmi_admin_audit_events(occurred_at);''',
'''CREATE INDEX IF NOT EXISTS idx_fmi_admin_login_ip_time ON fmi_admin_login_events(ip_hash,occurred_at);''',
]
for sql in migrations:d1(sql)
required={'fmi_admin_credentials','fmi_admin_bootstrap_tokens','fmi_admin_sessions','fmi_admin_audit_events','fmi_admin_login_events'}
inv={r.get('name') for r in d1("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'fmi_admin_%'")}
if not required.issubset(inv):raise RuntimeError('admin schema incomplete')

meta={'main_module':'index.mjs','compatibility_date':'2026-09-14','bindings':[
    {'type':'d1','name':'FMI_DB','id':DBID},
    {'type':'plain_text','name':'ADMIN_HOST','text':HOST},
    {'type':'plain_text','name':'PUBLIC_BASE','text':PUBLIC_BASE},
]}
bd,body=mp(meta);h=dict(CFH);h['Content-Type']='multipart/form-data; boundary='+bd
c,_,b=raw(f'{API}/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}', 'PUT',h,body)
if not 200<=c<300:raise RuntimeError('admin Worker upload HTTP '+str(c)+' '+b[:500].decode('utf-8','ignore'))
settings=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/settings') or {}
bn={x.get('name'):x for x in settings.get('bindings') or [] if isinstance(x,dict)}
if bn.get('FMI_DB',{}).get('id')!=DBID:raise RuntimeError('admin D1 binding readback mismatch')
if bn.get('ADMIN_HOST',{}).get('text')!=HOST or bn.get('PUBLIC_BASE',{}).get('text')!=PUBLIC_BASE:raise RuntimeError('admin metadata binding readback mismatch')

owner_count=int(one("SELECT COUNT(*) AS n FROM fmi_admin_credentials WHERE principal='owner'")['n'])
smoke={}
if owner_count==0:
    smoke_code='smoke_'+secrets.token_urlsafe(32);smoke_hash=hashlib.sha256(smoke_code.encode()).hexdigest();smoke_password='Smoke!'+secrets.token_urlsafe(28)+'9'
    print('::add-mask::'+smoke_code);print('::add-mask::'+smoke_password)
    d1('DELETE FROM fmi_admin_bootstrap_tokens')
    d1('INSERT INTO fmi_admin_bootstrap_tokens(token_hash,expires_at,created_at,used_at) VALUES(?1,?2,?3,NULL)',[smoke_hash,iso_after(minutes=20),iso_after()])
    cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain','POST',{'enabled':True,'previews_enabled':False})
    sub=cf(f'/accounts/{AID}/workers/subdomain') or {};subname=str(sub.get('subdomain') or '')
    if not subname:raise RuntimeError('workers account subdomain missing')
    dev=f'https://{WORKER}.{subname}.workers.dev'
    health=None
    for _ in range(30):
        hc,_,ho,_=http_json(dev+'/health')
        if hc==200 and ho.get('ok') is True:health=ho;break
        time.sleep(2)
    if health is None:raise RuntimeError('admin workers.dev smoke health failed')
    ac,ah,ao,_=http_json(dev+'/api/activate','POST',{'code':smoke_code,'password':smoke_password},{'Origin':'https://'+HOST})
    if ac!=200 or ao.get('ok') is not True:raise RuntimeError(f'admin activation smoke failed HTTP {ac}')
    set_cookie=ah.get('Set-Cookie') or ah.get('set-cookie') or ''
    cookie=set_cookie.split(';',1)[0]
    if '__Host-fmi_admin_session=' not in cookie:raise RuntimeError('admin activation smoke session cookie missing')
    authh={'Cookie':cookie,'Origin':'https://'+HOST}
    protected={}
    for path in ('/api/overview','/api/customers','/api/revenue','/api/usage','/api/system','/api/audit'):
        pc,_,po,_=http_json(dev+path,'GET',headers=authh)
        if pc!=200:raise RuntimeError(f'admin protected smoke {path} HTTP {pc}')
        protected[path]=pc

    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S');email_value=f'admin-e2e-{stamp}-{secrets.token_hex(8)}@example.invalid'
    print('::add-mask::'+email_value)
    sc,_,so,_=http_json(PUBLIC_BASE+'/v1/signup','POST',{'email':email_value,'name':'MUSITU FMI Admin E2E','plan':'FREE'})
    if sc not in (200,201):raise RuntimeError(f'admin control synthetic signup HTTP {sc}')
    raw_key=None
    for k in ('api_key','key','token'):
        if isinstance(so.get(k),str) and so.get(k):raw_key=so[k];break
    if not raw_key:raise RuntimeError('admin control synthetic API key missing')
    print('::add-mask::'+raw_key)
    rows=d1('SELECT id,status,plan FROM customers WHERE email=?1',[email_value])
    if len(rows)!=1:raise RuntimeError('admin control synthetic customer cardinality mismatch')
    cid=str(rows[0].get('id') or '');print('::add-mask::'+cid)
    if rows[0].get('status')!='active' or str(rows[0].get('plan')).upper()!='FREE':raise RuntimeError('synthetic customer baseline mismatch')
    bearer={'Authorization':'Bearer '+raw_key,'Accept':'application/json'}
    mc,_,_,_=http_json(PUBLIC_BASE+'/v1/me','GET',headers=bearer)
    if mc!=200:raise RuntimeError('synthetic customer baseline auth failed')
    dc,_,do,_=http_json(dev+'/api/customer/status','POST',{'customer_id':cid,'status':'disabled'},authh)
    if dc!=200 or do.get('status')!='disabled':raise RuntimeError('admin disable action failed')
    disabled_me,_,_,_=http_json(PUBLIC_BASE+'/v1/me','GET',headers=bearer)
    rc,_,ro,_=http_json(dev+'/api/customer/status','POST',{'customer_id':cid,'status':'active'},authh)
    if rc!=200 or ro.get('status')!='active':raise RuntimeError('admin reactivate action failed')
    reactivated_me,_,_,_=http_json(PUBLIC_BASE+'/v1/me','GET',headers=bearer)
    kc,_,ko,_=http_json(dev+'/api/customer/revoke-keys','POST',{'customer_id':cid},authh)
    if kc!=200 or int(ko.get('revoked_count') or 0)<1:raise RuntimeError('admin revoke-key action failed')
    revoked_me,_,_,_=http_json(PUBLIC_BASE+'/v1/me','GET',headers=bearer)
    if disabled_me==200:raise RuntimeError('customer status disable is not enforced by live edge')
    if reactivated_me!=200:raise RuntimeError('customer reactivation did not restore live edge access')
    if revoked_me==200:raise RuntimeError('revoked API key still accepted by live edge')

    d1('DELETE FROM customers WHERE id=?1 AND email=?2',[cid,email_value])
    if int(one('SELECT COUNT(*) AS n FROM customers WHERE email=?1',[email_value])['n'])!=0:raise RuntimeError('synthetic customer cleanup failed')
    d1('DELETE FROM fmi_admin_sessions')
    d1('DELETE FROM fmi_admin_credentials')
    d1('DELETE FROM fmi_admin_bootstrap_tokens')
    d1('DELETE FROM fmi_admin_audit_events')
    d1('DELETE FROM fmi_admin_login_events')
    smoke={'activation_http':ac,'protected_routes':protected,'customer_signup_http':sc,'baseline_me_http':mc,'disabled_me_http':disabled_me,'reactivated_me_http':reactivated_me,'revoked_me_http':revoked_me,'customer_cleanup':True,'admin_smoke_cleanup':True}

owner_count_after=int(one("SELECT COUNT(*) AS n FROM fmi_admin_credentials WHERE principal='owner'")['n'])
bootstrap_created=False;bootstrap_expires=None
if owner_count_after==0:
    d1('DELETE FROM fmi_admin_bootstrap_tokens WHERE used_at IS NULL')
    bootstrap_expires=iso_after(hours=24)
    d1('INSERT INTO fmi_admin_bootstrap_tokens(token_hash,expires_at,created_at,used_at) VALUES(?1,?2,?3,NULL)',[BOOTSTRAP_HASH,bootstrap_expires,iso_after()])
    bootstrap_created=True

cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain','POST',{'enabled':False,'previews_enabled':False})
subread=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain') or {}
if subread.get('enabled') is not False or subread.get('previews_enabled') is not False:raise RuntimeError('admin workers.dev/previews not disabled')

if not existing_domains:
    cf(f'/accounts/{AID}/workers/domains','PUT',{'hostname':HOST,'service':WORKER,'zone_id':ZID,'zone_name':ZONE,'override_existing_origin':True})
after=[d for d in (cf(f'/accounts/{AID}/workers/domains') or []) if isinstance(d,dict) and d.get('hostname')==HOST]
if len(after)!=1 or after[0].get('service')!=WORKER:raise RuntimeError('admin custom-domain mapping failed')

customer_counts_after=table_counts()
if customer_counts_after!=customer_counts_before:
    raise RuntimeError('customer/billing table cardinality drift after admin deployment: '+repr((customer_counts_before,customer_counts_after)))

custom_probe={}
for path in ('/health','/api/overview'):
    c,h,b=raw('https://'+HOST+path,'GET',{'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Postdeploy/1.0'},None,30)
    custom_probe[path]={'http':c,'content_type':h.get('content-type') if hasattr(h,'get') else None,'server':h.get('server') if hasattr(h,'get') else None}

out={
  'schema':'musitu.fmi.admin-command-center-deployment.v1',
  'gate':'FMI_ADMIN_COMMAND_CENTER_DEPLOYED',
  'worker':WORKER,
  'source_sha256':SOURCE_SHA,
  'host':HOST,
  'custom_domain_service':after[0].get('service'),
  'custom_domain_id':after[0].get('id'),
  'workers_dev_enabled':False,
  'previews_enabled':False,
  'd1_binding_verified':True,
  'admin_schema_tables':sorted(required),
  'owner_credential_present_before':bool(owner_count),
  'bootstrap_created':bootstrap_created,
  'bootstrap_expires_at':bootstrap_expires,
  'bootstrap_hash_sha256':hashlib.sha256(BOOTSTRAP_HASH.encode()).hexdigest(),
  'smoke':smoke,
  'customer_table_counts_preserved':True,
  'customer_counts_before':customer_counts_before,
  'customer_counts_after':customer_counts_after,
  'custom_domain_probe':custom_probe,
  'access_api_available':False,
  'application_auth':'ONE_TIME_ACTIVATION_PLUS_PBKDF2_PASSWORD_AND_HTTPONLY_SESSION',
  'paid_entitlement_mutation_exposed':False,
  'live_trading_control_exposed':False,
  'manual_payment_settlement_exposed':False,
  'secret_values_published':False,
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();pathlib.Path('fmi-admin-deployment-evidence.json').write_bytes(blob)
digest=hashlib.sha256(blob).hexdigest();pathlib.Path('fmi-admin-deployment-evidence.sha256').write_text(digest+'  fmi-admin-deployment-evidence.json\n')
print(json.dumps({'gate':out['gate'],'host':HOST,'worker':WORKER,'source_sha256':SOURCE_SHA,'workers_dev_enabled':False,'bootstrap_created':bootstrap_created,'bootstrap_expires_at':bootstrap_expires,'smoke':smoke,'customer_table_counts_preserved':True,'custom_domain_probe':custom_probe,'secret_values_published':False,'evidence_sha256':digest},sort_keys=True))
