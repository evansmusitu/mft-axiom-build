import datetime
import hashlib
import json
import os
import pathlib
import re
import secrets
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
ZONE_ID=os.environ['ZONE_ID']
ZONE_NAME=os.environ['ZONE_NAME']
DB_ID=os.environ['FMI_DB_UUID']
ADMIN_HOST=os.environ['ADMIN_HOST']
ADMIN_WORKER=os.environ['ADMIN_WORKER']
PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/')
REAL_BOOTSTRAP_HASH=os.environ['BOOTSTRAP_HASH']
SOURCE_PATH=pathlib.Path('admin/fmi_admin_worker.mjs')

CF_HEADERS={
    'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],
    'Accept':'application/json',
    'User-Agent':'MUSITU-FMI-Admin-Finalize/1.0',
}

def iso_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')

def iso_after(hours=0, minutes=0):
    return (datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=hours,minutes=minutes)).isoformat().replace('+00:00','Z')

def http_raw(url, method='GET', headers=None, body=None, timeout=45):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:
        return e.code,e.headers,e.read()
    except urllib.error.URLError as e:
        return 0,{},type(e).__name__.encode()

def cf(path, method='GET', obj=None):
    h=dict(CF_HEADERS); body=None
    if obj is not None:
        h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,_,raw=http_raw(CF_API+path,method,h,body)
    if not 200<=c<300:
        raise RuntimeError(f'Cloudflare HTTP {c}: {method} {path}')
    data=json.loads(raw or b'{}')
    if isinstance(data,dict) and data.get('success') is False:
        raise RuntimeError('Cloudflare success=false: '+path)
    return data.get('result') if isinstance(data,dict) else None

def d1(sql, params=None):
    payload={'sql':sql}
    if params is not None:payload['params']=params
    rr=cf(f'/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query','POST',payload) or []
    if not rr or not all(x.get('success') is True for x in rr):
        raise RuntimeError('D1 query failed')
    rows=[]
    for x in rr:rows.extend(x.get('results') or [])
    return rows

def one(sql, params=None):
    rows=d1(sql,params)
    if len(rows)!=1:raise RuntimeError(f'D1 cardinality mismatch: {len(rows)}')
    return rows[0]

def json_http(url, method='GET', obj=None, headers=None):
    h={'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Finalize-E2E/1.0'}
    if headers:h.update(headers)
    body=None
    if obj is not None:
        h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,hh,raw=http_raw(url,method,h,body,45)
    try:data=json.loads(raw or b'{}')
    except Exception:data={}
    return c,hh,data

def wait_json(url, expected=200, attempts=60, delay=2, headers=None):
    last=(0,{},{} )
    for _ in range(attempts):
        last=json_http(url,headers=headers)
        if last[0]==expected:return last
        time.sleep(delay)
    return last

def upload_worker(source):
    boundary='----MUSITU'+secrets.token_hex(18)
    metadata={'main_module':'index.mjs','compatibility_date':'2026-09-14','bindings':[
        {'type':'d1','name':'FMI_DB','id':DB_ID},
        {'type':'plain_text','name':'ADMIN_HOST','text':ADMIN_HOST},
        {'type':'plain_text','name':'PUBLIC_BASE','text':PUBLIC_BASE},
    ]}
    parts=[]
    def add(x):parts.append(x.encode() if isinstance(x,str) else x)
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n')
    add(json.dumps(metadata,separators=(',',':')));add('\r\n')
    add(f'--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n')
    add(source);add('\r\n');add(f'--{boundary}--\r\n')
    h=dict(CF_HEADERS);h['Content-Type']='multipart/form-data; boundary='+boundary
    c,_,raw=http_raw(f'{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}', 'PUT', h, b''.join(parts), 60)
    if not 200<=c<300:raise RuntimeError(f'admin Worker upload HTTP {c}: '+raw[:250].decode('utf-8','ignore'))

def counts():
    names=['customers','api_keys','lifecycle_events','billing_checkout_intents','billing_subscriptions','usage_events']
    return {n:int(one(f'SELECT COUNT(*) AS n FROM {n}')['n']) for n in names}

def admin_counts():
    names=['fmi_admin_credentials','fmi_admin_bootstrap_tokens','fmi_admin_sessions','fmi_admin_audit_events','fmi_admin_login_events']
    return {n:int(one(f'SELECT COUNT(*) AS n FROM {n}')['n']) for n in names}

# 1. Authority/topology checks.
zones=cf('/zones?name='+urllib.parse.quote(ZONE_NAME)+'&status=active') or []
if len(zones)!=1 or zones[0].get('id')!=ZONE_ID or (zones[0].get('account') or {}).get('id')!=ACCOUNT_ID:
    raise RuntimeError('canonical zone/account mismatch')
domains=cf(f'/accounts/{ACCOUNT_ID}/workers/domains') or []
admin_domains=[d for d in domains if isinstance(d,dict) and d.get('hostname')==ADMIN_HOST]
if len(admin_domains)!=1 or admin_domains[0].get('service')!=ADMIN_WORKER:
    raise RuntimeError('admin custom-domain mapping is not exact')
sub_path=f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}/subdomain'
cf(sub_path,'POST',{'enabled':False,'previews_enabled':False})
sub=cf(sub_path) or {}
if sub.get('enabled') is not False or sub.get('previews_enabled') is not False:
    raise RuntimeError('workers.dev or previews remain enabled')

# 2. Compile a release source that follows the production customer-status contract.
src=SOURCE_PATH.read_text()
if 'const PBKDF2_ITERATIONS = 120000;' not in src:raise RuntimeError('PBKDF2 source invariant missing')
src=src.replace('const PBKDF2_ITERATIONS = 120000;','const PBKDF2_ITERATIONS = 60000;',1)
old_batch="""  await env.FMI_DB.batch([
    env.FMI_DB.prepare('INSERT INTO fmi_admin_credentials(principal,password_salt,password_hash,pbkdf2_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('owner', b64url(salt), b64url(derived), PBKDF2_ITERATIONS, now, now),
    env.FMI_DB.prepare('UPDATE fmi_admin_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').bind(now, hash),
  ]);"""
new_batch="""  await dbRun(env, 'INSERT INTO fmi_admin_credentials(principal,password_salt,password_hash,pbkdf2_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?)', 'owner', b64url(salt), b64url(derived), PBKDF2_ITERATIONS, now, now);
  await dbRun(env, 'UPDATE fmi_admin_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL', now, hash);"""
if old_batch not in src:raise RuntimeError('activation batch invariant missing')
src=src.replace(old_batch,new_batch,1)
route_old="if (path === '/api/customer/status' && request.method === 'POST') return await mutateCustomerStatus(request, env, principal);"
route_new="if (path === '/api/customer/status' && request.method === 'POST') return json({ ok: false, error: 'customer_status_mutation_not_supported' }, 409);"
if route_old not in src:raise RuntimeError('customer-status route invariant missing')
src=src.replace(route_old,route_new,1)
src=src.replace('Search, inspect, disable/reactivate, or revoke customer API keys.','Search, inspect customer accounts, or revoke API keys.',1)
# Hide legacy status controls even if an older browser script path renders one; server also rejects the route.
css_anchor='button:disabled{opacity:.5;cursor:not-allowed}'
if css_anchor not in src:raise RuntimeError('CSS invariant missing')
src=src.replace(css_anchor,css_anchor+'[data-status]{display:none!important}',1)
release=src.encode()
release_sha=hashlib.sha256(release).hexdigest()
release_path=pathlib.Path('/tmp/fmi_admin_worker_final.mjs');release_path.write_bytes(release)
subprocess.run(['node','--check',str(release_path)],check=True,stdout=subprocess.DEVNULL)
upload_worker(release)
settings=cf(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}/settings') or {}
bind={x.get('name'):x for x in settings.get('bindings') or [] if isinstance(x,dict)}
if bind.get('FMI_DB',{}).get('id')!=DB_ID:raise RuntimeError('admin D1 binding mismatch')
if bind.get('ADMIN_HOST',{}).get('text')!=ADMIN_HOST:raise RuntimeError('admin host binding mismatch')
if bind.get('PUBLIC_BASE',{}).get('text')!=PUBLIC_BASE:raise RuntimeError('public-base binding mismatch')

# 3. Remove only known deployment-smoke state, preserving real customer state.
synthetic_before=int(one("SELECT COUNT(*) AS n FROM customers WHERE email LIKE 'admin-e2e-%@example.invalid'")['n'])
if synthetic_before:
    d1("DELETE FROM customers WHERE email LIKE 'admin-e2e-%@example.invalid'")
if int(one("SELECT COUNT(*) AS n FROM customers WHERE email LIKE 'admin-e2e-%@example.invalid'")['n'])!=0:
    raise RuntimeError('synthetic customer cleanup incomplete')
for t in ('fmi_admin_sessions','fmi_admin_credentials','fmi_admin_bootstrap_tokens','fmi_admin_audit_events','fmi_admin_login_events'):
    d1(f'DELETE FROM {t}')
if any(admin_counts().values()):raise RuntimeError('admin smoke cleanup incomplete')
baseline=counts()

# 4. Wait for the custom domain and prove unauthenticated admission is fail-closed.
base='https://'+ADMIN_HOST
hc,_,ho=wait_json(base+'/health',200,60,2)
if hc!=200 or ho.get('ok') is not True or ho.get('surface')!='admin':
    raise RuntimeError(f'admin custom-domain health failed HTTP {hc}')
sc,_,so=wait_json(base+'/api/session',200,30,2)
if sc!=200 or so.get('activated') is not False or so.get('authenticated') is not False:
    raise RuntimeError('pre-activation session state is not closed')
unauth={}
for p in ('/api/overview','/api/customers','/api/revenue','/api/usage','/api/system','/api/audit'):
    c,_,o=json_http(base+p)
    if c!=401 or o.get('error')!='unauthorized':raise RuntimeError(f'unauthenticated route {p} not closed: HTTP {c}')
    unauth[p]=c
status_c,_,status_o=json_http(base+'/api/customer/status','POST',{'customer_id':'probe','status':'disabled'},{'Origin':base})
# Authentication must be checked before unsupported mutation semantics are exposed.
if status_c!=401:raise RuntimeError(f'unauthenticated status route not closed: HTTP {status_c}')

# 5. Temporary owner activation over the real custom domain.
smoke_code='smoke_'+secrets.token_urlsafe(36)
smoke_password='Smoke!'+secrets.token_urlsafe(30)+'7'
print('::add-mask::'+smoke_code);print('::add-mask::'+smoke_password)
smoke_hash=hashlib.sha256(smoke_code.encode()).hexdigest()
d1('INSERT INTO fmi_admin_bootstrap_tokens(token_hash,expires_at,created_at,used_at) VALUES(?1,?2,?3,NULL)',[smoke_hash,iso_after(minutes=20),iso_now()])
ac,ah,ao=json_http(base+'/api/activate','POST',{'code':smoke_code,'password':smoke_password},{'Origin':base})
if ac!=200 or ao.get('ok') is not True:raise RuntimeError(f'custom-domain activation smoke failed HTTP {ac}')
set_cookie=ah.get('Set-Cookie') or ah.get('set-cookie') or ''
cookie=set_cookie.split(';',1)[0]
if not cookie.startswith('__Host-fmi_admin_session='):raise RuntimeError('secure admin session cookie missing')
auth={'Cookie':cookie,'Origin':base}
protected={}
for p in ('/api/overview','/api/customers','/api/revenue','/api/usage','/api/system','/api/audit'):
    c,_,_=json_http(base+p,headers=auth)
    if c!=200:raise RuntimeError(f'protected route {p} HTTP {c}')
    protected[p]=c
# Status mutation is intentionally unsupported even for authenticated owner.
uc,_,uo=json_http(base+'/api/customer/status','POST',{'customer_id':'probe','status':'disabled'},auth)
if uc!=409 or uo.get('error')!='customer_status_mutation_not_supported':
    raise RuntimeError(f'customer status mutation did not fail closed: HTTP {uc}')
# Prove sign-out and permanent-password sign-in.
loc,lh,lo=json_http(base+'/api/logout','POST',{},auth)
if loc!=200 or lo.get('ok') is not True:raise RuntimeError('admin logout smoke failed')
lc,lh,lo=json_http(base+'/api/login','POST',{'password':smoke_password},{'Origin':base})
if lc!=200 or lo.get('ok') is not True:raise RuntimeError(f'admin password login smoke failed HTTP {lc}')
login_cookie=(lh.get('Set-Cookie') or lh.get('set-cookie') or '').split(';',1)[0]
if not login_cookie.startswith('__Host-fmi_admin_session='):raise RuntimeError('login session cookie missing')
auth={'Cookie':login_cookie,'Origin':base}

# 6. Disposable real customer + safe revocation control E2E.
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
email_value=f'admin-e2e-{stamp}-{secrets.token_hex(8)}@example.invalid'
print('::add-mask::'+email_value)
sign_c,_,sign_o=json_http(PUBLIC_BASE+'/v1/signup','POST',{'email':email_value,'name':'MUSITU FMI Admin E2E','plan':'FREE'})
if sign_c not in (200,201):raise RuntimeError(f'synthetic customer signup HTTP {sign_c}')
raw_key=None
for k in ('api_key','key','token'):
    if isinstance(sign_o.get(k),str) and sign_o.get(k):raw_key=sign_o[k];break
if not raw_key:raise RuntimeError('synthetic customer API key missing')
print('::add-mask::'+raw_key)
rows=d1('SELECT id,plan,status FROM customers WHERE email=?1',[email_value])
if len(rows)!=1:raise RuntimeError('synthetic customer cardinality mismatch')
cid=str(rows[0].get('id') or '')
print('::add-mask::'+cid)
if str(rows[0].get('plan')).upper()!='FREE' or rows[0].get('status')!='active':raise RuntimeError('synthetic baseline mismatch')
bearer={'Authorization':'Bearer '+raw_key,'Accept':'application/json'}
me_before,_,_=json_http(PUBLIC_BASE+'/v1/me',headers=bearer)
if me_before!=200:raise RuntimeError('synthetic customer key baseline failed')
rev_c,_,rev_o=json_http(base+'/api/customer/revoke-keys','POST',{'customer_id':cid},auth)
if rev_c!=200 or int(rev_o.get('revoked_count') or 0)<1:raise RuntimeError(f'admin revoke-key E2E failed HTTP {rev_c}')
me_after,_,_=json_http(PUBLIC_BASE+'/v1/me',headers=bearer)
if me_after==200:raise RuntimeError('revoked customer API key still accepted')
if int(one('SELECT COUNT(*) AS n FROM billing_checkout_intents WHERE customer_id=?1',[cid])['n'])!=0:raise RuntimeError('synthetic customer unexpectedly has checkout intent')
if int(one('SELECT COUNT(*) AS n FROM billing_subscriptions WHERE customer_id=?1',[cid])['n'])!=0:raise RuntimeError('synthetic customer unexpectedly has subscription')
if int(one("SELECT COUNT(*) AS n FROM lifecycle_events WHERE customer_id=?1 AND event_name='PLAN_ACTIVATED'",[cid])['n'])!=0:raise RuntimeError('synthetic customer unexpectedly has PLAN_ACTIVATED')
d1('DELETE FROM customers WHERE id=?1 AND email=?2',[cid,email_value])
if int(one('SELECT COUNT(*) AS n FROM customers WHERE email=?1',[email_value])['n'])!=0:raise RuntimeError('synthetic customer cleanup failed')
if counts()!=baseline:raise RuntimeError('customer/billing cardinality drift after disposable admin E2E')

# 7. Remove all smoke owner material and install the real one-time activation hash.
for t in ('fmi_admin_sessions','fmi_admin_credentials','fmi_admin_bootstrap_tokens','fmi_admin_audit_events','fmi_admin_login_events'):
    d1(f'DELETE FROM {t}')
real_expires=iso_after(hours=24)
d1('INSERT INTO fmi_admin_bootstrap_tokens(token_hash,expires_at,created_at,used_at) VALUES(?1,?2,?3,NULL)',[REAL_BOOTSTRAP_HASH,real_expires,iso_now()])
if int(one("SELECT COUNT(*) AS n FROM fmi_admin_credentials WHERE principal='owner'")['n'])!=0:raise RuntimeError('owner credential must be absent before real activation')
if int(one('SELECT COUNT(*) AS n FROM fmi_admin_sessions')['n'])!=0:raise RuntimeError('admin sessions must be empty before real activation')
unused=one('SELECT COUNT(*) AS n FROM fmi_admin_bootstrap_tokens WHERE used_at IS NULL AND expires_at>?1',[iso_now()])
if int(unused['n'])!=1:raise RuntimeError('expected exactly one unused real bootstrap token')
if int(one("SELECT COUNT(*) AS n FROM customers WHERE email LIKE 'admin-e2e-%@example.invalid'")['n'])!=0:raise RuntimeError('synthetic customer residue remains')
if counts()!=baseline:raise RuntimeError('final customer/billing cardinality drift')
# Verify real activation landing state through custom domain.
fc,_,fo=wait_json(base+'/api/session',200,30,2)
if fc!=200 or fo.get('activated') is not False or fo.get('authenticated') is not False:
    raise RuntimeError('final owner activation landing state invalid')
# UI assets must be browser-usable.
assets={}
for p in ('/','/admin.css','/admin.js','/health'):
    c,h,b=http_raw(base+p,'GET',{'User-Agent':'MUSITU-FMI-Admin-Finalize/1.0','Accept':'*/*'})
    if c!=200:raise RuntimeError(f'admin UI asset {p} HTTP {c}')
    assets[p]={'http':c,'content_type':h.get('content-type') if hasattr(h,'get') else None,'bytes':len(b)}
# Keep workers.dev and previews shut.
sub=cf(sub_path) or {}
if sub.get('enabled') is not False or sub.get('previews_enabled') is not False:raise RuntimeError('workers.dev reopened unexpectedly')

final_admin_counts=admin_counts()
out={
    'schema':'musitu.fmi.admin-command-center-finalization.v1',
    'gate':'FMI_ADMIN_COMMAND_CENTER_READY',
    'recorded_at':iso_now(),
    'host':ADMIN_HOST,
    'worker':ADMIN_WORKER,
    'release_source_sha256':release_sha,
    'custom_domain_service':admin_domains[0].get('service'),
    'custom_domain_id':admin_domains[0].get('id'),
    'workers_dev_enabled':False,
    'previews_enabled':False,
    'authentication':{
        'mode':'ONE_TIME_ACTIVATION_PLUS_PBKDF2_SHA256_PASSWORD_HTTPONLY_SESSION',
        'pbkdf2_iterations':60000,
        'session_cookie':'__Host-fmi_admin_session',
        'real_activation_ready':True,
        'real_activation_expires_at':real_expires,
        'owner_credentials_before_activation':0,
        'unused_activation_token_count':1,
    },
    'e2e':{
        'health_http':hc,
        'pre_activation_session_http':sc,
        'unauthenticated_protected_routes':unauth,
        'temporary_activation_http':ac,
        'password_login_http':lc,
        'protected_routes':protected,
        'status_mutation_http':uc,
        'status_mutation_error':'customer_status_mutation_not_supported',
        'synthetic_signup_http':sign_c,
        'customer_me_before_revoke_http':me_before,
        'revoke_keys_http':rev_c,
        'customer_me_after_revoke_http':me_after,
        'synthetic_customer_cleanup':True,
        'customer_billing_cardinality_preserved':True,
    },
    'assets':assets,
    'controls':{
        'customer_view':True,
        'customer_search':True,
        'api_key_revocation':True,
        'customer_status_mutation':False,
        'manual_paid_entitlement':False,
        'manual_payment_settlement':False,
        'live_trading':False,
    },
    'admin_table_counts':final_admin_counts,
    'synthetic_rows_removed_before_finalize':synthetic_before,
    'secret_values_published':False,
    'raw_customer_identifiers_published':False,
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
pathlib.Path('fmi-admin-finalization-evidence.json').write_bytes(blob)
digest=hashlib.sha256(blob).hexdigest()
pathlib.Path('fmi-admin-finalization-evidence.sha256').write_text(digest+'  fmi-admin-finalization-evidence.json\n')
print(json.dumps({
    'gate':out['gate'],'host':ADMIN_HOST,'worker':ADMIN_WORKER,'release_source_sha256':release_sha,
    'real_activation_ready':True,'real_activation_expires_at':real_expires,
    'workers_dev_enabled':False,'previews_enabled':False,'protected_routes':protected,
    'status_mutation_http':uc,'revoke_keys_http':rev_c,'customer_me_before_revoke_http':me_before,
    'customer_me_after_revoke_http':me_after,'customer_billing_cardinality_preserved':True,
    'admin_table_counts':final_admin_counts,'secret_values_published':False,'evidence_sha256':digest
},sort_keys=True))
