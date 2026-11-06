"""Independent synthetic boundary probes. No sockets, credentials or source writes."""
import contextlib,hashlib,http.client,importlib.util,io,json,os,socket,ssl,sys,urllib.request,urllib.error
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
SOURCE=Path('/workspace/scratch/cf664c251767/existing-d1-reuse/customer_frontier/qualification/existing_d1_reuse_inventory.py')
OUT=Path('/workspace/scratch/cf664c251767/reuse-review')
TOKEN='INDEPENDENT_SYNTHETIC_TOKEN'
PRIVATE='INDEPENDENT_PRIVATE_PROVIDER_VALUE'
ACCOUNT='93f395f5121954671f92fffa453d6b61'
PREFIX='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT
LIST='/d1/database?per_page=100&page=1'
BASE='/d1/database/'
PROTECTED={
 '504029cc-f9a5-495e-818f-63c6144b4ea4':'musitu-axiom-prod',
 'a7384b8a-0751-4705-ac77-0616b0885e7c':'mft-axiom-claude-staging-20260927',
 '4a62b374-7232-4103-b201-34443c467382':'mft-axiom-prod',
}
SPARE='77777777-7777-4777-8777-777777777777'
def denied(*args,**kwargs): raise AssertionError('independent-network-denied')
socket.socket=denied;socket.create_connection=denied

def base_payloads(n=4):
 rows=[{'uuid':k,'name':v} for k,v in PROTECTED.items()]
 rows.append({'uuid':SPARE,'name':'review-spare'})
 for i in range(n-4): rows.append({'uuid':f'{i+1:08x}-1111-4111-8111-111111111111','name':f'review-spare-{i}'})
 payloads={LIST:{'success':True,'result':rows,'result_info':{'page':1,'per_page':100,'count':len(rows),'total_count':len(rows)}}}
 for row in rows: payloads[BASE+row['uuid']]={'success':True,'result':{**row,'version':'production','file_size':16384,'num_tables':0,'plain_text':PRIVATE}}
 return payloads

def run_case(name,mutate=lambda d:None,n=4,raw_override=None,http_status=200,error=None,clock=None,expected='EXISTING_D1_METADATA_OBSERVED',expected_calls=None):
 spec=importlib.util.spec_from_file_location('review_inventory_subject',SOURCE)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 data=base_payloads(n);mutate(data);calls=[];files={};output=io.StringIO()
 class Response:
  status=http_status
  def __init__(self,value,index): self.value=value;self.index=index
  def __enter__(self):return self
  def __exit__(self,*args):return False
  def read(self,size):
   if self.index==2 and raw_override is not None:return raw_override
   return json.dumps(self.value).encode()[:size]
 class Opener:
  def open(self,req,timeout):
   calls.append(req)
   assert req.get_method()=='GET' and req.data is None
   assert req.full_url.startswith(PREFIX+'/d1/database')
   assert req.get_header('Authorization')=='Bearer '+TOKEN
   assert 0<timeout<=20
   if len(calls)==2 and error is not None:raise error
   return Response(data[req.full_url[len(PREFIX):]],len(calls))
 class Sink:
  def __init__(self,path):self.name=path
  def __str__(self):return self.name
  def write_bytes(self,raw):files[self.name]=raw
  def write_text(self,text):files[self.name]=text
 with contextlib.ExitStack() as stack:
  stack.enter_context(patch.object(module.urllib.request,'build_opener',return_value=Opener()))
  stack.enter_context(patch.object(module,'Path',Sink))
  stack.enter_context(patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':TOKEN,'AXIOM_CHECKOUT_SHA':'a53dca27ea2cf9ac285e64a20c03411b52c187d1'}))
  stack.enter_context(contextlib.redirect_stdout(output))
  if clock is not None:stack.enter_context(patch.object(module.time,'monotonic',side_effect=clock))
  rc=module.observe()
 raw=files['existing-d1-reuse-inventory.json'];result=json.loads(raw)
 assert result['status']==expected,(name,rc,result)
 assert (rc==0)==(expected=='EXISTING_D1_METADATA_OBSERVED')
 if expected_calls is not None:assert len(calls)==expected_calls,(name,len(calls))
 assert len(calls)<=21
 for key in ['target_admitted','binding_inventory_complete','backup_restore_qualified','hosted_migration_qualified','release_authority']:assert result[key] is False
 for key in ['mutations','sql_queries','customer_records_read','billing_changes']:assert result[key]==0
 if expected=='INCOMPLETE':assert result['followup_candidate_ids']==[] and result['databases']==[] and not result['inventory_complete']
 assert TOKEN not in output.getvalue() and PRIVATE not in output.getvalue()
 assert json.loads(output.getvalue())==result
 assert files['existing-d1-reuse-inventory.json.sha256']==hashlib.sha256(raw).hexdigest()+'  existing-d1-reuse-inventory.json\n'
 print(json.dumps({'case':name,'status':result['status'],'requests':len(calls),'candidate_count':len(result['followup_candidate_ids']),'mutations':result['mutations'],'target_admitted':result['target_admitted']}))
 return result

r=run_case('complete-four-database-observation',expected_calls=5)
assert r['followup_candidate_ids']==[SPARE]
r=run_case('maximum-twenty-databases',n=20,expected_calls=21);assert len(r['followup_candidate_ids'])==17
run_case('over-limit-inventory',n=21,expected='INCOMPLETE',expected_calls=1)
run_case('missing-total-count',lambda d:d[LIST]['result_info'].pop('total_count'),expected='INCOMPLETE',expected_calls=1)
run_case('float-page-not-integer',lambda d:d[LIST]['result_info'].update(page=1.0),expected='INCOMPLETE',expected_calls=1)
run_case('unexpected-per-page',lambda d:d[LIST]['result_info'].update(per_page=101),expected='INCOMPLETE',expected_calls=1)
run_case('success-integer-not-true',lambda d:d[LIST].update(success=1),expected='INCOMPLETE',expected_calls=1)
run_case('malicious-uuid',lambda d:d[LIST]['result'][0].update(uuid='https://foreign.example/'),expected='INCOMPLETE',expected_calls=1)
run_case('missing-file-size',lambda d:d[BASE+SPARE]['result'].pop('file_size'),expected='INCOMPLETE',expected_calls=5)
run_case('negative-file-size',lambda d:d[BASE+SPARE]['result'].update(file_size=-1),expected='INCOMPLETE',expected_calls=5)
run_case('boolean-file-size',lambda d:d[BASE+SPARE]['result'].update(file_size=False),expected='INCOMPLETE',expected_calls=5)
r=run_case('unknown-sensitive-version-is-redacted',lambda d:d[BASE+SPARE]['result'].update(version=PRIVATE),expected_calls=5)
assert r['followup_candidate_ids']==[] and r['databases'][-1]['version']=='UNKNOWN'
def rename_protected(d):
 key=next(iter(PROTECTED));d[LIST]['result'][0]['name']='renamed-protected';d[BASE+key]['result']['name']='renamed-protected'
r=run_case('renamed-protected-id-never-candidate',rename_protected,expected_calls=5)
assert r['databases'][0]['protected'] and r['databases'][0]['name'] is None
run_case('non-200-success-envelope',http_status=201,expected='INCOMPLETE',expected_calls=1)
run_case('oversize-response',raw_override=b'x'*2_000_001,expected='INCOMPLETE',expected_calls=2)
run_case('malformed-private-response',raw_override=PRIVATE.encode(),expected='INCOMPLETE',expected_calls=2)
run_case('truncated-response',error=http.client.IncompleteRead(PRIVATE.encode(),100),expected='INCOMPLETE',expected_calls=2)
run_case('redirect307-refused',error=urllib.error.HTTPError('https://foreign.example',307,PRIVATE,{},io.BytesIO(PRIVATE.encode())),expected='INCOMPLETE',expected_calls=2)
run_case('expired-request-start-deadline',clock=[0,181],expected='INCOMPLETE',expected_calls=0)
