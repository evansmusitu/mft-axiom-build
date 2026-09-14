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
    'User-Agent':'MUSITU-FMI-Billing-Checkout-Handler-Readonly/1.0',
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

def function_slice(text,name):
    pats=[
        rf'\basync\s+function\s+{re.escape(name)}\s*\(',
        rf'\bfunction\s+{re.escape(name)}\s*\(',
        rf'\b(?:const|let|var)\s+{re.escape(name)}\s*=\s*async\s*\(',
        rf'\b(?:const|let|var)\s+{re.escape(name)}\s*=\s*\(',
    ]
    starts=[m.start() for p in pats for m in [re.search(p,text)] if m]
    if not starts:return ''
    start=min(starts);tail=text[start:]
    # Conservative capped function region; only names/literals are emitted.
    candidates=[]
    for p in (r'\nasync\s+function\s+[A-Za-z_$][\w$]*\s*\(',r'\nfunction\s+[A-Za-z_$][\w$]*\s*\(',r'\n(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*async\s*\('):
        for m in re.finditer(p,tail):
            if m.start()>20:
                candidates.append(m.start());break
    end=min(candidates) if candidates else min(len(tail),28000)
    return tail[:min(end,28000)]

code,h,raw=get(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}')
if code!=200:raise RuntimeError(f'billing worker source HTTP {code}')
src=executable(raw,h.get('content-type',''));text=src.decode('utf-8','ignore')
route='/billing/checkout';pos=text.find(route)
if pos<0:raise RuntimeError('billing checkout route missing')
near=text[max(0,pos-2500):min(len(text),pos+6000)]

# Resolve exact route dispatch calls by function names only.
handler_candidates=[]
after=text[pos:pos+4500]
for pat in (
    r'return\s+(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(',
    r'await\s+([A-Za-z_$][\w$]*)\s*\(',
    r'\b([A-Za-z_$][\w$]*(?:checkout|billing|paynow)[A-Za-z_$\w]*)\s*\('
):
    for m in re.finditer(pat,after,re.I):handler_candidates.append(m.group(1))
handler_candidates=list(dict.fromkeys(handler_candidates))[:20]
resolved=[];sections=[]
for name in handler_candidates:
    s=function_slice(text,name)
    if s:
        resolved.append(name);sections.append(s)
analysis='\n'.join(sections) if sections else near

# If the dispatch is inline, enrich with named function bodies called from the inline route block.
inline_calls=set(re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(',near))
noise={'if','for','while','switch','catch','String','Number','Boolean','JSON','Response','URL','Date','Math','Object','Array','Set','Map','Promise'}
for name in sorted(inline_calls-noise):
    if re.search(r'checkout|billing|paynow|intent|plan|customer|auth',name,re.I) and name not in resolved:
        s=function_slice(text,name)
        if s:
            resolved.append(name);sections.append(s)
analysis='\n'.join(sections) if sections else near

request_fields=set(re.findall(r'\b(?:body|payload|input|data|json|reqBody)\.([A-Za-z_$][\w$]*)\b',analysis))
request_fields.update(re.findall(r'\b(?:body|payload|input|data|json|reqBody)\s*\[\s*["\']([A-Za-z_$][\w$]*)["\']\s*\]',analysis))
for m in re.finditer(r'\{\s*([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*\}\s*=\s*(?:body|payload|input|data|json|reqBody)\b',analysis):
    request_fields.update(x.strip() for x in m.group(1).split(','))
response_fields=set()
for m in re.finditer(r'(?:jsonResponse|Response\.json|JSON\.stringify)\s*\(\s*\{([^{}]{0,7000})\}',analysis,re.S):
    response_fields.update(re.findall(r'\b([A-Za-z_$][\w$]*)\s*:',m.group(1)))

string_error_literals=sorted(set(re.findall(r'["\']([A-Za-z0-9 _:-]{3,120}(?:plan|checkout|payment|customer|provider|paynow)[A-Za-z0-9 _:-]{0,120})["\']',analysis,re.I)))[:40]
internal_paths=sorted(set(r for r in re.findall(r'["\'](/internal/[A-Za-z0-9_./:-]+)["\']',analysis) if 'paynow' in r.lower() or 'billing' in r.lower()))

out={
    'schema':'musitu.fmi.billing-checkout-handler-readonly.v1',
    'gate':'FMI_BILLING_CHECKOUT_HANDLER_READONLY_PASS',
    'worker':WORKER,
    'source_sha256':hashlib.sha256(src).hexdigest(),
    'route':route,
    'handler_candidates':handler_candidates,
    'resolved_handler_functions':resolved,
    'request_fields_observed':sorted(request_fields),
    'response_fields_observed':sorted(response_fields),
    'plan_literals_observed':sorted(set(x.upper() for x in re.findall(r'["\'](FREE|FOUNDING|PRO)["\']',analysis,re.I))),
    'status_literals_observed':sorted(set(x.lower() for x in re.findall(r'["\'](created|initiated|pending|paid|cancelled|failed|active)["\']',analysis,re.I))),
    'internal_paths_observed':internal_paths,
    'validation_error_literals_observed':string_error_literals,
    'db_insert_targets_observed':sorted(set(x.lower() for x in re.findall(r'INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)',analysis,re.I))),
    'db_update_targets_observed':sorted(set(x.lower() for x in re.findall(r'UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)',analysis,re.I))),
    'mutation_performed':False,
    'provider_request_performed':False,
    'customer_row_read':False,
    'raw_worker_source_published':False,
    'secret_values_read_or_logged':False,
}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();open('fmi-billing-checkout-handler-readonly.json','wb').write(blob)
digest=hashlib.sha256(blob).hexdigest();open('fmi-billing-checkout-handler-readonly.sha256','w').write(digest+'  fmi-billing-checkout-handler-readonly.json\n')
print(json.dumps({**out,'evidence_sha256':digest},sort_keys=True))
