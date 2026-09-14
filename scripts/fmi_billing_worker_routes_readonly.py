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
WORKER='mft-fmi-billing'
HEADERS={
    'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],
    'Accept':'application/json',
    'User-Agent':'MUSITU-FMI-Billing-Routes-Readonly/1.0',
}

def get(path):
    req=urllib.request.Request(API+path,headers=HEADERS)
    try:
        with urllib.request.urlopen(req,timeout=45) as r:return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:return e.code,e.headers,e.read()

def executable(raw,ct):
    if 'multipart/' not in (ct or '').lower():return raw
    msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
    xs=[]
    for p in msg.walk():
        if p.is_multipart():continue
        d=p.get_payload(decode=True) or b''
        if any(k in d for k in (b'export default',b'addEventListener',b'fetch(')):xs.append(d)
    if len(xs)!=1:raise RuntimeError(f'executable module count={len(xs)}')
    return xs[0]

code,h,raw=get(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}')
if code!=200:raise RuntimeError(f'billing worker source HTTP {code}')
src=executable(raw,h.get('content-type',''))
text=src.decode('utf-8','ignore')
# Publish route names only. Limit to operational HTTP-like paths relevant to billing.
all_routes=sorted(set(re.findall(r'["\'](/[A-Za-z0-9_./:-]{1,160})["\']',text)))
routes=[r for r in all_routes if any(k in r.lower() for k in ('billing','checkout','catalog','poll','pay','webhook','return','health','plan','subscription'))]
items=[]
for route in routes:
    pos=text.find(route)
    w=text[max(0,pos-3500):min(len(text),pos+9000)]
    request_fields=set(re.findall(r'\b(?:body|payload|input|data|json)\.([A-Za-z_$][\w$]*)\b',w))
    request_fields.update(re.findall(r'\b(?:body|payload|input|data|json)\s*\[\s*["\']([A-Za-z_$][\w$]*)["\']\s*\]',w))
    for m in re.finditer(r'\{\s*([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*\}\s*=\s*(?:body|payload|input|data|json)\b',w):
        request_fields.update(x.strip() for x in m.group(1).split(','))
    response_fields=set()
    for m in re.finditer(r'(?:jsonResponse|Response\.json|JSON\.stringify)\s*\(\s*\{([^{}]{0,5000})\}',w,re.S):
        response_fields.update(re.findall(r'\b([A-Za-z_$][\w$]*)\s*:',m.group(1)))
    items.append({
        'route':route,
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
    'schema':'musitu.fmi.billing-worker-routes-readonly.v1',
    'gate':'FMI_BILLING_WORKER_ROUTES_READONLY_PASS',
    'worker':WORKER,
    'source_sha256':hashlib.sha256(src).hexdigest(),
    'route_count':len(items),
    'routes':items,
    'mutation_performed':False,
    'provider_request_performed':False,
    'customer_row_read':False,
    'raw_worker_source_published':False,
    'secret_values_read_or_logged':False,
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();open('fmi-billing-worker-routes-readonly.json','wb').write(blob)
digest=hashlib.sha256(blob).hexdigest();open('fmi-billing-worker-routes-readonly.sha256','w').write(digest+'  fmi-billing-worker-routes-readonly.json\n')
print(json.dumps({'gate':out['gate'],'worker':WORKER,'source_sha256':out['source_sha256'],'route_count':len(items),'routes':items,'mutation_performed':False,'provider_request_performed':False,'evidence_sha256':digest},sort_keys=True))
