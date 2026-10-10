import unittest
from connect.mining import normalize_mining_rows, optimize_interventions
from connect.core import CanonicalEnvelope, IntegrationGate
from connect.registry import AdapterRegistry, AdapterSpec

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


    def test_normalization_preserves_spatial_asset_and_event_metadata(self):
        row=dict(
            SCENARIO[0],
            record_id="event-001",
            asset_id="haul-truck-17",
            site="open-pit-a",
            event_time="2026-10-06T05:00:00Z",
            latitude=-17.83,
            longitude=31.05,
        )
        record=normalize_mining_rows([row]).records[0]
        self.assertEqual(record["record_id"],"event-001")
        self.assertEqual(record["asset_id"],"haul-truck-17")
        self.assertEqual(record["site"],"open-pit-a")
        self.assertEqual(record["event_time"],"2026-10-06T05:00:00Z")
        self.assertEqual(record["latitude"],-17.83)
        self.assertEqual(record["longitude"],31.05)

    def test_spatial_metadata_requires_coordinate_pair_and_timezone(self):
        with self.assertRaisesRegex(ValueError,"coordinate_pair_required"):
            normalize_mining_rows([dict(SCENARIO[0],latitude=-17.83)])
        with self.assertRaisesRegex(ValueError,"event_time_timezone_required"):
            normalize_mining_rows([dict(SCENARIO[0],event_time="2026-10-06T05:00:00")])
        with self.assertRaisesRegex(ValueError,"unknown_fields"):
            normalize_mining_rows([dict(SCENARIO[0],unexpected="not-canonical")])

    def test_registry_is_domain_agnostic(self):
        registry=AdapterRegistry()
        registry.register(AdapterSpec(name='Mining Adapter',domain='mining',version='1.0.0'))
        registry.register(AdapterSpec(name='Finance Adapter',domain='finance',version='1.0.0'))
        self.assertEqual([x.domain for x in registry.list()],['finance','mining'])
        self.assertEqual(registry.get('Mining Adapter').domain,'mining')

    def test_optimizer_respects_hard_budget_and_reduces_selected_hazard_risk(self):
        envelope=normalize_mining_rows(SCENARIO)
        result=optimize_interventions(envelope,budget=50000)
        self.assertLessEqual(result.spend,50000)
        self.assertEqual(
            result.selected,
            ("Ground collapse", "Explosives / gases", "Shaft falls"),
        )
        self.assertEqual(result.gate,"LOCKED")
        expected_reduction=sum(
            row["exposure"]*row["severity"]*row["likelihood"]*row["benefit"]
            for row in SCENARIO[:3]
        )
        self.assertAlmostEqual(result.benefit, expected_reduction, places=12)
        self.assertAlmostEqual(
            result.residual_risk,
            result.baseline_risk - expected_reduction,
            places=12,
        )

    def test_optimizer_accepts_more_than_twenty_rows_without_approximation(self):
        rows=[
            {
                "hazard": f"Hazard {index:02d}",
                "exposure": 1.0,
                "severity": 1.0,
                "likelihood": 1.0,
                "cost": 1000.0 if index else 1.0,
                "benefit": 0.01 if index else 1.0,
            }
            for index in range(25)
        ]
        result=optimize_interventions(normalize_mining_rows(rows), budget=1.0)
        self.assertEqual(result.selected, ("Hazard 00",))
        self.assertEqual(result.spend, 1.0)
        self.assertAlmostEqual(result.residual_risk, 24.0, places=12)

    def test_invalid_input_is_rejected(self):
        with self.assertRaises(ValueError): normalize_mining_rows([{'hazard':'x'}])
        invalid_benefit=dict(SCENARIO[0], benefit=1.01)
        with self.assertRaisesRegex(ValueError, 'value_out_of_range'):
            normalize_mining_rows([invalid_benefit])

    def test_axiom_gate_is_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError,'AXIOM_INTEGRATION_BLOCKED'): IntegrationGate().assert_open()

if __name__=="__main__": unittest.main()
