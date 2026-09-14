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
    'User-Agent':'MUSITU-FMI-Checkout-Contract-Readonly/2.0',
}

def get(path):
    req=urllib.request.Request(API+path,headers=HEADERS)
    try:
        with urllib.request.urlopen(req,timeout=45) as r:
            return r.status,r.headers,r.read()
    except urllib.error.HTTPError as e:
        return e.code,e.headers,e.read()

def extract_executable(raw,content_type):
    if 'multipart/' not in content_type.lower():
        return raw
    msg=email.message_from_bytes((f'Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
    executable=[]
    for part in msg.walk():
        if part.is_multipart():
            continue
        data=part.get_payload(decode=True) or b''
        if any(k in data for k in (b'export default',b'addEventListener',b'fetch(')):
            executable.append(data)
    if len(executable)!=1:
        raise RuntimeError(f'executable module count={len(executable)}')
    return executable[0]

def function_body(text,name):
    patterns=[
        rf'\basync\s+function\s+{re.escape(name)}\s*\(',
        rf'\bfunction\s+{re.escape(name)}\s*\(',
        rf'\b(?:const|let|var)\s+{re.escape(name)}\s*=\s*async\s*\(',
        rf'\b(?:const|let|var)\s+{re.escape(name)}\s*=\s*\(',
    ]
    starts=[]
    for p in patterns:
        m=re.search(p,text)
        if m:
            starts.append(m.start())
    if not starts:
        return ''
    start=min(starts)
    # Stop at the next top-level-looking function declaration. This is structural metadata only,
    # and a generous cap prevents unrelated source from dominating extraction.
    tail=text[start:]
    nexts=[]
    for p in (r'\nasync\s+function\s+[A-Za-z_$][\w$]*\s*\(',r'\nfunction\s+[A-Za-z_$][\w$]*\s*\(',r'\n(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*async\s*\('):
        for m in re.finditer(p,tail):
            if m.start()>20:
                nexts.append(m.start())
                break
    end=min(nexts) if nexts else min(len(tail),24000)
    return tail[:min(end,24000)]

code,h,raw=get(f'/accounts/{ACCOUNT_ID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}')
if code!=200:
    raise RuntimeError(f'worker source HTTP {code}')
src=extract_executable(raw,h.get('content-type',''))
text=src.decode('utf-8','ignore')
route='/v1/billing/checkout'
pos=text.find(route)
if pos<0:
    raise RuntimeError('checkout route missing')
route_window=text[max(0,pos-1800):min(len(text),pos+5000)]

# Resolve named functions invoked near this exact route; names only are published.
called=set(re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(',route_window))
noise={'if','for','while','switch','catch','String','Number','Boolean','JSON','Response','URL','Date','Math','Object','Array','Set','Map','Promise'}
called={x for x in called if x not in noise}
checkout_named={x for x in called if re.search(r'checkout|billing|paynow',x,re.I)}
handler_candidates=[]
# Prefer explicit returns/calls after the route occurrence.
after=text[pos:pos+3500]
for pat in (r'return\s+(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(',r'await\s+([A-Za-z_$][\w$]*)\s*\(',r'\b([A-Za-z_$][\w$]*(?:Checkout|Billing|Paynow)[A-Za-z_$\w]*)\s*\('):
    for m in re.finditer(pat,after,re.I):
        handler_candidates.append(m.group(1))
handler_candidates += sorted(checkout_named)
handler_candidates=list(dict.fromkeys(x for x in handler_candidates if x not in noise))[:12]

handler_sections=[]
resolved=[]
for name in handler_candidates:
    body=function_body(text,name)
    if body:
        resolved.append(name)
        handler_sections.append(body)
analysis='\n'.join(handler_sections) if handler_sections else route_window

method_literals=sorted(set(re.findall(r'(?:request|req)\.method\s*(?:===|==|!==|!=)\s*["\']([A-Z]+)["\']',route_window)))
request_fields=set(re.findall(r'\b(?:body|payload|input|data|json)\.([A-Za-z_$][\w$]*)\b',analysis))
for m in re.finditer(r'\{\s*([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*\}\s*=\s*(?:body|payload|input|data|json)\b',analysis):
    request_fields.update(x.strip() for x in m.group(1).split(','))
# Common direct property extraction after request.json().
request_fields.update(re.findall(r'\b(?:body|payload|input|data|json)\s*\[\s*["\']([A-Za-z_$][\w$]*)["\']\s*\]',analysis))
request_fields=sorted(request_fields)

response_names=set()
for m in re.finditer(r'(?:jsonResponse|Response\.json|JSON\.stringify)\s*\(\s*\{([^{}]{0,5000})\}',analysis,re.S):
    response_names.update(re.findall(r'\b([A-Za-z_$][\w$]*)\s*:',m.group(1)))
response_names=sorted(response_names)

plan_literals=sorted(set(x.upper() for x in re.findall(r'["\'](FREE|FOUNDING|PRO)["\']',analysis,re.I)))
status_literals=sorted(set(x.lower() for x in re.findall(r'["\'](created|initiated|pending|paid|cancelled|failed|active)["\']',analysis,re.I)))
auth_signals=sorted(set(x.lower() for x in re.findall(r'(authorization|bearer|authenticate|requireAuth|api[_-]?key|apikey)',analysis,re.I)))
paynow_signals=sorted(set(x.lower() for x in re.findall(r'(paynow|browser_url|poll_url|paynow_reference)',analysis,re.I)))
insert_targets=sorted(set(x.lower() for x in re.findall(r'INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)',analysis,re.I)))
update_targets=sorted(set(x.lower() for x in re.findall(r'UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)',analysis,re.I)))
called_in_handler=sorted(set(re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(',analysis)) - noise)
called_in_handler=[x for x in called_in_handler if re.search(r'checkout|billing|paynow|customer|plan|intent|subscription|api|auth',x,re.I)][:40]

out={
    'schema':'musitu.fmi.checkout-contract-readonly.v2',
    'gate':'FMI_CHECKOUT_CONTRACT_READONLY_PASS',
    'worker':WORKER,
    'source_sha256':hashlib.sha256(src).hexdigest(),
    'route':route,
    'route_present':True,
    'method_literals_near_route':method_literals,
    'handler_candidates_near_route':handler_candidates,
    'resolved_handler_functions':resolved,
    'request_fields_observed':request_fields,
    'response_fields_observed':response_names,
    'plan_literals_observed':plan_literals,
    'status_literals_observed':status_literals,
    'auth_signals_observed':auth_signals,
    'paynow_signals_observed':paynow_signals,
    'handler_dependency_names_observed':called_in_handler,
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
    'method_literals_near_route':method_literals,
    'handler_candidates_near_route':handler_candidates,
    'resolved_handler_functions':resolved,
    'request_fields_observed':request_fields,
    'response_fields_observed':response_names,
    'plan_literals_observed':plan_literals,
    'status_literals_observed':status_literals,
    'auth_signals_observed':auth_signals,
    'paynow_signals_observed':paynow_signals,
    'handler_dependency_names_observed':called_in_handler,
    'insert_targets_observed':insert_targets,
    'update_targets_observed':update_targets,
    'mutation_performed':False,
    'provider_request_performed':False,
    'evidence_sha256':digest,
},sort_keys=True))
