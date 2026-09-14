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

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
DB_ID=os.environ['FMI_DB_UUID']
ADMIN_HOST=os.environ['ADMIN_HOST']
ADMIN_WORKER=os.environ['ADMIN_WORKER']
PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/')
SOURCE_PATH=pathlib.Path('admin/fmi_admin_worker.mjs')
AUTH={
    'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],
    'Accept':'application/json',
    'User-Agent':'MUSITU-FMI-Admin-Public-Edge-Persistent-Fix/1.0',
}

def http_raw(url,method='GET',headers=None,body=None,timeout=45):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:
            return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
    except urllib.error.HTTPError as e:
        return e.code,{k.lower():v for k,v in e.headers.items()},e.read()
    except Exception as e:
        return 0,{},type(e).__name__.encode()

def json_get(url):
    c,h,raw=http_raw(url,headers={'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Public-Edge-Persistent-Fix/1.0'})
    try:o=json.loads(raw or b'{}')
    except Exception:o={}
    return c,h,o,raw

def cf_json(path):
    c,_,raw=http_raw(CF_API+path,headers=AUTH,timeout=60)
    if not 200<=c<300:
        raise RuntimeError(f'Cloudflare HTTP {c}: GET {path}: '+raw[:200].decode('utf-8','ignore'))
    data=json.loads(raw or b'{}')
    if isinstance(data,dict) and data.get('success') is False:
        raise RuntimeError('Cloudflare success=false: '+path)
    return data.get('result') if isinstance(data,dict) else None

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
    h=dict(AUTH);h['Content-Type']='multipart/form-data; boundary='+boundary
    c,_,raw=http_raw(f'{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}', 'PUT', h, b''.join(parts), 60)
    if not 200<=c<300:
        raise RuntimeError(f'Worker upload HTTP {c}: '+raw[:220].decode('utf-8','ignore'))

src=SOURCE_PATH.read_text()
if "env.PUBLIC_BASE + '/health'" in src:
    raise RuntimeError('canonical source still contains obsolete /health public probe')
if src.count("env.PUBLIC_BASE + '/healthz'")!=1:
    raise RuntimeError('canonical source must contain exactly one /healthz public probe')
if src.count("url.pathname === '/health/public-edge'")!=1:
    raise RuntimeError('canonical source missing public-edge diagnostic route')
if src.count("/api/system?ts='+Date.now()")!=1:
    raise RuntimeError('canonical UI missing cache-busted system request')

# Apply the already-certified production runtime transforms; no D1 mutation is performed here.
if src.count("const PBKDF2_ITERATIONS = 120000;")!=1:raise RuntimeError('PBKDF2 source invariant missing')
src=src.replace("const PBKDF2_ITERATIONS = 120000;","const PBKDF2_ITERATIONS = 60000;",1)
old_batch="""  await env.FMI_DB.batch([
    env.FMI_DB.prepare('INSERT INTO fmi_admin_credentials(principal,password_salt,password_hash,pbkdf2_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind('owner', b64url(salt), b64url(derived), PBKDF2_ITERATIONS, now, now),
    env.FMI_DB.prepare('UPDATE fmi_admin_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').bind(now, hash),
  ]);"""
new_batch="""  await dbRun(env, 'INSERT INTO fmi_admin_credentials(principal,password_salt,password_hash,pbkdf2_iterations,created_at,updated_at) VALUES(?,?,?,?,?,?)', 'owner', b64url(salt), b64url(derived), PBKDF2_ITERATIONS, now, now);
  await dbRun(env, 'UPDATE fmi_admin_bootstrap_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL', now, hash);"""
if src.count(old_batch)!=1:raise RuntimeError('activation batch invariant missing')
src=src.replace(old_batch,new_batch,1)
route_old="if (path === '/api/customer/status' && request.method === 'POST') return await mutateCustomerStatus(request, env, principal);"
route_new="if (path === '/api/customer/status' && request.method === 'POST') return json({ ok: false, error: 'customer_status_mutation_not_supported' }, 409);"
if src.count(route_old)!=1:raise RuntimeError('customer-status route invariant missing')
src=src.replace(route_old,route_new,1)
copy_old='Search, inspect, disable/reactivate, or revoke customer API keys.'
if src.count(copy_old)!=1:raise RuntimeError('customer copy invariant missing')
src=src.replace(copy_old,'Search, inspect customer accounts, or revoke API keys.',1)
css_anchor='button:disabled{opacity:.5;cursor:not-allowed}'
if src.count(css_anchor)!=1:raise RuntimeError('CSS invariant missing')
src=src.replace(css_anchor,css_anchor+'[data-status]{display:none!important}',1)
release=src.encode()
release_sha=hashlib.sha256(release).hexdigest()
release_path=pathlib.Path('/tmp/fmi_admin_worker_public_edge_persistent.mjs')
release_path.write_bytes(release)
subprocess.run(['node','--check',str(release_path)],check=True)

# Prove public customer edge before deployment.
hc,_,health,_=json_get(PUBLIC_BASE+'/healthz')
if hc!=200 or health.get('status')!='ok' or health.get('authority')!='PAPER_SHADOW_ONLY':
    raise RuntimeError(f'canonical public /healthz unhealthy: HTTP {hc}')

upload_worker(release)

# Verify bindings remained exact.
settings=cf_json(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}/settings') or {}
bind={x.get('name'):x for x in settings.get('bindings') or [] if isinstance(x,dict)}
if bind.get('FMI_DB',{}).get('id')!=DB_ID:raise RuntimeError('FMI_DB binding drift')
if bind.get('ADMIN_HOST',{}).get('text')!=ADMIN_HOST:raise RuntimeError('ADMIN_HOST binding drift')
if bind.get('PUBLIC_BASE',{}).get('text')!=PUBLIC_BASE:raise RuntimeError('PUBLIC_BASE binding drift')
sub=cf_json(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}/subdomain') or {}
if sub.get('enabled') is not False or sub.get('previews_enabled') is not False:
    raise RuntimeError('workers.dev or previews unexpectedly enabled')

admin='https://'+ADMIN_HOST
admin_h=(0,{})
diag=(0,{})
for _ in range(30):
    ac,_,ao,_=json_get(admin+'/health')
    dc,_,do,_=json_get(admin+'/health/public-edge?ts='+str(int(time.time()*1000)))
    admin_h=(ac,ao);diag=(dc,do)
    pe=(do or {}).get('public_edge') or {}
    if ac==200 and ao.get('ok') is True and dc==200 and pe.get('ok') is True and pe.get('status')==200:
        break
    time.sleep(1)
if admin_h[0]!=200 or admin_h[1].get('ok') is not True:raise RuntimeError(f'admin health HTTP {admin_h[0]}')
pe=(diag[1] or {}).get('public_edge') or {}
if diag[0]!=200 or pe.get('ok') is not True or pe.get('status')!=200:
    raise RuntimeError(f'admin Worker-to-public-edge diagnostic failed: HTTP {diag[0]} edge={pe}')
if ((pe.get('body') or {}).get('status')!='ok' or (pe.get('body') or {}).get('authority')!='PAPER_SHADOW_ONLY'):
    raise RuntimeError('admin Worker received unexpected public health body')
unauth,_,uo,_=json_get(admin+'/api/system?ts='+str(int(time.time()*1000)))
if unauth!=401 or uo.get('error')!='unauthorized':raise RuntimeError(f'/api/system is not fail-closed: HTTP {unauth}')

# Read deployed content using current Cloudflare content endpoint.
content_url=f'{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}/content/v2'
cc,_,content=http_raw(content_url,headers=AUTH,timeout=60)
if cc!=200:raise RuntimeError(f'Worker content v2 readback HTTP {cc}')
if b"env.PUBLIC_BASE + '/healthz'" not in content:raise RuntimeError('deployed content lacks /healthz probe')
if b"env.PUBLIC_BASE + '/health'" in content:raise RuntimeError('deployed content contains obsolete /health probe')
if b"url.pathname === '/health/public-edge'" not in content:raise RuntimeError('deployed content lacks diagnostic route')

out={
  'schema':'musitu.fmi.admin-public-edge-persistent-fix.v1',
  'gate':'FMI_ADMIN_PUBLIC_EDGE_PERSISTENT_FIX_PASS',
  'admin_host':ADMIN_HOST,
  'worker':ADMIN_WORKER,
  'release_source_sha256':release_sha,
  'canonical_public_health_http':hc,
  'admin_health_http':admin_h[0],
  'admin_worker_to_public_edge_http':pe.get('status'),
  'admin_public_edge_diagnostic_http':diag[0],
  'unauthenticated_api_system_http':unauth,
  'content_v2_http':cc,
  'public_authority':(pe.get('body') or {}).get('authority'),
  'runtime_state_preservation':{
    'd1_api_calls_performed':False,
    'owner_credentials_modified':False,
    'sessions_modified':False,
    'bootstrap_tokens_modified':False,
    'customer_rows_modified':False,
    'billing_rows_modified':False,
    'workers_dev_enabled':False,
    'previews_enabled':False,
  },
  'authority':{'authority':'PAPER_SHADOW_ONLY','live_trading_authorized':False,'manual_paid_entitlement':False,'manual_payment_settlement':False},
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
pathlib.Path('fmi-admin-public-edge-persistent-fix.json').write_bytes(blob)
digest=hashlib.sha256(blob).hexdigest()
pathlib.Path('fmi-admin-public-edge-persistent-fix.sha256').write_text(digest+'  fmi-admin-public-edge-persistent-fix.json\n')
print(json.dumps({'gate':out['gate'],'canonical_public_health_http':hc,'admin_worker_to_public_edge_http':pe.get('status'),'admin_public_edge_diagnostic_http':diag[0],'admin_health_http':admin_h[0],'unauthenticated_api_system_http':unauth,'content_v2_http':cc,'release_source_sha256':release_sha,'evidence_sha256':digest,'d1_api_calls_performed':False},sort_keys=True))
