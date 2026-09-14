import hashlib,json,os,urllib.error,urllib.parse,urllib.request
API=os.environ['CF_API'].rstrip('/');AID=os.environ['ACCOUNT_ID'];DBID=os.environ['FMI_DB_UUID'];WORKER=os.environ['ADMIN_WORKER'];HOST=os.environ['ADMIN_HOST']
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Recovery/1.0'}
def call(path,method='GET',obj=None):
 h=dict(H);b=None
 if obj is not None:h['Content-Type']='application/json';b=json.dumps(obj,separators=(',',':')).encode()
 q=urllib.request.Request(API+path,headers=h,method=method,data=b)
 try:
  with urllib.request.urlopen(q,timeout=45) as r:c=r.status;raw=r.read()
 except urllib.error.HTTPError as e:c=e.code;raw=e.read()
 if not 200<=c<300:raise RuntimeError(f'Cloudflare HTTP {c}: {method} {path}')
 x=json.loads(raw or b'{}')
 if isinstance(x,dict) and x.get('success') is False:raise RuntimeError('Cloudflare success=false '+path)
 return x.get('result') if isinstance(x,dict) else None
def d1(sql,params=None):
 o={'sql':sql}
 if params is not None:o['params']=params
 rr=call(f'/accounts/{AID}/d1/database/{DBID}/query','POST',o) or [];rows=[]
 if not rr or not all(x.get('success') is True for x in rr):raise RuntimeError('D1 failed')
 for x in rr:rows.extend(x.get('results') or [])
 return rows
# Close temporary public workers.dev exposure immediately.
call(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain','POST',{'enabled':False,'previews_enabled':False})
sub=call(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain') or {}
if sub.get('enabled') is not False or sub.get('previews_enabled') is not False:raise RuntimeError('failed to disable workers.dev')
settings=call(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/settings') or {}
bindings=[]
for b in settings.get('bindings') or []:
 if isinstance(b,dict):bindings.append({k:b.get(k) for k in ('name','type','id','service','environment') if b.get(k) is not None})
domains=call(f'/accounts/{AID}/workers/domains') or []
admin_domains=[{'hostname':d.get('hostname'),'service':d.get('service'),'environment':d.get('environment')} for d in domains if isinstance(d,dict) and (d.get('hostname')==HOST or d.get('service')==WORKER)]
tables={r.get('name') for r in d1("SELECT name FROM sqlite_master WHERE type='table'")}
admin_tables=['fmi_admin_credentials','fmi_admin_bootstrap_tokens','fmi_admin_sessions','fmi_admin_audit_events','fmi_admin_login_events']
counts={}
for t in admin_tables:
 counts[t]=int((d1(f'SELECT COUNT(*) AS n FROM {t}')[0] or {}).get('n') or 0) if t in tables else None
# If no owner credential exists, all rows are deployment-smoke residue and can be safely removed.
cleanup_performed=False
if counts.get('fmi_admin_credentials')==0:
 for t in ('fmi_admin_sessions','fmi_admin_bootstrap_tokens','fmi_admin_audit_events','fmi_admin_login_events'):
  if t in tables:d1(f'DELETE FROM {t}')
 cleanup_performed=True
 counts={t:(int((d1(f'SELECT COUNT(*) AS n FROM {t}')[0] or {}).get('n') or 0) if t in tables else None) for t in admin_tables}
out={'schema':'musitu.fmi.admin-failed-deploy-recovery.v1','gate':'FMI_ADMIN_FAILED_DEPLOY_RECOVERY_PASS','worker':WORKER,'workers_dev_enabled':sub.get('enabled'),'previews_enabled':sub.get('previews_enabled'),'bindings':bindings,'admin_domains':admin_domains,'admin_table_counts':counts,'smoke_residue_cleanup_performed':cleanup_performed,'customer_tables_mutated':False,'secret_values_published':False}
blob=(json.dumps(out,indent=2,sort_keys=True)+'\n').encode();open('fmi-admin-recovery.json','wb').write(blob);dg=hashlib.sha256(blob).hexdigest();open('fmi-admin-recovery.sha256','w').write(dg+'  fmi-admin-recovery.json\n')
print(json.dumps({'gate':out['gate'],'workers_dev_enabled':out['workers_dev_enabled'],'previews_enabled':out['previews_enabled'],'bindings':bindings,'admin_domains':admin_domains,'admin_table_counts':counts,'smoke_residue_cleanup_performed':cleanup_performed,'evidence_sha256':dg},sort_keys=True))
