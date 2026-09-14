import hashlib
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
DB_ID=os.environ['FMI_DB_UUID']
ADMIN_HOST=os.environ['ADMIN_HOST']
ADMIN_WORKER=os.environ['ADMIN_WORKER']
PUBLIC_BASE=os.environ['PUBLIC_BASE'].rstrip('/')
AUTH={
    'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],
    'Accept':'application/json',
    'User-Agent':'MUSITU-FMI-Admin-Public-Edge-Health-Verify/2.0',
}

def raw(url,headers=None,timeout=45):
    req=urllib.request.Request(url,headers=dict(headers or {}),method='GET')
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:return r.status,{k.lower():v for k,v in r.headers.items()},r.read()
    except urllib.error.HTTPError as e:return e.code,{k.lower():v for k,v in e.headers.items()},e.read()
    except Exception as e:return 0,{},type(e).__name__.encode()

def json_get(url,headers=None):
    c,h,b=raw(url,headers or {'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Public-Edge-Health-Verify/2.0'})
    try:o=json.loads(b or b'{}')
    except Exception:o={}
    return c,h,o,b

def cf_json(path):
    c,_,b=raw(CF_API+path,AUTH)
    if c!=200:raise RuntimeError(f'Cloudflare GET {path} HTTP {c}')
    o=json.loads(b or b'{}')
    if o.get('success') is False:raise RuntimeError('Cloudflare success=false: '+path)
    return o.get('result')

healthz_c,_,healthz,_=json_get(PUBLIC_BASE+'/healthz')
if healthz_c!=200 or healthz.get('status')!='ok' or healthz.get('authority')!='PAPER_SHADOW_ONLY':
    raise RuntimeError(f'canonical public health failed HTTP {healthz_c}')
old_c,_,_,_=json_get(PUBLIC_BASE+'/health')
if old_c!=404:raise RuntimeError(f'obsolete /health expected 404, got {old_c}')
root_c,_,_=raw(PUBLIC_BASE+'/',{'Accept':'text/html,*/*','User-Agent':'MUSITU-FMI-Admin-Public-Edge-Health-Verify/2.0'})
if root_c!=200:raise RuntimeError(f'public landing HTTP {root_c}')

base='https://'+ADMIN_HOST
admin_c,_,admin,_=json_get(base+'/health')
if admin_c!=200 or admin.get('ok') is not True or admin.get('surface')!='admin':
    raise RuntimeError(f'admin health HTTP {admin_c}')
system_c,_,system,_=json_get(base+'/api/system')
if system_c!=401 or system.get('error')!='unauthorized':
    raise RuntimeError(f'unauthenticated /api/system not fail-closed: HTTP {system_c}')

quoted=urllib.parse.quote(ADMIN_WORKER,safe='')
sub=cf_json(f'/accounts/{ACCOUNT_ID}/workers/scripts/{quoted}/subdomain') or {}
if sub.get('enabled') is not False or sub.get('previews_enabled') is not False:
    raise RuntimeError('workers.dev or previews unexpectedly enabled')
settings=cf_json(f'/accounts/{ACCOUNT_ID}/workers/scripts/{quoted}/settings') or {}
bind={x.get('name'):x for x in settings.get('bindings') or [] if isinstance(x,dict)}
if bind.get('FMI_DB',{}).get('id')!=DB_ID:raise RuntimeError('FMI_DB binding drift')
if bind.get('ADMIN_HOST',{}).get('text')!=ADMIN_HOST:raise RuntimeError('ADMIN_HOST binding drift')
if bind.get('PUBLIC_BASE',{}).get('text')!=PUBLIC_BASE:raise RuntimeError('PUBLIC_BASE binding drift')

# Cloudflare's current supported script-content readback endpoint is /content/v2.
content_headers=dict(AUTH);content_headers['Accept']='*/*'
content_c,_,content=raw(f'{CF_API}/accounts/{ACCOUNT_ID}/workers/scripts/{quoted}/content/v2',content_headers,60)
if content_c!=200:raise RuntimeError(f'Worker content/v2 readback HTTP {content_c}')
new_marker=b"env.PUBLIC_BASE + '/healthz'"
old_marker=b"env.PUBLIC_BASE + '/health'"
if new_marker not in content:raise RuntimeError('deployed Worker lacks canonical /healthz monitor probe')
if old_marker in content:raise RuntimeError('deployed Worker still contains obsolete /health monitor probe')

out={
  'schema':'musitu.fmi.admin-public-edge-health-fix-verification.v2',
  'gate':'FMI_ADMIN_PUBLIC_EDGE_HEALTH_FIX_PASS',
  'host':ADMIN_HOST,
  'worker':ADMIN_WORKER,
  'diagnosis':{'obsolete_probe':'/health','obsolete_probe_http':old_c,'canonical_probe':'/healthz','canonical_probe_http':healthz_c,'public_status':healthz.get('status'),'public_authority':healthz.get('authority')},
  'verification':{'public_landing_http':root_c,'admin_health_http':admin_c,'unauthenticated_api_system_http':system_c,'deployed_content_v2_readback_http':content_c,'deployed_probe_is_healthz':True},
  'runtime_state_preservation':{'mutation_performed_by_verifier':False,'d1_api_calls_performed':False,'owner_credentials_modified':False,'sessions_modified':False,'bootstrap_tokens_modified':False,'customer_rows_modified':False,'billing_rows_modified':False,'workers_dev_enabled':False,'previews_enabled':False},
  'authority':{'authority':'PAPER_SHADOW_ONLY','live_trading_authorized':False,'manual_paid_entitlement':False,'manual_payment_settlement':False},
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
pathlib.Path('fmi-admin-public-edge-health-fix-v2.json').write_bytes(blob)
digest=hashlib.sha256(blob).hexdigest()
pathlib.Path('fmi-admin-public-edge-health-fix-v2.sha256').write_text(digest+'  fmi-admin-public-edge-health-fix-v2.json\n')
print(json.dumps({'gate':out['gate'],'obsolete_probe_http':old_c,'canonical_health_http':healthz_c,'admin_health_http':admin_c,'unauthenticated_api_system_http':system_c,'content_v2_http':content_c,'evidence_sha256':digest,'mutation_performed':False},sort_keys=True))
