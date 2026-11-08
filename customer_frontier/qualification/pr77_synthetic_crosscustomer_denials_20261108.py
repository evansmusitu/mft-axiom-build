"""Fixed-scope negative security acceptance: exactly two invalid synthetic OAuth writes.

The only D1 targeted for SQL is the newly-created synthetic PR77 test database.
Each attempted insert must be rejected by a named PR77 customer-isolation trigger.
No migration, cleanup, real identity mapping or production writes.
"""
import hashlib,json,os,urllib.error,urllib.request
from pathlib import Path

ACCOUNT='c954f0c842a486d0388c05b19cd21e47'
TARGET='1eff7a3d-b22b-4264-a0b8-196edf70074f'
PRESERVED='e36972b3-850d-4273-b934-2fa67587d9f1'
PLAN_SHA='6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a'
BASE='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/d1/database/'
SUBJECT='a'*64
CATALOG="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name"
COUNTS="""SELECT
 (SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT IN ('_cf_KV','_cf_METADATA')) AS tables,
 (SELECT count(*) FROM sqlite_master WHERE type='index' AND name NOT GLOB 'sqlite_*') AS indexes,
 (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name NOT GLOB 'sqlite_*') AS triggers,
 (SELECT count(*) FROM customers WHERE id='customer-a' AND status='active') AS customer_a_active,
 (SELECT count(*) FROM customers WHERE id='customer-b' AND status='active') AS customer_b_active,
 (SELECT count(*) FROM api_keys WHERE id='key-a' AND customer_id='customer-a' AND status='active') AS key_a_active,
 (SELECT count(*) FROM api_keys WHERE id='key-b' AND customer_id='customer-b' AND status='active') AS key_b_active,
 (SELECT count(*) FROM oauth_access_tokens WHERE token_hash='access-a' AND revoked_at IS NULL) AS access_a_live,
 (SELECT count(*) FROM oauth_refresh_tokens WHERE token_hash='refresh-a' AND revoked_at IS NULL) AS refresh_a_live,
 (SELECT count(*) FROM oauth_identity_links WHERE issuer='https://id.example.test' AND subject_sha256='__SUBJECT__' AND customer_id='customer-a' AND state='active') AS identity_link_a,
 (SELECT count(*) FROM oauth_identity_token_links WHERE api_key_id='key-a') AS token_link_a,
 (SELECT count(*) FROM oauth_identity_token_links WHERE api_key_id='key-b') AS token_link_b,
 (SELECT count(*) FROM oauth_identity_code_links WHERE code_hash='code-a') AS code_link_a,
 (SELECT count(*) FROM oauth_identity_code_links WHERE code_hash='code-b') AS code_link_b,
 (SELECT count(*) FROM oauth_identity_schema_versions WHERE version=2 AND plan_sha256='__PLAN__') AS reviewed_version_2,
 (SELECT count(*) FROM pragma_foreign_key_check) AS foreign_key_violations""".replace('__SUBJECT__',SUBJECT).replace('__PLAN__',PLAN_SHA)
DENIED_TOKEN="INSERT INTO oauth_identity_token_links(api_key_id,issuer,subject_sha256,customer_id,tenant_id) VALUES('key-b','https://id.example.test','"+SUBJECT+"','customer-a','tenant-a')"
DENIED_CODE="INSERT INTO oauth_identity_code_links(code_hash,issuer,subject_sha256,customer_id,tenant_id) VALUES('code-b','https://id.example.test','"+SUBJECT+"','customer-a','tenant-a')"
ATTACKS={'token':(DENIED_TOKEN,'identity_token_link_not_active'),
         'code':(DENIED_CODE,'identity_code_link_not_active')}
ALLOWED={'catalog':CATALOG,'counts':COUNTS,**{kind:sql for kind,(sql,_) in ATTACKS.items()}}
EXPECTED={'tables':9,'indexes':1,'triggers':21,'customer_a_active':1,'customer_b_active':1,
 'key_a_active':1,'key_b_active':1,'access_a_live':1,'refresh_a_live':1,'identity_link_a':1,
 'token_link_a':1,'token_link_b':0,'code_link_a':1,'code_link_b':0,
 'reviewed_version_2':1,'foreign_key_violations':0}

class Reject(ValueError):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None
OPENER=urllib.request.build_opener(NoRedirect())
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=True)
def sha(v):return hashlib.sha256(v.encode()).hexdigest()

def validate_denial(kind,status,response):
 if kind not in ATTACKS or status not in (200,400,409,422):
  raise Reject('DENIAL_PROVIDER_HTTP_UNQUALIFIED')
 if not isinstance(response,dict):raise Reject('DENIAL_RESPONSE_NOT_JSON')
 if ATTACKS[kind][1] not in canonical(response):
  raise Reject('REVIEWED_TRIGGER_DENIAL_NOT_OBSERVED_'+kind)
 result=response.get('result')
 if isinstance(result,list) and any(isinstance(x,dict) and x.get('success') is True for x in result):
  raise Reject('FORBIDDEN_INSERT_MAY_HAVE_SUCCEEDED_'+kind)
 return True

def validate_counts(rows):
 if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict) or set(rows[0])!=set(EXPECTED):
  raise Reject('SYNTHETIC_COUNTS_SHAPE_UNQUALIFIED')
 if any(type(v) is not int for v in rows[0].values()) or rows[0]!=EXPECTED:
  raise Reject('SYNTHETIC_BASELINE_DRIFT')
 return rows[0]

def observe(fetch):
 src=fetch('target_metadata')
 if not isinstance(src,dict) or src.get('uuid')!=TARGET or src.get('name')!='axiom-pr77-synthetic-only-20261108':
  raise Reject('SYNTHETIC_TARGET_IDENTITY_DRIFT')
 protected=fetch('preserved_metadata')
 if not isinstance(protected,dict) or protected.get('uuid')!=PRESERVED or protected.get('name')!='axiom-disposable-dr-target-20261108':
  raise Reject('PRESERVED_RECOVERY_IDENTITY_DRIFT')
 original_catalog=fetch('catalog')
 if not isinstance(original_catalog,list) or any(not isinstance(row,dict) for row in original_catalog):
  raise Reject('CATALOG_OBJECT_COUNT_DRIFT')
 user_catalog=[row for row in original_catalog if row.get('name') not in ('_cf_KV','_cf_METADATA')]
 if len(user_catalog)!=31:
  raise Reject('CATALOG_OBJECT_COUNT_DRIFT')
 initial_schema=sha(canonical(original_catalog))
 initial_counts=validate_counts(fetch('counts'))
 confirmed=[]
 for kind in ('token','code'):
  status,response=fetch(kind)
  validate_denial(kind,status,response)
  confirmed.append(kind)
 ending_catalog=fetch('catalog')
 if not isinstance(ending_catalog,list) or sha(canonical(ending_catalog))!=initial_schema:
  raise Reject('CATALOG_CHANGED_AFTER_DENIAL')
 if validate_counts(fetch('counts'))!=initial_counts:
  raise Reject('SYNTHETIC_ROW_STATE_CHANGED_AFTER_DENIAL')
 return {'schema':'musitu.axiom.pr77_hosted_synthetic_crosscustomer_denial.v1',
  'status':'TWO_CROSSCUSTOMER_PR77_TRIGGER_DENIALS_NO_RESIDUE_PASS',
  'synthetic_database_id':TARGET,'preserved_recovery_database_id':PRESERVED,
  'reviewed_plan_sha256':PLAN_SHA,'confirmed_denial_types':confirmed,
  'before_after_schema_sha256':initial_schema,'synthetic_state_unchanged':True,
  'provider_zero_write_select_queries':4,'real_customer_data_read':False,
  'production_oauth_modified':False,'real_identity_qualified':False,
  'production_tenant_isolation_qualified':False,'release_authority':False}

def live_fetch(token):
 if not token or '\n' in token or '\r' in token:raise Reject('SCOPED_SECRET_UNAVAILABLE')
 calls=0
 def fetch(kind):
  nonlocal calls
  calls+=1
  if calls>8:raise Reject('PROVIDER_CALL_BUDGET_EXCEEDED')
  if kind=='target_metadata':method='GET';url=BASE+TARGET;body=None
  elif kind=='preserved_metadata':method='GET';url=BASE+PRESERVED;body=None
  elif kind in ALLOWED:
   method='POST';url=BASE+TARGET+'/query';body=canonical({'sql':ALLOWED[kind],'params':[]}).encode()
  else:raise Reject('UNAPPROVED_OPERATION')
  headers={'Authorization':'Bearer '+token,'Accept':'application/json','User-Agent':'MUSITU-AXIOM-PR77-SyntheticIsolation-20261108'}
  if body is not None:headers['Content-Type']='application/json'
  request=urllib.request.Request(url,method=method,data=body,headers=headers)
  try:
   with OPENER.open(request,timeout=20) as r:status=r.status;raw=r.read(1000001)
  except urllib.error.HTTPError as e:status=e.code;raw=e.read(1000001)
  except (urllib.error.URLError,OSError,TimeoutError):raise Reject('PROVIDER_RESPONSE_UNKNOWN_NO_RETRY')
  if len(raw)>1000000:raise Reject('PROVIDER_RESPONSE_TOO_LARGE')
  try:payload=json.loads(raw)
  except (UnicodeError,ValueError):raise Reject('PROVIDER_JSON_UNQUALIFIED')
  if kind in ATTACKS:return status,payload
  if status!=200 or not isinstance(payload,dict) or payload.get('success') is not True:
   raise Reject('PROVIDER_READ_UNQUALIFIED')
  if method=='GET':return payload.get('result')
  arr=payload.get('result')
  if not isinstance(arr,list) or len(arr)!=1 or not isinstance(arr[0],dict) or arr[0].get('success') is not True:
   raise Reject('PROVIDER_SELECT_ENVELOPE_UNQUALIFIED')
  meta=arr[0].get('meta')
  if not isinstance(meta,dict) or meta.get('changed_db') is not False or type(meta.get('changes')) is not int or meta['changes']!=0 or type(meta.get('rows_written')) is not int or meta['rows_written']!=0:
   raise Reject('PROVIDER_SELECT_ZERO_WRITES_UNQUALIFIED')
  return arr[0].get('results')
 return fetch

def main():
 try:out=observe(live_fetch(os.environ.get('AXIOM_CUSTOMER_STAGING_CF_API_TOKEN','')));code=0
 except Reject as e:
  out={'schema':'musitu.axiom.pr77_hosted_synthetic_crosscustomer_denial.v1',
   'status':'UNQUALIFIED','reason_code':str(e),'synthetic_database_id':TARGET,
   'production_oauth_modified':False,'release_authority':False};code=1
 except Exception:
  out={'schema':'musitu.axiom.pr77_hosted_synthetic_crosscustomer_denial.v1',
   'status':'UNQUALIFIED','reason_code':'UNKNOWN_PROVIDER_OR_VALIDATOR_ERROR',
   'synthetic_database_id':TARGET,'production_oauth_modified':False,'release_authority':False};code=1
 p=Path('axiom-pr77-synthetic-denials-20261108.json')
 p.write_text(canonical(out)+'\n')
 print(canonical(out))
 return code
if __name__=='__main__':raise SystemExit(main())
