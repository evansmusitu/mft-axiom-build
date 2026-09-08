#!/usr/bin/env python3
import argparse, json, sys, urllib.request

REQUIRED = [
    ('/', ['MUSITU', 'Chemistry']),
    ('/app', ['MUSITU', 'Chemistry']),
    ('/install', ['MUSITU']),
    ('/plans', ['MUSITU']),
    ('/verify', ['MUSITU']),
    ('/support', ['MUSITU']),
    ('/privacy', ['MUSITU']),
    ('/terms', ['MUSITU']),
    ('/experience', ['MUSITU']),
    ('/rescue', ['MUSITU', 'Chemistry']),
    ('/manifest.webmanifest?v=2', ['MUSITU Chemistry']),
    ('/sw.js', ['chemistry']),
]

def fetch(url, timeout=12):
    req=urllib.request.Request(url,headers={'User-Agent':'MUSITU-Frontier-Preflight/1.0','Accept':'*/*'})
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return r.status, r.headers, r.read(512000).decode('utf-8','replace')

def run(origin):
    origin=origin.rstrip('/')
    base=origin + '/chemistry'
    checks=[]
    for path, needles in REQUIRED:
        url=base+path
        try:
            status, headers, body=fetch(url)
            ok=status==200 and all(n.lower() in body.lower() for n in needles)
            checks.append({'path':path,'status':status,'pass':ok,'missing':[n for n in needles if n.lower() not in body.lower()]})
        except Exception as e:
            checks.append({'path':path,'status':None,'pass':False,'error':type(e).__name__+': '+str(e)})
    app=next(x for x in checks if x['path']=='/app')
    rescue=next(x for x in checks if x['path']=='/rescue')
    checks.append({'path':'boundary:app_not_rescue','pass':bool(app.get('pass') and rescue.get('pass')),'detail':'route reachability prerequisite'})
    passed=sum(bool(x.get('pass')) for x in checks)
    return {'schema':'musitu.chemistry.frontier.host_preflight.v1','origin':origin,'passed':passed,'failed':len(checks)-passed,'checks':checks}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--origin',required=True); ap.add_argument('--json-out')
    a=ap.parse_args(); result=run(a.origin)
    if a.json_out:
        with open(a.json_out,'w',encoding='utf-8') as f: json.dump(result,f,indent=2); f.write('\n')
    print(json.dumps({'passed':result['passed'],'failed':result['failed'],'origin':result['origin']},indent=2))
    for c in result['checks']:
        if not c.get('pass'): print('FAIL',c,file=sys.stderr)
    raise SystemExit(1 if result['failed'] else 0)
if __name__=='__main__': main()
