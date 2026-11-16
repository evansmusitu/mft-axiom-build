import unittest,sys,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'qualification'))
import step1_d1_billing_analytics_readonly as m

def sample():
 return {'data':{'viewer':{'accounts':[{
 'rows':[{'dimensions':{'databaseId':'db1','date':'2026-11-11'},'sum':{'rowsRead':10000,'rowsWritten':3}},
         {'dimensions':{'databaseId':'db2','date':'2026-11-12'},'sum':{'rowsRead':3000,'rowsWritten':0}}],
 'storage':[{'dimensions':{'databaseId':'db1','date':'2026-11-12'},'max':{'databaseSizeBytes':10000}},
         {'dimensions':{'databaseId':'db2','date':'2026-11-12'},'max':{'databaseSizeBytes':20000}}]
 }]}}}
class Tests(unittest.TestCase):
 def test_diagnostic_usage_only(self):
  v=m.analyse(sample())
  self.assertTrue(v['all_usage_below_published_included_bands']);self.assertEqual(v['observed_read_rows_band'],'LT50')
  r=m.receipt(sample());self.assertFalse(r['zero_additional_spend_qualified']);self.assertFalse(r['step1_closed'])
  self.assertEqual(r['release'],'NOT_RELEASE');self.assertNotIn('db1',json.dumps(r))
 def test_invalid_account_scope(self):
  for a in [[],[{} ,{}],None]:
   s=sample();s['data']['viewer']['accounts']=a
   with self.assertRaises(m.NoGo):m.analyse(s)
 def test_graphql_error_denies(self):
  s=sample();s['errors']=[{'message':'bad'}]
  with self.assertRaises(m.NoGo):m.analyse(s)
 def test_group_incomplete_denies(self):
  for key in ['rows','storage']:
   s=sample();s['data']['viewer']['accounts'][0][key]=[]
   with self.assertRaises(m.NoGo):m.analyse(s)
 def test_duplicate_rows_denies(self):
  s=sample();s['data']['viewer']['accounts'][0]['rows'].append(s['data']['viewer']['accounts'][0]['rows'][0])
  with self.assertRaises(m.NoGo):m.analyse(s)
 def test_duplicate_storage_denies(self):
  s=sample();s['data']['viewer']['accounts'][0]['storage'].append(s['data']['viewer']['accounts'][0]['storage'][0])
  with self.assertRaises(m.NoGo):m.analyse(s)
 def test_boolean_metric_denies(self):
  s=sample();s['data']['viewer']['accounts'][0]['rows'][0]['sum']['rowsRead']=True
  with self.assertRaises(m.NoGo):m.analyse(s)
 def test_negative_metric_denies(self):
  s=sample();s['data']['viewer']['accounts'][0]['rows'][0]['sum']['rowsWritten']=-1
  with self.assertRaises(m.NoGo):m.analyse(s)
 def test_null_metric_denies(self):
  s=sample();s['data']['viewer']['accounts'][0]['storage'][0]['max']['databaseSizeBytes']=None
  with self.assertRaises(m.NoGo):m.analyse(s)
 def test_current_storage_latest_per_db(self):
  s=sample();s['data']['viewer']['accounts'][0]['storage'].append({'dimensions':{'date':'2026-11-10','databaseId':'db1'},'max':{'databaseSizeBytes':40000}})
  self.assertEqual(m.analyse(s)['observed_storage_bytes_band'],'LT50')
  self.assertEqual(m.analyse(s)['distinct_databases_with_storage_samples'],2)
 def test_missing_storage_today_no_certification(self):
  s=sample();s['data']['viewer']['accounts'][0]['storage'][0]['dimensions']['date']='2026-11-10'
  self.assertFalse(m.analyse(s)['storage_samples_include_end_date'])
  self.assertFalse(m.receipt(s)['zero_additional_spend_qualified'])
 def test_over_included_limit_reported_but_never_authorized(self):
  s=sample();s['data']['viewer']['accounts'][0]['rows'][0]['sum']['rowsWritten']=m.LIMIT_ROWS_WRITTEN
  v=m.analyse(s);self.assertFalse(v['all_usage_below_published_included_bands']);self.assertEqual(v['observed_written_rows_band'],'AT_OR_OVER_LIMIT')
  self.assertFalse(m.receipt(s)['zero_additional_spend_qualified'])
 def test_out_of_range_and_truncated_deny(self):
  s=sample();s['data']['viewer']['accounts'][0]['rows'][0]['dimensions']['date']='2026-12-01'
  with self.assertRaises(m.NoGo):m.analyse(s)
  s=sample();s['data']['viewer']['accounts'][0]['rows']*=5000
  with self.assertRaises(m.NoGo):m.analyse(s)
 def test_unavailable_token_denies_before_network(self):
  with self.assertRaises(m.NoGo):m.request('x')
 def test_fixed_query_contains_no_mutation(self):
  self.assertEqual(m.ENDPOINT,'https://api.cloudflare.com/client/v4/graphql')
  self.assertTrue(m.QUERY.lstrip().startswith('query AXIOMStep1'))
  for banned in ['mutation ', 'INSERT ', 'DELETE ', 'UPDATE ', 'queryBatchResponseBytes']:
   self.assertNotIn(banned,m.QUERY)

if __name__=='__main__':unittest.main()
