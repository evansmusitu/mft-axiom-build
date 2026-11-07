"""Read-only fixed FOUR UUID remaining unprotected existing D1 database catalogs and observed current bindings. No target admission; no row access."""
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

ACCOUNT='93f395f5121954671f92fffa453d6b61'
API='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT
CANDIDATES={
 'b043cc1b-dc6c-4031-9f36-f2331728e062':'551b580c0be9ac6327caf0aa7cec8939eed8264edbfc8b8905e491e5d4136e2d',
 'a525c8b6-9b44-413b-a219-46e419b71b12':'0c39bed960626cc4d0a8f5380246be714e7374afaab3c2f622da78774846925e',
 'a03dc12d-8206-47be-b904-1f24e4e37d91':'eea064d972716c2b9d9b2a2817dccd2df5187166a25fc8fb8a7861890d97747c',
 'e148cbce-1b00-4d07-bb58-c1d56a4af0c7':'755f48c99c99b6d3febc9073b37a4822797975bba0640a8ad413d997bb3aecda',
}
SQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
IDENT=re.compile(r'[A-Za-z0-9_-]{1,128}')
UUID=re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
PUBLIC_NAMES={'_cf_KV','d1_migrations','probe','smoke_test','smoke_probe','test','counter','events'}
def digest(value):return hashlib.sha256(value.encode()).hexdigest()
class AuditError(ValueError):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None


def observe():
 token=os.environ.get('CLOUDFLARE_API_TOKEN','')
 out={'schema':'musitu.axiom.remaining_four_d1_observation.v1',
      'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'source_sha':os.environ.get('AXIOM_CHECKOUT_SHA'),'event_sha':os.environ.get('GITHUB_SHA'),
      'run_id':os.environ.get('GITHUB_RUN_ID'),'catalogs':{},'references':[],
      'workers':{'status':'UNKNOWN'},'pages':{'status':'UNKNOWN'},'transport':[],'errors':[],
      'catalog_sql_sha256':digest(SQL),'query_count':0,'query_zero_writes_confirmed':0,
      'customer_records_read':0,'intended_mutations':0,'provider_query_mutations':None,
      'target_admitted':False,'global_absence_certified':False,'backup_restore_qualified':False,
      'hosted_migration_qualified':False,'release_authority':False,'status':'INCOMPLETE'}
 scripts=set();envs=set();projects=set();pages_totals={};deadline=time.monotonic()+480
 opener=urllib.request.build_opener(NoRedirect)

 def fetch(path,kind,resource='',body=None):
  method='GET' if body is None else 'POST'
  allowed=path=='/workers/scripts' and body is None
  for database in CANDIDATES:
   base='/d1/database/'+database
   allowed|=path==base and body is None
   allowed|=path==base+'/query' and body=={'sql':SQL,'params':[]}
  for script in scripts:
   allowed|=path in ('/workers/scripts/'+script+'/settings','/workers/services/'+script) and body is None
  for script,env in envs:
   allowed|=path=='/workers/services/'+script+'/environments/'+env+'/bindings' and body is None
  allowed|=path in {'/pages/projects?per_page=10&page='+str(page) for page in range(1,18)} and body is None
  allowed|=path in {'/pages/projects/'+name for name in projects} and body is None
  remaining=deadline-time.monotonic()
  if not allowed:raise AuditError('UNADMITTED_REQUEST')
  if remaining<=0 or len(out['transport'])>=512:raise AuditError('REQUEST_BUDGET_EXHAUSTED')
  item={'kind':kind,'resource_sha256':digest(resource),'method':method,'http_status':None,'provider_error_codes':[]}
  out['transport'].append(item)
  if method=='POST':out['query_count']+=1
  req=urllib.request.Request(API+path,method=method,data=None if body is None else json.dumps(body).encode(),
      headers={'Authorization':'Bearer '+token,'Accept':'application/json','Content-Type':'application/json','User-Agent':'MUSITU-AXIOM-D1-Remaining-Four/1.0'})
  try:
   with opener.open(req,timeout=min(20,remaining)) as response:
    item['http_status']=response.status;raw=response.read(2_000_001)
   if item['http_status']!=200 or len(raw)>2_000_000:raise AuditError('INVALID_TRANSPORT')
   data=json.loads(raw)
   if not isinstance(data,dict) or data.get('success') is not True:raise AuditError('INVALID_ENVELOPE')
   if kind=='pages_list' and 'result_info' in data:
    info=data['result_info'];result=data.get('result')
    if not isinstance(info,dict) or not isinstance(result,list):raise AuditError('INVALID_PAGES_PAGINATION')
    expected={'page':int(resource),'per_page':10,'count':len(result)}
    if any(key in info and (type(info[key]) is not int or info[key]!=value) for key,value in expected.items()):
     raise AuditError('INCONSISTENT_PAGES_PAGINATION')
    for key in ('total_count','total_pages'):
     if key not in info:continue
     value=info[key]
     if type(value) is not int or value<0:raise AuditError('INVALID_PAGES_TOTAL')
     if key in pages_totals and pages_totals[key]!=value:raise AuditError('CHANGED_PAGES_TOTAL')
     pages_totals[key]=value
   return data.get('result')
  except urllib.error.HTTPError as error:
   item['http_status']=error.code
   if error.fp is not None:
    try:
     raw=error.read(2_000_001)
     if len(raw)<=2_000_000:
      body=json.loads(raw)
      errors=body.get('errors') if isinstance(body,dict) else None
      if isinstance(errors,list):item['provider_error_codes']=[r['code'] for r in errors if isinstance(r,dict) and type(r.get('code')) is int and 1000<=r['code']<=999999][:20]
    except (OSError,ValueError,TypeError,UnicodeError,http.client.HTTPException,RecursionError):pass
   raise AuditError('HTTP_FAILURE') from None

 def problem(section,error,resource=''):
  code=str(error) if isinstance(error,AuditError) else 'INVALID_RESPONSE'
  out['errors'].append({'section':section,'resource_sha256':digest(resource),'code':code})

 def refs(bindings,kind,consumer,environment=''):
  if not isinstance(bindings,list) or len(bindings)>1000:raise AuditError('INVALID_BINDINGS')
  names=set()
  for row in bindings:
   if not isinstance(row,dict) or not isinstance(row.get('type'),str):raise AuditError('INVALID_BINDINGS')
   if row['type']!='d1':continue
   if not isinstance(row.get('name'),str) or not IDENT.fullmatch(row['name']) or row['name'] in names or not isinstance(row.get('id'),str) or not UUID.fullmatch(row['id']):
    raise AuditError('INVALID_D1_BINDING')
   names.add(row['name'])
   if row['id'] in CANDIDATES:
    if len(out['references'])>=4096:raise AuditError('REFERENCE_BUDGET_EXCEEDED')
    out['references'].append({'database_id':row['id'],'kind':kind,'consumer_sha256':digest(consumer),
       'environment_sha256':digest(environment),'binding_sha256':digest(row['name'])})

 caught=(AuditError,OSError,ValueError,TypeError,UnicodeError,http.client.HTTPException,RecursionError)
 if token:
  for database,expected_name in CANDIDATES.items():
   try:
    base='/d1/database/'+database;meta=fetch(base,'database_metadata',database)
    if not isinstance(meta,dict) or meta.get('uuid')!=database or not isinstance(meta.get('name'),str) or digest(meta['name'])!=expected_name:
     raise AuditError('DATABASE_IDENTITY_MISMATCH')
    data=fetch(base+'/query','database_catalog',database,{'sql':SQL,'params':[]})
    if not isinstance(data,list) or len(data)!=1 or not isinstance(data[0],dict):raise AuditError('INVALID_QUERY_RESULT')
    result=data[0];m=result.get('meta')
    if result.get('success') is not True or not isinstance(m,dict) or m.get('changed_db') is not False or any(type(m.get(k)) is not int or m[k]!=0 for k in ('changes','rows_written')):
     raise AuditError('READ_ONLY_NOT_CONFIRMED')
    out['query_zero_writes_confirmed']+=1
    rows=result.get('results')
    if not isinstance(rows,list) or not 1<=len(rows)<=2000:raise AuditError('INVALID_CATALOG')
    objects=[];seen=set()
    for row in rows:
     if not isinstance(row,dict) or set(row)!={'type','name','tbl_name','sql'} or row['type'] not in ('table','index','trigger','view'):
      raise AuditError('INVALID_CATALOG_ROW')
     if any(not isinstance(row[k],str) or not IDENT.fullmatch(row[k]) for k in ('name','tbl_name')) or row['name'] in seen:raise AuditError('INVALID_CATALOG_IDENTITY')
     definition=row['sql']
     if not (isinstance(definition,str) and 0<len(definition)<=100000) and not (definition is None and row['type']=='index'):raise AuditError('INVALID_DEFINITION')
     seen.add(row['name']);objects.append({'type':row['type'],'name':row['name'] if row['name'] in PUBLIC_NAMES else None,
       'name_sha256':digest(row['name']),'table_sha256':digest(row['tbl_name']),'sql_sha256':None if definition is None else digest(definition)})
    out['catalogs'][database]={'status':'OBSERVED','name_sha256':expected_name,'objects':objects,
       'catalog_sha256':digest(json.dumps(rows,sort_keys=True,separators=(',',':')))}
   except caught as error:problem('catalog',error,database)

  try:
   rows=fetch('/workers/scripts','scripts_list')
   if not isinstance(rows,list) or len(rows)>160:raise AuditError('INVALID_SCRIPT_LIST')
   for row in rows:
    if not isinstance(row,dict) or not isinstance(row.get('id'),str) or not IDENT.fullmatch(row['id']) or row['id'] in scripts:raise AuditError('INVALID_SCRIPT_IDENTITY')
    scripts.add(row['id'])
   workers_ok=True
   for script in sorted(scripts):
    try:
     data=fetch('/workers/scripts/'+script+'/settings','script_settings',script)
     if not isinstance(data,dict):raise AuditError('INVALID_SCRIPT_SETTINGS')
     refs(data.get('bindings'),'worker_script',script)
    except caught as error:workers_ok=False;problem('script_settings',error,script)
    try:
     data=fetch('/workers/services/'+script,'service_metadata',script)
     if not isinstance(data,dict) or data.get('id')!=script or not isinstance(data.get('environments'),list) or len(data['environments'])>8:
      raise AuditError('INVALID_SERVICE_METADATA')
     default=data.get('default_environment')
     if not isinstance(default,dict) or not isinstance(default.get('environment'),str):raise AuditError('INVALID_DEFAULT_ENVIRONMENT')
     values=[default['environment']]
     for row in data['environments']:
      if not isinstance(row,dict) or not isinstance(row.get('environment'),str):raise AuditError('INVALID_ENVIRONMENT')
      values.append(row['environment'])
     if any(not IDENT.fullmatch(v) for v in values):raise AuditError('INVALID_ENVIRONMENT')
     for env in sorted(set(values)):
      envs.add((script,env))
      refs(fetch('/workers/services/'+script+'/environments/'+env+'/bindings','service_environment',script+'/'+env),'service_environment',script,env)
    except caught as error:workers_ok=False;problem('service_environment',error,script)
   out['workers']={'status':'OBSERVED_LISTED_SCRIPTS_AND_ENVIRONMENTS' if workers_ok else 'PARTIAL',
       'listed_scripts':len(scripts),'observed_environment_paths':len(envs),'global_absence_certified':False}
  except caught as error:problem('workers',error)

  try:
   terminal=False
   for page in range(1,18):
    rows=fetch('/pages/projects?per_page=10&page='+str(page),'pages_list',str(page))
    if not isinstance(rows,list) or len(rows)>10:raise AuditError('INVALID_PROJECT_LIST')
    if not rows:terminal=True;break
    for row in rows:
     if not isinstance(row,dict) or not isinstance(row.get('name'),str) or not IDENT.fullmatch(row['name']) or row['name'] in projects:raise AuditError('INVALID_PROJECT_IDENTITY')
     projects.add(row['name'])
    if len(projects)>160:raise AuditError('PROJECT_BUDGET_EXCEEDED')
   if not terminal:raise AuditError('PROJECT_PAGINATION_INCOMPLETE')
   if 'total_count' in pages_totals and pages_totals['total_count']!=len(projects):
    raise AuditError('INCONSISTENT_PAGES_TOTAL_COUNT')
   expected_pages=(len(projects)+9)//10
   if 'total_pages' in pages_totals and pages_totals['total_pages'] not in ({0,1} if not projects else {expected_pages}):
    raise AuditError('INCONSISTENT_PAGES_TOTAL_PAGES')
   pages_ok=True
   for project in sorted(projects):
    try:
     data=fetch('/pages/projects/'+project,'project_detail',project)
     if not isinstance(data,dict) or data.get('name')!=project or not isinstance(data.get('deployment_configs'),dict):raise AuditError('INVALID_PROJECT_DETAIL')
     for env in ('production','preview'):
      cfg=data['deployment_configs'].get(env)
      if not isinstance(cfg,dict):raise AuditError('INVALID_PROJECT_ENVIRONMENT')
      bindings=cfg.get('d1_databases',{})
      if not isinstance(bindings,dict):raise AuditError('INVALID_PAGES_D1_MAP')
      normalized=[]
      for name,row in bindings.items():
       if not isinstance(row,dict):raise AuditError('INVALID_PAGES_D1_BINDING')
       normalized.append({'type':'d1','name':name,'id':row.get('id')})
      refs(normalized,'pages_current_config',project,env)
    except caught as error:pages_ok=False;problem('pages_config',error,project)
   out['pages']={'status':'OBSERVED_CURRENT_CONFIGS' if pages_ok else 'PARTIAL','projects':len(projects),
       'empty_terminal_page':True,'historical_deployment_bindings_covered':False}
  except caught as error:problem('pages',error)
 else:out['errors'].append({'section':'input','code':'MISSING_TOKEN'})
 if out['query_count']==out['query_zero_writes_confirmed']:out['provider_query_mutations']=0
 all_ok=len(out['catalogs'])==len(CANDIDATES) and out['workers']['status']=='OBSERVED_LISTED_SCRIPTS_AND_ENVIRONMENTS' and out['pages']['status']=='OBSERVED_CURRENT_CONFIGS'
 out['status']='CURRENT_CATALOG_AND_BINDINGS_OBSERVED' if all_ok else 'PARTIAL_OBSERVATION'
 out['limitations']=['Current Pages configs do not establish historical deployment bindings.','Listed Worker/service scans do not prove absence of external D1 clients.','No global unused/private exposure or target reuse qualification.']
 path=Path('remaining-four-d1-audit.json');raw=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode()
 path.write_bytes(raw);Path(str(path)+'.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  '+str(path)+'\n')
 print(json.dumps(out,sort_keys=True));return 0 if all_ok else 1


if __name__=='__main__':raise SystemExit(observe())
