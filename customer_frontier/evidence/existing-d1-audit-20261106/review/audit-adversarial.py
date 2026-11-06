"""Independent synthetic D1 audit probes. Network and subject file output blocked."""
import contextlib
import copy
import hashlib
import http.client
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import ssl
import sys
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'existing-d1-audit/customer_frontier/qualification/existing_d1_catalog_binding_audit.py'
FIRST = '2571795a-80fe-4f63-9b95-07948b4cefdb'
PROTECTED = {'504029cc-f9a5-495e-818f-63c6144b4ea4','a7384b8a-0751-4705-ac77-0616b0885e7c','4a62b374-7232-4103-b201-34443c467382'}
WORKER = 'PRIVATE_WORKER_SENTINEL'
PROJECT = 'PRIVATE_PROJECT_SENTINEL'
S1 = '/pages/projects?page=1&per_page=100'
S2 = '/pages/projects?page=2&per_page=100'
P = '/pages/projects/' + PROJECT
W = '/workers/scripts/' + WORKER + '/settings'
M = '/workers/services/' + WORKER
E = M + '/environments/production/bindings'
Q = '/d1/database/' + FIRST + '/query'
FLAGS = ('target_admitted','global_absence_certified','backup_restore_qualified','hosted_migration_qualified','release_authority')

def envelope(result): return {'success': True, 'result': result}

class IndependentAudit(unittest.TestCase):
 def run_case(self, mutate=None, fail=None, token='PRIVATE_TOKEN_SENTINEL', clock=None):
  spec = importlib.util.spec_from_file_location('independent_audit_subject', SOURCE)
  module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
  names = {key: 'SYNTHETIC_DB_' + str(i) for i,key in enumerate(module.CANDIDATES)}
  module.CANDIDATES = {key:hashlib.sha256(value.encode()).hexdigest() for key,value in names.items()}
  data = {'/workers/scripts':envelope([{'id':WORKER}]), W:envelope({'bindings':[]}),
   M:envelope({'id':WORKER,'default_environment':{'environment':'production'},'environments':[]}), E:envelope([]),
   S1:envelope([{'name':PROJECT}]), S2:envelope([]),
   P:envelope({'name':PROJECT,'deployment_configs':{'production':{'env_vars':{'PRIVATE_ENV_SENTINEL':{'value':'PRIVATE_VALUE_SENTINEL'}}},'preview':{}}})}
  for key,name in names.items():
   data['/d1/database/'+key] = envelope({'uuid':key,'name':name})
   data['/d1/database/'+key+'/query'] = envelope([{'success':True,'meta':{'changed_db':False,'changes':0,'rows_written':0},'results':[
    {'type':'table','name':'PRIVATE_TABLE_SENTINEL','tbl_name':'PRIVATE_TABLE_SENTINEL','sql':"CREATE TABLE PRIVATE_TABLE_SENTINEL(a TEXT DEFAULT 'PRIVATE_LITERAL_SENTINEL')"}]}])
  if mutate: mutate(data)
  calls=[]; files={}; output=io.StringIO()
  class Response:
   status=200
   def __init__(self,value): self.value=value
   def __enter__(self): return self
   def __exit__(self,*_): return False
   def read(self,size):
    return (self.value if isinstance(self.value,bytes) else json.dumps(self.value).encode())[:size]
  class FakeOpener:
   def open(self,req,timeout):
    self_timeout = timeout
    calls.append((req,self_timeout))
    path=req.full_url[len(module.API):]
    if fail and path in fail: raise fail[path]
    if path not in data: raise AssertionError('Unexpected synthetic request path: '+path)
    return Response(data[path])
  class OutputPath:
   def __init__(self,name): self.name=name
   def __str__(self):return self.name
   def write_bytes(self,raw): files[self.name]=raw
   def write_text(self,raw): files[self.name]=raw
  def no_socket(*_,**__):raise AssertionError('Network forbidden in independent review')
  with contextlib.ExitStack() as stack:
   stack.enter_context(patch.object(socket,'socket',no_socket)); stack.enter_context(patch.object(socket,'create_connection',no_socket))
   stack.enter_context(patch.object(module.urllib.request,'build_opener',return_value=FakeOpener()))
   stack.enter_context(patch.object(module,'Path',OutputPath))
   stack.enter_context(patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':token}))
   stack.enter_context(contextlib.redirect_stdout(output))
   if clock: stack.enter_context(patch.object(module.time,'monotonic',side_effect=clock))
   rc=module.observe()
  result=json.loads(files['existing-d1-catalog-binding-audit.json'])
  raw=output.getvalue()
  for value in ('PRIVATE_TOKEN_SENTINEL',WORKER,PROJECT,'PRIVATE_TABLE_SENTINEL','PRIVATE_LITERAL_SENTINEL','PRIVATE_ENV_SENTINEL','PRIVATE_VALUE_SENTINEL','PRIVATE_ERROR_SENTINEL'):
   self.assertNotIn(value,raw)
  for flag in FLAGS:self.assertIs(result[flag],False)
  for req,timeout in calls:
   self.assertGreater(timeout,0);self.assertLessEqual(timeout,20)
   self.assertTrue(req.full_url.startswith(module.API+'/'))
   self.assertFalse(any(key in req.full_url for key in PROTECTED))
   self.assertEqual(req.get_header('Authorization'),'Bearer '+token)
   if req.get_method()=='POST':
    self.assertIn(req.full_url,[module.API+'/d1/database/'+key+'/query' for key in names])
    self.assertEqual(json.loads(req.data),{'sql':module.SQL,'params':[]})
   else:self.assertEqual(req.get_method(),'GET');self.assertIsNone(req.data)
  self.assertLessEqual(sum(req.get_method()=='POST' for req,_ in calls),3)
  self.assertLessEqual(len(calls),512)
  digest=hashlib.sha256(files['existing-d1-catalog-binding-audit.json']).hexdigest()
  self.assertTrue(files['existing-d1-catalog-binding-audit.json.sha256'].startswith(digest+'  '))
  return rc,result,calls

 def test_positive_reference_on_all_three_surfaces_hashes_labels(self):
  def mutate(d):
   d[W]['result']['bindings']=[{'type':'d1','name':'PRIVATE_BINDING_A','id':FIRST}]
   d[E]['result']=[{'type':'d1','name':'PRIVATE_BINDING_B','id':FIRST}]
   d[P]['result']['deployment_configs']['preview']={'d1_databases':{'PRIVATE_BINDING_C':{'id':FIRST}}}
  rc,result,_=self.run_case(mutate);self.assertEqual(rc,0)
  self.assertEqual({r['kind'] for r in result['references']},{'worker_script','service_environment','pages_current_config'})
  for row in result['references']:
   self.assertEqual(len(row['consumer_sha256']),64);self.assertEqual(len(row['binding_sha256']),64)

 def test_original_contradictory_optional_totals_are_rejected(self):
  def mutate(d):
   for p,count in ((1,1),(2,0)):
    d['/pages/projects?page='+str(p)+'&per_page=100']['result_info']={'page':p,'count':count,'per_page':100,'total_count':3,'total_pages':2}
  rc,result,_=self.run_case(mutate);self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'UNKNOWN')
  self.assertTrue(any(r['code']=='INCONSISTENT_PAGES_TOTAL_COUNT' for r in result['errors']))

 def test_optional_total_only_on_terminal_or_first_is_still_enforced(self):
  for path in (S1,S2):
   for field,value in (('total_count',2),('total_pages',2)):
    with self.subTest(path=path,field=field):
     rc,result,_=self.run_case(lambda d:d[path].update(result_info={field:value}))
     self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'UNKNOWN')

 def test_optional_total_type_and_stability_rejects_false_evidence(self):
  for field in ('total_count','total_pages'):
   for value in (False,1.0,'1',None,-1):
    with self.subTest(field=field,value=value):
     rc,_,_=self.run_case(lambda d:d[S1].update(result_info={field:value}));self.assertEqual(rc,1)
   def mutate(d):d[S1].update(result_info={field:1});d[S2].update(result_info={field:0})
   rc,_,_=self.run_case(mutate);self.assertEqual(rc,1)

 def test_missing_totals_and_coherent_totals_remain_observations_only(self):
  for info in (None,{'total_count':1,'total_pages':1}):
   def mutate(d):
    if info is not None:
     d[S1]['result_info']=copy.deepcopy(info);d[S2]['result_info']=copy.deepcopy(info)
   rc,result,_=self.run_case(mutate);self.assertEqual(rc,0);self.assertEqual(result['status'],'CURRENT_CATALOG_AND_BINDINGS_OBSERVED')

 def test_identity_path_injection_never_becomes_request(self):
  for section in ('script','project','env'):
   with self.subTest(section=section):
    def mutate(d):
     if section=='script':d['/workers/scripts']['result']=[{'id':'../PRIVATE_ERROR_SENTINEL'}]
     if section=='project':d[S1]['result']=[{'name':'evil?PRIVATE_ERROR_SENTINEL'}]
     if section=='env':d[M]['result']['environments']=[{'environment':'x/PRIVATE_ERROR_SENTINEL'}]
    rc,result,calls=self.run_case(mutate);self.assertEqual(rc,1)
    self.assertFalse(any('PRIVATE_ERROR_SENTINEL' in req.full_url for req,_ in calls))

 def test_missing_identity_prevents_catalog_query(self):
  def mutate(d):d['/d1/database/'+FIRST]['result']['uuid']='another'
  rc,result,calls=self.run_case(mutate);self.assertEqual(rc,1)
  self.assertFalse(any(req.full_url.endswith(Q) for req,_ in calls));self.assertNotIn(FIRST,result['catalogs'])

 def test_zero_write_confirmation_requires_exact_boolean_and_integer_types(self):
  for field,value in (('changed_db',0),('changed_db',None),('changes',False),('changes',0.0),('rows_written',False),('rows_written',1)):
   with self.subTest(field=field,value=value):
    rc,result,_=self.run_case(lambda d:d[Q]['result'][0]['meta'].update({field:value}))
    self.assertEqual(rc,1);self.assertIsNone(result['provider_query_mutations']);self.assertNotIn(FIRST,result['catalogs'])

 def test_partial_privacy_and_http_errors_remain_unknown(self):
  for status in (301,307,403,404,500):
   with self.subTest(status=status):
    error=urllib.error.HTTPError('https://evil.example/PRIVATE_ERROR_SENTINEL',status,'PRIVATE_ERROR_SENTINEL',{},io.BytesIO(json.dumps({'errors':[{'code':10000,'message':'PRIVATE_ERROR_SENTINEL'}]}).encode()))
    rc,result,_=self.run_case(fail={M:error});self.assertEqual(rc,1);self.assertEqual(result['workers']['status'],'PARTIAL')
    self.assertTrue(any(row['provider_error_codes']==[10000] for row in result['transport']))

 def test_null_or_missing_environments_never_default_to_empty(self):
  for mutate in (lambda d:d[M]['result'].pop('environments'), lambda d:d[M]['result'].update(default_environment=None),lambda d:d[E].update(result=None)):
   rc,result,_=self.run_case(mutate);self.assertEqual(rc,1);self.assertEqual(result['workers']['status'],'PARTIAL')

 def test_pages_uses_id_and_both_configs(self):
  for env in ('production','preview'):
   def mutate(d):d[P]['result']['deployment_configs'][env]={'d1_databases':{'DB':{'database_id':FIRST}}}
   rc,result,_=self.run_case(mutate);self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'PARTIAL')

 def test_catalog_rows_and_missing_query_results_remain_unknown(self):
  for value in ([],None,{},[{'type':'table','name':'PRIVATE_TABLE_SENTINEL','tbl_name':'PRIVATE_TABLE_SENTINEL','sql':None}]):
   rc,result,_=self.run_case(lambda d:d[Q]['result'][0].update(results=value));self.assertEqual(rc,1);self.assertNotIn(FIRST,result['catalogs'])

 def test_response_size_and_invalid_json_fail_closed(self):
  for raw in (b'x'*2_000_001,b'{PRIVATE_ERROR_SENTINEL',b'[]',b'null'):
   rc,result,_=self.run_case(lambda d:d.update({S1:raw}));self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'UNKNOWN')

 def test_expired_deadline_and_missing_token_make_no_request(self):
  rc,result,calls=self.run_case(token='');self.assertEqual(rc,1);self.assertEqual(calls,[])
  ticks=iter([0]+[1000]*20)
  rc,result,calls=self.run_case(clock=lambda:next(ticks));self.assertEqual(rc,1);self.assertEqual(calls,[])

 def test_redirect_handler_refuses_destination(self):
  spec=importlib.util.spec_from_file_location('audit_redirect_subject',SOURCE)
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  self.assertIsNone(module.NoRedirect().redirect_request(None,None,302,None,None,'https://evil.example/'))

if __name__=='__main__':unittest.main(verbosity=2)
