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
  self.assertTrue(all('CUSTOMER' not in x['name'].upper().split('_')[0] for x in rows))
 def test_schema_zero_write_accepts_only_pinned_namespace(self):
  rows=m.local_schema()
  self.assertEqual(m.parse_sql(reply(rows),'catalog'),rows)
  with self.assertRaisesRegex(m.Reject,'BOUNDS'):m.parse_sql(reply([{'type':'table','name':'unrelated','sql':'x'}]),'catalog')
  with self.assertRaisesRegex(m.Reject,'ZERO_WRITE'):m.parse_sql(reply(rows,changes=1),'catalog')
  with self.assertRaisesRegex(m.Reject,'ZERO_WRITE'):m.parse_sql(reply(rows,written=1),'catalog')
 def test_row_counts_are_aggregate_only_and_bounded(self):
  self.assertEqual(m.parse_sql(reply([{'flows':0,'sessions':0}]),'counts'),[{'flows':0,'sessions':0}])
  for bad in ([{'flows':'PRIVATE','sessions':0}],[{'flows':0,'sessions':-1}],
              [{'flows':0,'sessions':0,'email':'PRIVATE'}]):
   with self.assertRaises(m.Reject):m.parse_sql(reply(bad),'counts')
 def test_expected_schema_stays_source_bound(self):
  self.assertRegex(m.EXPECTED_SOURCE_BLOB,r'^[a-f0-9]{40}$')
  self.assertRegex(m.sha(m.canonical(m.local_schema())),r'^[a-f0-9]{64}$')
if __name__=='__main__':unittest.main()
