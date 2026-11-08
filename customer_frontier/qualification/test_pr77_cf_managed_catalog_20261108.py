import unittest
import pr77_synthetic_crosscustomer_denials_20261108 as v

class ProviderSystemTables(unittest.TestCase):
 def test_cloudflare_managed_metadata_not_counted_as_pr77_user_object(self):
  names=[{'type':'table','name':'synthetic_%02d'%i} for i in range(31)]
  catalog=names+[{'type':'table','name':'_cf_KV'}]
  calls=[]
  def fetch(kind):
   calls.append(kind)
   if kind=='target_metadata':return {'uuid':v.TARGET,'name':'axiom-pr77-synthetic-only-20261108'}
   if kind=='preserved_metadata':return {'uuid':v.PRESERVED,'name':'axiom-disposable-dr-target-20261108'}
   if kind=='catalog':return catalog
   if kind=='counts':return [dict(v.EXPECTED)]
   if kind in v.ATTACKS:return 200,{'success':False,'errors':[{'message':v.ATTACKS[kind][1]}]}
   raise AssertionError('unknown kind')
  verdict=v.observe(fetch)
  self.assertEqual(verdict['status'],'TWO_CROSSCUSTOMER_PR77_TRIGGER_DENIALS_NO_RESIDUE_PASS')
  self.assertEqual(calls.count('catalog'),2)
  self.assertEqual(calls.count('token'),1)
  self.assertEqual(calls.count('code'),1)
  self.assertFalse(verdict['production_oauth_modified'])
  self.assertFalse(verdict['release_authority'])

 def test_unrecognized_user_table_still_blocks_even_when_cf_table_allowed(self):
  catalog=[{'type':'table','name':'synthetic_%02d'%i} for i in range(32)]
  catalog.append({'type':'table','name':'_cf_KV'})
  def fetch(kind):
   if kind=='target_metadata':return {'uuid':v.TARGET,'name':'axiom-pr77-synthetic-only-20261108'}
   if kind=='preserved_metadata':return {'uuid':v.PRESERVED,'name':'axiom-disposable-dr-target-20261108'}
   if kind=='catalog':return catalog
   if kind=='counts':return [dict(v.EXPECTED)]
   if kind in v.ATTACKS:raise AssertionError('should never attempt forbidden insert')
   raise AssertionError('unknown kind')
  with self.assertRaisesRegex(v.Reject,'CATALOG_OBJECT_COUNT_DRIFT'):v.observe(fetch)

if __name__=='__main__':unittest.main()
