#!/usr/bin/env python3
import argparse, json, sys, urllib.request

HTML = {
    '/': {'required':['MUSITU','Chemistry','href="/chemistry/install"'], 'forbidden':['href="/chemistry/download/']},
    '/app': {'required':['MUSITU','Chemistry','Your Chemistry workspace.','class="app-topbar"','class="app-nav"'], 'forbidden':['class="site-header"','class="site-footer"']},
    '/install': {'required':['MUSITU','install-concierge','Get MUSITU Chemistry on this device'], 'forbidden':['href="/chemistry/download/']},
    '/plans': {'required':['MUSITU','Chemistry'], 'forbidden':[]},
    '/verify': {'required':['MUSITU','Chemistry'], 'forbidden':[]},
    '/support': {'required':['MUSITU','Chemistry','/chemistry/install'], 'forbidden':[]},
    '/privacy': {'required':['MUSITU'], 'forbidden':[]},
    '/terms': {'required':['MUSITU'], 'forbidden':[]},
    '/experience': {'required':['MUSITU','Core Web Vitals'], 'forbidden':[]},
    '/rescue': {'required':['MUSITU','Chemistry'], 'forbidden':[]},
}
STRICT_HTML=['/','/app','/install','/privacy','/terms']

def fetch(url, accept='*/*', timeout=20):
    req=urllib.request.Request(url,headers={
        'User-Agent':'MUSITU-Frontier-ReadOnly-Preflight/2.0',
        'Accept':accept,
        'Cache-Control':'no-cache, no-store, max-age=0',
        'Pragma':'no-cache',
    })
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return r.status,{k.lower():v for k,v in r.headers.items()},r.read(1024*1024)

def strict_headers(h):
    csp=h.get('content-security-policy','')
    return (
        "style-src 'self'" in csp and "script-src 'self'" in csp and "connect-src 'self'" in csp
        and 'unsafe-inline' not in csp and 'unsafe-eval' not in csp
        and h.get('referrer-policy')=='no-referrer'
        and h.get('x-frame-options')=='DENY'
        and h.get('x-content-type-options')=='nosniff'
    )

def run(origin):
    origin=origin.rstrip('/')
    base=origin+'/chemistry'
    checks=[]
    def check(name,passed,**detail): checks.append({'name':name,'pass':bool(passed),**detail})

    for path,contract in HTML.items():
        url=base+path
        try:
            status,headers,raw=fetch(url,'text/html')
            body=raw.decode('utf-8','replace')
            missing=[x for x in contract['required'] if x not in body]
            exposed=[x for x in contract['forbidden'] if x in body]
            check('route:'+path,status==200 and not missing and not exposed,status=status,missing=missing,forbidden_present=exposed)
            if path in STRICT_HTML:
                check('strict_headers:'+path,status==200 and strict_headers(headers),csp=headers.get('content-security-policy',''))
        except Exception as e:
            check('route:'+path,False,error=type(e).__name__+': '+str(e))
            if path in STRICT_HTML: check('strict_headers:'+path,False,error='route unavailable')

    try:
        status,headers,raw=fetch(base+'/manifest.webmanifest?v=2','application/manifest+json')
        m=json.loads(raw or b'{}')
        ok=(status==200 and m.get('name')=='MUSITU Chemistry' and m.get('short_name')=='MUSITU Chemistry'
            and m.get('id')=='/chemistry/app' and m.get('start_url')=='/chemistry/app'
            and m.get('scope')=='/chemistry/' and m.get('display')=='standalone')
        check('manifest_identity',ok,status=status,manifest_name=m.get('name'),id=m.get('id'),start_url=m.get('start_url'),scope=m.get('scope'),display=m.get('display'))
    except Exception as e: check('manifest_identity',False,error=type(e).__name__+': '+str(e))

    try:
        status,headers,raw=fetch(base+'/sw.js','application/javascript')
        text=raw.decode('utf-8','replace')
        check('service_worker',status==200 and '/chemistry/app' in text and 'chemistry' in text.lower(),status=status,cache_control=headers.get('cache-control',''))
    except Exception as e: check('service_worker',False,error=type(e).__name__+': '+str(e))

    try:
        status,headers,raw=fetch(base+'/healthz','application/json')
        h=json.loads(raw or b'{}')
        ok=(status==200 and h.get('ok') is True and h.get('raw_paynow_key_present') is False
            and h.get('payment_authority_bound') is True and h.get('transport_bound') is True)
        check('payment_authority_health',ok,status=status,ok_value=h.get('ok'),raw_paynow_key_present=h.get('raw_paynow_key_present'),payment_authority_bound=h.get('payment_authority_bound'),transport_bound=h.get('transport_bound'))
    except Exception as e: check('payment_authority_health',False,error=type(e).__name__+': '+str(e))

    app_ok=next((x['pass'] for x in checks if x['name']=='route:/app'),False)
    rescue_ok=next((x['pass'] for x in checks if x['name']=='route:/rescue'),False)
    check('boundary:app_not_rescue',app_ok and rescue_ok)

    passed=sum(bool(x.get('pass')) for x in checks)
    return {
        'schema':'musitu.chemistry.frontier.host_preflight.v2',
        'origin':origin,
        'method_policy':'GET_ONLY_NO_MUTATION',
        'passed':passed,
        'failed':len(checks)-passed,
        'checks':checks,
    }

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--origin',required=True); ap.add_argument('--json-out')
    a=ap.parse_args(); result=run(a.origin)
    if a.json_out:
        with open(a.json_out,'w',encoding='utf-8') as f: json.dump(result,f,indent=2); f.write('\n')
    print(json.dumps({'passed':result['passed'],'failed':result['failed'],'origin':result['origin'],'method_policy':result['method_policy']},indent=2))
    for c in result['checks']:
        if not c.get('pass'): print('FAIL',json.dumps(c,sort_keys=True),file=sys.stderr)
    raise SystemExit(1 if result['failed'] else 0)
if __name__=='__main__': main()
