import importlib.util,sys,unittest
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'qualification/existing_stage_idp_schema_parity_readonly.py'
spec=importlib.util.spec_from_file_location('idp_schema_parity_readonly',p)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)

def reply(rows,changes=0,written=0):
 return {'success':True,'result':[{'success':True,'results':rows,
 'meta':{'changed_db':False,'changes':changes,'rows_written':written}}]}
class Parity(unittest.TestCase):
 def test_existing_reviewed_namespace_reconstructs_locally_without_customer_data(self):
  rows=m.local_schema()
  self.assertEqual(sum(x['type']=='table' for x in rows),2)
  self.assertTrue(all(x['name'].startswith('customer_idp_') for x in rows))
  self.assertTrue(all(x['name'].startswith('customer_idp_') for x in rows))
 def test_schema_zero_write_accepts_only_pinned_namespace(self):
  rows=m.local_schema()
  self.assertEqual(m.parse_sql(reply(rows),'catalog'),rows)
  with self.assertRaisesRegex(m.Reject,'BOUNDS'):m.parse_sql(reply([{'type':'table','name':'unrelated','sql':'x'}]),'catalog')
  with self.assertRaisesRegex(m.Reject,'ZERO_WRITE'):m.parse_sql(reply(rows,changes=1),'catalog')
  with self.assertRaisesRegex(m.Reject,'ZERO_WRITE'):m.parse_sql(reply(rows,written=1),'catalog')
 def test_row_counts_are_aggregate_only_and_bounded(self):
  clean={'flows':0,'sessions':0,'pending_flows':0,'processing_flows':0,
   'active_sessions':0,'unexpired_active_sessions':0}
  self.assertEqual(m.parse_sql(reply([clean]),'counts'),[clean])
  for bad in ([{**clean,'flows':'PRIVATE'}],[{**clean,'sessions':-1}],
              [{**clean,'email':'PRIVATE'}],[{**clean,'unexpired_active_sessions':1}],
              [{**clean,'pending_flows':1}]):

   with self.assertRaises(m.Reject):m.parse_sql(reply(bad),'counts')
 def test_expected_schema_stays_source_bound(self):
  self.assertRegex(m.EXPECTED_SOURCE_BLOB,r'^[a-f0-9]{40}$')
  self.assertRegex(m.sha(m.canonical(m.local_schema())),r'^[a-f0-9]{64}$')
if __name__=='__main__':unittest.main()
