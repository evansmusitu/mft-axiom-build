"""Independent offline probes of immutable Pages-only reader."""
import contextlib,hashlib,http.client,importlib.util,io,json,os,socket,ssl,sys,unittest,urllib.error,urllib.request
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'existing-d1-pages/customer_frontier/qualification/existing_d1_pages_only.py'
FIRST='2571795a-80fe-4f63-9b95-07948b4cefdb'
THIRD='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'
P='PRIVATE_PROJECT_SENTINEL'
def listing(page):return '/pages/projects?per_page=10&page='+str(page)
def env(result):return {'success':True,'result':result}

class IndependentPages(unittest.TestCase):
 def run_case(self,change=None,error=None,clock=None,token='PRIVATE_TOKEN_SENTINEL'):
  spec=importlib.util.spec_from_file_location('independent_pages_subject',SOURCE)
  m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  data={listing(1):env([{'name':P}]),listing(2):env([]),'/pages/projects/'+P:env({'name':P,'deployment_configs':{'production':{'env_vars':{'PRIVATE_SECRET_SENTINEL':{'value':'PRIVATE_VALUE_SENTINEL'}}},'preview':{}}})}
  if change:change(data)
  calls=[];files={};stdout=io.StringIO()
  class Response:
   status=200
   def __init__(self,value):self.value=value
   def __enter__(self):return self
   def __exit__(self,*_):return False
   def read(self,n):return (self.value if isinstance(self.value,bytes) else json.dumps(self.value).encode())[:n]
  class Opener:
   def open(self,req,timeout):
    calls.append((req,timeout));path=req.full_url[len(m.API):]
    if error:raise error
    if path not in data:raise AssertionError('Unexpected request: '+path)
    return Response(data[path])
  class Sink:
   def __init__(self,path):self.path=path
   def __str__(self):return self.path
   def write_bytes(self,b):files[self.path]=b
   def write_text(self,b):files[self.path]=b
  def deny(*_,**__):raise AssertionError('Network forbidden')
  with contextlib.ExitStack() as stack:
   for name in ('socket','create_connection'):stack.enter_context(patch.object(socket,name,deny))
   stack.enter_context(patch.object(m.urllib.request,'build_opener',return_value=Opener()))
   stack.enter_context(patch.object(m,'Path',Sink));stack.enter_context(patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':token}));stack.enter_context(contextlib.redirect_stdout(stdout))
   if clock:stack.enter_context(patch.object(m.time,'monotonic',side_effect=clock))
   rc=m.observe()
  out=json.loads(files['existing-d1-pages-only.json'])
  for secret in (P,'PRIVATE_TOKEN_SENTINEL','PRIVATE_BINDING_SENTINEL','PRIVATE_SECRET_SENTINEL','PRIVATE_VALUE_SENTINEL','PRIVATE_ERROR_SENTINEL'):
   self.assertNotIn(secret,stdout.getvalue())
  for flag in ('target_admitted','global_absence_certified','backup_restore_qualified','hosted_migration_qualified','release_authority','historical_deployment_bindings_covered'):
   self.assertIs(out[flag],False)
  self.assertEqual(out['database_queries'],0);self.assertEqual(out['mutations'],0)
  for req,timeout in calls:
   self.assertEqual(req.get_method(),'GET');self.assertIsNone(req.data)
   self.assertTrue(req.full_url.startswith(m.API+'/pages/projects'))
   self.assertNotIn('/d1/',req.full_url);self.assertNotIn('/workers/',req.full_url)
   self.assertEqual(req.get_header('Authorization'),'Bearer '+token)
   self.assertGreater(timeout,0);self.assertLessEqual(timeout,20)
  self.assertLessEqual(len(calls),200)
  self.assertTrue(files['existing-d1-pages-only.json.sha256'].startswith(hashlib.sha256(files['existing-d1-pages-only.json']).hexdigest()+'  '))
  return rc,out,calls

 def test_maximum160_projects_uses17_lists_and160_gets(self):
  def change(d):
   d.clear()
   for page in range(1,17):
    names=['PRIVATE_PROJECT_'+str((page-1)*10+i) for i in range(10)]
    d[listing(page)]=env([{'name':name} for name in names]);d[listing(page)]['result_info']={'page':page,'per_page':10,'count':10,'total_count':160,'total_pages':16}
    for name in names:d['/pages/projects/'+name]=env({'name':name,'deployment_configs':{'production':{},'preview':{}}})
   d[listing(17)]=env([]);d[listing(17)]['result_info']={'page':17,'per_page':10,'count':0,'total_count':160,'total_pages':16}
  rc,out,calls=self.run_case(change);self.assertEqual(rc,0);self.assertEqual(out['projects_observed'],160);self.assertEqual(len(calls),177)

 def test161_projects_never_gets_details_or_admits_complete(self):
  def change(d):
   for page in range(1,18):d[listing(page)]=env([{'name':'PRIVATE_PROJECT_'+str((page-1)*10+i)} for i in range(10 if page<17 else 1)])
  rc,out,calls=self.run_case(change);self.assertEqual(rc,1);self.assertEqual(out['status'],'UNKNOWN');self.assertEqual(len(calls),17)
  self.assertTrue(any(e['code']=='PROJECT_BUDGET_EXCEEDED' for e in out['errors']))

 def test_original_contradictory_totals_and_one_page_only_totals_rejected(self):
  for p in (1,2):
   for key,value in (('total_count',3),('total_pages',2)):
    with self.subTest(page=p,key=key):
     rc,out,_=self.run_case(lambda d:d[listing(p)].update(result_info={key:value}));self.assertEqual(rc,1);self.assertEqual(out['status'],'UNKNOWN')

 def test_integer_and_total_stability_boundaries(self):
  for key in ('page','count','per_page','total_count','total_pages'):
   for value in (True,'1',1.0,None,-1):
    with self.subTest(key=key,value=value):
     rc,_,_=self.run_case(lambda d:d[listing(1)].update(result_info={key:value}));self.assertEqual(rc,1)
  def change(d):d[listing(1)].update(result_info={'total_count':1});d[listing(2)].update(result_info={'total_count':2})
  rc,_,_=self.run_case(change);self.assertEqual(rc,1)

 def test_seven_digit_errors_retained_only_safe_actual_ints(self):
  codes=[8000007,8000024,2147483647,2147483648,True,'8000007',8000007.0,999,-1]
  err=urllib.error.HTTPError('https://foreign.example/PRIVATE_ERROR_SENTINEL',400,'PRIVATE_ERROR_SENTINEL',{},io.BytesIO(json.dumps({'errors':[{'code':c,'message':'PRIVATE_ERROR_SENTINEL'} for c in codes]}).encode()))
  rc,out,calls=self.run_case(error=err);self.assertEqual(rc,1);self.assertEqual(len(calls),1);self.assertEqual(out['transport'][0]['provider_error_codes'],[8000007,8000024,2147483647])

 def test_preview_and_production_refs_are_hashed(self):
  def change(d):
   for environment,key in (('production',FIRST),('preview',THIRD)):
    d['/pages/projects/'+P]['result']['deployment_configs'][environment]={'d1_databases':{'PRIVATE_BINDING_SENTINEL':{'id':key}},'env_vars':{'SECRET':{'value':'PRIVATE_VALUE_SENTINEL'}}}
  rc,out,_=self.run_case(change);self.assertEqual(rc,0);self.assertEqual(len(out['references']),2)
  self.assertEqual({r['database_id'] for r in out['references']},{FIRST,THIRD})
  self.assertTrue(all(len(r['consumer_sha256'])==64 and len(r['binding_sha256'])==64 for r in out['references']))

 def test_injected_project_and_wrong_detail_identity_stay_unknown(self):
  for name in ('../PRIVATE_ERROR_SENTINEL','x?PRIVATE_ERROR_SENTINEL','x/PRIVATE_ERROR_SENTINEL','x%2fPRIVATE_ERROR_SENTINEL'):
   rc,out,calls=self.run_case(lambda d:d[listing(1)].update(result=[{'name':name}]))
   self.assertEqual(rc,1);self.assertEqual(len(calls),1)
  def change(d):d['/pages/projects/'+P]['result']['name']='another'
  rc,out,_=self.run_case(change);self.assertEqual(rc,1);self.assertEqual(out['status'],'PARTIAL')

 def test_raw_json_size_null_map_and_wrong_binding_key_fail_closed(self):
  for raw in (b'x'*2_000_001,b'{PRIVATE_ERROR_SENTINEL',b'null',b'[]'):
   rc,out,_=self.run_case(lambda d:d.update({listing(1):raw}));self.assertEqual(rc,1);self.assertEqual(out['status'],'UNKNOWN')
  for value in (None,{'DB':{'database_id':FIRST}},{'DB':{'id':FIRST.upper()}}):
   def change(d):d['/pages/projects/'+P]['result']['deployment_configs']['production']['d1_databases']=value
   rc,out,_=self.run_case(change);self.assertEqual(rc,1);self.assertEqual(out['status'],'PARTIAL')

 def test_missing_token_or_expired_deadline_emits_unknown_without_requests(self):
  rc,out,calls=self.run_case(token='');self.assertEqual(rc,1);self.assertEqual(calls,[])
  ticks=iter([0,1000]);rc,out,calls=self.run_case(clock=lambda:next(ticks));self.assertEqual(rc,1);self.assertEqual(calls,[])

 def test_redirect_handler_refuses_new_target(self):
  spec=importlib.util.spec_from_file_location('independent_redirect',SOURCE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  self.assertIsNone(m.NoRedirect().redirect_request(None,None,307,None,None,'https://evil.example'))

if __name__=='__main__':unittest.main(verbosity=2)
