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
    'User-Agent':'MUSITU-FMI-Admin-Public-Edge-Health-Fix/1.0',
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

def cf(path,method='GET',obj=None):
    h=dict(AUTH); body=None
    if obj is not None:
        h['Content-Type']='application/json';body=json.dumps(obj,separators=(',',':')).encode()
    c,_,raw=http_raw(CF_API+path,method,h,body)
    if not 200<=c<300:
        raise RuntimeError(f'Cloudflare HTTP {c}: {method} {path}: '+raw[:180].decode('utf-8','ignore'))
    data=json.loads(raw or b'{}')
    if isinstance(data,dict) and data.get('success') is False:
        raise RuntimeError('Cloudflare success=false: '+path)
    return data.get('result') if isinstance(data,dict) else None

def json_get(url):
    c,h,raw=http_raw(url,headers={'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Public-Edge-Health-Fix/1.0'})
    try:o=json.loads(raw or b'{}')
    except Exception:o={}
    return c,h,o,raw

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

# Prove the reported 404 is a monitor-path mismatch, not a public-edge outage.
healthz_c,_,healthz,healthz_raw=json_get(PUBLIC_BASE+'/healthz')
if healthz_c!=200 or healthz.get('status')!='ok' or healthz.get('authority')!='PAPER_SHADOW_ONLY':
    raise RuntimeError(f'canonical public /healthz is not healthy: HTTP {healthz_c}')
old_c,_,_,_=json_get(PUBLIC_BASE+'/health')
if old_c!=404:
    raise RuntimeError(f'expected obsolete public /health probe to be 404, got HTTP {old_c}')
root_c,_,root_raw=http_raw(PUBLIC_BASE+'/',headers={'Accept':'text/html,*/*','User-Agent':'MUSITU-FMI-Admin-Public-Edge-Health-Fix/1.0'})
if root_c!=200:raise RuntimeError(f'public landing HTTP {root_c}')

admin_base='https://'+ADMIN_HOST
admin_health_c,_,admin_health,_=json_get(admin_base+'/health')
if admin_health_c!=200 or admin_health.get('ok') is not True or admin_health.get('surface')!='admin':
    raise RuntimeError(f'admin worker pre-patch health HTTP {admin_health_c}')
unauth_before,_,unauth_obj,_=json_get(admin_base+'/api/system')
if unauth_before!=401 or unauth_obj.get('error')!='unauthorized':
    raise RuntimeError(f'admin /api/system pre-patch is not fail-closed: HTTP {unauth_before}')

sub_path=f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}/subdomain'
sub_before=cf(sub_path) or {}
if sub_before.get('enabled') is not False or sub_before.get('previews_enabled') is not False:
    raise RuntimeError('workers.dev or previews unexpectedly enabled before patch')

# Reconstruct the already-certified production runtime transforms without any D1 mutation.
src=SOURCE_PATH.read_text()
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

# The only functional change in this repair: use the public edge's canonical health route.
probe_old="env.PUBLIC_BASE + '/health'"
probe_new="env.PUBLIC_BASE + '/healthz'"
if src.count(probe_old)!=1:raise RuntimeError(f'expected exactly one obsolete public health probe, found {src.count(probe_old)}')
src=src.replace(probe_old,probe_new,1)
if probe_old in src or src.count(probe_new)!=1:raise RuntimeError('public health monitor transform failed')

release=src.encode()
release_sha=hashlib.sha256(release).hexdigest()
release_path=pathlib.Path('/tmp/fmi_admin_worker_public_edge_health_fixed.mjs')
release_path.write_bytes(release)
subprocess.run(['node','--check',str(release_path)],check=True)
upload_worker(release)

# Verify bindings and live behavior. This script contains no D1 API query/write calls.
settings=cf(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}/settings') or {}
bind={x.get('name'):x for x in settings.get('bindings') or [] if isinstance(x,dict)}
if bind.get('FMI_DB',{}).get('id')!=DB_ID:raise RuntimeError('FMI_DB binding drift')
if bind.get('ADMIN_HOST',{}).get('text')!=ADMIN_HOST:raise RuntimeError('ADMIN_HOST binding drift')
if bind.get('PUBLIC_BASE',{}).get('text')!=PUBLIC_BASE:raise RuntimeError('PUBLIC_BASE binding drift')

post_health=(0,{})
for _ in range(30):
    c,_,o,_=json_get(admin_base+'/health')
    post_health=(c,o)
    if c==200 and o.get('ok') is True and o.get('surface')=='admin':break
    time.sleep(1)
if post_health[0]!=200:raise RuntimeError(f'admin health post-patch HTTP {post_health[0]}')
unauth_after,_,unauth_obj,_=json_get(admin_base+'/api/system')
if unauth_after!=401 or unauth_obj.get('error')!='unauthorized':
    raise RuntimeError(f'admin /api/system post-patch is not fail-closed: HTTP {unauth_after}')
sub_after=cf(sub_path) or {}
if sub_after.get('enabled') is not False or sub_after.get('previews_enabled') is not False:
    raise RuntimeError('workers.dev or previews opened during patch')

# Read deployed content back to prove the monitor route was actually published.
content_url=f'{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(ADMIN_WORKER,safe="")}/content'
cc,_,content_raw=http_raw(content_url,headers=AUTH,timeout=60)
if cc!=200:raise RuntimeError(f'Worker content readback HTTP {cc}')
if b"env.PUBLIC_BASE + '/healthz'" not in content_raw:raise RuntimeError('deployed content lacks /healthz monitor probe')
if b"env.PUBLIC_BASE + '/health'" in content_raw:raise RuntimeError('deployed content still contains obsolete /health monitor probe')

out={
  'schema':'musitu.fmi.admin-public-edge-health-fix.v1',
  'gate':'FMI_ADMIN_PUBLIC_EDGE_HEALTH_FIX_PASS',
  'host':ADMIN_HOST,
  'worker':ADMIN_WORKER,
  'release_source_sha256':release_sha,
  'diagnosis':{'obsolete_probe':'/health','obsolete_probe_http':old_c,'canonical_probe':'/healthz','canonical_probe_http':healthz_c,'public_authority':healthz.get('authority')},
  'verification':{'public_landing_http':root_c,'admin_health_before_http':admin_health_c,'admin_health_after_http':post_health[0],'unauthenticated_api_system_before_http':unauth_before,'unauthenticated_api_system_after_http':unauth_after,'deployed_content_readback_http':cc},
  'runtime_state_preservation':{'d1_api_calls_performed':False,'owner_credentials_modified':False,'sessions_modified':False,'bootstrap_tokens_modified':False,'customer_rows_modified':False,'billing_rows_modified':False,'workers_dev_enabled':False,'previews_enabled':False},
  'authority':{'paper_shadow_only':True,'live_trading_authorized':False,'manual_paid_entitlement':False,'manual_payment_settlement':False},
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
pathlib.Path('fmi-admin-public-edge-health-fix.json').write_bytes(blob)
digest=hashlib.sha256(blob).hexdigest()
pathlib.Path('fmi-admin-public-edge-health-fix.sha256').write_text(digest+'  fmi-admin-public-edge-health-fix.json\n')
print(json.dumps({'gate':out['gate'],'old_probe_http':old_c,'canonical_health_http':healthz_c,'admin_health_http':post_health[0],'unauthenticated_api_system_http':unauth_after,'release_source_sha256':release_sha,'evidence_sha256':digest,'d1_api_calls_performed':False},sort_keys=True))
