import email
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

API=os.environ['CF_API'].rstrip('/')
ACCOUNT_ID=os.environ['ACCOUNT_ID']
EDGE='mft-fmi-global-edge'
HEADERS={
    'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],
    'Accept':'application/json',
    'User-Agent':'MUSITU-FMI-Billing-Topology-Readonly/1.0',
}

def get(path):
    req=urllib.request.Request(API+path,headers=HEADERS)
    try:
        with urllib.request.urlopen(req,timeout=45) as r:
            return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:
        return e.code,e.headers,e.read()

def json_get(path):
    code,h,raw=get(path)
    if code!=200:
        return code,{}
    try:
        return code,json.loads(raw or b'{}')
    except Exception:
        return code,{}

def executable(raw,ct):
    if 'multipart/' not in (ct or '').lower():
        return raw
    msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
    xs=[]
    for part in msg.walk():
        if part.is_multipart():
            continue
        d=part.get_payload(decode=True) or b''
        if any(k in d for k in (b'export default',b'addEventListener',b'fetch(')):
            xs.append(d)
    if len(xs)!=1:
        raise RuntimeError(f'executable module count={len(xs)}')
    return xs[0]

# Enumerate script names only.
code,scripts_obj=json_get(f'/accounts/{ACCOUNT_ID}/workers/scripts')
if code!=200:
    raise RuntimeError(f'workers scripts list HTTP {code}')
rows=scripts_obj.get('result') or []
script_names=[]
for row in rows:
    if isinstance(row,dict):
        name=row.get('id') or row.get('script_name') or row.get('name')
        if isinstance(name,str) and re.search(r'fmi|billing',name,re.I):
            script_names.append(name)
script_names=sorted(set(script_names))

# Read edge settings and publish only non-secret service-binding topology.
settings_code,settings=json_get(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(EDGE,safe="")}/settings')
service_bindings=[]
if settings_code==200:
    result=settings.get('result') or {}
    binds=result.get('bindings') or []
    for b in binds:
        if not isinstance(b,dict):
            continue
        typ=str(b.get('type') or '')
        if typ in ('service','service_binding') or b.get('service'):
            service_bindings.append({
                'name':b.get('name'),
                'type':typ,
                'service':b.get('service'),
                'environment':b.get('environment'),
            })

# Resolve likely downstream billing service from binding metadata first, names second.
billing_candidates=[]
for b in service_bindings:
    service=b.get('service')
    name=b.get('name')
    if isinstance(service,str) and re.search(r'bill|pay|fmi',service,re.I):
        billing_candidates.append(service)
    if isinstance(name,str) and re.search(r'bill|pay',name,re.I) and isinstance(service,str):
        billing_candidates.append(service)
for name in script_names:
    if re.search(r'bill|pay',name,re.I):
        billing_candidates.append(name)
billing_candidates=list(dict.fromkeys(x for x in billing_candidates if x and x!=EDGE))

inspected=[]
for worker in billing_candidates[:8]:
    code,h,raw=get(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(worker,safe="")}')
    if code!=200:
        inspected.append({'worker':worker,'http':code,'checkout_route_present':False})
        continue
    src=executable(raw,h.get('content-type',''))
    text=src.decode('utf-8','ignore')
    pos=text.find('/v1/billing/checkout')
    if pos<0:
        inspected.append({'worker':worker,'http':200,'source_sha256':hashlib.sha256(src).hexdigest(),'checkout_route_present':False})
        continue
    w=text[max(0,pos-6000):min(len(text),pos+18000)]
    request_fields=set(re.findall(r'\b(?:body|payload|input|data|json)\.([A-Za-z_$][\w$]*)\b',w))
    request_fields.update(re.findall(r'\b(?:body|payload|input|data|json)\s*\[\s*["\']([A-Za-z_$][\w$]*)["\']\s*\]',w))
    for m in re.finditer(r'\{\s*([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*\}\s*=\s*(?:body|payload|input|data|json)\b',w):
        request_fields.update(x.strip() for x in m.group(1).split(','))
    response_fields=set()
    for m in re.finditer(r'(?:jsonResponse|Response\.json|JSON\.stringify)\s*\(\s*\{([^{}]{0,5000})\}',w,re.S):
        response_fields.update(re.findall(r'\b([A-Za-z_$][\w$]*)\s*:',m.group(1)))
    inspected.append({
        'worker':worker,
        'http':200,
        'source_sha256':hashlib.sha256(src).hexdigest(),
        'checkout_route_present':True,
        'method_literals':sorted(set(re.findall(r'(?:request|req)\.method\s*(?:===|==|!==|!=)\s*["\']([A-Z]+)["\']',w))),
        'request_fields_observed':sorted(request_fields),
        'response_fields_observed':sorted(response_fields),
        'plan_literals_observed':sorted(set(x.upper() for x in re.findall(r'["\'](FREE|FOUNDING|PRO)["\']',w,re.I))),
        'status_literals_observed':sorted(set(x.lower() for x in re.findall(r'["\'](created|initiated|pending|paid|cancelled|failed|active)["\']',w,re.I))),
        'paynow_signals_observed':sorted(set(x.lower() for x in re.findall(r'(paynow|browser_url|poll_url|paynow_reference)',w,re.I))),
        'insert_targets_observed':sorted(set(x.lower() for x in re.findall(r'INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)',w,re.I))),
        'update_targets_observed':sorted(set(x.lower() for x in re.findall(r'UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)',w,re.I))),
    })

out={
    'schema':'musitu.fmi.billing-topology-readonly.v1',
    'gate':'FMI_BILLING_TOPOLOGY_READONLY_PASS',
    'edge_worker':EDGE,
    'matching_worker_names':script_names,
    'service_bindings':service_bindings,
    'billing_candidates':billing_candidates,
    'inspected_candidates':inspected,
    'mutation_performed':False,
    'provider_request_performed':False,
    'customer_row_read':False,
    'secret_values_read_or_logged':False,
    'raw_worker_source_published':False,
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
open('fmi-billing-topology-readonly.json','wb').write(blob)
digest=hashlib.sha256(blob).hexdigest()
open('fmi-billing-topology-readonly.sha256','w').write(digest+'  fmi-billing-topology-readonly.json\n')
print(json.dumps({
    'gate':out['gate'],
    'matching_worker_names':script_names,
    'service_bindings':service_bindings,
    'billing_candidates':billing_candidates,
    'inspected_candidates':inspected,
    'mutation_performed':False,
    'provider_request_performed':False,
    'evidence_sha256':digest,
},sort_keys=True))
