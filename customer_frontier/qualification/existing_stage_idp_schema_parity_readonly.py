"""Read-only pinned one-database identity session schema and row-count verifier.
NO private row values, SQL DML/DDL, DB reset, key storage, or service binding.
A matching schema still does not qualify shared customer/IdP custody.
"""
import hashlib,json,os,sqlite3,urllib.request,urllib.error
from pathlib import Path

ACCOUNT='93f395f5121954671f92fffa453d6b61'
DATABASE='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
NAME_SHA='7e98510fc457a669c29dd85ab1d87cc758fe0ba74d0833c20863b53d599b5b36'
BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'+DATABASE
CATALOG="SELECT type,name,sql FROM sqlite_schema WHERE name GLOB 'customer_idp_*' ORDER BY type,name"
COUNTS=("SELECT (SELECT COUNT(*) FROM customer_idp_flows_v1) AS flows,"
" (SELECT COUNT(*) FROM customer_idp_sessions_v1) AS sessions,"
" (SELECT COUNT(*) FROM customer_idp_flows_v1 WHERE status='pending') AS pending_flows,"
" (SELECT COUNT(*) FROM customer_idp_flows_v1 WHERE status='processing') AS processing_flows,"
" (SELECT COUNT(*) FROM customer_idp_sessions_v1 WHERE status='active') AS active_sessions,"
" (SELECT COUNT(*) FROM customer_idp_sessions_v1 WHERE status='active'"
" AND expires_at_ms > unixepoch('now')*1000) AS unexpired_active_sessions")
COUNT_KEYS=frozenset(('flows','sessions','pending_flows','processing_flows','active_sessions','unexpired_active_sessions'))
ALLOWED=frozenset((CATALOG,COUNTS))
SCHEMA=Path(__file__).resolve().parents[1]/'customer_control_plane/zitadel_session_broker_candidate.sql'
EXPECTED_SOURCE_BLOB='8ee3d092d2634e7fc44fc65db4b44e9fce2058fc'

class Reject(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'))
def sha(s):return hashlib.sha256((s if isinstance(s,bytes) else s.encode())).hexdigest()

def local_schema():
 db=sqlite3.connect(':memory:')
 try:
  db.executescript(SCHEMA.read_text(encoding='utf8'))
  return [dict(zip(('type','name','sql'),x)) for x in
   db.execute("SELECT type,name,sql FROM sqlite_schema WHERE name GLOB 'customer_idp_*' ORDER BY type,name").fetchall()]
 finally:db.close()

def parse_sql(result,kind):
 if not isinstance(result,dict) or result.get('success') is not True or not isinstance(result.get('result'),list) or len(result['result'])!=1:raise Reject('D1_SQL_ENVELOPE_INVALID')
 p=result['result'][0];m=p.get('meta') if isinstance(p,dict) else None
 if not isinstance(m,dict) or m.get('changed_db') is not False or type(m.get('changes')) is not int or m['changes']!=0 or type(m.get('rows_written')) is not int or m['rows_written']!=0:raise Reject('D1_SQL_ZERO_WRITE_UNCONFIRMED')
 rows=p.get('results')
 if not isinstance(rows,list):raise Reject('D1_SQL_RESULTS_INVALID')
 if kind=='catalog':
  if len(rows)>30 or any(not isinstance(x,dict) or set(x)!={'type','name','sql'} or not x['name'].startswith('customer_idp_') for x in rows):raise Reject('D1_CATALOG_BOUNDS_INVALID')
 else:
  if len(rows)!=1 or not isinstance(rows[0],dict) or set(rows[0])!=COUNT_KEYS or any(type(rows[0][k]) is not int or rows[0][k]<0 for k in COUNT_KEYS):raise Reject('D1_ROW_COUNTS_INVALID')
  c=rows[0]
  if c['pending_flows']+c['processing_flows']>c['flows'] or c['unexpired_active_sessions']>c['active_sessions'] or c['active_sessions']>c['sessions']:raise Reject('D1_ROW_COUNTS_INCONSISTENT')
 return rows

def run():
 token=os.environ.get('CLOUDFLARE_API_TOKEN','')
 if not token or any(c in token for c in '\n\r'):raise Reject('TOKEN_MISSING')
 api=urllib.request.build_opener(NoRedirect)
 def read(path='',sql=None):
  if path not in ('','/query') or (path=='' and sql is not None) or (path=='/query' and sql not in ALLOWED):raise Reject('API_PATH_OR_SQL_DENIED')
  body=canonical({'sql':sql,'params':[]}).encode() if sql is not None else None
  h={'Authorization':'Bearer '+token,'Accept':'application/json'}
  if body:h['content-type']='application/json'
  req=urllib.request.Request(BASE+path,data=body,method='POST' if body else 'GET',headers=h)
  try:
   with api.open(req,timeout=17) as resp:
    if resp.status!=200:raise Reject('D1_PROVIDER_HTTP_NOT_200')
    b=resp.read(90001)
  except urllib.error.HTTPError as e:raise Reject('D1_PROVIDER_HTTP_'+str(e.code)) from None
  except (OSError,TimeoutError):raise Reject('D1_PROVIDER_UNAVAILABLE') from None
  if len(b)>90000:raise Reject('D1_PROVIDER_OVERSIZE')
  try:return json.loads(b.decode('utf8'))
  except (UnicodeError,ValueError):raise Reject('D1_PROVIDER_JSON_INVALID')
 try:
  metadata=read().get('result')
  if not isinstance(metadata,dict) or metadata.get('uuid')!=DATABASE or sha(metadata.get('name',''))!=NAME_SHA:raise Reject('PINNED_DATABASE_IDENTITY_MISMATCH')
  actual=parse_sql(read('/query',CATALOG),'catalog')
  expected=local_schema()
  same=canonical(actual)==canonical(expected)
  counts=parse_sql(read('/query',COUNTS),'counts')[0]
  state={'schema':'AXIOM_EXISTING_STAGE_IDP_SCHEMA_PARITY_READONLY_V1',
   'status':'SCHEMA_PARITY_PASS_NO_ADOPTION' if same else 'SCHEMA_MISMATCH_NO_ADOPTION',
   'source_d1':DATABASE,'source_name_matches_pinned_sha':True,
   'reviewed_source_sql_git_blob':EXPECTED_SOURCE_BLOB,
   'expected_object_count':len(expected),'observed_object_count':len(actual),
   'schema_exact_match':same,'expected_schema_sha256':sha(canonical(expected)),
   'observed_schema_sha256':sha(canonical(actual)),
   'flows_rows_observed':counts['flows'],'sessions_rows_observed':counts['sessions'],
   'pending_flow_count':counts['pending_flows'],'processing_flow_count':counts['processing_flows'],
   'active_session_count':counts['active_sessions'],
   'unexpired_active_session_count':counts['unexpired_active_sessions'],
   'provider_operations':['GET','POST_SELECT_ONLY'],'provider_writes':0,
   'customer_row_values_read':0,'no_bindings_or_grants_changed':True,
   'cross_service_custody_qualified':False,'database_reuse_qualified':False,
   'production_idp_enabled':False,'release_authority':False}
  code=0 if same else 2
 except Reject as e:
  state={'schema':'AXIOM_EXISTING_STAGE_IDP_SCHEMA_PARITY_READONLY_V1',
   'status':str(e),'provider_writes':0,'database_reuse_qualified':False,'release_authority':False}
  code=2
 out=(json.dumps(state,sort_keys=True,indent=2)+'\n').encode()
 p=Path('axiom-existing-staging-idp-schema-parity.json');p.write_bytes(out)
 p.with_name(p.name+'.sha256').write_text(sha(out)+'  '+p.name+'\n')
 print('EXISTING_STAGE_IDP_SCHEMA='+state['status']+' WRITES=0')
 return code

if __name__=='__main__':raise SystemExit(run())
