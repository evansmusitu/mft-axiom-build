import json,os,re,urllib.error,urllib.request
API=os.environ['CF_API'].rstrip('/');AID=os.environ['ACCOUNT_ID'];DBID=os.environ['FMI_DB_UUID']
H={'X-Auth-Email':os.environ['CLOUDFLARE_EMAIL'],'X-Auth-Key':os.environ['CLOUDFLARE_GLOBAL_API_KEY'],'Content-Type':'application/json','Accept':'application/json','User-Agent':'MUSITU-FMI-Admin-Status-Schema/1.0'}
def q(sql):
 body=json.dumps({'sql':sql},separators=(',',':')).encode();req=urllib.request.Request(f'{API}/accounts/{AID}/d1/database/{DBID}/query',headers=H,method='POST',data=body)
 try:
  with urllib.request.urlopen(req,timeout=45) as r:c=r.status;raw=r.read()
 except urllib.error.HTTPError as e:c=e.code;raw=e.read()
 if c!=200:raise RuntimeError(f'D1 HTTP {c}')
 x=json.loads(raw or b'{}');rr=x.get('result') or []
 if not rr or not all(z.get('success') is True for z in rr):raise RuntimeError('D1 failed')
 out=[]
 for z in rr:out.extend(z.get('results') or [])
 return out
row=q("SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'")
if len(row)!=1:raise RuntimeError('customers schema cardinality mismatch')
sql=str(row[0].get('sql') or '')
# Publish only status constraint tokens, not the full schema text.
status_literals=[]
for m in re.finditer(r"status[^,)]{0,500}",sql,re.I):
 status_literals += re.findall(r"['\"]([A-Za-z0-9_-]{1,32})['\"]",m.group(0))
status_literals=sorted(set(x.lower() for x in status_literals if x.lower() not in ('status','text','not','null','default','check','in')))
distinct=[{'status':str(r.get('status')),'count':int(r.get('c') or 0)} for r in q('SELECT status,COUNT(*) AS c FROM customers GROUP BY status ORDER BY status')]
print(json.dumps({'gate':'FMI_ADMIN_CUSTOMER_STATUS_SCHEMA_READONLY_PASS','status_constraint_literals':status_literals,'observed_statuses':distinct,'schema_text_published':False,'row_identity_published':False,'mutation_performed':False},sort_keys=True))
