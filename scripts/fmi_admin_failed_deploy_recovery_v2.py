import json,os,urllib.error,urllib.parse,urllib.request
API=os.environ['CF_API'].rstrip('/');AID=os.environ['ACCOUNT_ID'];DBID=os.environ['FMI_DB_UUID'];WORKER=os.environ['ADMIN_WORKER'];HOST=os.environ['ADMIN_HOST']
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Recovery-V2/1.1'}
def cf(path,method='GET',obj=None):
 h=dict(H);b=None
 if obj is not None:h['Content-Type']='application/json';b=json.dumps(obj,separators=(',',':')).encode()
 q=urllib.request.Request(API+path,headers=h,method=method,data=b)
 try:
  with urllib.request.urlopen(q,timeout=45) as r:c=r.status;raw=r.read()
 except urllib.error.HTTPError as e:c=e.code;raw=e.read()
 if not 200<=c<300:raise RuntimeError(f'CF HTTP {c}: {method} {path}')
 x=json.loads(raw or b'{}')
 if isinstance(x,dict) and x.get('success') is False:raise RuntimeError('CF success=false '+path)
 return x.get('result') if isinstance(x,dict) else None
def d1(sql):
 rr=cf(f'/accounts/{AID}/d1/database/{DBID}/query','POST',{'sql':sql}) or [];rows=[]
 if not rr or not all(x.get('success') is True for x in rr):raise RuntimeError('D1 failed')
 for x in rr:rows.extend(x.get('results') or [])
 return rows
cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain','POST',{'enabled':False,'previews_enabled':False})
sub=cf(f'/accounts/{AID}/workers/scripts/{urllib.parse.quote(WORKER,safe="")}/subdomain') or {}
if sub.get('enabled') is not False or sub.get('previews_enabled') is not False:raise RuntimeError('workers.dev closure failed')
domains=cf(f'/accounts/{AID}/workers/domains') or []
admin_domains=[d for d in domains if isinstance(d,dict) and (d.get('hostname')==HOST or d.get('service')==WORKER)]
if admin_domains:raise RuntimeError('refusing incomplete-run cleanup because admin custom domain already exists')
tables={r.get('name') for r in d1("SELECT name FROM sqlite_master WHERE type='table'")}
admin_tables=['fmi_admin_sessions','fmi_admin_credentials','fmi_admin_bootstrap_tokens','fmi_admin_audit_events','fmi_admin_login_events']
for t in admin_tables:
 if t in tables:d1(f'DELETE FROM {t}')
# Only remove identities created by the admin deployment smoke test. Child rows are verified ON DELETE CASCADE.
synthetic_before=0
if 'customers' in tables:
 synthetic_before=int((d1("SELECT COUNT(*) AS n FROM customers WHERE email LIKE 'admin-e2e-%@example.invalid'")[0] or {}).get('n') or 0)
 if synthetic_before:d1("DELETE FROM customers WHERE email LIKE 'admin-e2e-%@example.invalid'")
 synthetic_after=int((d1("SELECT COUNT(*) AS n FROM customers WHERE email LIKE 'admin-e2e-%@example.invalid'")[0] or {}).get('n') or 0)
 if synthetic_after!=0:raise RuntimeError('synthetic admin customer residue remains')
else:synthetic_after=0
counts={t:(int((d1(f'SELECT COUNT(*) AS n FROM {t}')[0] or {}).get('n') or 0) if t in tables else None) for t in admin_tables}
if any(v not in (0,None) for v in counts.values()):raise RuntimeError('admin residue remains')
print(json.dumps({'gate':'FMI_ADMIN_FAILED_DEPLOY_RECOVERY_V2_PASS','workers_dev_enabled':False,'previews_enabled':False,'admin_domain_count':0,'admin_table_counts':counts,'synthetic_customer_rows_removed':synthetic_before,'synthetic_customer_rows_remaining':synthetic_after,'customer_mutation_scope':'SYNTHETIC_ADMIN_E2E_ONLY','secret_values_published':False},sort_keys=True))
