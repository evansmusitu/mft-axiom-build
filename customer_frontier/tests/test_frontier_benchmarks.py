import json,pathlib,sys,unittest
base=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(base/'benchmarks'))
from verify_benchmarks import evaluate
M=json.loads((base/'benchmarks/frontier_manifest.json').read_text())
class BenchmarkTests(unittest.TestCase):
 def test_empty_is_not_proven(self):
  r=evaluate(M,{'program':M['program'],'observations':[]});self.assertEqual(r['status'],'NOT_CERTIFIED');self.assertTrue(all(x['state']=='NOT_PROVEN' for x in r['comparisons']))
 def test_unknown_dimension_rejected(self):
  r=evaluate(M,{'program':M['program'],'observations':[{'id':'falseworldbest','axiom':1}]});self.assertEqual(r['status'],'FAILED_INPUT')
 def test_lacking_independent_evidence_fails_closed(self):
  r=evaluate(M,{'program':M['program'],'observations':[{'id':'accuracy','axiom':1,'baseline':0}]});self.assertEqual(r['comparisons'][2]['state'],'NOT_PROVEN')
 def test_synthetic_nonqualifying(self):
  x={'id':'accuracy','axiom':1,'baseline':0,'baseline_product':'Wolfram','baseline_version':'x','benchmark_date':'2026-10-31','tasks_sha256':'0'*64,'measurement_sha256':'1'*64,'independent_verifier':'external','independent_verifier_evidence_sha256':'2'*64,'same_tasks':True,'same_data':True,'same_budget':True,'synthetic':True};r=evaluate(M,{'program':M['program'],'observations':[x]});self.assertEqual(r['comparisons'][2]['state'],'NOT_PROVEN')
 def test_no_superiority_claim_even_from_metrically_good_candidate(self):
  x={'id':'onboarding_p90_seconds','axiom':80,'baseline':100,'baseline_product':'test','baseline_version':'x','benchmark_date':'2026-10-31','tasks_sha256':'0'*64,'measurement_sha256':'1'*64,'independent_verifier':'external','independent_verifier_evidence_sha256':'2'*64,'same_tasks':True,'same_data':True,'same_budget':True};r=evaluate(M,{'program':M['program'],'observations':[x]});self.assertEqual(r['status'],'NOT_CERTIFIED');self.assertEqual(r['comparisons'][0]['state'],'WIN_CANDIDATE_UNVERIFIED')
if __name__=='__main__':unittest.main()
