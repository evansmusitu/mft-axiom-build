"""Read-only schema-name inventory for existing primary-account D1 identity sessions.
No customer rows, table DDL, SQL mutation, database creation or binding changes.
A matching schema name is NOT permission to reuse a database.
"""
import hashlib,json,os,re,urllib.request,urllib.error
from pathlib import Path

ACCOUNT="93f395f5121954671f92fffa453d6b61"
ROOT="https://api.cloudflare.com/client/v4/accounts/"+ACCOUNT
SQL="SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('customer_idp_flows_v1','customer_idp_sessions_v1') ORDER BY name"
NAMES=['customer_idp_flows_v1','customer_idp_sessions_v1']
class Reject(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None

def parse_catalog(o):
 if not isinstance(o,dict) or o.get('success') is not True:raise Reject('D1_INVENTORY_NOT_VERIFIED')
 rows=o.get('result');p=o.get('result_info')
 if not isinstance(rows,list) or len(rows)!=11 or not isinstance(p,dict) or any(type(p.get(k)) is not int for k in ('page','count','total_count')) or p['page']!=1 or p['count']!=11 or p['total_count']!=11:raise Reject('D1_INVENTORY_INCOMPLETE_OR_CHANGED')
 if any(not isinstance(x,dict) or not re.fullmatch(r'[a-f0-9-]{36}',str(x.get('uuid',''))) or not isinstance(x.get('name'),str) for x in rows):raise Reject('D1_INVENTORY_INVALID')
 if len({x['uuid'] for x in rows})!=11 or len({x['name'] for x in rows})!=11:raise Reject('D1_IDENTITY_COLLISION')
 return rows

def parse_query(o):
 if not isinstance(o,dict) or o.get('success') is not True:raise Reject('D1_QUERY_NOT_VERIFIED')
 x=o.get('result')
 if not isinstance(x,list) or len(x)!=1 or x[0].get('success') is not True:raise Reject('D1_QUERY_NOT_VERIFIED')
 x=x[0];m=x.get('meta')
 if not isinstance(m,dict) or m.get('changed_db') is not False or type(m.get('changes')) is not int or m['changes']!=0 or type(m.get('rows_written')) is not int or m['rows_written']!=0:raise Reject('D1_QUERY_NOT_PROVEN_ZERO_WRITE')
 rows=x.get('results')
 if not isinstance(rows,list) or len(rows)>2 or any(not isinstance(r,dict) or set(r)!={'name'} or r['name'] not in NAMES for r in rows):raise Reject('D1_SCHEMA_RESULT_INVALID')
 if len({r['name'] for r in rows})!=len(rows):raise Reject('D1_SCHEMA_DUPLICATE')
 return {r['name'] for r in rows}

def run(fetch=None):
 token=os.environ.get('CLOUDFLARE_API_TOKEN','')
 if not token or '\n' in token or '\r' in token:raise Reject('TOKEN_MISSING')
 allowed_prefix=ROOT+'/d1/database'
 def provider(path,body=None):
  method='POST' if body is not None else 'GET'
  if method=='GET' and path!='/d1/database?per_page=100&page=1':raise Reject('API_GET_DENIED')
  if method=='POST' and (not re.fullmatch(r'/d1/database/[0-9a-f-]{36}/query',path) or body!={'sql':SQL,'params':[]}):raise Reject('API_POST_DENIED')
  url=ROOT+path
  if not url.startswith(allowed_prefix):raise Reject('WRONG_ROOT')
  h={'Authorization':'Bearer '+token,'Accept':'application/json'}
  rawbody=json.dumps(body,separators=(',',':')).encode() if body else None
  if rawbody:h['content-type']='application/json'
  try:
   with urllib.request.build_opener(NoRedirect).open(urllib.request.Request(url,data=rawbody,headers=h,method=method),timeout=17) as resp:
    if resp.status!=200:raise Reject('PROVIDER_HTTP_NOT_200')
    raw=resp.read(85001)
  except urllib.error.HTTPError as e:raise Reject('PROVIDER_HTTP_'+str(e.code)) from None
  except (OSError,TimeoutError):raise Reject('PROVIDER_NETWORK_UNKNOWN') from None
  if len(raw)>85000:raise Reject('PROVIDER_RESPONSE_TOO_LARGE')
  try:return json.loads(raw.decode('utf-8'))
  except (UnicodeError,ValueError):raise Reject('PROVIDER_JSON_INVALID')
 calls=0
 try:
  invoke=fetch if fetch is not None else provider
  inventory=parse_catalog(invoke('/d1/database?per_page=100&page=1'));calls+=1
  candidates=[]
  for item in inventory:
   names=parse_query(invoke('/d1/database/'+item['uuid']+'/query',{'sql':SQL,'params':[]}));calls+=1
   if names==set(NAMES):
    candidates.append({'database_id':item['uuid'],'both_names_present':True,'adoption_qualified':False})
  result={'schema':'AXIOM_PRIMARY_D1_IDP_SCHEMA_READONLY_V1','status':'D1_SCHEMA_NAMES_INVENTORIED_NO_ADOPTION',
   'databases_checked':len(inventory),'candidate_count':len(candidates),'candidates':candidates,
   'query_sql_sha256':hashlib.sha256(SQL.encode()).hexdigest(),
   'method_allowlist':['GET','POST_SELECT_ONLY'],'requests':calls,'database_writes':0,
   'customer_rows_read':0,'database_created':False,'binding_changed':False,
   'schema_identity_verified':False,'reuse_authorized':False,'release_authority':False}
  exitcode=0
 except Reject as e:
  result={'schema':'AXIOM_PRIMARY_D1_IDP_SCHEMA_READONLY_V1','status':str(e),'requests_observed':calls,
   'database_writes':0,'customer_rows_read':0,'reuse_authorized':False,'release_authority':False}
  exitcode=2
 raw=(json.dumps(result,indent=2,sort_keys=True)+'\n').encode()
 p=Path('axiom-primary-idp-d1-schema-readonly.json');p.write_bytes(raw)
 p.with_name(p.name+'.sha256').write_text(hashlib.sha256(raw).hexdigest()+'  '+p.name+'\n')
 print('PRIMARY_IDP_SCHEMA_READ='+result['status']+' WRITES=0')
 return exitcode

if __name__=='__main__':raise SystemExit(run())
