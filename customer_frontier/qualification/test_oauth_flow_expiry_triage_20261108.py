import unittest
import oauth_flow_expiry_triage_20261108 as m
import oauth_identity_links_20261108 as b

def original():return {'status':'STRUCTURAL_LINK_INCONSISTENCY_OBSERVED',
     'catalog_sha256':b.CATALOG_SHA,'provider_zero_write_queries':2,
     'aggregate_counters':{k:(3 if k=='orphan_flow_clients' else 0) for k in b.FIELDS}}
def counts(**updates):
    c=dict(total=3,expired=3,unexpired=0,invalid_expiry=0,used=0,distinct_unknown_clients=1);c.update(updates);return c
class Triage(unittest.TestCase):
 def test_expired_only_cannot_promote_real_identity(self):
    a=m.classify(original(),counts())
    self.assertEqual(a['status'],'THREE_UNREGISTERED_FLOWS_EXPIRED_NOT_USER_OWNERSHIP')
    self.assertFalse(a['release_authority'])
    self.assertFalse(a['real_identity_qualified'])
    self.assertFalse(a['delete_or_repair_performed'])
 def test_unexpired_flow_is_blocking(self):
    a=m.classify(original(),counts(expired=2,unexpired=1))
    self.assertEqual(a['status'],'UNREGISTERED_FLOW_NOT_YET_EXPIRED_PRESENT')
 def test_invalid_expiry_not_trusted(self):
    a=m.classify(original(),counts(expired=2,invalid_expiry=1))
    self.assertEqual(a['status'],'UNREGISTERED_FLOW_INVALID_EXPIRY_PRESENT')
 def test_invalid_counter_sum_is_rejected(self):
    with self.assertRaisesRegex(m.Rejected,'TIMING_COUNTER_SUM_INCONSISTENT'):m.classify(original(),counts(unexpired=1))
 def test_baseline_drift_is_rejected(self):
    prev=original();prev['aggregate_counters']['orphan_code_clients']=1
    with self.assertRaisesRegex(m.Rejected,'UNREGISTERED_FLOW_REFERENCE_COUNTER_DRIFT'):m.classify(prev,counts())
 def test_no_actual_identifier_or_client_list_query(self):
    self.assertNotIn('SELECT *',m.SQL.upper())
    self.assertNotIn('GROUP BY',m.SQL.upper())
    self.assertNotIn('DELETE FROM',m.SQL.upper())
    self.assertNotIn('DROP TABLE',m.SQL.upper())
if __name__=='__main__':unittest.main()
