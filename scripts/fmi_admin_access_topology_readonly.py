import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
HEADERS={
    'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],
    'Accept':'application/json',
    'User-Agent':'MUSITU-FMI-Admin-Access-Topology/1.0',
}

def cf(path):
    req=urllib.request.Request(CF_API+path,headers=HEADERS,method='GET')
    try:
        with urllib.request.urlopen(req,timeout=45) as r:
            raw=r.read(); code=r.status
    except urllib.error.HTTPError as e:
        raw=e.read(); code=e.code
    if code!=200:
        raise RuntimeError(f'Cloudflare GET HTTP {code}: {path}')
    obj=json.loads(raw or b'{}')
    if obj.get('success') is not True:
        raise RuntimeError(f'Cloudflare success=false: {path}')
    return obj.get('result')

apps=cf(f'/accounts/{ACCOUNT_ID}/access/apps?per_page=100') or []
relevant=[]
for app in apps:
    name=str(app.get('name') or '')
    domain=str(app.get('domain') or '')
    if not any(k in (name+' '+domain).lower() for k in ('axiom','admin','mftintelligence','fmi')):
        continue
    app_id=app.get('id')
    policies=[]
    if app_id:
        try:
            ps=cf(f'/accounts/{ACCOUNT_ID}/access/apps/{app_id}/policies?per_page=100') or []
        except Exception:
            ps=[]
        for p in ps:
            # Do not publish identity selectors. Only publish structural metadata.
            policies.append({
                'id':p.get('id'),
                'name':p.get('name'),
                'decision':p.get('decision'),
                'precedence':p.get('precedence'),
                'include_rule_count':len(p.get('include') or []),
                'exclude_rule_count':len(p.get('exclude') or []),
                'require_rule_count':len(p.get('require') or []),
            })
    relevant.append({
        'id':app_id,
        'name':name,
        'domain':domain,
        'type':app.get('type'),
        'session_duration':app.get('session_duration'),
        'auto_redirect_to_identity':app.get('auto_redirect_to_identity'),
        'policy_count':len(policies),
        'policies':policies,
    })

idps=[]
try:
    for p in cf(f'/accounts/{ACCOUNT_ID}/access/identity_providers') or []:
        idps.append({'id':p.get('id'),'name':p.get('name'),'type':p.get('type')})
except Exception:
    pass

out={
    'schema':'musitu.fmi.admin-access-topology-readonly.v1',
    'gate':'FMI_ADMIN_ACCESS_TOPOLOGY_READONLY_PASS',
    'account_id':ACCOUNT_ID,
    'relevant_apps':relevant,
    'identity_providers':idps,
    'mutation_performed':False,
    'identity_selector_values_published':False,
    'secret_values_published':False,
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
open('fmi-admin-access-topology-readonly.json','wb').write(blob)
digest=hashlib.sha256(blob).hexdigest()
open('fmi-admin-access-topology-readonly.sha256','w').write(digest+'  fmi-admin-access-topology-readonly.json\n')
print(json.dumps({
    'gate':out['gate'],
    'relevant_apps':[{'id':x['id'],'name':x['name'],'domain':x['domain'],'type':x['type'],'policy_count':x['policy_count'],'policies':x['policies']} for x in relevant],
    'identity_providers':idps,
    'mutation_performed':False,
    'evidence_sha256':digest,
},sort_keys=True))
