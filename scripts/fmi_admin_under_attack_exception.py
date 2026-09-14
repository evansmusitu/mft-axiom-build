import json, os, time, urllib.error, urllib.parse, urllib.request

CF_API=os.environ['CF_API'].rstrip('/')
ZONE_ID=os.environ['ZONE_ID']
ADMIN_HOST=os.environ['ADMIN_HOST']
AUTH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Under-Attack-Exception/1.0'}

def raw(url,method='GET',headers=None,body=None,timeout=40):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:return r.status,dict(r.headers.items()),r.read()
    except urllib.error.HTTPError as e:return e.code,dict(e.headers.items()),e.read()
    except Exception as e:return 0,{},type(e).__name__.encode()

def cf(path,method='GET',obj=None):
    h=dict(AUTH); b=None
    if obj is not None:
        h['Content-Type']='application/json'; b=json.dumps(obj,separators=(',',':')).encode()
    c,hh,rawb=raw(CF_API+path,method,h,b)
    try:o=json.loads(rawb or b'{}')
    except Exception:o={}
    if not 200<=c<300:
        raise RuntimeError(f'Cloudflare HTTP {c}: {method} {path}')
    if isinstance(o,dict) and o.get('success') is False:
        raise RuntimeError('Cloudflare success=false: '+path)
    return o.get('result') if isinstance(o,dict) else None

def probe_health(attempts=45,delay=2):
    last=(0,{},b'')
    for _ in range(attempts):
        last=raw('https://'+ADMIN_HOST+'/health',headers={'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Exception-Probe/1.0'})
        if last[0]==200:
            try:o=json.loads(last[2] or b'{}')
            except Exception:o={}
            if o.get('ok') is True and o.get('surface')=='admin':return last[0],last[1],o
        time.sleep(delay)
    try:o=json.loads(last[2] or b'{}')
    except Exception:o={}
    return last[0],last[1],o

rulesets=cf(f'/zones/{ZONE_ID}/rulesets') or []
config=[r for r in rulesets if isinstance(r,dict) and r.get('phase')=='http_config_settings' and r.get('name')=='MFT payments API configuration']
if len(config)!=1:raise RuntimeError(f'expected exactly one canonical config ruleset, found {len(config)}')
rsid=config[0]['id']
full=cf(f'/zones/{ZONE_ID}/rulesets/{rsid}') or {}
rules=full.get('rules') or []

description='MUSITU FMI owner command center: disable browser challenge only on admin hostname; Worker owner auth remains fail-closed'
expression=f'(http.host eq "{ADMIN_HOST}")'
existing=[r for r in rules if isinstance(r,dict) and r.get('description')==description]
created=False
if existing:
    if len(existing)!=1:raise RuntimeError('duplicate FMI admin config exception rules exist')
else:
    templates=[]
    for r in rules:
        if not isinstance(r,dict) or r.get('action')!='set_config':continue
        ap=r.get('action_parameters') or {}
        desc=str(r.get('description') or '')
        if ap.get('security_level')=='essentially_off' and ap.get('bic') is False and ('machine transport' in desc.lower() or 'disable under attack' in desc.lower() or 'disable browser challenge' in desc.lower()):
            templates.append(r)
    if not templates:raise RuntimeError('no established machine-transport config template with security_level=essentially_off and bic=false')
    payload={
      'action':'set_config',
      'action_parameters':{'security_level':'essentially_off','bic':False},
      'expression':expression,
      'description':description,
      'enabled':True,
    }
    cf(f'/zones/{ZONE_ID}/rulesets/{rsid}/rules','POST',payload)
    created=True

# Cloudflare's add-rule endpoint may return the updated ruleset rather than the created rule.
# Re-read canonical state and derive the rule id from the persisted exact description.
full2=cf(f'/zones/{ZONE_ID}/rulesets/{rsid}') or {}
rules2=full2.get('rules') or []
matches=[r for r in rules2 if isinstance(r,dict) and r.get('description')==description]
if len(matches)!=1:raise RuntimeError(f'expected one FMI admin exception after mutation, found {len(matches)}')
r=matches[0]
rule_id=r.get('id')
ap=r.get('action_parameters') or {}
if not rule_id or r.get('action')!='set_config' or r.get('expression')!=expression or ap.get('security_level')!='essentially_off' or ap.get('bic') is not False or r.get('enabled',True) is not True:
    raise RuntimeError('persisted FMI admin exception failed exact verification')

hc,hh,ho=probe_health()
if hc!=200:
    # Roll back only the rule created by this execution. Existing pre-authorized rule state is never deleted.
    if created and rule_id:
        cf(f'/zones/{ZONE_ID}/rulesets/{rsid}/rules/{rule_id}','DELETE')
    mitigated=str(hh.get('cf-mitigated') or hh.get('Cf-Mitigated') or '')
    raise RuntimeError(f'admin health did not clear edge challenge: HTTP {hc}, cf-mitigated={mitigated}')

setting=cf(f'/zones/{ZONE_ID}/settings/security_level') or {}
if setting.get('value')!='under_attack':raise RuntimeError('global Under Attack setting changed unexpectedly')

out={
 'gate':'FMI_ADMIN_UNDER_ATTACK_HOST_EXCEPTION_PASS',
 'host':ADMIN_HOST,
 'global_security_level':'under_attack',
 'ruleset_id':rsid,
 'rule_id':rule_id,
 'rule_created':created,
 'expression':expression,
 'action':'set_config',
 'action_parameters':{'security_level':'essentially_off','bic':False},
 'health_http':hc,
 'worker_health_ok':ho.get('ok') is True,
 'worker_surface':ho.get('surface'),
 'zone_wide_security_lowered':False,
}
print(json.dumps(out,sort_keys=True,separators=(',',':')))
