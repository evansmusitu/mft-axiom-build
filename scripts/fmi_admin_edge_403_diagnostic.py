import hashlib, json, os, re, urllib.error, urllib.parse, urllib.request

CF_API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
ZONE_ID=os.environ['ZONE_ID']
ADMIN_HOST=os.environ['ADMIN_HOST']
ADMIN_WORKER=os.environ['ADMIN_WORKER']
AUTH={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Edge-Diagnostic/1.0'}

def raw(url,method='GET',headers=None,body=None,timeout=35):
    req=urllib.request.Request(url,headers=dict(headers or {}),method=method,data=body)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as r:return r.status,dict(r.headers.items()),r.read()
    except urllib.error.HTTPError as e:return e.code,dict(e.headers.items()),e.read()
    except Exception as e:return 0,{},type(e).__name__.encode()

def cf_raw(path):return raw(CF_API+path,headers=AUTH)
def cf_json(path):
    c,h,b=cf_raw(path)
    try:o=json.loads(b or b'{}')
    except Exception:o={}
    return c,h,o

def safe_header_subset(h):
    keep=('server','cf-ray','cf-mitigated','content-type','location','www-authenticate','cache-control','x-frame-options')
    out={}
    for k,v in h.items():
        if k.lower() in keep:
            out[k.lower()]=str(v)[:500]
    return out

def classify_body(b):
    txt=b.decode('utf-8','ignore')[:20000].lower()
    labels=[]
    pats={
      'cloudflare_access':['cloudflare access','access denied | cloudflare','cloudflareaccess.com'],
      'waf_block':['sorry, you have been blocked','error 1020','access denied'],
      'challenge':['cf-chl-','managed challenge','attention required! | cloudflare'],
      'forbidden':['forbidden'],
      'worker_json':['"surface":"admin"','"product":"musitu frontier market intelligence"'],
    }
    for label,vals in pats.items():
        if any(x in txt for x in vals):labels.append(label)
    return {'sha256':hashlib.sha256(b).hexdigest(),'length':len(b),'labels':labels}

out={'gate':'FMI_ADMIN_EDGE_403_DIAGNOSTIC_READONLY','mutation_performed':False,'host':ADMIN_HOST,'worker':ADMIN_WORKER}
for p in ('/','/health','/api/session'):
    c,h,b=raw('https://'+ADMIN_HOST+p,headers={'Accept':'application/json,text/html;q=0.9,*/*;q=0.8','User-Agent':'MUSITU-FMI-Admin-Edge-Diagnostic/1.0'})
    out.setdefault('edge',{})[p]={'http':c,'headers':safe_header_subset(h),'body':classify_body(b)}

# Exact worker-domain mapping.
c,h,o=cf_json(f'/accounts/{ACCOUNT_ID}/workers/domains')
domains=(o.get('result') or []) if isinstance(o,dict) else []
out['worker_domains']={'http':c,'matches':[{'hostname':d.get('hostname'),'service':d.get('service'),'environment':d.get('environment')} for d in domains if isinstance(d,dict) and (d.get('hostname')==ADMIN_HOST or d.get('service')==ADMIN_WORKER)]}

# DNS records for only the admin hostname; do not publish content targets/tokens.
c,h,o=cf_json(f'/zones/{ZONE_ID}/dns_records?name='+urllib.parse.quote(ADMIN_HOST)+'&per_page=100')
recs=(o.get('result') or []) if isinstance(o,dict) else []
out['dns']={'http':c,'count':len(recs),'records':[{'type':r.get('type'),'name':r.get('name'),'proxied':r.get('proxied'),'comment':r.get('comment')} for r in recs if isinstance(r,dict)]}

# Enumerate zone rulesets and summarize only rules that explicitly reference admin hostname,
# the whole zone hostname, or are broad host-independent block/challenge rules.
c,h,o=cf_json(f'/zones/{ZONE_ID}/rulesets')
rs=(o.get('result') or []) if isinstance(o,dict) else []
rule_summaries=[]
for r in rs:
    if not isinstance(r,dict):continue
    rid=r.get('id'); phase=r.get('phase'); name=r.get('name')
    dc,dh,do=cf_json(f'/zones/{ZONE_ID}/rulesets/{rid}') if rid else (0,{}, {})
    rules=((do.get('result') or {}).get('rules') or []) if isinstance(do,dict) else []
    matched=[]
    for rr in rules:
        if not isinstance(rr,dict):continue
        expr=str(rr.get('expression') or '')
        action=str(rr.get('action') or '')
        desc=str(rr.get('description') or '')
        exp_l=expr.lower()
        host_ref=(ADMIN_HOST.lower() in exp_l)
        zone_ref=('mftintelligence.com' in exp_l)
        broad=(not expr.strip() and action in ('block','challenge','managed_challenge','js_challenge'))
        if host_ref or zone_ref or broad:
            matched.append({'id':rr.get('id'),'action':action,'enabled':rr.get('enabled',True),'description':desc[:200],'references_admin_host':host_ref,'references_zone_host':zone_ref,'broad_without_expression':broad})
    if matched:
        rule_summaries.append({'id':rid,'name':name,'phase':phase,'kind':r.get('kind'),'rules':matched})
out['rulesets']={'http':c,'matching_rulesets':rule_summaries}

# Legacy firewall rules and IP access rules: publish only action/notes and host-match booleans.
for label,path in (
 ('firewall_rules',f'/zones/{ZONE_ID}/firewall/rules?per_page=100'),
 ('ip_access_rules',f'/zones/{ZONE_ID}/firewall/access_rules/rules?per_page=100'),
 ('zone_lockdowns',f'/zones/{ZONE_ID}/firewall/lockdowns?per_page=100'),
):
    c,h,o=cf_json(path)
    rows=(o.get('result') or []) if isinstance(o,dict) else []
    safe=[]
    for r in rows:
        if not isinstance(r,dict):continue
        txt=json.dumps(r,sort_keys=True).lower()
        if ADMIN_HOST.lower() in txt or 'mftintelligence.com' in txt or label!='firewall_rules':
            safe.append({'id':r.get('id'),'action':r.get('action'),'mode':r.get('mode'),'paused':r.get('paused'),'description':str(r.get('description') or r.get('notes') or '')[:200],'references_admin_host':ADMIN_HOST.lower() in txt,'references_zone_host':'mftintelligence.com' in txt})
    out[label]={'http':c,'count':len(rows),'relevant':safe[:100]}

# Account Access applications visibility. A 403 here is evidence that this credential cannot manage Zero Trust;
# do not infer absence from that failure.
for label,path in (
 ('access_apps_account',f'/accounts/{ACCOUNT_ID}/access/apps?per_page=100'),
 ('access_apps_zone',f'/zones/{ZONE_ID}/access/apps?per_page=100'),
):
    c,h,o=cf_json(path)
    rows=(o.get('result') or []) if isinstance(o,dict) and isinstance(o.get('result'),list) else []
    relevant=[]
    for r in rows:
        if not isinstance(r,dict):continue
        dom=str(r.get('domain') or '')
        if ADMIN_HOST.lower() in dom.lower() or 'mftintelligence.com' in dom.lower():
            relevant.append({'id':r.get('id'),'name':r.get('name'),'domain':dom,'type':r.get('type'),'session_duration':r.get('session_duration')})
    out[label]={'http':c,'visible_count':len(rows),'relevant':relevant}

# Selected read-only zone settings useful for distinguishing WAF/security-level behavior.
settings={}
for name in ('security_level','browser_check','challenge_ttl'):
    c,h,o=cf_json(f'/zones/{ZONE_ID}/settings/{name}')
    result=o.get('result') if isinstance(o,dict) else None
    settings[name]={'http':c,'value':result.get('value') if isinstance(result,dict) else None}
out['zone_settings']=settings

print(json.dumps(out,sort_keys=True,separators=(',',':')))
