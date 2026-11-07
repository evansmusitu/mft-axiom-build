"""Synthetic catalogs/settings only; all network and output files intercepted."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

SOURCE=Path(__file__).resolve().parents[1]/'qualification/remaining_four_d1_audit.py'


class CatalogBindings(unittest.TestCase):
 def run_subject(self,mutate=lambda data:None,exception=None,exception_path=None,token='SYNTHETIC_TOKEN'):
  spec=importlib.util.spec_from_file_location('catalog_bindings',SOURCE)
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  ids=list(module.CANDIDATES);names=['synthetic_candidate_'+str(i) for i in range(4)]
  module.CANDIDATES={key:hashlib.sha256(name.encode()).hexdigest() for key,name in zip(ids,names)}
  worker='PRIVATE_WORKER_ALIAS';project='PRIVATE_PROJECT_ALIAS'
  data={'/workers/scripts':{'success':True,'result':[{'id':worker}]},
   '/workers/scripts/'+worker+'/settings':{'success':True,'result':{'bindings':[{'type':'plain_text','name':'SECRET','text':'PRIVATE_SETTING_VALUE'}]}},
   '/workers/services/'+worker:{'success':True,'result':{'id':worker,'default_environment':{'environment':'production'},'environments':[]}},
   '/workers/services/'+worker+'/environments/production/bindings':{'success':True,'result':[]},
   '/pages/projects?per_page=10&page=1':{'success':True,'result':[{'name':project}]},
   '/pages/projects?per_page=10&page=2':{'success':True,'result':[]},
   '/pages/projects/'+project:{'success':True,'result':{'name':project,'deployment_configs':{'production':{'d1_databases':{},'env_vars':{'SECRET':{'value':'PRIVATE_SETTING_VALUE'}}},'preview':{}}}}}
  for key,name in zip(ids,names):
   data['/d1/database/'+key]={'success':True,'result':{'uuid':key,'name':name}}
   data['/d1/database/'+key+'/query']={'success':True,'result':[{'success':True,'meta':{'changed_db':False,'changes':0,'rows_written':0},'results':[
    {'type':'table','name':'PRIVATE_TABLE_ALIAS','tbl_name':'PRIVATE_TABLE_ALIAS','sql':"CREATE TABLE PRIVATE_TABLE_ALIAS(secret TEXT DEFAULT 'PRIVATE_DDL_LITERAL')"}]}]}
  mutate(data);calls=[];files={}
  class Response:
   status=200
   def __init__(self,payload):self.payload=payload
   def __enter__(self):return self
   def __exit__(self,*args):return False
   def read(self,size):return json.dumps(self.payload).encode()[:size]
  class Opener:
   def open(self,req,timeout):
    calls.append(req);path=req.full_url[len(module.API):]
    if exception and path==exception_path:raise exception
    return Response(data[path])
  class Sink:
   def __init__(self,name):self.name=name
   def __str__(self):return self.name
   def write_bytes(self,raw):files[self.name]=raw
   def write_text(self,raw):files[self.name]=raw
  output=io.StringIO()
  with patch.object(module.urllib.request,'build_opener',return_value=Opener()),patch.object(module,'Path',Sink),patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':token}),contextlib.redirect_stdout(output):
   rc=module.observe()
  for secret in ['SYNTHETIC_TOKEN','PRIVATE_WORKER_ALIAS','PRIVATE_PROJECT_ALIAS','PRIVATE_TABLE_ALIAS','PRIVATE_SETTING_VALUE','PRIVATE_DDL_LITERAL','PRIVATE_ERROR']:
   self.assertNotIn(secret,output.getvalue())
  posts=[]
  for req in calls:
   self.assertTrue(req.full_url.startswith(module.API+'/'))
   if req.get_method()=='POST':
    posts.append(req);self.assertIn(req.full_url,[module.API+'/d1/database/'+key+'/query' for key in ids]);self.assertEqual(json.loads(req.data),{'sql':module.SQL,'params':[]})
   else:self.assertEqual(req.get_method(),'GET');self.assertIsNone(req.data)
  self.assertLessEqual(len(posts),4)
  result=json.loads(files['remaining-four-d1-audit.json'])
  for flag in ['target_admitted','global_absence_certified','backup_restore_qualified','hosted_migration_qualified','release_authority']:self.assertFalse(result[flag])
  return rc,result,calls

 def test_complete_current_scope_does_not_claim_global_absence_or_admit(self):
  rc,result,calls=self.run_subject();self.assertEqual(rc,0);self.assertEqual(result['query_zero_writes_confirmed'],4)
  self.assertEqual(result['provider_query_mutations'],0);self.assertEqual(result['references'],[])
  self.assertFalse(result['pages']['historical_deployment_bindings_covered'])

 def test_name_identity_change_blocks_that_catalog(self):
  first='b043cc1b-dc6c-4031-9f36-f2331728e062'
  rc,result,_=self.run_subject(lambda d:d['/d1/database/'+first]['result'].update(name='different'))
  self.assertEqual(rc,1);self.assertNotIn(first,result['catalogs'])

 def test_changed_db_true_keeps_mutations_unknown(self):
  path='/d1/database/b043cc1b-dc6c-4031-9f36-f2331728e062/query'
  rc,result,_=self.run_subject(lambda d:d[path]['result'][0]['meta'].update(changed_db=True))
  self.assertEqual(rc,1);self.assertIsNone(result['provider_query_mutations'])

 def test_missing_counter_is_not_read_only_confirmation(self):
  path='/d1/database/b043cc1b-dc6c-4031-9f36-f2331728e062/query'
  rc,result,_=self.run_subject(lambda d:d[path]['result'][0]['meta'].pop('rows_written'))
  self.assertEqual(rc,1);self.assertIsNone(result['provider_query_mutations'])

 def test_malformed_catalog_has_no_partial_catalog_admission(self):
  path='/d1/database/b043cc1b-dc6c-4031-9f36-f2331728e062/query'
  rc,result,_=self.run_subject(lambda d:d[path]['result'][0]['results'][0].update(private='PRIVATE_ERROR'))
  self.assertEqual(rc,1);self.assertEqual(len(result['catalogs']),3)

 def test_pages_permission_denial_is_unknown_not_empty(self):
  path='/pages/projects?per_page=10&page=1'
  error=urllib.error.HTTPError('https://foreign.example',403,'PRIVATE_ERROR',{},None)
  rc,result,_=self.run_subject(exception=error,exception_path=path)
  self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'UNKNOWN')

 def test_provider_error_codes_retained_without_private_messages(self):
  path='/pages/projects?per_page=10&page=1'
  body=io.BytesIO(json.dumps({'success':False,'errors':[{'code':10000,'message':'PRIVATE_ERROR'}]}).encode())
  error=urllib.error.HTTPError('https://foreign.example',403,'PRIVATE_ERROR',{},body)
  rc,result,_=self.run_subject(exception=error,exception_path=path);self.assertEqual(rc,1)
  self.assertTrue(any(row['provider_error_codes']==[10000] for row in result['transport']))

 def test_service_404_is_unknown_not_no_environments(self):
  path='/workers/services/PRIVATE_WORKER_ALIAS'
  error=urllib.error.HTTPError('https://foreign.example',404,'PRIVATE_ERROR',{},None)
  rc,result,_=self.run_subject(exception=error,exception_path=path)
  self.assertEqual(rc,1);self.assertEqual(result['workers']['status'],'PARTIAL')

 def test_duplicate_project_page_is_incomplete(self):
  def change(d):d['/pages/projects?per_page=10&page=2']['result']=[{'name':'PRIVATE_PROJECT_ALIAS'}]
  rc,result,_=self.run_subject(change);self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'UNKNOWN')

 def test_contradictory_pages_echo_is_not_complete(self):
  def change(d):d['/pages/projects?per_page=10&page=2']['result_info']={'page':1,'per_page':10,'count':0}
  rc,result,_=self.run_subject(change);self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'UNKNOWN')

 def test_null_pages_binding_map_is_unknown(self):
  def change(d):d['/pages/projects/PRIVATE_PROJECT_ALIAS']['result']['deployment_configs']['production']['d1_databases']=None
  rc,result,_=self.run_subject(change);self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'PARTIAL')

 def test_optional_pages_totals_must_match_aggregate(self):
  for info in ({'total_count':3},{'total_pages':2},{'total_count':3,'total_pages':2}):
   with self.subTest(info=info):
    def change(d):
     for page in (1,2):d['/pages/projects?per_page=10&page='+str(page)]['result_info']=info.copy()
    rc,result,_=self.run_subject(change);self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'UNKNOWN')

 def test_present_pages_totals_are_typed_nonnegative_and_stable(self):
  for key in ('total_count','total_pages'):
   for value in (True,-1,'1',None,1.0):
    with self.subTest(key=key,value=value):
     def change(d):d['/pages/projects?per_page=10&page=1']['result_info']={key:value}
     rc,result,_=self.run_subject(change);self.assertEqual(rc,1)
   def change(d):
    d['/pages/projects?per_page=10&page=1']['result_info']={key:1}
    d['/pages/projects?per_page=10&page=2']['result_info']={key:2}
   rc,result,_=self.run_subject(change);self.assertEqual(rc,1)

 def test_matching_optional_totals_accept_terminal_page_beyond_last(self):
  def change(d):
   for page in (1,2):d['/pages/projects?per_page=10&page='+str(page)]['result_info']={'page':page,'per_page':10,'count':1 if page==1 else 0,'total_count':1,'total_pages':1}
  rc,result,_=self.run_subject(change);self.assertEqual(rc,0)

 def test_empty_pages_totals_accept_zero_or_one_pages(self):
  for total_pages in (0,1):
   def change(d):d['/pages/projects?per_page=10&page=1'].update(result=[],result_info={'total_count':0,'total_pages':total_pages})
   rc,result,_=self.run_subject(change);self.assertEqual(rc,0)

 def test_nondefault_environment_binding_is_observed(self):
  def change(d):
   d['/workers/services/PRIVATE_WORKER_ALIAS']['result']['environments']=[{'environment':'preview'}]
   d['/workers/services/PRIVATE_WORKER_ALIAS/environments/preview/bindings']={'success':True,'result':[{'type':'d1','name':'DB','id':'b043cc1b-dc6c-4031-9f36-f2331728e062'}]}
  rc,result,_=self.run_subject(change);self.assertEqual(rc,0);self.assertEqual(len(result['references']),1)
  self.assertEqual(result['references'][0]['kind'],'service_environment')

 def test_invalid_d1_reference_cannot_be_silently_ignored(self):
  def change(d):d['/workers/scripts/PRIVATE_WORKER_ALIAS/settings']['result']['bindings']=[{'type':'d1','name':'DB','id':'invalid'}]
  rc,result,_=self.run_subject(change);self.assertEqual(rc,1);self.assertEqual(result['workers']['status'],'PARTIAL')

 def test_redirect_does_not_disclose_or_follow_target(self):
  path='/d1/database/b043cc1b-dc6c-4031-9f36-f2331728e062/query'
  error=urllib.error.HTTPError('https://foreign.example',307,'PRIVATE_ERROR',{},None)
  rc,result,calls=self.run_subject(exception=error,exception_path=path)
  self.assertEqual(rc,1);self.assertIsNone(result['provider_query_mutations'])

 def test_missing_token_makes_no_request(self):
  rc,result,calls=self.run_subject(token='');self.assertEqual(rc,1);self.assertEqual(calls,[])

 def test_no_empty_terminal_page_keeps_pages_unknown(self):
  def change(d):
   for page in range(2,18):d['/pages/projects?per_page=10&page='+str(page)]={'success':True,'result':[{'name':'PRIVATE_PROJECT_ALIAS_'+str(page)}]}
  rc,result,_=self.run_subject(change);self.assertEqual(rc,1);self.assertEqual(result['pages']['status'],'UNKNOWN')


if __name__=='__main__':unittest.main()
