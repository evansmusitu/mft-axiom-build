"""Guarded single-worker reviewer remediation; preserve current bindings.

Only musitu-axiom-mcp is writable. Authentication, core computation,
billing, customer entitlements, DNS and routes are read-only or untouched.
Rollback restores the captured source only while our deployment still owns
the source and settings; it never overwrites a concurrent operator change.
"""
import argparse
import email
import hashlib
import json
import os
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
ACCOUNT='93f395f5121954671f92fffa453d6b61'
WORKER='musitu-axiom-mcp'
SOURCE_PIN='decaaebad4d8052e7c345e574819204558731d8ab32f8da24205493f24edb08e'
SETTINGS_PIN='eccb16ae434c9729e382b8bc0f7790630606ed2ce9151eb911d4b54d7d1f253c'
CORE_PIN='444efc44820d0655641e4041a48618a9e6648c3391323a7f92c7a296bb1435dc'
API='https://api.cloudflare.com/client/v4'
PREFIX='/accounts/'+ACCOUNT+'/workers/scripts/'
def sha(b):return hashlib.sha256(b).hexdigest()
def digest(x):return sha(json.dumps(x,sort_keys=True,separators=(',',':')).encode())
def raw(url,method='GET',headers=None,body=None):
    req=urllib.request.Request(url,method=method,headers=headers or {},data=body)
    try:
        with urllib.request.urlopen(req,timeout=45) as r:return r.status,dict(r.headers),r.read()
    except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read()
def cf(path,method='GET',body=None,content_type=None):
    assert path in [PREFIX+WORKER,PREFIX+WORKER+'/settings',PREFIX+'musitu-axiom-mcp-core','/accounts/'+ACCOUNT+'/workers/domains']
    assert method=='GET' or (method=='PUT' and path==PREFIX+WORKER),'Mutation outside public gateway denied'
    h={'Authorization':'Bearer '+os.environ['CLOUDFLARE_API_TOKEN'],'User-Agent':'MUSITU-Axiom-Reviewer-Fix/2.0.5'}
    if content_type:h['Content-Type']=content_type
    c,hh,b=raw(API+path,method,h,body)
    if not 200<=c<300:raise RuntimeError('Cloudflare API '+method+' HTTP '+str(c))
    return hh,b
def cf_json(path):
    _,raw_body=cf(path);x=json.loads(raw_body);assert x.get('success') is True,'Cloudflare success=false';return x['result']
def source(name=WORKER):
    headers,b=cf(PREFIX+name);ct=headers.get('Content-Type') or headers.get('content-type') or ''
    if 'multipart/' not in ct:return b
    msg=email.message_from_bytes(('Content-Type: '+ct+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+b)
    modules={p.get_filename() or p.get_param('name',header='content-disposition'):p.get_payload(decode=True) for p in msg.walk() if not p.is_multipart()}
    assert set(modules)=={'index.mjs'},'Unexpected live module set';return modules['index.mjs']
def settings():return cf_json(PREFIX+WORKER+'/settings')
def comparable_settings(x):
    x=dict(x);x.pop('annotations',None);x['bindings']=sorted(x.get('bindings',[]),key=lambda b:b['name']);return x
def upload(src,current):
    # Reapply every current non-secret binding; retain all secret bindings.
    bindings=[]
    for binding in current['bindings']:
        if binding['type']=='secret_text':continue
        binding=dict(binding)
        if binding['type']=='d1' and 'database_id' in binding:
            if 'id' in binding:assert binding['id']==binding['database_id'],'D1 binding identifiers disagree'
            binding['id']=binding.pop('database_id')
        bindings.append(binding)
    metadata={'main_module':'index.mjs','compatibility_date':current['compatibility_date'],'compatibility_flags':current.get('compatibility_flags',[]),'bindings':bindings,'keep_bindings':['secret_text']}
    for key in ['usage_model','tags','tail_consumers','logpush']:
        if key in current:metadata[key]=current[key]
    if current.get('placement'):metadata['placement']=current['placement']
    boundary='----AxiomReviewer'+secrets.token_hex(16)
    body=(f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()+json.dumps(metadata,separators=(',',':')).encode()+f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="index.mjs"; filename="index.mjs"\r\nContent-Type: application/javascript+module\r\n\r\n'.encode()+src+f'\r\n--{boundary}--\r\n'.encode())
    _,b=cf(PREFIX+WORKER,'PUT',body,'multipart/form-data; boundary='+boundary);assert json.loads(b).get('success') is True,'Upload success=false'
def public(path,obj=None):
    h={'User-Agent':'MUSITU-Axiom-Reviewer-Fix/2.0.5','Accept':'application/json'}
    if obj is not None:h['Content-Type']='application/json'
    c,_,b=raw('https://mcp.mftintelligence.com'+path,'POST' if obj is not None else 'GET',h,json.dumps(obj).encode() if obj is not None else None)
    assert c==200,'Public probe HTTP '+str(c);return json.loads(b)
def verify_public():
    health=public('/health');assert health.get('ok') is True and health.get('server_version')=='4.0.2' and health.get('oauth_enforced') is True
    listed=public('/mcp',{'jsonrpc':'2.0','id':1,'method':'tools/list','params':{}})['result']['tools'];assert len(listed)==108
    count=0
    for t in listed:
        if t['name'] in ['search','fetch','musitu_axiom_capabilities']:continue
        s=t['inputSchema'];assert s['properties']['args']['type']=='object';assert s.get('oneOf') or s['properties']['args'].get('properties');count+=1
    assert count==105
    blocked=public('/mcp',{'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'moving_average','arguments':{'args':{'data':[1,2,3],'window':2}}}})['result']
    assert blocked.get('isError') is True and blocked['structuredContent'].get('authenticated') is False and blocked.get('_meta',{}).get('mcp/www_authenticate')
    discover=public('/mcp',{'jsonrpc':'2.0','id':3,'method':'server/discover','params':{}})['result'];assert discover['resultType']=='complete' and '2026-07-28' in discover['supportedVersions']
    return {'tool_count':len(listed),'computation_schema_count':count,'oauth_enforced':True,'modern_discover':True}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    candidate=(ROOT/'mcp/musitu_axiom_plugin_gate_v4.mjs').read_bytes();candidate_sha=sha(candidate)
    before=source();current=settings();assert sha(before)==SOURCE_PIN,'Live source changed; inspect before deploying';assert digest(current)==SETTINGS_PIN,'Live settings changed; inspect before deploying'
    assert sha(source('musitu-axiom-mcp-core'))==CORE_PIN,'Core source changed; inspect before deploying'
    domains=cf_json('/accounts/'+ACCOUNT+'/workers/domains');matches=[d for d in domains if d.get('hostname')=='mcp.mftintelligence.com'];assert len(matches)==1 and matches[0].get('service')==WORKER,'MCP domain mapping changed'
    print(json.dumps({'phase':'validated','old_sha256':SOURCE_PIN,'new_sha256':candidate_sha,'settings_guard':True,'core_guard':True,'apply':args.apply}))
    if not args.apply:return
    deployed=False
    try:
        upload(candidate,current);deployed=True
        assert sha(source())==candidate_sha,'New source readback mismatch'
        assert comparable_settings(settings())==comparable_settings(current),'Worker settings changed unexpectedly'
        result=None
        for attempt in range(6):
            try:result=verify_public();break
            except (AssertionError,urllib.error.URLError):
                if attempt==5:raise
                time.sleep(2)
        assert sha(source('musitu-axiom-mcp-core'))==CORE_PIN,'Core changed during deploy'
        print(json.dumps({'phase':'complete','source_sha256':candidate_sha,'settings_preserved':True,'core_preserved':True,**result}))
    except Exception:
        if deployed and sha(source())==candidate_sha and comparable_settings(settings())==comparable_settings(current):
            upload(before,current);assert sha(source())==SOURCE_PIN;print(json.dumps({'phase':'rollback','source_sha256':SOURCE_PIN}))
        raise
if __name__=='__main__':main()
