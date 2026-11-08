"""Independent read-only observation of AXIOM's exact newly created staging hostname.
No login, cookies, customer SQL or Cloudflare mutations. Source-only gate.
"""
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

A='93f395f5121954671f92fffa453d6b61'
Z='5b56528f03948ff5917a5e0cd9f7109e'
H='axiom-customer-staging.mftintelligence.com'
S='musitu-axiom-customer-staging'
ALLOWED={
  f'/accounts/{A}/workers/domains',
  f'/accounts/{A}/workers/scripts',
  f'/accounts/{A}/workers/scripts/{S}/settings',
  f'/zones/{Z}/dns_records?name={H}&per_page=100&page=1',
}
class Refuse(Exception): pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def cloud_get(path):
 if path not in ALLOWED:raise Refuse('UNEXPECTED_CLOUDFLARE_RESOURCE')
 token=os.environ.get('CLOUDFLARE_API_TOKEN','')
 if not token:raise Refuse('MISSING_GITHUB_SECRET')
 req=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,method='GET',headers={
  'Authorization':'Bearer '+token,'Accept':'application/json',
  'User-Agent':'AXIOM-STAGING-HOST-READBACK/20261108'})
 try:
  with urllib.request.build_opener(NoRedirect).open(req,timeout=15) as r:
   if r.status!=200:raise Refuse('CLOUDFLARE_STATUS_UNKNOWN')
   data=r.read(200001)
 except urllib.error.HTTPError as e:raise Refuse('CLOUDFLARE_HTTP_'+str(e.code)) from None
 except (OSError,TimeoutError,ValueError):raise Refuse('CLOUDFLARE_TRANSPORT_UNKNOWN') from None
 try:b=json.loads(data)
 except (UnicodeError,ValueError):raise Refuse('CLOUDFLARE_INVALID_JSON') from None
 if not isinstance(b,dict) or b.get('success') is not True or not isinstance(b.get('result'),(dict,list)):
  raise Refuse('CLOUDFLARE_RESULT_UNKNOWN')
 if isinstance(b.get('result_info'),dict) and b['result_info'].get('total_pages',1)!=1:
  raise Refuse('CLOUDFLARE_LIST_PARTIAL')
 return b['result']

def http_get(path):
 if path not in ('/_health','/auth/start','/v1/customer/me'):raise Refuse('UNREVIEWED_HTTP_PATH')
 req=urllib.request.Request('https://'+H+path,headers={'Accept':'application/json','User-Agent':'AXIOM-STAGING-HOST-READBACK/20261108'},method='GET')
 try:
  with urllib.request.build_opener(NoRedirect).open(req,timeout=12) as r:
   return r.status,r.headers.get('set-cookie'),r.read(5001)
 except urllib.error.HTTPError as e:
  return e.code,e.headers.get('set-cookie'),e.read(5001)
 except (OSError,TimeoutError,ValueError):return None,None,None

def verify(cloud=cloud_get,http=http_get):
 o={'status':'UNQUALIFIED','host':H,'worker':S,'https_qualified':False,
    'customer_identity_qualified':False,'production_oauth_touched':False,
    'provider_mutations':0,'d1_queries':0,'authoritative_login':False,
    'domain_owned':False,'worker_exists':False,'bindings_empty':False,
    'dns_exists':False,'health_status':None,'auth_status':None,'customer_status':None}
 try:
  domains=cloud(f'/accounts/{A}/workers/domains')
  scripts=cloud(f'/accounts/{A}/workers/scripts')
  settings=cloud(f'/accounts/{A}/workers/scripts/{S}/settings')
  dns=cloud(f'/zones/{Z}/dns_records?name={H}&per_page=100&page=1')
  if not isinstance(domains,list) or not isinstance(scripts,list) or not isinstance(settings,dict) or not isinstance(dns,list):
   raise Refuse('INVALID_PROVIDER_RESULT_SHAPE')
  o['domain_owned']=sum(1 for d in domains if isinstance(d,dict) and d.get('hostname')==H and d.get('service')==S and d.get('zone_id')==Z and d.get('enabled') is True)==1
  o['worker_exists']=sum(1 for s in scripts if isinstance(s,dict) and s.get('id')==S)==1
  o['bindings_empty']=settings.get('bindings')==[]
  o['dns_exists']=any(isinstance(d,dict) and d.get('name')==H and d.get('proxied') is True for d in dns)
  if not (o['domain_owned'] and o['worker_exists'] and o['bindings_empty']):
   o['status']='METADATA_MISMATCH'
   return o
  for i in range(4):
   health,cookie,body=http('/_health')
   o['health_status']=health
   if health==200 and not cookie:
    try:payload=json.loads(body)
    except (ValueError,UnicodeError,TypeError):payload=None
    if isinstance(payload,dict) and payload.get('stage')=='host_route_only' and payload.get('identity_live_qualified') is False and payload.get('release_qualified') is False:
     break
   if i<3:time.sleep(8)
  if o['health_status']!=200:
   o['status']='HTTP_PENDING_OR_FILTERED'
   return o
  st,cookie,body=http('/auth/start');o['auth_status']=st
  st2,cookie2,body2=http('/v1/customer/me');o['customer_status']=st2
  if st==503 and st2==503 and not cookie and not cookie2 and o['dns_exists']:
   o['https_qualified']=True
   o['status']='EXACT_STAGING_HTTPS_FAIL_CLOSED_PASS'
  else:o['status']='HTTP_IDENTITY_GATE_UNQUALIFIED'
  return o
 except Refuse as e:
  o['status']='PROVIDER_READ_FAILED'
  o['reason']=str(e)
  return o

def main():
 out=verify()
 b=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
 p=Path('axiom-staging-host-readback.json');p.write_bytes(b)
 Path(str(p)+'.sha256').write_text(hashlib.sha256(b).hexdigest()+'  '+str(p)+'\n')
 print('AXIOM_STAGING_READBACK='+out['status'])
 print('PROVIDER_MUTATIONS=0 D1_QUERIES=0 CUSTOMER_IDENTITY_QUALIFIED=false')
 return 0 if out['status']=='EXACT_STAGING_HTTPS_FAIL_CLOSED_PASS' else 2
if __name__=='__main__':raise SystemExit(main())
