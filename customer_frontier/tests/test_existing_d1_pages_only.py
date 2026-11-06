"""Offline fake Pages provider; reject incomplete evidence and private output."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

SOURCE=Path(__file__).resolve().parents[1]/'qualification/existing_d1_pages_only.py'
class PagesOnly(unittest.TestCase):
 def run_subject(self,change=lambda data:None,error=None,token='PRIVATE_TOKEN'):
  spec=importlib.util.spec_from_file_location('pages_only',SOURCE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
  name='PRIVATE_PROJECT';key='2571795a-80fe-4f63-9b95-07948b4cefdb'
  data={'/pages/projects?per_page=10&page=1':{'success':True,'result':[{'name':name}]},
   '/pages/projects?per_page=10&page=2':{'success':True,'result':[]},
   '/pages/projects/'+name:{'success':True,'result':{'name':name,'deployment_configs':{'production':{'env_vars':{'SECRET':{'value':'PRIVATE_VALUE'}},'d1_databases':{'PRIVATE_BINDING':{'id':key}}},'preview':{}}}}}
  change(data);requests=[];files={}
  class Response:
   status=200
   def __init__(self,value):self.value=value
   def __enter__(self):return self
   def __exit__(self,*args):return False
   def read(self,size):return json.dumps(self.value).encode()[:size]
  class Opener:
   def open(self,req,timeout):
    requests.append(req)
    if error:raise error
    return Response(data[req.full_url[len(m.API):]])
  class Sink:
   def __init__(self,name):self.name=name
   def __str__(self):return self.name
   def write_bytes(self,raw):files[self.name]=raw
   def write_text(self,raw):files[self.name]=raw
  stdout=io.StringIO()
  with patch.object(m.urllib.request,'build_opener',return_value=Opener()),patch.object(m,'Path',Sink),patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':token}),contextlib.redirect_stdout(stdout):rc=m.observe()
  for secret in ('PRIVATE_TOKEN','PRIVATE_PROJECT','PRIVATE_BINDING','PRIVATE_VALUE','PRIVATE_MESSAGE'):self.assertNotIn(secret,stdout.getvalue())
  for req in requests:
   self.assertEqual(req.get_method(),'GET');self.assertIsNone(req.data);self.assertTrue(req.full_url.startswith(m.API+'/pages/projects'))
   self.assertNotIn('/d1/',req.full_url);self.assertNotIn('/workers/',req.full_url)
  result=json.loads(files['existing-d1-pages-only.json'])
  self.assertEqual(result['database_queries'],0);self.assertEqual(result['mutations'],0)
  for key in ('target_admitted','global_absence_certified','backup_restore_qualified','hosted_migration_qualified','release_authority','historical_deployment_bindings_covered'):self.assertFalse(result[key])
  return rc,result,requests

 def test_matches_wrangler_query_and_hashes_current_references(self):
  rc,out,req=self.run_subject();self.assertEqual(rc,0);self.assertEqual(len(req),3)
  self.assertEqual(req[0].full_url.rsplit('/',1)[-1],'projects?per_page=10&page=1');self.assertEqual(len(out['references']),1)

 def test_counts_are_optional_but_present_totals_must_be_coherent(self):
  for info,expected in (({'total_count':1,'total_pages':1},0),({'total_count':3},1),({'total_pages':2},1),({'per_page':100},1),({'count':9},1),({'total_count':True},1),({'total_pages':None},1)):
   with self.subTest(info=info):
    def change(d):d['/pages/projects?per_page=10&page=1']['result_info']=info
    rc,out,_=self.run_subject(change);self.assertEqual(rc,expected)

 def test_changed_totals_and_duplicate_pages_are_incomplete(self):
  def change(d):
   d['/pages/projects?per_page=10&page=1']['result_info']={'total_count':1}
   d['/pages/projects?per_page=10&page=2']['result_info']={'total_count':2}
  rc,out,_=self.run_subject(change);self.assertEqual(rc,1)
  def duplicate(d):d['/pages/projects?per_page=10&page=2']['result']=[{'name':'PRIVATE_PROJECT'}]
  rc,out,_=self.run_subject(duplicate);self.assertEqual(rc,1)

 def test_missing_or_null_configs_remain_partial(self):
  for value in (None,{'production':{}},{'production':{},'preview':{'d1_databases':None}}):
   def change(d):d['/pages/projects/PRIVATE_PROJECT']['result']['deployment_configs']=value
   rc,out,_=self.run_subject(change);self.assertEqual(rc,1)

 def test_bad_binding_uuid_is_not_ignored(self):
  def change(d):d['/pages/projects/PRIVATE_PROJECT']['result']['deployment_configs']['production']['d1_databases']['PRIVATE_BINDING']['id']='bad'
  rc,out,_=self.run_subject(change);self.assertEqual(rc,1)

 def test_preview_reference_is_included(self):
  def change(d):d['/pages/projects/PRIVATE_PROJECT']['result']['deployment_configs']['preview']={'d1_databases':{'PRIVATE_BINDING':{'id':'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'}}}
  rc,out,_=self.run_subject(change);self.assertEqual(rc,0);self.assertEqual(len(out['references']),2)

 def test_seven_digit_error_code_preserved_without_message(self):
  error=urllib.error.HTTPError('https://foreign.example',400,'PRIVATE_MESSAGE',{},io.BytesIO(json.dumps({'success':False,'errors':[{'code':8000007,'message':'PRIVATE_MESSAGE'},{'code':True}]}).encode()))
  rc,out,req=self.run_subject(error=error);self.assertEqual(rc,1);self.assertEqual(len(req),1)
  self.assertEqual(out['transport'][0]['provider_error_codes'],[8000007])

 def test_redirect_and_permissions_do_not_become_empty_results(self):
  for status in (307,403,404):
   error=urllib.error.HTTPError('https://foreign.example',status,'PRIVATE_MESSAGE',{},None)
   rc,out,req=self.run_subject(error=error);self.assertEqual(rc,1);self.assertEqual(out['status'],'UNKNOWN');self.assertEqual(len(req),1)

 def test_project_path_injection_is_not_requested(self):
  def change(d):d['/pages/projects?per_page=10&page=1']['result'][0]['name']='../private'
  rc,out,req=self.run_subject(change);self.assertEqual(rc,1);self.assertEqual(len(req),1)

 def test_missing_token_never_requests(self):
  rc,out,req=self.run_subject(token='');self.assertEqual(rc,1);self.assertEqual(req,[])

 def test_missing_empty_terminal_is_incomplete(self):
  def change(d):
   for page in range(2,18):d['/pages/projects?per_page=10&page='+str(page)]={'success':True,'result':[{'name':'PRIVATE_PROJECT_'+str(page)}]}
  rc,out,_=self.run_subject(change);self.assertEqual(rc,1);self.assertEqual(out['status'],'UNKNOWN')

if __name__=='__main__':unittest.main()
