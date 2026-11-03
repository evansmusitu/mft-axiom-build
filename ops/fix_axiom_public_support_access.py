"""Exempt only public support reads from zone Security Level challenges.

Does not change the zone security level, BIC, WAF, rate limits, Access,
support application, or any case, operator, recovery, or enterprise route.
"""
import argparse
import email
import hashlib
import json
import os
import time
import urllib.error
import urllib.request

ACCOUNT='93f395f5121954671f92fffa453d6b61'
ZONE='5b56528f03948ff5917a5e0cd9f7109e'
RULESET='b6e24c698e0842bcb8e27739074a865c'
RULES_PIN='33d4a5bac89a95fb3c72ab8968fae5ffa5568ecf9cc0ebc767855650a5afb2ef'
WORKER_PIN='d2573a92a8fdab487a0e0a4ab81670cbb3b518a3e033fe62d6ba1caa1ad040dc'
REF='musitu_axiom_public_support_reads_20261028'
PUBLIC_PATHS=['/','/index.html','/robots.txt','/sitemap.xml','/styles.css','/app.js','/api/v1/config','/api/v1/catalog','/api/v1/help']
EXPRESSION='(http.host eq "support.mftintelligence.com" and http.request.method eq "GET" and http.request.uri.path in {'+' '.join(json.dumps(p) for p in PUBLIC_PATHS)+'})'
RULE={'ref':REF,'description':'Public MUSITU Axiom support pages and read-only help: skip only Security Level; preserve BIC, WAF, rate limits and private support routes','action':'skip','action_parameters':{'products':['securityLevel']},'expression':EXPRESSION,'enabled':True}
BASE='https://api.cloudflare.com/client/v4'

def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def api(path,method='GET',body=None):
    assert path.startswith(('/zones/'+ZONE+'/', '/accounts/'+ACCOUNT+'/workers/scripts/musitu-axiom-support'))
    req=urllib.request.Request(BASE+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'Content-Type':'application/json','User-Agent':'MUSITU-Axiom-Support-Access-Fix/2.0.5'})
    try:
        with urllib.request.urlopen(req,timeout=40) as r:return r.status,dict(r.headers),r.read()
    except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read()
def read(path,method='GET',body=None):
    status,_,raw=api(path,method,body)
    try:x=json.loads(raw)
    except ValueError:raise RuntimeError('Cloudflare returned non-JSON; HTTP '+str(status))
    if status>=300 or not x.get('success'):raise RuntimeError('Cloudflare API HTTP '+str(status)+'; error codes '+','.join(str(e.get('code')) for e in x.get('errors',[])))
    return x['result']
def worker_pin():
    c,h,raw=api('/accounts/'+ACCOUNT+'/workers/scripts/musitu-axiom-support')
    assert c==200,'Cannot read support source'
    ct=h.get('Content-Type') or h.get('content-type') or ''
    if 'multipart/' in ct:
        msg=email.message_from_bytes(('Content-Type: '+ct+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
        parts=[p.get_payload(decode=True) for p in msg.walk() if not p.is_multipart() and (p.get_filename() or p.get_param('name',header='content-disposition'))=='index.mjs']
        assert len(parts)==1,'Unexpected support bundle';raw=parts[0]
    assert hashlib.sha256(raw).hexdigest()==WORKER_PIN,'Support source changed; review public paths before applying'
def protected_settings():
    level=read('/zones/'+ZONE+'/settings/security_level')['value'];bic=read('/zones/'+ZONE+'/settings/browser_check')['value']
    assert level=='under_attack' and bic=='on','Zone protection baseline changed; inspect before applying'
    return {'security_level':level,'browser_check':bic}
def same_rule(rule):return all(rule.get(k)==v for k,v in RULE.items())
def probe():
    req=urllib.request.Request('https://support.mftintelligence.com/',headers={'User-Agent':'MUSITU-Axiom-Support-Access-Fix/2.0.5','Accept':'text/html'})
    try:
        with urllib.request.urlopen(req,timeout=30) as r:body=r.read().decode();return r.status==200 and 'mailto:support@mftintelligence.com' in body and r.headers.get('cf-mitigated')!='challenge'
    except urllib.error.HTTPError:return False
def main():
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');args=p.parse_args()
    worker_pin();baseline=protected_settings();path='/zones/'+ZONE+'/rulesets/'+RULESET
    before=read(path);existing=[r for r in before['rules'] if r.get('ref')==REF]
    if existing:
        assert len(existing)==1 and same_rule(existing[0]),'A different rule already uses this reference'
    else:
        assert digest(before['rules'])==RULES_PIN,'Rules changed since readback; inspect before applying'
    print(json.dumps({'phase':'validated','public_paths':PUBLIC_PATHS,'zone_protections':baseline,'mutation':args.apply and not bool(existing)}))
    if not args.apply:return
    if not existing:read(path+'/rules','POST',RULE)
    after=read(path);own_rules=[r for r in after['rules'] if r.get('ref')==REF]
    assert len(own_rules)==1 and same_rule(own_rules[0]),'Public support rule did not match the plan'
    assert {r['id']:r for r in after['rules'] if r.get('ref')!=REF}=={r['id']:r for r in before['rules'] if r.get('ref')!=REF},'Unrelated rules changed; inspect without overwriting them'
    assert protected_settings()==baseline
    public_ok=False
    for _ in range(6):
        if probe():public_ok=True;break
        time.sleep(2)
    print(json.dumps({'phase':'complete','rule_id':own_rules[0]['id'],'public_support_http_200':public_ok,'existing_rules_preserved':True,'zone_protections':baseline}))
    assert public_ok,'Public support still blocked; inspect challenge without broadening the exception'
if __name__=='__main__':main()
