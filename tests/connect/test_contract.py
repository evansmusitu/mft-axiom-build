import unittest
from connect.mining import normalize_mining_rows, optimize_interventions
from connect.core import CanonicalEnvelope

SCENARIO=[
 {"hazard":"Ground collapse","exposure":0.54,"severity":10,"likelihood":0.62,"cost":18000,"benefit":0.34},
 {"hazard":"Explosives / gases","exposure":0.25,"severity":8,"likelihood":0.48,"cost":12000,"benefit":0.28},
 {"hazard":"Shaft falls","exposure":0.15,"severity":9,"likelihood":0.40,"cost":14000,"benefit":0.24},
 {"hazard":"Electrocution / equipment","exposure":0.06,"severity":7,"likelihood":0.36,"cost":9000,"benefit":0.18},
]

class ConnectContractTests(unittest.TestCase):
    def test_normalization_produces_canonical_envelope(self):
        envelope=normalize_mining_rows(SCENARIO)
        self.assertIsInstance(envelope, CanonicalEnvelope)
        self.assertEqual(envelope.contract,"musitu.connect.canonical.v1")
        self.assertEqual(envelope.domain,"mining")
        self.assertEqual(len(envelope.records),4)
        self.assertEqual(envelope.records[0]["hazard"],"Ground collapse")

    def test_optimizer_respects_hard_budget(self):
        envelope=normalize_mining_rows(SCENARIO)
        result=optimize_interventions(envelope,budget=50000)
        self.assertLessEqual(result.spend,50000)
        self.assertTrue(result.selected)
        self.assertEqual(result.gate,"LOCKED")

if __name__=="__main__": unittest.main()
