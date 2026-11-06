"""Execute reviewed inline reader with synthetic transport; no sockets or source writes."""
from pathlib import Path
from unittest.mock import patch
import contextlib,copy,hashlib,http.client,io,json,os,socket,urllib.error,urllib.request
source=Path('/workspace/scratch/cf664c251767/hosted-gate-review/oauth-binding-inline-reviewed.py').read_text()
DB='504029cc-f9a5-495e-818f-63c6144b4ea4';API='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61'
settings='/workers/scripts/musitu-axiom-oauth/settings';dbpath='/d1/database/'+DB
private='PRIVATE_SETTING_DO_NOT_DISCLOSE_123'
def run(case,mutate=lambda p:None,fail_at=None,error=None,token='SYNTHETIC_TOKEN_ONLY',status=200,raw_override=None,expected=1,expected_calls=None):
 payload=[{'success':True,'result':{'bindings':[{'name':'SECRET_PRIVATE','type':'plain_text','text':private},{'name':'AXIOM_DB','type':'d1','id':DB}]}},{'success':True,'result':{'uuid':DB,'name':'musitu-axiom-prod'}}]
 mutate(payload);calls=[];files={}
 class Response:
  def __init__(self,data):self.status=status;self.data=data
  def __enter__(self):return self
  def __exit__(self,*args):return False
  def read(self,n):return raw_override[:n] if raw_override is not None else json.dumps(self.data).encode()[:n]
 class Opener:
  def open(self,request,timeout):
   calls.append(request);assert timeout==20
   assert request.get_method()=='GET' and request.data is None
   assert request.full_url in (API+settings,API+dbpath)
   assert request.get_header('Authorization')=='Bearer '+token
   if fail_at==len(calls):raise error
   return Response(payload[len(calls)-1])
 class Sink:
  def __init__(self,name):self.name=name
  def __str__(self):return self.name
  def write_bytes(self,data):files[self.name]=data
  def write_text(self,data):files[self.name]=data
 stdout=io.StringIO();namespace={}
 with patch.object(urllib.request,'build_opener',return_value=Opener()),patch('pathlib.Path',Sink),patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':token}),patch.object(socket,'socket',side_effect=AssertionError('network denied')),contextlib.redirect_stdout(stdout):
  try:exec(compile(source,'reviewed-inline','exec'),namespace)
  except SystemExit as e:rc=e.code
 assert private not in stdout.getvalue() and 'SECRET_PRIVATE' not in stdout.getvalue() and 'SYNTHETIC_TOKEN_ONLY' not in stdout.getvalue() and 'PRIVATE_EXCEPTION_DETAIL' not in stdout.getvalue()
 evidence=json.loads(files['oauth-binding-readonly.json']);assert rc==expected,(case,rc,evidence)
 assert evidence['mutations']==evidence['sql_queries']==evidence['customer_records_read']==0
 assert evidence['raw_settings_disclosed'] is False and evidence['hosted_migration_qualified'] is False and evidence['release_authority'] is False
 assert files['oauth-binding-readonly.json.sha256'].split()[0]==hashlib.sha256(files['oauth-binding-readonly.json']).hexdigest()
 assert namespace['NoRedirect']().redirect_request(None,None,302,None,None,'https://foreign.invalid') is None
 if expected_calls is not None:assert len(calls)==expected_calls,(case,len(calls))
 assert len(calls)<=2
 if rc==0:assert evidence['status']=='OAUTH_BINDING_IDENTITY_OBSERVED' and evidence['binding_identity_observed'] and evidence['database_identity_observed']
 else:assert evidence['status']=='INCOMPLETE'
 print(json.dumps({'case':case,'exit':rc,'status':evidence['status'],'requests':len(calls),'error':evidence['error'],'private_values_disclosed':False}))
run('matching_identity_and_unrelated_private_binding',expected=0,expected_calls=2)
run('wrong_binding_id',lambda p:p[0]['result']['bindings'][1].update(id='foreign-db'),expected_calls=1)
run('duplicate_binding',lambda p:p[0]['result']['bindings'].append(copy.deepcopy(p[0]['result']['bindings'][1])),expected_calls=1)
run('secret_instead_of_d1',lambda p:p[0]['result']['bindings'][1].update(type='secret_text',text=private),expected_calls=1)
run('missing_binding',lambda p:p[0]['result']['bindings'].pop(),expected_calls=1)
run('invalid_binding_row',lambda p:p[0]['result']['bindings'].append(private),expected_calls=1)
run('wrong_settings_shape',lambda p:p[0].update(result=[]),expected_calls=1)
run('wrong_binding_list_shape',lambda p:p[0]['result'].update(bindings={}),expected_calls=1)
run('binding_name_mismatch',lambda p:p[0]['result']['bindings'][1].update(name='AXIOM_DB_OTHER'),expected_calls=1)
run('wrong_db_uuid',lambda p:p[1]['result'].update(uuid='foreign-db'),expected_calls=2)
run('wrong_db_name',lambda p:p[1]['result'].update(name='foreign-name'),expected_calls=2)
run('malformed_db_metadata',lambda p:p[1].update(result=[]),expected_calls=2)
run('missing_token',token='',expected_calls=0)
run('settings_redirect302',fail_at=1,error=urllib.error.HTTPError('https://foreign.invalid',302,'PRIVATE_EXCEPTION_DETAIL',{},None),expected_calls=1)
run('db_redirect307',fail_at=2,error=urllib.error.HTTPError('https://foreign.invalid',307,'PRIVATE_EXCEPTION_DETAIL',{},None),expected_calls=2)
run('truncated_db_response',fail_at=2,error=http.client.IncompleteRead(b'PRIVATE_EXCEPTION_DETAIL',100),expected_calls=2)
run('transport_error',fail_at=1,error=OSError('PRIVATE_EXCEPTION_DETAIL'),expected_calls=1)
run('malformed_json',raw_override=b'PRIVATE_EXCEPTION_DETAIL',expected_calls=1)
run('oversized_response',raw_override=b'x'*2_000_001,expected_calls=1)
run('non200_response',status=500,expected_calls=1)
run('unsuccessful_envelope',lambda p:p[0].update(success=False),expected_calls=1)
