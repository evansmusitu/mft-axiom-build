import importlib.util
import hashlib
import json
import pathlib
import unittest
import urllib.error
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('topo', ROOT/'qualification/mcn072_cloudflare_topology.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
QUEUE='a'*32

class Response:
  status=200
  headers={'Content-Type':'application/json'}
  def __init__(self, data):self.data=data
  def __enter__(self):return self
  def __exit__(self,*a):pass
  def read(self,*a):return json.dumps(self.data).encode()

class Opener:
  def __init__(self, *, producers=None, consumers=None, bad=None, wrong_queue=False):
    self.producers=[] if producers is None else producers
    self.consumers=[] if consumers is None else consumers
    self.bad=bad
    self.wrong_queue=wrong_queue
    self.calls=[]
    self.consumer_list=self.consumers
    self.consumer_detail=(self.consumers[0] if self.consumers else {})
  def open(self,req,timeout):
    assert req.get_method()=='GET'
    self.calls.append(req.full_url)
    if self.bad=='redirect':raise urllib.error.HTTPError(req.full_url,302,'redirect',{},None)
    if self.bad=='forbidden':raise urllib.error.HTTPError(req.full_url,403,'forbidden',{},None)
    if req.full_url.endswith('/consumers'):
      return Response({'success':True,'result':self.consumer_list})
    if '/consumers/' in req.full_url:
      return Response({'success':True,'result':self.consumer_detail})
    if '?page=' in req.full_url:
      return Response({'success':True,'result':[{'queue_id':QUEUE}],
        'result_info':{'page':1,'total_pages':1,'total_count':1}})
    return Response({'success':True,'result':{'queue_id':('b'*32 if self.wrong_queue else QUEUE),
      'consumers':self.consumers,'consumers_total_count':len(self.consumers),
      'producers':self.producers,'producers_total_count':len(self.producers)}})

class TestTopology(unittest.TestCase):
  def test_one_unconnected_queue_does_not_become_fairness(self):
    o=Opener()
    r=mod.inspect('secret-test-token',o)
    self.assertEqual(len(o.calls),2)
    self.assertEqual(r['queues'][0]['worker_producer_count'],0)
    self.assertEqual(r['queues'][0]['worker_consumer_count'],0)
    self.assertFalse(r['postgres_scheduler_correlated'])
    self.assertFalse(r['mcn072_qualified'])
    self.assertNotIn(QUEUE,json.dumps(r))
  def test_worker_linkage_only_digest_no_plaintext(self):
    o=Opener(producers=[{'type':'worker','script':'secret_worker'}],consumers=[{'type':'worker','script_name':'secret_worker','consumer_id':'c'*32}])
    r=mod.inspect('secret-test-token',o)
    self.assertEqual(r['queues'][0]['worker_producer_count'],1)
    self.assertEqual(r['queues'][0]['worker_consumer_count'],1)
    self.assertNotIn('secret_worker',json.dumps(r))
    self.assertFalse(r['mcn072_qualified'])
  def test_verified_consumer_list_can_fill_missing_worker_name(self):
    consumer_id='c'*32
    o=Opener(consumers=[{'type':'worker','consumer_id':consumer_id}])
    o.consumer_list=[{'type':'worker','consumer_id':consumer_id,'script_name':'current-worker'}]
    r=mod.inspect('secret-test-token',o)
    self.assertEqual(r['queues'][0]['worker_consumer_count'],1)
    self.assertEqual(len(o.calls),3)
    self.assertNotIn('current-worker',json.dumps(r))
    self.assertFalse(r['postgres_scheduler_correlated'])
  def test_consumer_list_identity_conflict_fails_closed(self):
    o=Opener(consumers=[{'type':'worker','consumer_id':'c'*32}])
    o.consumer_list=[{'type':'worker','consumer_id':'d'*32,'script_name':'current-worker'}]
    with self.assertRaises(mod.ProbeFailure):mod.inspect('token',o)
  def test_missing_secret_no_network(self):
    o=Opener()
    with self.assertRaises(mod.ProbeFailure):mod.inspect('',o)
    self.assertEqual(o.calls,[])
  def test_redirect_fails(self):
    with self.assertRaises(mod.ProbeFailure):mod.inspect('token',Opener(bad='redirect'))
  def test_http_403_fails(self):
    with self.assertRaises(mod.ProbeFailure):mod.inspect('token',Opener(bad='forbidden'))
  def test_wrong_queue_identity_fails(self):
    with self.assertRaises(mod.ProbeFailure):mod.inspect('token',Opener(wrong_queue=True))
  def test_unrecognized_producer_type_fails(self):
    with self.assertRaises(mod.ProbeFailure):mod.inspect('token',Opener(producers=[{'type':'unknown','script':'name'}]))
  def test_duplicate_workers_do_not_create_linkage(self):
    with self.assertRaises(mod.ProbeFailure):mod.inspect('token',Opener(producers=[{'type':'worker','script':'same'},{'type':'worker','script':'same'}]))
  def test_absent_producer_name_reports_safe_role_code(self):
    with self.assertRaisesRegex(mod.ProbeFailure,'PRODUCER_WORKER_SCRIPT_MISSING_OR_INVALID'):
      mod.inspect('token',Opener(producers=[{'type':'worker'}]))
  def test_absent_consumer_name_reports_safe_role_code(self):
    with self.assertRaisesRegex(mod.ProbeFailure,'CONSUMER_WORKER_SCRIPT_MISSING_OR_INVALID'):
      mod.inspect('token',Opener(consumers=[{'type':'worker','consumer_id':'c'*32}]))
  def test_missing_count_fails(self):
    o=Opener()
    old=o.open
    def bad(req,timeout):
      r=old(req,timeout)
      if '?page=' not in req.full_url: r.data['result'].pop('producers_total_count')
      return r
    o.open=bad
    with self.assertRaises(mod.ProbeFailure):mod.inspect('token',o)
  def test_request_allowlist_rejects_arbitrary_path(self):
    with self.assertRaises(mod.ProbeFailure):mod.fetch(mod.PREFIX+'/'+QUEUE+'/messages/pull','token',Opener())
  def test_no_raw_body_emitted(self):
    r=mod.inspect('token',Opener())
    self.assertNotIn('result_info',json.dumps(r))
  def test_no_unjustified_independent_witness(self):
    r=mod.inspect('token',Opener())
    self.assertFalse(r['independent_witness_verified'])
    self.assertFalse(r['tenant_mapping_verified'])


  def test_exact_consumer_get_recovers_worker_name_with_matching_id(self):
    consumer_id='c'*32
    o=Opener(consumers=[{'type':'worker','consumer_id':consumer_id}])
    o.consumer_list=[{'type':'worker','consumer_id':consumer_id}]
    o.consumer_detail={'type':'worker','consumer_id':consumer_id,'script_name':'witnessed-actual-worker'}
    result=mod.inspect('test-token',o)
    self.assertEqual(result['queues'][0]['worker_consumer_count'],1)
    self.assertEqual(len(o.calls),4)
    self.assertTrue(o.calls[-1].endswith('/consumers/'+consumer_id))
    self.assertNotIn('witnessed-actual-worker',json.dumps(result))
    self.assertFalse(result['postgres_scheduler_correlated'])
    self.assertFalse(result['mcn072_qualified'])

  def test_exact_consumer_get_rejects_conflicting_identity(self):
    consumer_id='c'*32
    o=Opener(consumers=[{'type':'worker','consumer_id':consumer_id}])
    o.consumer_list=[{'type':'worker','consumer_id':consumer_id}]
    o.consumer_detail={'type':'worker','consumer_id':'d'*32,'script_name':'other'}
    with self.assertRaisesRegex(mod.ProbeFailure,'CONSUMER_EXACT_IDENTITY_CONFLICT'):
      mod.inspect('test-token',o)

  def test_exact_consumer_get_rejects_conflicting_type(self):
    consumer_id='c'*32
    o=Opener(consumers=[{'type':'worker','consumer_id':consumer_id}])
    o.consumer_list=[{'type':'worker','consumer_id':consumer_id}]
    o.consumer_detail={'type':'http_pull','consumer_id':consumer_id,'script_name':'forged'}
    with self.assertRaisesRegex(mod.ProbeFailure,'CONSUMER_EXACT_IDENTITY_CONFLICT'):
      mod.inspect('test-token',o)

  def test_exact_consumer_get_path_rejects_other_id_shapes(self):
    with self.assertRaisesRegex(mod.ProbeFailure,'UNAPPROVED_URL_PATH'):
      mod.fetch(mod.PREFIX+'/'+QUEUE+'/consumers/../secret','token',Opener())

if __name__=='__main__':unittest.main()
