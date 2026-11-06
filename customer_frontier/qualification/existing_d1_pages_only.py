"""Bounded Pages-only current bindings observation. No SQL or target admission."""
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request

API='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61'
CANDIDATES={'2571795a-80fe-4f63-9b95-07948b4cefdb','8cb4d319-6008-4ba8-aba1-563c6d836ce8','ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'}
IDENT=re.compile(r'[A-Za-z0-9_-]{1,128}')
UUID=re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
def digest(text):return hashlib.sha256(text.encode()).hexdigest()
class ObservationError(ValueError):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def observe():
 out={'schema':'musitu.axiom.existing_d1_pages_only.v1','observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'source_sha':os.environ.get('AXIOM_CHECKOUT_SHA'),'event_sha':os.environ.get('GITHUB_SHA'),'run_id':os.environ.get('GITHUB_RUN_ID'),
  'status':'UNKNOWN','projects_observed':0,'references':[],'transport':[],'errors':[],'database_queries':0,'mutations':0,
  'target_admitted':False,'global_absence_certified':False,'backup_restore_qualified':False,'hosted_migration_qualified':False,'release_authority':False,
  'historical_deployment_bindings_covered':False}
 token=os.environ.get('CLOUDFLARE_API_TOKEN','');deadline=time.monotonic()+240
 opener=urllib.request.build_opener(NoRedirect);projects=set();totals={}
 def fetch(path,kind,label):
  if path not in {'/pages/projects?per_page=10&page='+str(p) for p in range(1,18)} and path not in {'/pages/projects/'+p for p in projects}:
   raise ObservationError('UNADMITTED_REQUEST')
  remaining=deadline-time.monotonic()
  if remaining<=0 or len(out['transport'])>=200:raise ObservationError('REQUEST_BUDGET_EXHAUSTED')
  trace={'kind':kind,'resource_sha256':digest(label),'http_status':None,'provider_error_codes':[]};out['transport'].append(trace)
  req=urllib.request.Request(API+path,method='GET',headers={'Authorization':'Bearer '+token,'Accept':'application/json','User-Agent':'MUSITU-AXIOM-Pages-ReadOnly/1.0'})
  try:
   with opener.open(req,timeout=min(20,remaining)) as r:trace['http_status']=r.status;raw=r.read(2_000_001)
   if trace['http_status']!=200 or len(raw)>2_000_000:raise ObservationError('INVALID_TRANSPORT')
   data=json.loads(raw)
   if not isinstance(data,dict) or data.get('success') is not True:raise ObservationError('INVALID_ENVELOPE')
   return data
  except urllib.error.HTTPError as e:
   trace['http_status']=e.code
   try:
    raw=e.read(2_000_001) if e.fp is not None else b''
    if len(raw)<=2_000_000:
     data=json.loads(raw);errors=data.get('errors') if isinstance(data,dict) else None
     if isinstance(errors,list):trace['provider_error_codes']=[v['code'] for v in errors if isinstance(v,dict) and type(v.get('code')) is int and 1000<=v['code']<=2147483647][:20]
   except (OSError,ValueError,TypeError,UnicodeError,http.client.HTTPException,RecursionError):pass
   raise ObservationError('HTTP_FAILURE') from None
 def problem(error,kind,label=''):
  out['errors'].append({'section':kind,'resource_sha256':digest(label),'code':str(error) if isinstance(error,ObservationError) else 'INVALID_RESPONSE'})
 caught=(ObservationError,OSError,ValueError,TypeError,UnicodeError,http.client.HTTPException,RecursionError)
 if not token:out['errors'].append({'section':'input','code':'MISSING_TOKEN'})
 else:
  try:
   terminal=False
   for page in range(1,18):
    data=fetch('/pages/projects?per_page=10&page='+str(page),'pages_list',str(page));rows=data.get('result')
    if not isinstance(rows,list) or len(rows)>10:raise ObservationError('INVALID_PROJECT_LIST')
    if 'result_info' in data:
     info=data['result_info']
     if not isinstance(info,dict):raise ObservationError('INVALID_PAGINATION')
     for key,value in {'page':page,'per_page':10,'count':len(rows)}.items():
      if key in info and (type(info[key]) is not int or info[key]!=value):raise ObservationError('INCONSISTENT_PAGINATION')
     for key in ('total_count','total_pages'):
      if key not in info:continue
      value=info[key]
      if type(value) is not int or value<0:raise ObservationError('INVALID_TOTAL')
      if key in totals and totals[key]!=value:raise ObservationError('CHANGED_TOTAL')
      totals[key]=value
    if not rows:terminal=True;break
    for row in rows:
     if not isinstance(row,dict) or not isinstance(row.get('name'),str) or not IDENT.fullmatch(row['name']) or row['name'] in projects:raise ObservationError('INVALID_PROJECT_IDENTITY')
     projects.add(row['name'])
    if len(projects)>160:raise ObservationError('PROJECT_BUDGET_EXCEEDED')
   if not terminal:raise ObservationError('PAGINATION_INCOMPLETE')
   if 'total_count' in totals and totals['total_count']!=len(projects):raise ObservationError('INCONSISTENT_TOTAL_COUNT')
   if 'total_pages' in totals and totals['total_pages'] not in ({0,1} if not projects else {(len(projects)+9)//10}):raise ObservationError('INCONSISTENT_TOTAL_PAGES')
   complete=True
   for project in sorted(projects):
    try:
     data=fetch('/pages/projects/'+project,'project_detail',project).get('result')
     if not isinstance(data,dict) or data.get('name')!=project or not isinstance(data.get('deployment_configs'),dict):raise ObservationError('INVALID_PROJECT_DETAIL')
     for env in ('production','preview'):
      cfg=data['deployment_configs'].get(env)
      if not isinstance(cfg,dict):raise ObservationError('INVALID_PROJECT_ENVIRONMENT')
      bindings=cfg.get('d1_databases',{})
      if not isinstance(bindings,dict) or len(bindings)>1000:raise ObservationError('INVALID_D1_MAP')
      for alias,row in bindings.items():
       if not isinstance(alias,str) or not IDENT.fullmatch(alias) or not isinstance(row,dict) or not isinstance(row.get('id'),str) or not UUID.fullmatch(row['id']):raise ObservationError('INVALID_D1_BINDING')
       if row['id'] in CANDIDATES:
        if len(out['references'])>=4096:raise ObservationError('REFERENCE_BUDGET_EXCEEDED')
        out['references'].append({'database_id':row['id'],'kind':'pages_current_config','consumer_sha256':digest(project),'environment_sha256':digest(env),'binding_sha256':digest(alias)})
    except caught as e:complete=False;problem(e,'project_config',project)
   out['projects_observed']=len(projects);out['empty_terminal_page']=True
   out['status']='OBSERVED_CURRENT_CONFIGS' if complete else 'PARTIAL'
  except caught as e:problem(e,'pages')
 out['limitations']=['Current project configs omit historical deployment bindings.','No external D1 client absence or target reuse qualification.']
 raw=(json.dumps(out,sort_keys=True,indent=2)+'\n').encode();p=Path('existing-d1-pages-only.json');p.write_bytes(raw)
 Path(str(p)+'.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  '+str(p)+'\n')
 print(json.dumps(out,sort_keys=True));return 0 if out['status']=='OBSERVED_CURRENT_CONFIGS' else 1

if __name__=='__main__':raise SystemExit(observe())
