import importlib.util,sys,unittest
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'qualification/primary_d1_idp_schema_readonly.py'
spec=importlib.util.spec_from_file_location('primary_idp_inventory',p)
m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)

class SchemaOnly(unittest.TestCase):
 def inventory(self,n=11):
  return {'success':True,'result':[{'uuid':f'{i:08x}-1111-4111-8111-222222222222','name':f'db-{i}'} for i in range(n)],
   'result_info':{'page':1,'count':n,'total_count':n}}
 def q(self,names,changes=0):
  return {'success':True,'result':[{'success':True,'results':[{'name':x} for x in names],
   'meta':{'changed_db':False,'changes':changes,'rows_written':0}}]}
 def test_complete_metadata_inventory_and_uniqueness(self):
  self.assertEqual(len(m.parse_catalog(self.inventory())),11)
  with self.assertRaisesRegex(m.Reject,'INCOMPLETE_OR_CHANGED'):m.parse_catalog(self.inventory(10))
  with self.assertRaisesRegex(m.Reject,'IDENTITY_COLLISION'):
   x=self.inventory();x['result'][1]['uuid']=x['result'][0]['uuid'];m.parse_catalog(x)
 def test_exact_schema_names_only_and_zero_write(self):
  self.assertEqual(m.parse_query(self.q(m.NAMES)),set(m.NAMES))
  self.assertEqual(m.parse_query(self.q([])),set())
  with self.assertRaisesRegex(m.Reject,'ZERO_WRITE'):m.parse_query(self.q(m.NAMES,changes=1))
  with self.assertRaisesRegex(m.Reject,'SCHEMA_RESULT_INVALID'):m.parse_query(self.q(['customer_email']))
 def test_negative_missing_catalog_and_response_rejected(self):
  with self.assertRaises(m.Reject):m.parse_catalog({'success':False,'result':[]})
  with self.assertRaises(m.Reject):m.parse_query({'success':True,'result':[{'success':False}]})
if __name__=='__main__':unittest.main()
