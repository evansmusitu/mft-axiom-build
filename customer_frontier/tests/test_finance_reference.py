import json, unittest, sys
from pathlib import Path
from decimal import Decimal
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HERE/'benchmarks'))
from build_reference_cases import build,npv,bond

class FinanceReferenceTests(unittest.TestCase):
 def test_complete_fixed_vectors(self):
  x=build();self.assertEqual(x['claim'],'REFERENCE_VECTORS_ONLY_NOT_AXIOM_TESTED');self.assertEqual(len(x['cases']),34)
  self.assertEqual(len({r['id'] for r in x['cases']}),34)
  self.assertEqual({r['operation'] for r in x['cases']},{'finance.npv','finance.bond_price','optimization.quadratic'})
 def test_frozen_file_matches_generator(self):
  frozen=json.loads((HERE/'benchmarks/finance_reference_cases.json').read_text());self.assertEqual(frozen,build())
 def test_npv_values(self):
  for r in build()['cases']:
   if r['operation']=='finance.npv':self.assertEqual(Decimal(r['expected']),npv(r['args']['cashflows'],r['args']['rate']))
 def test_bond_values(self):
  for r in build()['cases']:
   if r['operation']=='finance.bond_price':
    a=r['args'];self.assertEqual(Decimal(r['expected']),bond(a['face'],a['coupon_rate'],a['maturity'],a['yield']))
 def test_qp_residual_stationary_and_global_convexity(self):
  for r in build()['cases']:
   if r['operation']!='optimization.quadratic':continue
   a=r['args'];x=list(map(Decimal,r['expected_x']));self.assertEqual(Decimal(a['Q'][0][0])*x[0]+Decimal(a['c'][0]),0)
   self.assertEqual(Decimal(a['Q'][1][1])*x[1]+Decimal(a['c'][1]),0)
   self.assertTrue(all(a['Q'][k][k]>0 for k in range(2)))

if __name__=='__main__':unittest.main()
