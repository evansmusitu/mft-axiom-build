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
WORKER='mft-fmi-global-edge'
HEADERS={
    'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],
    'X-Auth-Key':os.environ['CLOUDFLARE_API_KEY'],
    'Accept':'application/json',
    'User-Agent':'MUSITU-FMI-Checkout-Contract-Readonly/1.0',
}

def get(path):
    req=urllib.request.Request(API+path,headers=HEADERS)
    try:
        with urllib.request.urlopen(req,timeout=45) as r:
            return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:
        return e.code,e.headers,e.read()

code,h,raw=get(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}')
if code!=200:
    raise RuntimeError(f'worker source HTTP {code}')
ct=h.get('content-type','')
src=raw
if 'multipart/' in ct.lower():
    msg=email.message_from_bytes((f'Content-Type: {ct}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
    executable=[]
    for part in msg.walk():
        if part.is_multipart():
            continue
        data=part.get_payload(decode=True) or b''
        if any(k in data for k in (b'export default',b'addEventListener',b'fetch(')):
            executable.append(data)
    if len(executable)!=1:
        raise RuntimeError(f'executable module count={len(executable)}')
    src=executable[0]

text=src.decode('utf-8','ignore')
route='/v1/billing/checkout'
pos=text.find(route)
if pos<0:
    raise RuntimeError('checkout route missing')
window=text[max(0,pos-5500):min(len(text),pos+12000)]

methods=sorted(set(re.findall(r'(?:request|req)\.method\s*(?:===|==)\s*["\']([A-Z]+)["\']',window)))
# Observe only field names / literals, never source or values from secrets.
request_fields=sorted(set(re.findall(r'\b(?:body|payload|input|data)\.([A-Za-z_$][\w$]*)\b',window)))
for m in re.finditer(r'\{\s*([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*\}\s*=\s*(?:body|payload|input|data)\b',window):
    request_fields += [x.strip() for x in m.group(1).split(',')]
request_fields=sorted(set(request_fields))

response_fields=sorted(set(re.findall(r'\b(?:return\s+jsonResponse|jsonResponse|Response\.json)\s*\(\s*\{([^{}]{0,2400})\}',window,re.S)))
# Convert response object snippets to property names only.
response_names=set()
for snippet in response_fields:
    response_names.update(re.findall(r'\b([A-Za-z_$][\w$]*)\s*:',snippet))
response_names=sorted(response_names)

plan_literals=sorted(set(x.upper() for x in re.findall(r'["\'](FREE|FOUNDING|PRO)["\']',window,re.I)))
status_literals=sorted(set(x.lower() for x in re.findall(r'["\'](created|initiated|pending|paid|cancelled|failed|active)["\']',window,re.I)))
auth_signals=sorted(set(x.lower() for x in re.findall(r'(authorization|bearer|authenticate|requireAuth|api[_-]?key)',window,re.I)))
paynow_signals=sorted(set(x.lower() for x in re.findall(r'(paynow|browser_url|poll_url|paynow_reference)',window,re.I)))
insert_targets=sorted(set(x.lower() for x in re.findall(r'INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)',window,re.I)))
update_targets=sorted(set(x.lower() for x in re.findall(r'UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)',window,re.I)))

# Explicit safety facts only; no mutation is performed by this probe.
out={
    'schema':'musitu.fmi.checkout-contract-readonly.v1',
    'gate':'FMI_CHECKOUT_CONTRACT_READONLY_PASS',
    'worker':WORKER,
    'source_sha256':hashlib.sha256(src).hexdigest(),
    'route':route,
    'route_present':True,
    'methods_observed':methods,
    'request_fields_observed':request_fields,
    'response_fields_observed':response_names,
    'plan_literals_observed':plan_literals,
    'status_literals_observed':status_literals,
    'auth_signals_observed':auth_signals,
    'paynow_signals_observed':paynow_signals,
    'insert_targets_observed':insert_targets,
    'update_targets_observed':update_targets,
    'mutation_performed':False,
    'provider_request_performed':False,
    'customer_row_read':False,
    'raw_worker_source_published':False,
    'secret_values_read_or_logged':False,
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
open('fmi-checkout-contract-readonly.json','wb').write(blob)
digest=hashlib.sha256(blob).hexdigest()
open('fmi-checkout-contract-readonly.sha256','w').write(digest+'  fmi-checkout-contract-readonly.json\n')
print(json.dumps({
    'gate':out['gate'],
    'source_sha256':out['source_sha256'],
    'route':route,
    'methods_observed':methods,
    'request_fields_observed':request_fields,
    'response_fields_observed':response_names,
    'plan_literals_observed':plan_literals,
    'status_literals_observed':status_literals,
    'auth_signals_observed':auth_signals,
    'paynow_signals_observed':paynow_signals,
    'insert_targets_observed':insert_targets,
    'update_targets_observed':update_targets,
    'mutation_performed':False,
    'provider_request_performed':False,
    'evidence_sha256':digest,
},sort_keys=True))
