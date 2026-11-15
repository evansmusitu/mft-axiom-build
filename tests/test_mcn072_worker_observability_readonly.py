import hashlib
import json
import unittest
from qualification.mcn072_worker_observability_readonly import inspect

H=lambda s:hashlib.sha256(s.encode()).hexdigest()
A='9'*32
Q='private-queue-worker'
C='other-postgres-worker'

def fixture(denied=False,duplicate=False,missing=False):
    names=[{'id':Q},{'id':C}]
    if duplicate:names.append({'id':Q})
    config={
      Q:{'logpush':False,'observability':{'enabled':True,'head_sampling_rate':0.5,
        'logs':{'enabled':True,'invocation_logs':True,'persist':True,'head_sampling_rate':0.5},
        'traces':{'enabled':True,'persist':False,'head_sampling_rate':0.2}},
        'tail_consumers':[{'service':'private-receiver','environment':'production'}]},
      C:{'logpush':True,'observability':{'enabled':False,'logs':{'enabled':False,'invocation_logs':False,'persist':False}},'tail_consumers':[]},
    }
    def getter(path):
      if denied and path.endswith('/script-settings'):raise PermissionError('forbidden/secret private-receiver')
      if path.endswith('/workers/scripts'):return {'result':names}
      if path.endswith('/workers/domains'):
        return {'result':[{'service':C,'hostname':'secret-candidate.example','enabled':True},
                          {'service':'third-party','hostname':'other.example','enabled':True}]}
      for name in (Q,C):
        if path.endswith('/workers/scripts/'+name+'/script-settings'):
          return {'result':config[name] if not missing or name!=C else {}}
      raise LookupError(path)
    return getter

class Cases(unittest.TestCase):
 def test_reads_exact_two_observability_records_and_routed_host_count(self):
  r=inspect(fixture(),A,H(Q),H(C))
  self.assertTrue(r['read_complete'])
  self.assertEqual(r['queue']['logpush'],False)
  self.assertEqual(r['queue']['logs_invocation_enabled'],True)
  self.assertEqual(r['queue']['logs_persist'],True)
  self.assertEqual(r['queue']['logs_sampling_rate'],0.5)
  self.assertEqual(r['candidate']['domains_enabled'],1)
  self.assertEqual(r['candidate']['logpush'],True)
  self.assertEqual(r['queue']['tail_consumer_count'],1)
  self.assertFalse(r['cloudflare_pg_correspondence'])
 def test_no_raw_name_route_secret_or_host_in_report(self):
  r=inspect(fixture(),A,H(Q),H(C))
  text=json.dumps(r)
  for secret in [Q,C,'private-receiver','secret-candidate.example','other.example','9'*32]:
   self.assertNotIn(secret,text)
 def test_denial_cannot_be_reported_as_complete(self):
  r=inspect(fixture(denied=True),A,H(Q),H(C))
  self.assertFalse(r['read_complete'])
  self.assertFalse(r['mcn072_qualified'])
 def test_duplicate_worker_inventory_refused(self):
  r=inspect(fixture(duplicate=True),A,H(Q),H(C))
  self.assertFalse(r['read_complete'])
 def test_missing_logs_are_unknown_not_false_or_enabled(self):
  r=inspect(fixture(missing=True),A,H(Q),H(C))
  self.assertIsNone(r['candidate']['logs_invocation_enabled'])
  self.assertFalse(r['mcn072_qualified'])
 def test_missing_one_candidate_is_fail_closed(self):
  r=inspect(fixture(),A,H(Q),H('not-here'))
  self.assertFalse(r['read_complete'])
if __name__=='__main__': unittest.main()
